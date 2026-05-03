const GEMINI_TEXT_MODEL = "gemini-3.1-flash-lite-preview";
const GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image";
const GEMMA_MODEL       = "gemma-4-31b-it";

// Model pool for primary structuring — tried in order, rotates on failure
const MODEL_POOL = [
    { id: 'gemini-3.1-flash-lite-preview',  label: 'Gemini Flash Lite', vision: false },
    { id: 'gemini-2.0-flash',               label: 'Gemini Flash 2.0',  vision: false },
    { id: 'gemini-2.5-flash-preview-05-20', label: 'Gemini Flash 2.5',  vision: false },
    { id: 'gemma-4-31b-it',                 label: 'Gemma 4 31B',       vision: true  },
];

// ── Agent utilities ──────────────────────────────────────────────────────────

function agentBroadcast(tabId, task, model, detail = '') {
    const msg = { action: 'agent_status', task, model, detail };
    // → content script in the tab
    chrome.tabs.sendMessage(tabId, msg, () => { chrome.runtime.lastError; });
    // → popup (if still open)
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

async function callModelForStructuring(payload, model) {
    return model.vision ? callGemmaAPI(payload) : callGeminiWithModel(payload, model.id);
}

// ── Agent pipeline ───────────────────────────────────────────────────────────

async function runAgentPipeline(tabId) {
    const { geminiApiKey } = await chrome.storage.sync.get('geminiApiKey');
    if (!geminiApiKey) {
        agentBroadcast(tabId, 'error', null, 'API key not configured');
        return;
    }

    // TASK: extract
    agentBroadcast(tabId, 'extracting page content', '—');
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

    await chrome.storage.local.set({ tf_agent_payload: payload, tf_agent_tab: tabId });

    // TASK: structure with model rotation
    let structureResult = null;
    let usedModel = null;
    for (const model of MODEL_POOL) {
        agentBroadcast(tabId, 'structuring nuggets', model.label);
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

    // TASK: mount gallery
    agentBroadcast(tabId, 'mounting gallery', usedModel.label);
    await tabMessage(tabId, { action: 'mount_ui', data: structureResult.api_response })
        .catch(() => {});
    chrome.tabs.sendMessage(tabId, { action: 'open_overlay' }, () => { chrome.runtime.lastError; });

    // signal popup to close
    chrome.runtime.sendMessage({ action: 'agent_close_popup' }, () => { chrome.runtime.lastError; });

    // persist session
    await chrome.storage.local.set({
        tf_agent_session: {
            timestamp: Date.now(),
            model: usedModel.label,
            nuggetCount: structureResult.api_response.nuggets?.length,
            tldr: structureResult.api_response.tldr,
            tags: structureResult.api_response.tags,
        }
    });

    agentBroadcast(tabId, 'complete', usedModel.label,
        `${structureResult.api_response.nuggets?.length} nuggets`);

    // TASK: background Gemma refinement (always, regardless of which model mounted)
    if (usedModel.id !== GEMMA_MODEL) {
        agentBroadcast(tabId, 'refining with Gemma 4', 'Gemma 4 31B');
        callGemmaAPI(payload).then(result => {
            if (result.success) {
                chrome.tabs.sendMessage(tabId,
                    { action: 'update_nuggets', data: result.api_response },
                    () => { chrome.runtime.lastError; });
                agentBroadcast(tabId, 'refined', 'Gemma 4 31B');
            } else {
                console.warn('[agent] Gemma refinement failed:', result.error);
            }
        });
    }
}

// ── Message router ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "agent_start") {
        runAgentPipeline(request.tabId);
        sendResponse({ started: true });
        return true;
    }
    if (request.action === "proxy_gemini_api") {
        callGeminiAPI(request.payload).then(sendResponse);
        return true;
    }
    if (request.action === "generate_image_asset") {
        generateContextualImage(request.payload).then(sendResponse);
        return true;
    }
});

const SYSTEM_PROMPT = `You are an expert learning engine and strict JSON structuring agent.
You are given a chronologically ordered array of text chunks and image URLs scraped from an article.
Your task is to structure this content into a rich learning payload.

RULES:
1. Generate a 'tldr' (a single-sentence summary of the entire page).
2. Auto-extract an array of 3-5 semantic 'tags' (e.g., "#machinelearning", "#design").
3. Group the logically related original text chunks together into manageable semantic "nuggets" to preserve the author's voice. Do NOT heavily rewrite the text, just intelligently chunk it.
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

async function callGeminiWithModel(payload, modelId) {
    const { geminiApiKey } = await chrome.storage.sync.get('geminiApiKey');
    if (!geminiApiKey) return { error: "API Key not configured." };
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${geminiApiKey}`;
    const fullPrompt = SYSTEM_PROMPT + "\n\nRAW SCRAPED CONTENT:\n" + JSON.stringify(payload);
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: fullPrompt }] }],
                generationConfig: { response_mime_type: "application/json" }
            })
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            return { error: `${modelId} error (${response.status}): ${err.error?.message || response.statusText}` };
        }
        const data = await response.json();
        const jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!jsonText) return { error: `${modelId} returned empty response.` };
        return { success: true, api_response: JSON.parse(jsonText) };
    } catch (e) {
        return { error: `${modelId} request failed: ${e.message}` };
    }
}

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
            const r = await fetch(img.src);
            if (!r.ok) throw new Error(`${r.status}`);
            const buf = await r.arrayBuffer();
            const bytes = new Uint8Array(buf);
            const CHUNK = 8192;
            let bin = '';
            for (let i = 0; i < bytes.length; i += CHUNK) {
                bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
            }
            return { mimeType: r.headers.get('content-type') || 'image/jpeg', data: btoa(bin) };
        })
    );
    for (const r of imageResults) {
        if (r.status === 'fulfilled') parts.push({ inlineData: r.value });
    }

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts }],
                generationConfig: { response_mime_type: "application/json" }
            })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            return { error: `Gemma API Error (${response.status}): ${errorData.error?.message || response.statusText}` };
        }

        const data = await response.json();
        const jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!jsonText) return { error: "Gemma returned an empty response." };
        return { success: true, api_response: JSON.parse(jsonText) };
    } catch (error) {
        return { error: `Gemma request failed: ${error.message}` };
    }
}

function isValidHttpUrl(str) {
    try { const u = new URL(str); return u.protocol === 'https:' || u.protocol === 'http:'; }
    catch { return false; }
}

async function callGeminiAPI(payload) {
    const { geminiApiKey } = await chrome.storage.sync.get('geminiApiKey');

    if (!geminiApiKey) {
        return { error: "API Key not configured. Please initialize your key in the Options panel." };
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_TEXT_MODEL}:generateContent?key=${geminiApiKey}`;
    const fullPrompt = SYSTEM_PROMPT + "\n\nRAW SCRAPED CONTENT:\n" + JSON.stringify(payload);

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: fullPrompt }] }],
                generationConfig: { response_mime_type: "application/json" }
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            return { error: `Google API Error (${response.status}): ${errorData.error?.message || response.statusText}` };
        }

        const data = await response.json();
        const jsonText = data.candidates[0]?.content?.parts[0]?.text;
        if (!jsonText) return { error: "Gemini returned an empty response." };
        return { success: true, api_response: JSON.parse(jsonText) };
    } catch (error) {
        return { error: `Network exception in Service Worker: ${error.message}` };
    }
}

async function generateContextualImage({ text, tags }) {
    console.log("[typingflow] Invoking image generation...");

    const { geminiApiKey } = await chrome.storage.sync.get('geminiApiKey');
    if (!geminiApiKey) return { success: false, error: "API Key Missing" };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${geminiApiKey}`;
    const prompt = `Create a visually stunning, minimal abstract representation for this learning concept. Context: ${text} Tags: ${(tags || []).join(', ')}`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { responseModalities: ["IMAGE", "TEXT"] }
            })
        });

        if (!response.ok) {
            const errBody = await response.json().catch(() => ({}));
            console.warn(`[typingflow] Image API ${response.status}:`, errBody?.error?.message || response.statusText);
            return { success: true, img_src: await fallbackDataUrl(tags) };
        }

        const data = await response.json();
        const parts = data.candidates?.[0]?.content?.parts || [];
        // Image model may return text + image parts; find the inlineData part specifically
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
        const r = await fetch(picsumUrl);
        if (!r.ok) throw new Error(`picsum ${r.status}`);
        const buf = await r.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let bin = '';
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        const mimeType = r.headers.get('content-type') || 'image/jpeg';
        return `data:${mimeType};base64,${btoa(bin)}`;
    } catch (e) {
        console.error("[typingflow] Fallback image failed:", e.message);
        return null;
    }
}
