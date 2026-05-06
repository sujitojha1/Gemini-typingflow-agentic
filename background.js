const GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image";
const GEMMA_MODEL       = "gemma-4-26b-a4b-it";

let imageQuotaExceeded = false;

// ── Model definitions ────────────────────────────────────────────────────────

const DEFAULT_GOOGLE_MODELS = [
    { id: 'gemini-3.1-flash-lite-preview', label: 'Gemini Flash Lite 3.1', vision: false },
    { id: 'gemini-3-flash-preview',        label: 'Gemini 3 Flash',        vision: false },
    { id: 'gemini-2.5-flash-lite',         label: 'Gemini 2.5 Flash Lite', vision: false },
    { id: 'gemma-4-26b-a4b-it',           label: 'Gemma 4 26B',           vision: true  },
    { id: 'gemma-4-31b-it',               label: 'Gemma 4 31B',           vision: true  },
];

// Mutable pools — rebuilt by refreshActiveSettings() before each pipeline run
let MODEL_POOL       = [...DEFAULT_GOOGLE_MODELS];
let AGENT_MODEL_POOL = [...DEFAULT_GOOGLE_MODELS];

// Active provider settings — read from storage, updated per run
let ACTIVE_SETTINGS = {
    provider:    'google',
    ollamaUrl:   'http://localhost:11434',
    ollamaModel: '',
};

async function refreshActiveSettings() {
    const stored = await chrome.storage.sync.get(
        ['modelProvider', 'enabledModelIds', 'customModelIds',
         'ollamaBaseUrl', 'ollamaModels', 'ollamaEnabledModels', 'ollamaModel']
    );

    ACTIVE_SETTINGS.provider  = stored.modelProvider || 'google';
    ACTIVE_SETTINGS.ollamaUrl = (stored.ollamaBaseUrl || 'http://localhost:11434').replace(/\/$/, '');

    if (ACTIVE_SETTINGS.provider === 'ollama') {
        // Support both new (ollamaModels array) and legacy (ollamaModel string) storage
        const allOllamaIds = (stored.ollamaModels && stored.ollamaModels.length > 0)
            ? stored.ollamaModels
            : (stored.ollamaModel ? [stored.ollamaModel] : []);

        const enabledIds = stored.ollamaEnabledModels;
        const enabledModels = (enabledIds && enabledIds.length > 0)
            ? allOllamaIds.filter(id => enabledIds.includes(id))
            : allOllamaIds;

        const activeModels = enabledModels.length > 0 ? enabledModels : allOllamaIds;

        ACTIVE_SETTINGS.ollamaModel = activeModels[0] || stored.ollamaModel || '';

        MODEL_POOL = activeModels.length > 0
            ? activeModels.map(id => ({ id, label: `Ollama (${id})`, vision: false, isOllama: true }))
            : [{ id: ACTIVE_SETTINGS.ollamaModel || 'ollama',
                 label: `Ollama (${ACTIVE_SETTINGS.ollamaModel || 'unconfigured'})`,
                 vision: false, isOllama: true }];
        AGENT_MODEL_POOL = MODEL_POOL;
    } else {
        ACTIVE_SETTINGS.ollamaModel = stored.ollamaModel || '';

        const customIds  = stored.customModelIds  || [];
        const customMods = customIds.map(id => ({ id, label: id, vision: false }));
        const allMods    = [...DEFAULT_GOOGLE_MODELS, ...customMods];

        const enabledIds = stored.enabledModelIds;
        const pool = (enabledIds && enabledIds.length > 0)
            ? allMods.filter(m => enabledIds.includes(m.id))
            : [...DEFAULT_GOOGLE_MODELS];

        MODEL_POOL       = pool.length > 0 ? pool : [...DEFAULT_GOOGLE_MODELS];
        AGENT_MODEL_POOL = MODEL_POOL;
    }
}

function pickAgentModel() {
    return AGENT_MODEL_POOL[Math.floor(Math.random() * AGENT_MODEL_POOL.length)];
}

// ── Ollama API ────────────────────────────────────────────────────────────────

async function callOllamaStructuring(payload, modelId) {
    const { ollamaUrl, ollamaModel } = ACTIVE_SETTINGS;
    const model = modelId || ollamaModel;
    if (!model) return { error: 'No Ollama model configured. Set it in Settings.' };

    const fullPrompt = SYSTEM_PROMPT + '\n\nRAW SCRAPED CONTENT:\n' + JSON.stringify(payload);
    // Estimate tokens (≈4 chars/token) and request enough context to hold the prompt + response
    const estimatedTokens = Math.ceil(fullPrompt.length / 4);
    const numCtx = Math.max(8192, estimatedTokens + 2048);

    try {
        console.log(`[typingflow] callOllamaStructuring: model=${model} prompt≈${estimatedTokens} tokens num_ctx=${numCtx}`);
        const response = await fetchWithTimeout(`${ollamaUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                messages: [{ role: 'user', content: fullPrompt }],
                format:   'json',
                stream:   false,
                options:  { num_ctx: numCtx },
            }),
        }, 120000);

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            const detail = err.error || response.statusText;
            return { error: `Ollama ${response.status}: ${detail}` };
        }
        const data    = await response.json();
        const content = data.message?.content;
        if (!content) return { error: 'Ollama returned empty content — model may not support JSON mode' };

        try {
            return { success: true, api_response: JSON.parse(content) };
        } catch (e) {
            const match = content.match(/\{[\s\S]*\}/);
            if (match) {
                try { return { success: true, api_response: JSON.parse(match[0]) }; } catch {}
            }
            return { error: `Ollama JSON parse failed: ${e.message} | content[:200]: ${content.slice(0, 200)}` };
        }
    } catch (e) {
        const msg = e.name === 'AbortError' ? 'Ollama timed out (model too slow for page size)' : `Ollama request failed: ${e.message}`;
        return { error: msg };
    }
}

async function callOllamaAgent(allMessages, modelId) {
    const { ollamaUrl, ollamaModel } = ACTIVE_SETTINGS;
    const model = modelId || ollamaModel;
    const messages = allMessages.map(m => ({
        role:    m.role === 'model' ? 'assistant' : m.role,
        content: m.text,
    }));

    const res = await fetchWithTimeout(`${ollamaUrl}/api/chat`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, format: 'json', stream: false, options: { num_ctx: 8192 } }),
    }, 60000);

    if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(`Ollama agent ${res.status}: ${errBody.error || res.statusText}`);
    }
    const data = await res.json();
    const raw  = data.message?.content;
    if (!raw) throw new Error('Ollama agent: empty response');

    try { return JSON.parse(raw); } catch (e) {
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) { try { return JSON.parse(match[0]); } catch {} }
        throw new Error(`Ollama agent JSON parse failed: ${e.message}`);
    }
}

// Shared fetch with AbortController timeout — prevents silent hangs in service-worker context
async function fetchWithTimeout(url, options, timeoutMs = 25000) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
        console.error(`[typingflow] fetchWithTimeout: aborting after ${timeoutMs}ms — ${url.split('?')[0].split('/').pop()}`);
        controller.abort();
    }, timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

// Shared base64 encoder — chunked to avoid call-stack overflow on large images
function arrayBufferToBase64(buf) {
    const bytes = new Uint8Array(buf);
    const CHUNK = 8192;
    let bin = '';
    for (let i = 0; i < bytes.length; i += CHUNK) {
        bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
}

function isValidHttpUrl(str) {
    try { const u = new URL(str); return u.protocol === 'https:' || u.protocol === 'http:'; }
    catch { return false; }
}

// Gemma 4 thinking models prepend an empty {"text":"","thought":true} part before the real response
function pickResponseText(data) {
    const parts = data.candidates?.[0]?.content?.parts || [];
    return parts.find(p => p.text && !p.thought)?.text || null;
}

function stripMarkdownFences(text) {
    return text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
}

// ── Structuring System Prompt ────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert learning engine and strict JSON structuring agent.
You are given a chronologically ordered array of text chunks and image URLs scraped from an article.
Your task is to structure this content into a rich learning payload.

RULES:
1. Generate a 'tldr' (a single-sentence summary of the entire page).
2. Auto-extract an array of 3-5 semantic 'tags' (e.g., "#machinelearning", "#design").
3. Group the logically related original text chunks together into manageable semantic "nuggets" to preserve the author's voice. Each nugget MUST be strictly under 300 words. Do NOT heavily rewrite the text, just intelligently chunk it into smaller pieces if necessary.
4. If an image URL is highly relevant to a specific nugget based on chronological proximity or context, map its URL to 'img_src'. If no image is relevant for that nugget, map 'img_src' as null.
5. Return a 'star_rating' (integer 1-5): your editorial quality and depth assessment of the article content.
6. Return a 'coverage_pct' (integer 0-100): the percentage of the page's meaningful content captured across all nuggets combined.

EXPECTED JSON SCHEMA:
{
  "tldr": "string",
  "star_rating": 4,
  "coverage_pct": 85,
  "tags": ["string"],
  "nuggets": [
    {
      "text": "The logically grouped original text chunks representing this concept.",
      "img_src": "url_string_or_null"
    }
  ]
}`;

// ── Gemini API ───────────────────────────────────────────────────────────────

async function callGeminiWithModel(payload, modelId) {
    const { geminiApiKey } = await chrome.storage.sync.get('geminiApiKey');
    if (!geminiApiKey) return { error: "API Key not configured." };
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${geminiApiKey}`;
    const fullPrompt = SYSTEM_PROMPT + "\n\nRAW SCRAPED CONTENT:\n" + JSON.stringify(payload);
    try {
        console.log(`[typingflow] callGeminiWithModel: ${modelId} | prompt ~${fullPrompt.length} chars`);
        const response = await fetchWithTimeout(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: fullPrompt }] }],
                generationConfig: { response_mime_type: "application/json" }
            })
        }, 30000);
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            const msg = `${modelId} error (${response.status}): ${err.error?.message || response.statusText}`;
            console.error(`[typingflow] callGeminiWithModel HTTP ${response.status}:`, msg, err);
            return { error: msg };
        }
        const data = await response.json();
        const jsonText = pickResponseText(data);
        if (!jsonText) {
            console.warn(`[typingflow] callGeminiWithModel ${modelId}: empty response. Full:`, JSON.stringify(data).slice(0, 400));
            return { error: `${modelId} returned empty response.` };
        }
        try {
            return { success: true, api_response: JSON.parse(jsonText) };
        } catch (parseErr) {
            console.error(`[typingflow] callGeminiWithModel ${modelId}: JSON.parse failed:`, parseErr.message, '| raw:', jsonText.slice(0, 300));
            return { error: `${modelId} JSON parse failed: ${parseErr.message}` };
        }
    } catch (e) {
        console.error(`[typingflow] callGeminiWithModel ${modelId} threw:`, e.message);
        return { error: `${modelId} request failed: ${e.message}` };
    }
}

// ── Gemma API (vision-capable) ───────────────────────────────────────────────

async function callGemmaAPI(payload) {
    const { geminiApiKey } = await chrome.storage.sync.get('geminiApiKey');
    if (!geminiApiKey) {
        return { error: "API Key not configured. Please initialize your key in the Options panel." };
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMMA_MODEL}:generateContent?key=${geminiApiKey}`;

    const textItems  = payload.filter(p => p.type === 'text');
    const imageItems = payload.filter(p => p.type === 'image' && isValidHttpUrl(p.src));

    const parts = [
        { text: SYSTEM_PROMPT + '\n\nRAW SCRAPED CONTENT:\n' + JSON.stringify(textItems) }
    ];

    // Fetch up to 5 page images in parallel and attach as inlineData for visual chunk-mapping
    const imageResults = await Promise.allSettled(
        imageItems.slice(0, 5).map(async (img) => {
            const r = await fetchWithTimeout(img.src, {}, 10000);
            if (!r.ok) throw new Error(`${r.status}`);
            return { mimeType: r.headers.get('content-type') || 'image/jpeg', data: arrayBufferToBase64(await r.arrayBuffer()) };
        })
    );
    for (const r of imageResults) {
        if (r.status === 'fulfilled') parts.push({ inlineData: r.value });
        else console.warn(`[typingflow] callGemmaAPI: image fetch failed:`, r.reason?.message);
    }

    try {
        console.log(`[typingflow] callGemmaAPI: ${GEMMA_MODEL} | ${textItems.length} text items | ${parts.length - 1} images attached`);
        const response = await fetchWithTimeout(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts }],
                generationConfig: { response_mime_type: "application/json" }
            })
        }, 35000);

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const msg = `Gemma API Error (${response.status}): ${errorData.error?.message || response.statusText}`;
            console.error(`[typingflow] callGemmaAPI HTTP ${response.status}:`, msg, errorData);
            return { error: msg };
        }

        const data = await response.json();
        const jsonText = pickResponseText(data);
        if (!jsonText) {
            console.warn(`[typingflow] callGemmaAPI: empty response. Full:`, JSON.stringify(data).slice(0, 400));
            return { error: "Gemma returned an empty response." };
        }
        try {
            return { success: true, api_response: JSON.parse(jsonText) };
        } catch (parseErr) {
            console.error(`[typingflow] callGemmaAPI: JSON.parse failed:`, parseErr.message, '| raw:', jsonText.slice(0, 300));
            return { error: `Gemma JSON parse failed: ${parseErr.message}` };
        }
    } catch (error) {
        console.error(`[typingflow] callGemmaAPI threw:`, error.message);
        return { error: `Gemma request failed: ${error.message}` };
    }
}

// ── Image Generation ─────────────────────────────────────────────────────────

async function generateContextualImage({ text, tags }) {
    if (imageQuotaExceeded) return { success: true, img_src: await fallbackDataUrl(tags) };

    const { geminiApiKey } = await chrome.storage.sync.get('geminiApiKey');
    if (!geminiApiKey) return { success: false, error: "API Key Missing" };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${geminiApiKey}`;
    const prompt = `Create a visually stunning, minimal abstract representation for this learning concept. Context: ${text} Tags: ${(tags || []).join(', ')}`;

    try {
        const response = await fetchWithTimeout(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { responseModalities: ["IMAGE", "TEXT"] }
            })
        }, 30000);

        if (!response.ok) {
            const errBody = await response.json().catch(() => ({}));
            if (response.status === 429) {
                imageQuotaExceeded = true;
                console.warn(`[typingflow] Image quota exceeded — skipping image generation for this session`);
            } else {
                console.warn(`[typingflow] Image API ${response.status}:`, errBody?.error?.message || response.statusText);
            }
            return { success: true, img_src: await fallbackDataUrl(tags) };
        }

        const data = await response.json();
        const parts = data.candidates?.[0]?.content?.parts || [];
        const imagePart = parts.find(p => p.inlineData);
        if (imagePart) {
            const { mimeType, data: b64 } = imagePart.inlineData;
            console.log("[typingflow] Image received, mimeType:", mimeType);
            return { success: true, img_src: `data:${mimeType};base64,${b64}` };
        }

        console.warn("[typingflow] No inlineData in image response:", JSON.stringify(parts));
        return { success: true, img_src: await fallbackDataUrl(tags) };
    } catch (e) {
        console.error("[typingflow] Image generation exception:", e.message);
        return { success: true, img_src: await fallbackDataUrl(tags) };
    }
}

// Returns a picsum image as a data: URL so page CSP cannot block it
async function fallbackDataUrl(tags) {
    const seed = (tags && tags.length > 0 ? tags[0].replace('#', '') : 'learn') + Math.floor(Math.random() * 999);
    const picsumUrl = `https://picsum.photos/seed/${seed}/800/500`;
    try {
        const r = await fetchWithTimeout(picsumUrl, {}, 10000);
        if (!r.ok) throw new Error(`picsum ${r.status}`);
        const mimeType = r.headers.get('content-type') || 'image/jpeg';
        return `data:${mimeType};base64,${arrayBufferToBase64(await r.arrayBuffer())}`;
    } catch (e) {
        console.error("[typingflow] Fallback image failed:", e.message);
        return null;
    }
}

// ── Load tool and agentic-flow modules ──────────────────────────────────────
// importScripts executes synchronously in the service-worker global scope,
// so all globals above are available to the imported files at call time.

importScripts(
    // Chunk-processing tools (parallel agentic track)
    'tools/tool_check_relevance.js',
    'tools/tool_get_chunk_stats.js',
    'tools/tool_extract_subject.js',
    'tools/tool_evaluate_chunk.js',
    'tools/tool_check_grammar.js',
    'tools/tool_refine_chunk.js',
    'tools/tool_update_coverage.js',
    // Agent pipeline & orchestration
    'agentic_flow.js'
);

// ── Message Router ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "agent_start") {
        (async () => {
            await refreshActiveSettings();
            runAgentPipeline(request.tabId);
        })();
        sendResponse({ started: true });
        return true;
    }
    if (request.action === "proxy_gemini_api") {
        (async () => {
            await refreshActiveSettings();
            if (ACTIVE_SETTINGS.provider === 'ollama') {
                const result = await callOllamaStructuring(request.payload);
                sendResponse(result);
                return;
            }
            for (const model of MODEL_POOL) {
                const result = await callGeminiWithModel(request.payload, model.id);
                if (result.success) { sendResponse(result); return; }
                console.warn(`[typingflow] proxy_gemini_api: ${model.label} failed:`, result.error);
            }
            sendResponse({ error: 'All models failed' });
        })();
        return true;
    }
    if (request.action === "generate_image_asset") {
        generateContextualImage(request.payload).then(sendResponse);
        return true;
    }
});
