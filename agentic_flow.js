// ─────────────────────────────────────────────────────────────────────────────
// agentic_flow.js — Parallel Chunk Processing Pipeline
//
// Architecture (replaces the old sequential ReAct loop):
//   Track 1 (fast, ~10-15s):
//     extractFromTab → callModelForStructuring → mount_ui → open_overlay → close_popup
//
//   Track 2 (background, parallel):
//     For each nugget, concurrently run:
//       A: checkRelevance (heuristic first, LLM fallback)
//       C+D+E+F: getChunkStats + extractSubject + evaluateChunk + checkGrammar (all in parallel)
//       G: refineChunk (conditional — only if grammar issues found)
//       B: image resolution (use existing img_src or generateChunkImage)
//       H: updateCoverage
//     → send update_nuggets to tab overlay
//
// Performance vs old ReAct loop:
//   Old: 70+ sequential LLM calls → ~3-5 minutes
//   New: batched parallel calls   → ~20-30 seconds
//
// Depends on: background.js globals, tools/tool_*.js
// ─────────────────────────────────────────────────────────────────────────────

// ── Constants ─────────────────────────────────────────────────────────────────

const CONCURRENCY_LIMIT = 3; // Chunks processed simultaneously (rate-limit safe)

// ── Utilities ─────────────────────────────────────────────────────────────────

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
    function unwrap(data) {
        if (!data) return null;
        return Array.isArray(data) ? data : (data.payload || null);
    }
    try {
        const resp = await tabMessage(tabId, { action: 'extract_content' });
        const result = unwrap(resp?.payload);
        if (result) return result;
    } catch (_) {}
    await new Promise((resolve, reject) => {
        chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }, r => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(r);
        });
    });
    for (let attempt = 0; attempt < 5; attempt++) {
        await new Promise(r => setTimeout(r, 250));
        try {
            const resp = await tabMessage(tabId, { action: 'extract_content' });
            const result = unwrap(resp?.payload);
            if (result) return result;
        } catch (_) {}
    }
    return null;
}

function callModelForStructuring(payload, model) {
    if (model.isOllama) return callOllamaStructuring(payload, model.id);
    return model.vision ? callGemmaAPI(payload) : callGeminiWithModel(payload, model.id);
}

// ── Track 1: Fast Gallery Pipeline ────────────────────────────────────────────

async function runAgentPipeline(tabId) {
    const t0 = Date.now();
    const { geminiApiKey } = await chrome.storage.sync.get('geminiApiKey');
    if (ACTIVE_SETTINGS.provider === 'google' && !geminiApiKey) {
        agentBroadcast(tabId, 'error', null, 'API key not configured');
        return;
    }
    if (ACTIVE_SETTINGS.provider === 'ollama' && !ACTIVE_SETTINGS.ollamaModel) {
        agentBroadcast(tabId, 'error', null, 'Ollama model not configured in Settings');
        return;
    }

    agentBroadcast(tabId, '[1/4] Session init', '—');
    const sessionId = 'session_' + Date.now();

    // Clean up stale keys from previous sessions to prevent storage bloat
    chrome.storage.local.get(null, (allItems) => {
        if (chrome.runtime.lastError) return;
        const staleKeys = Object.keys(allItems).filter(k =>
            k.startsWith('tf_') && !k.includes(sessionId)
        );
        if (staleKeys.length) chrome.storage.local.remove(staleKeys);
    });

    agentBroadcast(tabId, '[2/4] Extracting content', '—', `tab ${tabId}`);
    let payload;
    try {
        payload = await extractFromTab(tabId);
    } catch (e) {
        agentBroadcast(tabId, 'error', null, 'injection blocked');
        return;
    }
    if (!payload?.length) {
        agentBroadcast(tabId, 'error', null, 'no content');
        return;
    }
    agentBroadcast(tabId, '[2/4] Extracted', '—', `${payload.length} blocks in ${Date.now() - t0}ms`);

    await chrome.storage.local.set({ [`tf_agent_payload_${sessionId}`]: payload, tf_agent_tab: tabId });

    // Build image index from raw payload (for Track 2 image resolution)
    const imageIndex = payload
        .filter(p => p.type === 'image' && isValidHttpUrl(p.src))
        .map((img, idx) => ({ idx, src: img.src }));

    let structureResult = null;
    let usedModel = null;
    let lastStructureError = 'all models exhausted';
    for (const model of MODEL_POOL) {
        const ts = Date.now();
        agentBroadcast(tabId, '[3/4] Structuring', model.label);
        try {
            const result = await callModelForStructuring(payload, model);
            if (result.success) {
                structureResult = result;
                usedModel = model;
                agentBroadcast(tabId, '[3/4] Structured', model.label, `${Date.now() - ts}ms`);
                break;
            }
            lastStructureError = result.error || 'unknown error';
            agentBroadcast(tabId, '[3/4] Failed', model.label, result.error);
        } catch (e) {
            lastStructureError = e.message;
            agentBroadcast(tabId, '[3/4] Error', model.label, e.message);
        }
    }
    if (!structureResult) {
        agentBroadcast(tabId, 'error', null, lastStructureError);
        return;
    }

    const nuggets = structureResult.api_response.nuggets || [];
    agentBroadcast(tabId, '[4/4] Mounting', usedModel.label, `${nuggets.length} nuggets`);

    // Mount UI and wait for overlay to confirm open before closing popup
    await tabMessage(tabId, { action: 'mount_ui', data: structureResult.api_response }).catch(() => {});
    await tabMessage(tabId, { action: 'open_overlay' }).catch(() => {});
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
        `${nuggets.length} nuggets | ${Date.now() - t0}ms total`);

    // Track 2: Parallel enhancement (skip for Gemma — already vision-enriched)
    if (usedModel.id !== GEMMA_MODEL) {
        // Keep service worker alive during background processing (Chrome kills it after ~30s)
        const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(() => {}), 20000);

        processChunksInParallel(tabId, nuggets, imageIndex, sessionId, structureResult.api_response)
            .catch(e => {
                console.error('[agent] processChunksInParallel fatal:', e.message);
                agentBroadcast(tabId, 'error', null, `Enhancement failed: ${e.message}`);
            })
            .finally(() => clearInterval(keepAlive));
    }
}

// ── Track 2: Parallel Chunk Enhancement ───────────────────────────────────────
// Processes all nuggets concurrently in batches of CONCURRENCY_LIMIT.
// Results are sent to the tab overlay via 'update_nuggets' to enrich the gallery.

async function processChunksInParallel(tabId, nuggets, imageIndex, sessionId, initialData) {
    const loopStart = Date.now();
    agentBroadcast(tabId, '[Agent] Enhancing', '—',
        `${nuggets.length} chunks × ${CONCURRENCY_LIMIT} parallel`);

    const results = [];

    // Process in rate-limit-safe batches
    for (let i = 0; i < nuggets.length; i += CONCURRENCY_LIMIT) {
        const batch = nuggets.slice(i, i + CONCURRENCY_LIMIT);
        const batchResults = await Promise.all(
            batch.map((nugget, j) => processOneChunk(nugget, i + j, nuggets.length, imageIndex, tabId))
        );
        results.push(...batchResults);
        const done = Math.min(i + CONCURRENCY_LIMIT, nuggets.length);
        agentBroadcast(tabId, '[Agent] Progress', '—', `${done}/${nuggets.length} chunks done`);
    }

    // Assemble refined data — filter ads, keep valid nuggets
    const validResults = results.filter(r => !r.isAd);
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
        // Preserve top-level metadata from initial structuring
        tldr: initialData.tldr,
        tags: initialData.tags,
        star_rating: initialData.star_rating,
        coverage_pct: initialData.coverage_pct,
        sessionId,
        totalMs: Date.now() - loopStart,
        processHistory: results.map(r => ({ chunkIdx: r.chunkIdx, steps: r.steps || [] })),
        isAgentRefined: true,
    };

    await chrome.storage.local.set({ tf_pt_refined: refinedData });

    chrome.tabs.sendMessage(tabId,
        { action: 'update_nuggets', data: refinedData },
        () => { chrome.runtime.lastError; }
    );

    agentBroadcast(tabId, '[Agent] Complete', '—',
        `${validResults.length}/${results.length} valid | ${Date.now() - loopStart}ms`);
}

// ── Single Chunk Processor ────────────────────────────────────────────────────
// Runs the full tool pipeline for one nugget. Steps C/D/E/F run concurrently.

async function processOneChunk(nugget, chunkIdx, totalChunks, imageIndex, tabId) {
    const steps = [];
    const text = nugget.text || '';
    const tags = nugget.tags || [];

    // Step A: Relevance check (heuristic-first, saves LLM call for ~30% of chunks)
    const relevance = await toolCheckRelevance({ text })
        .catch(e => ({ isAd: false, reason: e.message, error: true }));
    steps.push({ tool: 'checkRelevance', result: relevance });

    if (relevance.isAd) {
        agentBroadcast(tabId, `[C${chunkIdx + 1}/${totalChunks}] Skipped`, '—', 'ad/boilerplate');
        return { chunkIdx, isAd: true, steps };
    }

    // Steps C, D, E, F: run all in parallel — no inter-dependency
    const [stats, subject, evaluation, grammar] = await Promise.all([
        Promise.resolve(toolGetChunkStats({ text })),
        toolExtractSubject({ text }).catch(e => ({ subject: 'Untitled', error: e.message })),
        toolEvaluateChunk({ text }).catch(e => ({ score: 0, critique: e.message, error: true })),
        toolCheckGrammar({ text }).catch(e => ({ isProper: true, issues: e.message, error: true })),
    ]);
    steps.push(
        { tool: 'getChunkStats',  result: stats },
        { tool: 'extractSubject', result: subject },
        { tool: 'evaluateChunk',  result: evaluation },
        { tool: 'checkGrammar',   result: grammar },
    );

    // Step G: Conditional refinement (only if grammar issues detected)
    let refined = { refinedText: text };
    if (!grammar.isProper && !grammar.error) {
        refined = await toolRefineChunk({ text, grammar, evaluation })
            .catch(e => ({ refinedText: text, error: e.message }));
        steps.push({ tool: 'refineChunk', result: refined });
    }

    // Step B: Image resolution
    // Prefer: existing img_src → nearby page image → generated image
    let imgSrc = nugget.img_src || null;
    if (!imgSrc && nugget.nearbyImageIdx != null && imageIndex[nugget.nearbyImageIdx]) {
        imgSrc = imageIndex[nugget.nearbyImageIdx].src;
        steps.push({ tool: 'findMatchingImage', result: { matched: true, src: imgSrc } });
    } else if (!imgSrc) {
        const imgResult = await generateContextualImage({ text, tags })
            .catch(() => ({ img_src: null }));
        imgSrc = imgResult.img_src;
        steps.push({ tool: 'generateChunkImage', result: { img_src: imgSrc } });
    }

    // Step H: Coverage
    const coverage = Math.round(((chunkIdx + 1) / totalChunks) * 100);
    steps.push({ tool: 'updateCoverage', result: { coverage, processed: chunkIdx + 1, total: totalChunks } });

    agentBroadcast(tabId, `[C${chunkIdx + 1}/${totalChunks}] Done`, '—',
        `score:${evaluation?.score ?? '?'} grammar:${grammar.isProper ? '✓' : '✗'} cov:${coverage}%`);

    return {
        chunkIdx,
        text,
        refinedText: refined.refinedText || text,
        imgSrc,
        tags,
        subject: subject.subject || 'Untitled',
        stats,
        evaluation,
        coverage,
        steps,
    };
}
