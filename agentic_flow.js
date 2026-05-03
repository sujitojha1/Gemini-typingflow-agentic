// ─────────────────────────────────────────────────────────────────────────────
// agentic_flow.js — LLM-driven ReAct Agent Loop (optimized)
//
// Architecture:
//   1. System prompt defines tools, plan, and chunk data.
//   2. LLM generates: { thought, tool, args, nextStep }
//   3. Runtime executes tool, feeds result back.
//   4. Conversation history is kept trim (sliding window).
//   5. Loops until LLM emits { tool: "DONE" }.
//
// Performance notes:
//   - No artificial setTimeout waits anywhere.
//   - Conversation window slides: only last N turns kept in context.
//   - Result summaries aggressively truncated for LLM context.
//   - Every step timed (ms) for log viewer diagnostics.
//
// Depends on: background.js globals, tools/tool_*.js
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
    function unwrap(data) {
        if (!data) return null;
        // extractPageContent returns { payload: [...], readability } — unwrap if needed
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
    return model.vision ? callGemmaAPI(payload) : callGeminiWithModel(payload, model.id);
}

function preview(str, words = 8) {
    if (str == null) return '';
    const s = String(str).trim().replace(/\s+/g, ' ');
    const ws = s.split(' ');
    return ws.length <= words ? s : ws.slice(0, words).join(' ') + '…';
}

// Gemma models sometimes wrap JSON in prose — extract the first {...} block as fallback
function extractJsonFromText(text) {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try { return JSON.parse(match[0]); } catch { return null; }
}

// ── Agent Pipeline (Track 1 — fast gallery, no artificial delays) ────────────

async function runAgentPipeline(tabId) {
    const t0 = Date.now();
    const { geminiApiKey } = await chrome.storage.sync.get('geminiApiKey');
    if (!geminiApiKey) {
        agentBroadcast(tabId, 'error', null, 'API key not configured');
        return;
    }

    agentBroadcast(tabId, '[1/4] Session init', '—');
    const sessionId = 'session_' + Date.now();

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

    agentBroadcast(tabId, '[2/4] Extracted', '—',
        `${payload.length} blocks in ${Date.now() - t0}ms`);

    await chrome.storage.local.set({ [`tf_agent_payload_${sessionId}`]: payload, tf_agent_tab: tabId });

    let structureResult = null;
    let usedModel = null;
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
            console.warn(`[agent] ${model.label} failed:`, result.error);
        } catch (e) {
            console.warn(`[agent] ${model.label} threw:`, e.message);
        }
    }
    if (!structureResult) {
        agentBroadcast(tabId, 'error', null, 'all models exhausted');
        return;
    }

    const nuggets = structureResult.api_response.nuggets || [];

    agentBroadcast(tabId, '[4/4] Mounting', usedModel.label, `${nuggets.length} nuggets`);
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
        `${nuggets.length} nuggets | ${Date.now() - t0}ms total`);

    if (usedModel.id !== GEMMA_MODEL) {
        runAgenticLoop(tabId, payload, sessionId);
    }
}


// ═════════════════════════════════════════════════════════════════════════════
// Track 2 — LLM-Driven ReAct Agent Loop (optimized)
// ═════════════════════════════════════════════════════════════════════════════

// Agent model pool (AGENT_MODEL_POOL, pickAgentModel) defined in background.js globals

const MAX_TURNS = 25;
const CONTEXT_WINDOW = 12;

// ── System prompt ────────────────────────────────────────────────────────────

function buildAgentSystemPrompt(chunks, imageIndex) {
    return `You are an agentic content-processing pipeline for a learning application.
You have ${chunks.length} semantic content chunks to process.
There are ${imageIndex.length} images available by index.

## YOUR GOAL
Process every chunk through a quality pipeline, then finish.

## RESPONSE FORMAT — CRITICAL
You MUST output ONLY a raw JSON object. No prose, no explanation, no markdown, no code fences.
Your ENTIRE response must be parseable by JSON.parse(). Do NOT write anything before or after the JSON.

Example of a valid response:
{"thought":"Chunk 0 looks like article content, not an ad.","tool":"checkRelevance","args":{"chunkIdx":0,"text":"..."},"nextStep":"Step B: find matching image for chunk 0"}

## AVAILABLE TOOLS (call exactly ONE per turn)

| Tool               | Args                                                      | Returns                            |
|---------------------|-----------------------------------------------------------|------------------------------------|
| checkRelevance      | { "chunkIdx": N, "text": "..." }                        | { isAd, reason }                   |
| findMatchingImage   | { "chunkIdx": N, "nearbyImageIdx": N }                   | { matched, src }                   |
| generateChunkImage  | { "chunkIdx": N, "text": "...", "tags": [...] }          | { img_src }                        |
| getChunkStats       | { "chunkIdx": N, "text": "..." }                        | { wordCount, charCount, ... }      |
| extractSubject      | { "chunkIdx": N, "text": "..." }                        | { subject }                        |
| evaluateChunk       | { "chunkIdx": N, "text": "..." }                        | { score, clarity, critique, ... }  |
| checkGrammar        | { "chunkIdx": N, "text": "..." }                        | { isProper, issues }               |
| refineChunk         | { "chunkIdx": N, "text": "...", "grammar": {...}, "evaluation": {...} } | { refinedText }    |
| updateCoverage      | { "chunkIdx": N, "totalChunks": N }                     | { coverage, processed, total }     |
| DONE                | {}                                                        | (terminates)                       |

## PLAN — for EACH chunk (0/${chunks.length}, 1/${chunks.length}, ...):
  A: checkRelevance — if isAd=true, skip to H.
  B: findMatchingImage (if nearbyImageIdx exists) OR generateChunkImage.
  C: getChunkStats.
  D: extractSubject.
  E: evaluateChunk.
  F: checkGrammar.
  G: if isProper=false → refineChunk; else skip.
  H: updateCoverage.
  Move to next chunk.

After ALL chunks → call DONE.

## CHUNKS
${JSON.stringify(chunks.map((c, i) => ({
    i,
    text: c.text.slice(0, 300),
    tags: c.tags,
    nearbyImageIdx: c.nearbyImageIdx,
})))}

## IMAGES
${JSON.stringify(imageIndex.map(img => ({ idx: img.idx })))}

Start: chunk 0/${chunks.length}, Step A.`;
}

// ── Tool dispatcher ──────────────────────────────────────────────────────────

async function executeTool(toolName, args, imageIndex) {
    switch (toolName) {
        case 'checkRelevance':
            return await toolCheckRelevance({ text: args.text });
        case 'findMatchingImage': {
            const img = imageIndex[args.nearbyImageIdx];
            return img ? { matched: true, src: img.src } : { matched: false, src: null };
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

// ── LLM caller (uses sliding context window) ─────────────────────────────────

async function callAgent(allMessages, geminiApiKey, modelId) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${geminiApiKey}`;

    // Sliding window: always keep the first message (system prompt) + last N
    let messages;
    if (allMessages.length > CONTEXT_WINDOW + 1) {
        const trimNote = { role: 'user', text: `[Context trimmed. ${allMessages.length - CONTEXT_WINDOW - 1} earlier turns omitted. Continue from where you left off.]` };
        messages = [allMessages[0], trimNote, ...allMessages.slice(-CONTEXT_WINDOW)];
    } else {
        messages = allMessages;
    }

    const contents = messages.map(m => ({
        role: m.role,
        parts: [{ text: m.text }],
    }));

    const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents,
            generationConfig: { response_mime_type: 'application/json' },
        }),
    }, 25000);
    if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        const errDetail = errBody.error?.message || res.statusText;
        console.error(`[agent] callAgent ${modelId} HTTP ${res.status}:`, errDetail, errBody);
        throw new Error(`Agent API ${res.status}: ${errDetail}`);
    }
    const data = await res.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) {
        console.error(`[agent] callAgent ${modelId}: empty response. Full:`, JSON.stringify(data).slice(0, 400));
        throw new Error('Empty response');
    }
    try {
        return JSON.parse(raw);
    } catch (parseErr) {
        // Gemma models sometimes wrap JSON in prose — attempt extraction before failing
        const extracted = extractJsonFromText(raw);
        if (extracted) {
            console.warn(`[agent] callAgent ${modelId}: prose-wrapped JSON extracted successfully`);
            return extracted;
        }
        console.error(`[agent] callAgent ${modelId}: JSON.parse failed — no JSON found in response.`,
            parseErr.message, '| raw:', raw.slice(0, 300));
        throw new Error(`Agent JSON parse failed: ${parseErr.message}`);
    }
}

// ── Result summarizer ────────────────────────────────────────────────────────

function summarizeResult(tool, result) {
    if (!result || typeof result !== 'object') return result;
    const copy = { ...result };
    // Aggressively truncate to keep context small
    if (copy.src && copy.src.length > 40) copy.src = copy.src.slice(0, 40) + '…';
    if (copy.img_src && copy.img_src.length > 40) copy.img_src = copy.img_src.slice(0, 40) + '…';
    if (copy.refinedText && copy.refinedText.length > 150)
        copy.refinedText = copy.refinedText.slice(0, 150) + '…';
    return copy;
}

// ── The main ReAct loop ──────────────────────────────────────────────────────

async function runAgenticLoop(tabId, payload, sessionId) {
    const { geminiApiKey } = await chrome.storage.sync.get('geminiApiKey');
    if (!geminiApiKey) return;

    const loopStart = Date.now();
    const initModel = pickAgentModel();
    agentBroadcast(tabId, '[Agent] Init', initModel.label);

    // Phase 1: Index
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
    console.log(`[agent] runAgenticLoop: ${textBlocks.length} textBlocks, ${imageIndex.length} images indexed`);
    agentBroadcast(tabId, '[Agent] Indexed', initModel.label,
        `${textBlocks.length} text | ${imageIndex.length} img`);

    // Phase 2: Chunk identification
    const chunkStart = Date.now();
    agentBroadcast(tabId, '[Agent] Chunking', initModel.label,
        `${textBlocks.length} text blocks → semantic grouping`);
    console.log(`[agent] identifySemanticChunks: starting with ${textBlocks.length} blocks, model pool:`, AGENT_MODEL_POOL.map(m => m.label));
    let chunks = await identifySemanticChunks(textBlocks, imageIndex, geminiApiKey, tabId);
    if (!chunks?.length) {
        agentBroadcast(tabId, '[Agent] Chunking fallback', null,
            'all models failed — using raw text blocks');
        chunks = textBlocks.map(b => ({ text: b.text, tags: [], blockIndices: [b.idx], nearbyImageIdx: null }));
    }
    agentBroadcast(tabId, '[Agent] Chunks ready', initModel.label,
        `${chunks.length} chunks | ${Date.now() - chunkStart}ms`);

    // Phase 3: ReAct loop
    const systemPrompt = buildAgentSystemPrompt(chunks, imageIndex);
    const messages = [{ role: 'user', text: systemPrompt }];
    const chunkState = {};

    for (let turn = 0; turn < MAX_TURNS; turn++) {
        const turnStart = Date.now();

        // ── Call LLM with model rotation failsafe ────────────────────────────
        let turnModel = pickAgentModel();
        agentBroadcast(tabId, '[Agent] Thinking...', turnModel.label, `Turn ${turn + 1}...`);

        let action;
        {
            const triedIds = new Set([turnModel.id]);
            let modelAttempt = 0;
            const MAX_MODEL_RETRIES = 5;
            while (true) {
                try {
                    action = await callAgent(messages, geminiApiKey, turnModel.id);
                    break;
                } catch (e) {
                    modelAttempt++;
                    const isTimeout = e.name === 'AbortError';
                    const errLabel = isTimeout ? 'TIMEOUT (25s)' : e.message;
                    console.warn(`[agent] ${turnModel.label} ${isTimeout ? 'timed out' : 'failed'} (attempt ${modelAttempt}):`, errLabel);
                    agentBroadcast(tabId, isTimeout ? '[Agent] Model timeout' : '[Agent] Model failed',
                        turnModel.label, `attempt ${modelAttempt}/${MAX_MODEL_RETRIES} — ${errLabel}`);
                    if (modelAttempt >= MAX_MODEL_RETRIES) {
                        agentBroadcast(tabId, '[Agent] All retries exhausted', turnModel.label,
                            `${MAX_MODEL_RETRIES} models tried, aborting loop`);
                        return;
                    }
                    const candidates = AGENT_MODEL_POOL.filter(m => !triedIds.has(m.id));
                    const next = candidates.length
                        ? candidates[Math.floor(Math.random() * candidates.length)]
                        : AGENT_MODEL_POOL[Math.floor(Math.random() * AGENT_MODEL_POOL.length)];
                    triedIds.add(next.id);
                    turnModel = next;
                    agentBroadcast(tabId, '[Agent] Rotating model', turnModel.label,
                        `retry ${modelAttempt + 1}/${MAX_MODEL_RETRIES}`);
                }
            }
        }
        const llmMs = Date.now() - turnStart;

        const { thought, tool, args, nextStep } = action;

        // ── DONE ─────────────────────────────────────────────────────────────
        if (tool === 'DONE') {
            agentBroadcast(tabId, '[Agent] Complete', turnModel.label,
                `${turn} turns | ${Date.now() - loopStart}ms total`);
            messages.push({ role: 'model', text: JSON.stringify(action) });
            break;
        }

        // ── Execute tool ─────────────────────────────────────────────────────
        const toolStart = Date.now();
        let result;
        try {
            result = await executeTool(tool, args || {}, imageIndex);
        } catch (e) {
            result = { error: e.message };
        }
        const toolMs = Date.now() - toolStart;
        const totalMs = llmMs + toolMs;

        // ── Accumulate state ─────────────────────────────────────────────────
        const ci = args?.chunkIdx ?? null;
        const chunkRef = ci != null ? `[C${ci + 1}/${chunks.length}]` : '';

        const historyEntry = {
            tool,
            thought: thought || '',
            nextStep: nextStep || '',
            model: turnModel.label,
            input: args || {},
            result,
            llmMs,
            toolMs,
            totalMs,
        };

        if (ci != null) {
            if (!chunkState[ci]) chunkState[ci] = { steps: [], data: {} };
            chunkState[ci].steps.push(historyEntry);

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

        // ── Broadcast with timing ────────────────────────────────────────────
        agentBroadcast(tabId, `${chunkRef} ${tool}`, turnModel.label,
            `${totalMs}ms (llm:${llmMs} tool:${toolMs}) | next: ${preview(nextStep, 6)}`);

        // ── Feed back to LLM ─────────────────────────────────────────────────
        messages.push({ role: 'model', text: JSON.stringify(action) });

        const resultSummary = summarizeResult(tool, result);
        messages.push({
            role: 'user',
            text: `Result[${tool}]: ${JSON.stringify(resultSummary)}\nContinue.`,
        });
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
        totalMs: Date.now() - loopStart,
        processHistory: chunkResults.map(r => ({ chunkIdx: r.chunkIdx, steps: r.history || [] })),
    };

    await chrome.storage.local.set({ tf_pt_refined: refinedData });

    chrome.tabs.sendMessage(tabId,
        { action: 'update_nuggets', data: refinedData },
        () => { chrome.runtime.lastError; }
    );

    agentBroadcast(tabId, '[Agent] Handoff', initModel.label,
        `${validResults.length}/${chunkResults.length} valid | ${Date.now() - loopStart}ms`);
}

// ── Semantic chunk identification ────────────────────────────────────────────

async function identifySemanticChunks(textBlocks, imageIndex, geminiApiKey, tabId) {
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

Rules: group related consecutive blocks; each chunk MUST be strictly under 300 words; preserve original wording; assign nearbyImageIdx by position proximity.`;

    const triedIds = new Set();
    const MAX_MODEL_RETRIES = AGENT_MODEL_POOL.length + 1;

    for (let attempt = 0; attempt < MAX_MODEL_RETRIES; attempt++) {
        const candidates = AGENT_MODEL_POOL.filter(m => !triedIds.has(m.id));
        const model = candidates.length
            ? candidates[Math.floor(Math.random() * candidates.length)]
            : AGENT_MODEL_POOL[Math.floor(Math.random() * AGENT_MODEL_POOL.length)];
        triedIds.add(model.id);

        const promptChars = prompt.length;
        console.log(`[agent] chunking attempt ${attempt + 1}/${MAX_MODEL_RETRIES}: ${model.label} | ${textBlocks.length} blocks | prompt ${promptChars} chars`);
        agentBroadcast(tabId, '[Agent] Chunking model', model.label,
            `attempt ${attempt + 1}/${MAX_MODEL_RETRIES} | ${textBlocks.length} blocks | ~${promptChars} chars`);

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model.id}:generateContent?key=${geminiApiKey}`;
        try {
            const res = await fetchWithTimeout(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { response_mime_type: 'application/json' },
                }),
            }, 30000);
            if (!res.ok) {
                const errBody = await res.json().catch(() => ({}));
                const errDetail = errBody.error?.message || res.statusText;
                console.error(`[agent] chunking ${model.label} HTTP ${res.status}:`, errDetail, errBody);
                agentBroadcast(tabId, '[Agent] Chunking failed', model.label,
                    `HTTP ${res.status}: ${errDetail} — rotating model`);
                continue;
            }
            const data = await res.json();
            const jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!jsonText) {
                console.warn(`[agent] chunking ${model.label}: empty response. Full:`, JSON.stringify(data).slice(0, 400));
                agentBroadcast(tabId, '[Agent] Chunking empty', model.label,
                    'no content in response — rotating model');
                continue;
            }
            let chunks;
            try {
                chunks = JSON.parse(jsonText).chunks || null;
            } catch (parseErr) {
                console.error(`[agent] chunking ${model.label}: JSON.parse failed:`, parseErr.message, '| raw:', jsonText.slice(0, 300));
                agentBroadcast(tabId, '[Agent] Chunking parse error', model.label,
                    `JSON parse failed — rotating model`);
                continue;
            }
            if (!chunks?.length) {
                console.warn(`[agent] chunking ${model.label}: parsed 0 chunks. jsonText:`, jsonText.slice(0, 300));
                agentBroadcast(tabId, '[Agent] Chunking invalid', model.label,
                    'parsed 0 chunks — rotating model');
                continue;
            }
            return chunks;
        } catch (e) {
            const isTimeout = e.name === 'AbortError';
            const msg = isTimeout ? 'timed out after 30s' : e.message;
            console.error(`[agent] chunking ${model.label} ${isTimeout ? 'TIMEOUT' : 'threw'}:`, msg);
            agentBroadcast(tabId, isTimeout ? '[Agent] Chunking timeout' : '[Agent] Chunking error',
                model.label, `${msg} — rotating model`);
        }
    }

    return null;
}
