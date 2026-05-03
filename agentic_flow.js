// ─────────────────────────────────────────────────────────────────────────────
// agentic_flow.js — LLM-driven ReAct Agent Loop
//
// Architecture:
//   1. A large system prompt defines the agent's role, available tools, and
//      the expected multi-step plan.
//   2. The agent generates a JSON response: { thought, tool, args }
//   3. The runtime executes the requested tool with the provided args.
//   4. The tool result is appended to the conversation history.
//   5. The LLM is called again with the accumulated history to decide the
//      next step.
//   6. This loops until the agent emits { tool: "DONE" }.
//
// Depends on: background.js globals (MODEL_POOL, GEMMA_MODEL,
//             callGeminiWithModel, callGemmaAPI, generateContextualImage,
//             isValidHttpUrl)
// Depends on: tools/tool_*.js (loaded before this via importScripts)
// ─────────────────────────────────────────────────────────────────────────────

// ── Utilities ────────────────────────────────────────────────────────────────

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

function preview(str, words = 8) {
    if (str == null) return '';
    const s = String(str).trim().replace(/\s+/g, ' ');
    const ws = s.split(' ');
    return ws.length <= words ? s : ws.slice(0, words).join(' ') + ' ...';
}

// ── Agent Pipeline (Track 1 — fast gallery) ─────────────────────────────────

async function runAgentPipeline(tabId) {
    const { geminiApiKey } = await chrome.storage.sync.get('geminiApiKey');
    if (!geminiApiKey) {
        agentBroadcast(tabId, 'error', null, 'API key not configured');
        return;
    }

    agentBroadcast(tabId, '[1/4] Session init', '—');
    const sessionId = 'session_' + Date.now();
    await new Promise(r => setTimeout(r, 600));

    agentBroadcast(tabId, '[2/4] Extracting content', '—', `in: tab ${tabId}`);
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

    agentBroadcast(tabId, '[2/4] Content extracted', '—',
        `out: ${payload.length} blocks | "${preview(payload.find(p => p.type === 'text')?.content)}"`);

    await chrome.storage.local.set({ [`tf_agent_payload_${sessionId}`]: payload, tf_agent_tab: tabId });
    await new Promise(r => setTimeout(r, 600));

    let structureResult = null;
    let usedModel = null;
    for (const model of MODEL_POOL) {
        agentBroadcast(tabId, '[3/4] Structuring', model.label, `in: ${payload.length} blocks`);
        try {
            const result = await callModelForStructuring(payload, model);
            if (result.success) { structureResult = result; usedModel = model; break; }
            agentBroadcast(tabId, `[3/4] ${model.label} failed`, model.label, preview(result.error));
            console.warn(`[agent] ${model.label} failed:`, result.error);
        } catch (e) {
            agentBroadcast(tabId, `[3/4] ${model.label} threw`, model.label, preview(e.message));
            console.warn(`[agent] ${model.label} threw:`, e.message);
        }
    }
    if (!structureResult) {
        agentBroadcast(tabId, 'error', null, 'all models exhausted');
        return;
    }

    const nuggets = structureResult.api_response.nuggets || [];
    agentBroadcast(tabId, '[3/4] Structured', usedModel.label,
        `out: ${nuggets.length} nuggets | "${preview(structureResult.api_response.tldr)}"`);

    agentBroadcast(tabId, '[4/4] Mounting gallery', usedModel.label, `${nuggets.length} nuggets`);
    await tabMessage(tabId, { action: 'mount_ui', data: structureResult.api_response }).catch(() => {});
    chrome.tabs.sendMessage(tabId, { action: 'open_overlay' }, () => { chrome.runtime.lastError; });
    chrome.runtime.sendMessage({ action: 'agent_close_popup' }, () => { chrome.runtime.lastError; });

    await chrome.storage.local.set({
        tf_agent_nuggets: nuggets,
        tf_agent_session: {
            timestamp: Date.now(),
            model: usedModel.label,
            nuggetCount: nuggets.length,
            tldr: structureResult.api_response.tldr,
            tags: structureResult.api_response.tags,
            star_rating: structureResult.api_response.star_rating,
        }
    });

    agentBroadcast(tabId, 'Done [1-4]', usedModel.label,
        `${nuggets.length} nuggets | "${preview(structureResult.api_response.tldr)}"`);

    if (usedModel.id !== GEMMA_MODEL) {
        runAgenticLoop(tabId, payload);
    }
}


// ═════════════════════════════════════════════════════════════════════════════
// Track 2 — LLM-Driven ReAct Agent Loop
// ═════════════════════════════════════════════════════════════════════════════

const AGENT_MODEL = 'gemini-3.1-flash-lite-preview';
const MAX_TURNS = 80;   // safety cap

// ── System prompt ────────────────────────────────────────────────────────────

function buildAgentSystemPrompt(chunks, imageIndex) {
    return `You are an agentic content-processing pipeline for a learning application.
You have ${chunks.length} semantic content chunks to process.
There are ${imageIndex.length} images available by index.

## YOUR GOAL
Process every chunk through a quality pipeline: filter ads, resolve images,
compute statistics, evaluate quality, check grammar, conditionally refine,
and track coverage. Then finish.

## AVAILABLE TOOLS
Call exactly ONE tool per turn. Return JSON: { "thought": "...", "tool": "<NAME>", "args": { ... } }

| Tool               | Args                                                      | Returns                            |
|---------------------|-----------------------------------------------------------|------------------------------------|
| checkRelevance      | { "text": "..." }                                        | { isAd, reason }                   |
| findMatchingImage   | { "chunkIdx": N, "nearbyImageIdx": N }                   | { matched, src }                   |
| generateChunkImage  | { "text": "...", "tags": [...] }                         | { img_src }                        |
| getChunkStats       | { "text": "..." }                                        | { wordCount, charCount, ... }      |
| extractSubject      | { "text": "..." }                                        | { subject }                        |
| evaluateChunk       | { "text": "..." }                                        | { score, clarity, critique, ... }  |
| checkGrammar        | { "text": "..." }                                        | { isProper, issues }               |
| refineChunk         | { "text": "...", "grammar": {...}, "evaluation": {...} } | { refinedText }                    |
| updateCoverage      | { "chunkIdx": N, "totalChunks": N }                      | { coverage, processed, total }     |
| DONE                | {}                                                        | (terminates the loop)              |

## PLAN — follow this order for EACH chunk (0/${chunks.length}, 1/${chunks.length}, ...):
  Step A: checkRelevance — if isAd=true, skip to updateCoverage for this chunk.
  Step B: findMatchingImage (if nearbyImageIdx exists) OR generateChunkImage.
  Step C: getChunkStats.
  Step D: extractSubject.
  Step E: evaluateChunk.
  Step F: checkGrammar.
  Step G: if grammar isProper=false → refineChunk; else skip refinement.
  Step H: updateCoverage for this chunk.
  Then move to the next chunk (e.g. 1/${chunks.length}).

After ALL chunks are done, call DONE.

## CHUNKS DATA
${JSON.stringify(chunks.map((c, i) => ({
    idx: i,
    ref: `${i}/${chunks.length}`,
    text: c.text.slice(0, 400),
    tags: c.tags,
    nearbyImageIdx: c.nearbyImageIdx,
})))}

## IMAGE INDEX
${JSON.stringify(imageIndex.map(img => ({ idx: img.idx })))}

Begin with chunk 0/${chunks.length}, Step A.`;
}

// ── Tool dispatcher ──────────────────────────────────────────────────────────

async function executeTool(toolName, args, imageIndex) {
    switch (toolName) {
        case 'checkRelevance':
            return await toolCheckRelevance({ text: args.text });

        case 'findMatchingImage': {
            const img = imageIndex[args.nearbyImageIdx];
            if (img) return { matched: true, src: img.src };
            return { matched: false, src: null };
        }

        case 'generateChunkImage':
            return await generateContextualImage({ text: args.text, tags: args.tags || [] });

        case 'getChunkStats':
            return toolGetChunkStats({ text: args.text });

        case 'extractSubject':
            return await toolExtractSubject({ text: args.text });

        case 'evaluateChunk':
            return await toolEvaluateChunk({ text: args.text });

        case 'checkGrammar':
            return await toolCheckGrammar({ text: args.text });

        case 'refineChunk':
            return await toolRefineChunk({
                text: args.text,
                grammar: args.grammar || null,
                evaluation: args.evaluation || null,
            });

        case 'updateCoverage':
            return await toolUpdateCoverage({
                chunkIdx: args.chunkIdx,
                totalChunks: args.totalChunks,
            });

        default:
            return { error: `Unknown tool: ${toolName}` };
    }
}

// ── LLM caller for the agent loop ────────────────────────────────────────────

async function callAgent(messages, geminiApiKey) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${AGENT_MODEL}:generateContent?key=${geminiApiKey}`;

    const contents = messages.map(m => ({
        role: m.role,
        parts: [{ text: m.text }],
    }));

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents,
            generationConfig: { response_mime_type: 'application/json' },
        }),
    });
    if (!res.ok) throw new Error(`Agent API error ${res.status}`);
    const data = await res.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) throw new Error('Agent returned empty response');
    return JSON.parse(raw);
}

// ── The main ReAct loop ──────────────────────────────────────────────────────

async function runAgenticLoop(tabId, payload) {
    const { geminiApiKey } = await chrome.storage.sync.get('geminiApiKey');
    if (!geminiApiKey) return;

    agentBroadcast(tabId, '[Agent] Initializing', AGENT_MODEL);

    // ── Phase 1: Index content ───────────────────────────────────────────────
    const sessionId = 'session_' + Date.now();

    const imageIndex = payload
        .filter(p => p.type === 'image' && isValidHttpUrl(p.src))
        .map((img, idx) => ({ idx, src: img.src }));

    const textBlocks = payload
        .filter(p => p.type === 'text' && p.content?.trim())
        .map((b, idx) => ({ idx, text: b.content }));

    await chrome.storage.local.set({
        [`tf_pt_${sessionId}_images`]: imageIndex,
        [`tf_pt_${sessionId}_texts`]: textBlocks,
        tf_pt_coverage: [],
    });

    agentBroadcast(tabId, '[Agent] Content indexed', AGENT_MODEL,
        `${textBlocks.length} text | ${imageIndex.length} images`);

    // ── Phase 2: Identify semantic chunks ────────────────────────────────────
    agentBroadcast(tabId, '[Agent] Identifying chunks', AGENT_MODEL);
    let chunks = await identifySemanticChunks(textBlocks, imageIndex, geminiApiKey);
    if (!chunks?.length) {
        chunks = textBlocks.map(b => ({ text: b.text, tags: [], blockIndices: [b.idx], nearbyImageIdx: null }));
    }
    agentBroadcast(tabId, '[Agent] Chunks ready', AGENT_MODEL, `${chunks.length} chunks`);

    // ── Phase 3: ReAct agent loop ────────────────────────────────────────────
    const systemPrompt = buildAgentSystemPrompt(chunks, imageIndex);
    const messages = [{ role: 'user', text: systemPrompt }];
    const processHistory = [];     // per-chunk logs for the UI
    const chunkState = {};         // accumulate results per chunk

    for (let turn = 0; turn < MAX_TURNS; turn++) {
        let action;
        try {
            action = await callAgent(messages, geminiApiKey);
        } catch (e) {
            console.warn('[agent loop] LLM error:', e.message);
            agentBroadcast(tabId, '[Agent] LLM error', AGENT_MODEL, preview(e.message));
            break;
        }

        const { thought, tool, args } = action;

        // ── DONE signal ──────────────────────────────────────────────────────
        if (tool === 'DONE') {
            agentBroadcast(tabId, '[Agent] All chunks processed', AGENT_MODEL, thought || '');
            // Append the assistant turn and break
            messages.push({ role: 'model', text: JSON.stringify(action) });
            break;
        }

        // ── Broadcast thought ────────────────────────────────────────────────
        const chunkRef = args?.chunkIdx != null ? `[C${args.chunkIdx + 1}/${chunks.length}]` : '';
        agentBroadcast(tabId, `${chunkRef} ${tool}`, AGENT_MODEL, preview(thought));

        // ── Execute the tool ─────────────────────────────────────────────────
        let result;
        try {
            result = await executeTool(tool, args || {}, imageIndex);
        } catch (e) {
            result = { error: e.message };
        }

        // ── Build history entry ──────────────────────────────────────────────
        const historyEntry = { tool, input: args || {}, result };
        const ci = args?.chunkIdx ?? null;
        if (ci != null) {
            if (!chunkState[ci]) chunkState[ci] = { steps: [], data: {} };
            chunkState[ci].steps.push(historyEntry);

            // Accumulate useful data per chunk
            if (tool === 'findMatchingImage' && result.matched) chunkState[ci].data.imgSrc = result.src;
            if (tool === 'generateChunkImage') chunkState[ci].data.imgSrc = result.img_src;
            if (tool === 'getChunkStats') chunkState[ci].data.stats = result;
            if (tool === 'extractSubject') chunkState[ci].data.subject = result.subject;
            if (tool === 'evaluateChunk') chunkState[ci].data.evaluation = result;
            if (tool === 'checkGrammar') chunkState[ci].data.grammar = result;
            if (tool === 'refineChunk') chunkState[ci].data.refinedText = result.refinedText;
            if (tool === 'checkRelevance' && result.isAd) chunkState[ci].data.isAd = true;
            if (tool === 'updateCoverage') chunkState[ci].data.coverage = result.coverage;
        }

        // ── Feed result back to the LLM ──────────────────────────────────────
        messages.push({ role: 'model', text: JSON.stringify(action) });

        // Summarize result for the LLM (truncate large values like img_src)
        const resultSummary = summarizeResult(tool, result);
        messages.push({ role: 'user', text: `Tool result for ${tool}:\n${JSON.stringify(resultSummary)}\n\nContinue with the next step.` });

        agentBroadcast(tabId, `${chunkRef} ${tool} done`, AGENT_MODEL,
            preview(JSON.stringify(resultSummary)));
    }

    // ── Phase 4: Assemble and hand off ───────────────────────────────────────
    const chunkResults = [];
    for (let i = 0; i < chunks.length; i++) {
        const st = chunkState[i] || { steps: [], data: {} };
        const d = st.data;
        if (d.isAd) {
            chunkResults.push({ chunkIdx: i, isAd: true, history: st.steps });
            continue;
        }
        chunkResults.push({
            chunkIdx: i,
            text: chunks[i].text,
            refinedText: d.refinedText || chunks[i].text,
            imgSrc: d.imgSrc || null,
            tags: chunks[i].tags,
            subject: d.subject || 'Untitled',
            stats: d.stats || {},
            evaluation: d.evaluation || {},
            coverage: d.coverage ?? 0,
            history: st.steps,
        });
    }

    const validResults = chunkResults.filter(r => !r.isAd);

    const refinedData = {
        nuggets: validResults.map(r => ({
            text: r.refinedText,
            img_src: r.imgSrc,
            tags: r.tags,
            subject: r.subject,
            stats: r.stats,
            score: r.evaluation?.score ?? null,
            coverage: r.coverage,
        })),
        sessionId,
        processHistory: chunkResults.map(r => ({ chunkIdx: r.chunkIdx, steps: r.history || [] })),
    };

    await chrome.storage.local.set({ tf_pt_refined: refinedData });

    chrome.tabs.sendMessage(tabId,
        { action: 'update_nuggets', data: refinedData },
        () => { chrome.runtime.lastError; }
    );

    agentBroadcast(tabId, '[Agent] Handoff complete', AGENT_MODEL,
        `${validResults.length}/${chunkResults.length} valid chunks`);
}

// ── Result summarizer (keeps LLM context clean) ─────────────────────────────

function summarizeResult(tool, result) {
    if (!result || typeof result !== 'object') return result;
    const copy = { ...result };

    // Truncate large fields to keep the prompt small
    if (copy.src && copy.src.length > 60) copy.src = copy.src.slice(0, 60) + '...';
    if (copy.img_src && copy.img_src.length > 60) copy.img_src = copy.img_src.slice(0, 60) + '...';
    if (copy.refinedText && copy.refinedText.length > 300)
        copy.refinedText = copy.refinedText.slice(0, 300) + '...';

    return copy;
}

// ── Semantic chunk identification (unchanged) ────────────────────────────────

async function identifySemanticChunks(textBlocks, imageIndex, geminiApiKey) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${AGENT_MODEL}:generateContent?key=${geminiApiKey}`;

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

Rules: group related consecutive blocks; generate as many chunks as needed, but each chunk MUST be strictly under 300 words; preserve original wording; assign nearbyImageIdx by position proximity.`;

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { response_mime_type: 'application/json' },
            }),
        });
        if (!res.ok) return null;
        const data = await res.json();
        const jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!jsonText) return null;
        return JSON.parse(jsonText).chunks || null;
    } catch (e) {
        console.warn('[agent] identifySemanticChunks failed:', e.message);
        return null;
    }
}
