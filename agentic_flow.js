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
const MULTIPASS_WORD_THRESHOLD = 3000; // Articles above this word count are split into sections
const SECTION_MAX_WORDS = 2000;        // Target words per section in multi-pass mode

// ── Utilities ─────────────────────────────────────────────────────────────────

// Replaces typographic characters that can't be typed on a standard keyboard
// with their closest keyboard-typeable equivalents.
function normalizeForTyping(text) {
    return text
        .replace(/[“”«»‹›]/g, '"')  // curly/guillemet quotes → "
        .replace(/[‘’‚‛`]/g, "'")         // curly single quotes, backtick → '
        .replace(/[–—―−﹘﹣－]/g, '-') // en/em/minus dashes → -
        .replace(/…/g, '...')                                 // ellipsis → ...
        .replace(/[     ]/g, ' ')        // non-breaking/thin spaces → space
        .replace(/•/g, '*')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '');  // strip diacritics (é→e, î→i, ç→c)                                  // bullet → *
}

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

// ── Multi-pass helpers ────────────────────────────────────────────────────────

// Splits payload into sections ≤ SECTION_MAX_WORDS, keeping images with their surrounding text.
function splitPayloadIntoSections(payload, maxWords = SECTION_MAX_WORDS) {
    const sections = [];
    let current = [];
    let words = 0;

    for (const item of payload) {
        if (item.type === 'text') {
            const w = item.content.split(/\s+/).length;
            if (words + w > maxWords && current.length > 0) {
                sections.push(current);
                current = [item];
                words = w;
            } else {
                current.push(item);
                words += w;
            }
        } else {
            // Images travel with the current section
            current.push(item);
        }
    }
    if (current.length > 0) sections.push(current);
    return sections;
}

// Tries every model in the pool; returns { result, model } or null on total failure.
async function structureWithFallback(payload, modelPool, tabId) {
    for (const model of modelPool) {
        agentBroadcast(tabId, '[3/4] Structuring', model.label);
        const ts = Date.now();
        try {
            const result = await callModelForStructuring(payload, model);
            if (result.success) {
                agentBroadcast(tabId, '[3/4] Structured', model.label, `${Date.now() - ts}ms`);
                return { result, model };
            }
            agentBroadcast(tabId, '[3/4] Failed', model.label, result.error);
        } catch (e) {
            agentBroadcast(tabId, '[3/4] Error', model.label, e.message);
        }
    }
    return null;
}

// Merges nugget arrays from multiple section results into one unified response.
function mergeStructuredSections(sectionOutputs) {
    const allNuggets = sectionOutputs.flatMap(o => o.nuggets || []);
    const allTags    = [...new Set(sectionOutputs.flatMap(o => o.tags || []))].slice(0, 8);
    const ratings    = sectionOutputs.map(o => o.star_rating).filter(Boolean);
    const avgRating  = ratings.length
        ? Math.round(ratings.reduce((a, b) => a + b, 0) / ratings.length)
        : 3;

    // Recompute coverage based on merged nugget word count vs. full article word count
    const nuggetWords = allNuggets.reduce((s, n) => s + (n.text || '').split(/\s+/).length, 0);
    const sourceWords = sectionOutputs.reduce((s, o) => s + (o._sourceWords || 0), 0);
    const coverage_pct = sourceWords > 0
        ? Math.min(99, Math.round((nuggetWords / sourceWords) * 100))
        : sectionOutputs[0]?.coverage_pct ?? 85;

    return {
        tldr:         sectionOutputs[0]?.tldr || '',
        tags:         allTags,
        star_rating:  avgRating,
        coverage_pct,
        nuggets:      allNuggets,
    };
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

    // Count total article words for coverage calculation
    const originalArticleWords = payload
        .filter(p => p.type === 'text')
        .reduce((sum, p) => sum + p.content.split(/\s+/).length, 0);

    // Track 1: always lead with Gemini Flash Lite for fast initial load.
    // If no Gemini key (e.g. Ollama-only setup), fall back to MODEL_POOL (Ollama).
    const seenIds = new Set();
    const track1Pool = (geminiApiKey ? [DEFAULT_GOOGLE_MODELS[0]] : [])
        .concat(MODEL_POOL)
        .filter(m => { if (seenIds.has(m.id)) return false; seenIds.add(m.id); return true; });

    let structureResult = null;
    let usedModel = null;

    if (originalArticleWords > MULTIPASS_WORD_THRESHOLD) {
        // ── Multi-pass: split long articles into sections ──────────────────────
        const sections = splitPayloadIntoSections(payload);
        agentBroadcast(tabId, '[3/4] Multi-pass', '—',
            `${originalArticleWords} words → ${sections.length} sections`);

        const sectionOutputs = [];
        for (let i = 0; i < sections.length; i++) {
            const section = sections[i];
            const sectionWords = section
                .filter(p => p.type === 'text')
                .reduce((sum, p) => sum + p.content.split(/\s+/).length, 0);
            agentBroadcast(tabId, `[3/4] Section ${i + 1}/${sections.length}`, '—',
                `${sectionWords} words`);

            const hit = await structureWithFallback(section, track1Pool, tabId);
            if (!hit) {
                agentBroadcast(tabId, 'error', null, `Section ${i + 1} failed — all models exhausted`);
                return;
            }
            if (!usedModel) usedModel = hit.model;
            const parsed = hit.result.api_response;
            parsed._sourceWords = sectionWords;
            sectionOutputs.push(parsed);
        }

        const merged = mergeStructuredSections(sectionOutputs);
        structureResult = { success: true, api_response: merged };
        agentBroadcast(tabId, '[3/4] Merged', usedModel.label,
            `${merged.nuggets.length} nuggets | cov ${merged.coverage_pct}%`);
    } else {
        // ── Single-pass: short article fits in one call ────────────────────────
        const hit = await structureWithFallback(payload, track1Pool, tabId);
        if (!hit) {
            agentBroadcast(tabId, 'error', null, 'all models exhausted');
            return;
        }
        structureResult = hit.result;
        usedModel = hit.model;
    }

    const nuggets = structureResult.api_response.nuggets || [];
    nuggets.forEach(n => { if (n.text) n.text = normalizeForTyping(n.text); });
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

        processChunksInParallel(tabId, nuggets, imageIndex, sessionId, structureResult.api_response, originalArticleWords)
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

async function processChunksInParallel(tabId, nuggets, imageIndex, sessionId, initialData, originalArticleWords = 0) {
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

    // Compute real coverage: refined nugget words vs. original article words
    const refinedWordCount = validResults.reduce(
        (sum, r) => sum + (r.refinedText || '').split(/\s+/).length, 0);
    const computedCoverage = originalArticleWords > 0
        ? Math.min(99, Math.round((refinedWordCount / originalArticleWords) * 100))
        : initialData.coverage_pct;

    const refinedData = {
        nuggets: validResults.map(r => ({
            text: r.refinedText,
            img_src: r.imgSrc,
            tags: r.tags,
            subject: r.subject,
            stats: r.stats,
            score: r.evaluation?.score ?? null,
            content_type: r.contentType || null,
        })),
        // Preserve top-level metadata from initial structuring
        tldr: initialData.tldr,
        tags: initialData.tags,
        star_rating: initialData.star_rating,
        coverage_pct: computedCoverage,
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

    agentBroadcast(tabId, 'refined', '—',
        `${validResults.length}/${results.length} valid | ${Date.now() - loopStart}ms`);
}

// ── Single Chunk Processor ────────────────────────────────────────────────────
// Runs the full tool pipeline for one nugget. Steps C/D/E/F run concurrently.

async function processOneChunk(nugget, chunkIdx, totalChunks, imageIndex, tabId) {
    const steps = [];
    const text = nugget.text || '';
    const tags = nugget.tags || [];
    const contentType = nugget.content_type || null;

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
        toolEvaluateChunk({ text }).catch(e => ({ score: null, critique: e.message, error: true })),
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

    // Step H: Coverage — track completion per chunk (real coverage computed after all chunks finish)
    const chunkProgress = Math.round(((chunkIdx + 1) / totalChunks) * 100);
    steps.push({ tool: 'updateCoverage', result: { processed: chunkIdx + 1, total: totalChunks } });

    // Step I: Normalize typographic characters to keyboard-typeable equivalents
    const finalText = normalizeForTyping(refined.refinedText || text);
    steps.push({ tool: 'normalizeForTyping', result: { applied: true } });

    agentBroadcast(tabId, `[C${chunkIdx + 1}/${totalChunks}] Done`, '—',
        `score:${evaluation?.score ?? '?'} grammar:${grammar.isProper ? '✓' : '✗'} progress:${chunkProgress}%`);

    return {
        chunkIdx,
        text,
        refinedText: finalText,
        imgSrc,
        tags,
        subject: subject.subject || 'Untitled',
        stats,
        evaluation,
        contentType,
        steps,
    };
}
