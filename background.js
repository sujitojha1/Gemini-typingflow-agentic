const GEMINI_TEXT_MODEL = "gemini-3.1-flash-lite-preview";
const GEMINI_IMAGE_MODEL = "gemini-2.5-flash-image";

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "proxy_gemini_api") {
        console.log("[typingflow] Routing to text API...");
        callGeminiAPI(request.payload).then(sendResponse);
        return true;
    }
    if (request.action === "generate_image_asset") {
        console.log("[typingflow] Routing to image API...");
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
