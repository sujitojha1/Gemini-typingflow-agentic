// Depends on: background.js globals (MODEL_POOL, GEMMA_MODEL, callGeminiWithModel, callGemmaAPI, generateContextualImage, isValidHttpUrl)
// Depends on: tools/tool_*.js (all tool files loaded before this via importScripts)

// ── Agent utilities ──────────────────────────────────────────────────────────

function agentBroadcast(tabId, task, model, detail = '') {
    const msg = { action: 'agent_status', task, model, detail };
    chrome.tabs.sendMessage(tabId, msg, () => { chrome.runtime.lastError; });
    chrome.runtime.sendMessage(msg, () => { chrome.runtime.lastError; });
}

function tabMessage(tabId, msg) {
    return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, msg, (resp) => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(resp);
        });
    });
}

async function extractFromTab(tabId) {
    try {
        const resp = await tabMessage(tabId, { action: 'extract_content' });
        if (resp?.payload) return resp.payload;
    } catch (_) {}
    // content script not loaded — inject it
    await new Promise((resolve, reject) => {
        chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }, r => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(r);
        });
    });
    await new Promise(r => setTimeout(r, 300));
    const resp = await tabMessage(tabId, { action: 'extract_content' });
    return resp?.payload || null;
}

function callModelForStructuring(payload, model) {
    return model.vision ? callGemmaAPI(payload) : callGeminiWithModel(payload, model.id);
}

// ── LLM Response Parser ──────────────────────────────────────────────────────

function parseLLMResponse(text) {
    text = text.trim();
    if (text.startsWith('```')) {
        const lines = text.split('\n');
        const end = lines[lines.length - 1].trim() === '```' ? lines.length - 1 : lines.length;
        text = lines.slice(1, end).join('\n').trim();
        if (text.startsWith('json')) text = text.slice(4).trim();
    }
    try { return JSON.parse(text); } catch (_) {}
    const m = text.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch (_) {} }
    throw new Error('Cannot parse: ' + text.slice(0, 200));
}

// ── Agent Tools Registry ─────────────────────────────────────────────────────

const AGENT_TOOLS = {
    calculate:        toolCalculate,
    searchNuggets:    toolSearchNuggets,
    summarizePage:    toolSummarizePage,
    lookupDefinition: toolLookupDefinition,
};

// ── Agent System Prompt ──────────────────────────────────────────────────────

const AGENT_SYSTEM_PROMPT = `You are a helpful AI agent that can use tools to answer questions about web page content.

You have access to the following tools:

1. calculate(expression: string)
   Evaluate a math expression. Supports: +, -, *, /, **, %, sqrt, abs, round, floor, ceil, sin, cos, tan, log, exp, pow, min, max, sum.
   Example: calculate({"expression": "sum(exp(1), exp(1), exp(2), exp(3), exp(5), exp(8))"})

2. searchNuggets(query: string)
   Search the structured knowledge nuggets extracted from the current page.
   Example: searchNuggets({"query": "transformer attention"})

3. summarizePage({})
   Get the TL;DR and tags for the current page.
   Example: summarizePage({})

4. lookupDefinition(term: string)
   Find sentences in the page that explain a specific term or concept.
   Example: lookupDefinition({"term": "backpropagation"})

Respond in ONE of these two JSON formats ONLY:

To call a tool:
{"tool_name": "<name>", "tool_arguments": {"<arg>": "<value>"}}

To give the final answer:
{"answer": "<your complete answer>"}

RULES: Respond with ONLY the JSON. No markdown, no extra text. Use tools for page info and math. ALWAYS use calculate for numbers.`;

// ── Agent Pipeline ───────────────────────────────────────────────────────────

async function runAgentPipeline(tabId) {
    const { geminiApiKey } = await chrome.storage.sync.get('geminiApiKey');
    if (!geminiApiKey) {
        agentBroadcast(tabId, 'error', null, 'API key not configured');
        return;
    }

    agentBroadcast(tabId, 'Step 1: Create an agent session', '—');
    const sessionId = 'session_' + Date.now();
    await new Promise(r => setTimeout(r, 600));

    agentBroadcast(tabId, 'Step 2: Initial Content Storage', '—');
    let payload;
    try {
        payload = await extractFromTab(tabId);
    } catch (e) {
        agentBroadcast(tabId, 'error', null, 'injection blocked by Chrome');
        return;
    }
    if (!payload?.length) {
        agentBroadcast(tabId, 'error', null, 'no extractable content');
        return;
    }

    await chrome.storage.local.set({ [`tf_agent_payload_${sessionId}`]: payload, tf_agent_tab: tabId });
    await new Promise(r => setTimeout(r, 600));

    let structureResult = null;
    let usedModel = null;
    for (const model of MODEL_POOL) {
        agentBroadcast(tabId, 'Step 3: Structuring nuggets', model.label);
        try {
            const result = await callModelForStructuring(payload, model);
            if (result.success) { structureResult = result; usedModel = model; break; }
            console.warn(`[agent] ${model.label} failed:`, result.error);
        } catch (e) {
            console.warn(`[agent] ${model.label} threw:`, e.message);
        }
    }
    if (!structureResult) {
        agentBroadcast(tabId, 'error', null, 'all models exhausted');
        return;
    }

    agentBroadcast(tabId, 'Step 4: Mounting gallery', usedModel.label);
    await tabMessage(tabId, { action: 'mount_ui', data: structureResult.api_response })
        .catch(() => {});
    chrome.tabs.sendMessage(tabId, { action: 'open_overlay' }, () => { chrome.runtime.lastError; });

    chrome.runtime.sendMessage({ action: 'agent_close_popup' }, () => { chrome.runtime.lastError; });

    await chrome.storage.local.set({
        tf_agent_nuggets: structureResult.api_response.nuggets || [],
        tf_agent_session: {
            timestamp: Date.now(),
            model: usedModel.label,
            nuggetCount: structureResult.api_response.nuggets?.length,
            tldr: structureResult.api_response.tldr,
            tags: structureResult.api_response.tags,
            star_rating: structureResult.api_response.star_rating,
        }
    });

    agentBroadcast(tabId, 'complete (Steps 1-4 Done)', usedModel.label,
        `${structureResult.api_response.nuggets?.length} nuggets`);

    if (usedModel.id !== GEMMA_MODEL) {
        runAgenticParallelTrack(tabId, payload);
    }
}

// ── Parallel Agentic Track ───────────────────────────────────────────────────
//
// Pipeline:
//   Phase 1 — session + index content & images
//   Phase 2 — LLM identifies semantic chunks from indexed text
//   Phase 3 — each chunk runs its own async agent loop (parallel)
//               findMatchingImage | generateChunkImage
//               getChunkStats → evaluateChunk → refineChunk → updateCoverage
//   Phase 4 — state handoff: refined nuggets sent to tab overlay

async function identifySemanticChunks(textBlocks, imageIndex, geminiApiKey) {
    const modelId = 'gemini-3.1-flash-lite-preview';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${geminiApiKey}`;

    const prompt = `You are a semantic content analyzer. Group the following text blocks into logical learning chunks.

TEXT BLOCKS (${textBlocks.length} items):
${JSON.stringify(textBlocks.map(b => ({ idx: b.idx, text: b.text.slice(0, 400) })))}

IMAGE POSITIONS (${imageIndex.length} images):
${JSON.stringify(imageIndex.map(img => ({ idx: img.idx })))}

Return ONLY valid JSON:
{
  "chunks": [
    {
      "text": "<grouped original text from related blocks, do not rewrite>",
      "tags": ["<semantic-tag>"],
      "blockIndices": [<original block idx values included>],
      "nearbyImageIdx": <image idx closest in position, or null>
    }
  ]
}

Rules: group related consecutive blocks; 3–8 chunks; preserve original wording; assign nearbyImageIdx by position proximity.`;

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { response_mime_type: 'application/json' }
            })
        });
        if (!res.ok) return null;
        const data = await res.json();
        const jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!jsonText) return null;
        return JSON.parse(jsonText).chunks || null;
    } catch (e) {
        console.warn('[parallel track] identifySemanticChunks failed:', e.message);
        return null;
    }
}

// Runs all tool steps for a single chunk sequentially, accumulating history.
// Called in parallel across all chunks via Promise.all.
async function runChunkAgentLoop(tabId, chunk, chunkIdx, totalChunks, imageIndex) {
    const history = [];

    // Step 1: Image — find in index by nearbyImageIdx, or generate via Gemini
    let imgSrc = null;
    if (chunk.nearbyImageIdx != null && imageIndex[chunk.nearbyImageIdx]) {
        const matched = imageIndex[chunk.nearbyImageIdx];
        imgSrc = matched.src;
        history.push({
            tool: 'findMatchingImage',
            input: { chunkIdx, nearbyImageIdx: chunk.nearbyImageIdx },
            result: { matched: true, src: imgSrc },
        });
    } else {
        const imagePrompt = chunk.text.slice(0, 300) + (chunk.tags?.length ? ' | ' + chunk.tags.join(', ') : '');
        history.push({
            tool: 'generateChunkImage',
            input: { chunkIdx, prompt: imagePrompt },
        });
        const generated = await generateContextualImage({ text: chunk.text, tags: chunk.tags || [] });
        imgSrc = generated.img_src;
        history[history.length - 1].result = { img_src: imgSrc };
    }

    // Step 2: Stats
    const stats = toolGetChunkStats({ text: chunk.text });
    history.push({ tool: 'getChunkStats', input: { chunkIdx }, result: stats });

    // Step 3: Evaluate
    const evaluation = await toolEvaluateChunk({ text: chunk.text });
    history.push({ tool: 'evaluateChunk', input: { chunkIdx }, result: evaluation });

    // Step 4: Refine — only when score is below threshold; skip if evaluation errored
    let refinedText = chunk.text;
    if (!evaluation.error && evaluation.score < 4) {
        const refined = await toolRefineChunk({ text: chunk.text, evaluation });
        refinedText = refined.refinedText || chunk.text;
        history.push({ tool: 'refineChunk', input: { chunkIdx, score: evaluation.score }, result: { refinedText } });
    } else {
        history.push({
            tool: 'refineChunk',
            input: { chunkIdx },
            result: { refinedText, skipped: true, reason: evaluation.error ? 'eval error' : 'score acceptable' },
        });
    }

    // Step 5: Coverage
    const coverage = await toolUpdateCoverage({ chunkIdx, totalChunks });
    history.push({ tool: 'updateCoverage', input: { chunkIdx, totalChunks }, result: coverage });

    agentBroadcast(
        tabId,
        `Chunk ${chunkIdx + 1}/${totalChunks}: done`,
        'Gemini Flash Lite',
        `score:${evaluation.score ?? '?'} cov:${coverage.coverage}%`
    );

    return { chunkIdx, text: chunk.text, refinedText, imgSrc, tags: chunk.tags, stats, evaluation, coverage: coverage.coverage, history };
}

async function runAgenticParallelTrack(tabId, payload) {
    const { geminiApiKey } = await chrome.storage.sync.get('geminiApiKey');
    if (!geminiApiKey) return;

    const modelId = 'gemini-3.1-flash-lite-preview';

    // Phase 1: Session + index
    const sessionId = 'session_' + Date.now();
    agentBroadcast(tabId, 'Parallel Track: session created', modelId, sessionId);

    const imageIndex = payload
        .filter(p => p.type === 'image' && isValidHttpUrl(p.src))
        .map((img, idx) => ({ idx, src: img.src }));

    const textBlocks = payload
        .filter(p => p.type === 'text' && p.text?.trim())
        .map((b, idx) => ({ idx, text: b.text }));

    await chrome.storage.local.set({
        [`tf_pt_${sessionId}_images`]: imageIndex,
        [`tf_pt_${sessionId}_texts`]: textBlocks,
        tf_pt_coverage: [],
    });

    agentBroadcast(tabId, 'Parallel Track: content indexed', modelId,
        `${textBlocks.length} text blocks · ${imageIndex.length} images`);

    // Phase 2: LLM identifies semantic chunks
    agentBroadcast(tabId, 'Parallel Track: identifying semantic chunks', modelId);
    let chunks = await identifySemanticChunks(textBlocks, imageIndex, geminiApiKey);

    if (!chunks?.length) {
        // Fallback: one chunk per text block
        chunks = textBlocks.map(b => ({ text: b.text, tags: [], blockIndices: [b.idx], nearbyImageIdx: null }));
    }

    agentBroadcast(tabId, `Parallel Track: ${chunks.length} chunks — starting async loops`, modelId);

    // Phase 3: All chunk agent loops run in parallel
    const chunkResults = await Promise.all(
        chunks.map((chunk, idx) =>
            runChunkAgentLoop(tabId, chunk, idx, chunks.length, imageIndex)
        )
    );

    // Phase 4: Assemble refined data and hand off to tab overlay
    const refinedData = {
        nuggets: chunkResults.map(r => ({
            text: r.refinedText,
            img_src: r.imgSrc,
            tags: r.tags,
            stats: r.stats,
            coverage: r.coverage,
        })),
        sessionId,
        processHistory: chunkResults.map(r => ({ chunkIdx: r.chunkIdx, steps: r.history })),
    };

    await chrome.storage.local.set({ tf_pt_refined: refinedData });

    chrome.tabs.sendMessage(tabId,
        { action: 'update_nuggets', data: refinedData },
        () => { chrome.runtime.lastError; }
    );

    agentBroadcast(tabId, 'Parallel Track: complete', modelId,
        `${chunkResults.length} chunks refined & handed off`);
}

// ── Agent Loop (ReAct-style tool use) ────────────────────────────────────────

async function runAgentLoop(tabId, userQuery, maxIter = 6) {
    const { geminiApiKey } = await chrome.storage.sync.get('geminiApiKey');
    if (!geminiApiKey) {
        chrome.runtime.sendMessage({ action: 'agent_loop_step', step: { type: 'error', text: 'API key not configured' } }, () => { chrome.runtime.lastError; });
        return;
    }

    const modelId = 'gemini-3.1-flash-lite-preview';
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${geminiApiKey}`;

    const messages = [
        { role: 'system', content: AGENT_SYSTEM_PROMPT },
        { role: 'user',   content: userQuery },
    ];

    agentBroadcast(tabId, 'agent loop: starting', modelId);

    for (let iter = 0; iter < maxIter; iter++) {
        let prompt = '';
        for (const msg of messages) {
            if      (msg.role === 'system')    prompt += msg.content + '\n\n';
            else if (msg.role === 'user')      prompt += `User: ${msg.content}\n\n`;
            else if (msg.role === 'assistant') prompt += `Assistant: ${msg.content}\n\n`;
            else if (msg.role === 'tool')      prompt += `Tool Result: ${msg.content}\n\n`;
        }

        let responseText;
        try {
            const res = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error?.message || res.statusText);
            }
            const data = await res.json();
            responseText = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!responseText) throw new Error('Empty response from LLM');
        } catch (e) {
            chrome.runtime.sendMessage({ action: 'agent_loop_step', step: { type: 'error', text: e.message } }, () => { chrome.runtime.lastError; });
            return;
        }

        let parsed;
        try {
            parsed = parseLLMResponse(responseText);
        } catch (_) {
            messages.push({ role: 'assistant', content: responseText });
            messages.push({ role: 'user',      content: 'Please respond with valid JSON only. No markdown, no extra text.' });
            continue;
        }

        if (parsed.answer) {
            chrome.runtime.sendMessage({
                action: 'agent_loop_step',
                step: { type: 'answer', text: parsed.answer, iteration: iter + 1 }
            }, () => { chrome.runtime.lastError; });
            agentBroadcast(tabId, 'agent loop: complete', modelId);
            return;
        }

        if (parsed.tool_name) {
            const toolName = parsed.tool_name;
            const toolArgs = parsed.tool_arguments || {};

            if (!(toolName in AGENT_TOOLS)) {
                const errMsg = JSON.stringify({ error: `Unknown tool: ${toolName}. Available: ${Object.keys(AGENT_TOOLS).join(', ')}` });
                messages.push({ role: 'assistant', content: responseText });
                messages.push({ role: 'tool',      content: errMsg });
                continue;
            }

            agentBroadcast(tabId, `loop: ${toolName}`, modelId);
            const toolResult = await Promise.resolve(AGENT_TOOLS[toolName](toolArgs));

            chrome.runtime.sendMessage({
                action: 'agent_loop_step',
                step: { type: 'tool_call', toolName, toolArgs, toolResult, iteration: iter + 1 }
            }, () => { chrome.runtime.lastError; });

            messages.push({ role: 'assistant', content: responseText });
            messages.push({ role: 'tool',      content: toolResult });
            continue;
        }

        messages.push({ role: 'assistant', content: responseText });
        messages.push({ role: 'user',      content: 'Please respond with valid JSON only.' });
    }

    chrome.runtime.sendMessage({
        action: 'agent_loop_step',
        step: { type: 'error', text: 'Max iterations reached without a final answer.' }
    }, () => { chrome.runtime.lastError; });
}
