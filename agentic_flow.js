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
//               checkRelevance → findMatchingImage | generateChunkImage
//               getChunkStats → extractSubject → evaluateChunk → refineChunk → updateCoverage
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

    // Step 0: Check relevance
    const relevance = await toolCheckRelevance({ text: chunk.text });
    history.push({ tool: 'checkRelevance', input: { chunkIdx }, result: relevance });
    if (relevance.isAd) {
        agentBroadcast(
            tabId,
            `Chunk ${chunkIdx + 1}/${totalChunks}: dropped (Ad/Irrelevant)`,
            'Gemini Flash Lite',
            relevance.reason
        );
        const coverage = await toolUpdateCoverage({ chunkIdx, totalChunks });
        history.push({ tool: 'updateCoverage', input: { chunkIdx, totalChunks }, result: coverage });
        return { chunkIdx, isAd: true, history };
    }

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

    // Step 3: Subject
    const subjectResult = await toolExtractSubject({ text: chunk.text });
    const subject = subjectResult.subject || 'Untitled';
    history.push({ tool: 'extractSubject', input: { chunkIdx }, result: subjectResult });

    // Step 4: Evaluate
    const evaluation = await toolEvaluateChunk({ text: chunk.text });
    history.push({ tool: 'evaluateChunk', input: { chunkIdx }, result: evaluation });

    // Step 5: Refine — only when score is below threshold; skip if evaluation errored
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

    // Step 6: Coverage
    const coverage = await toolUpdateCoverage({ chunkIdx, totalChunks });
    history.push({ tool: 'updateCoverage', input: { chunkIdx, totalChunks }, result: coverage });

    agentBroadcast(
        tabId,
        `Chunk ${chunkIdx + 1}/${totalChunks}: done`,
        'Gemini Flash Lite',
        `score:${evaluation.score ?? '?'} cov:${coverage.coverage}%`
    );

    return { chunkIdx, text: chunk.text, refinedText, imgSrc, tags: chunk.tags, subject, stats, evaluation, coverage: coverage.coverage, history };
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
        .filter(p => p.type === 'text' && p.content?.trim())
        .map((b, idx) => ({ idx, text: b.content }));

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

