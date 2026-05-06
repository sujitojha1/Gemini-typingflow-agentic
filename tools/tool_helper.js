// tool_helper.js — Shared LLM call helper for all tool_*.js files.
// Eliminates ~35 lines of boilerplate duplicated across 5 tool files.
//
// Depends on: background.js globals:
//   pickAgentModel, fetchWithTimeout, pickResponseText, stripMarkdownFences

async function callToolModel(prompt, defaultResult, timeoutMs = 20000) {
    const { geminiApiKey } = await chrome.storage.sync.get('geminiApiKey');
    if (!geminiApiKey) {
        console.warn('[tool] callToolModel: no API key configured');
        return { ...defaultResult, error: 'No API key' };
    }

    const model = pickAgentModel();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model.id}:generateContent?key=${geminiApiKey}`;

    try {
        const res = await fetchWithTimeout(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { response_mime_type: 'application/json' },
            }),
        }, timeoutMs);

        if (!res.ok) {
            const errBody = await res.json().catch(() => ({}));
            const errDetail = errBody.error?.message || res.statusText;
            console.warn(`[tool] ${model.label} HTTP ${res.status}:`, errDetail);
            return { ...defaultResult, error: `API ${res.status}: ${errDetail}` };
        }

        const data = await res.json();
        const jsonText = pickResponseText(data);
        if (!jsonText) {
            console.warn(`[tool] ${model.label}: empty response`);
            return { ...defaultResult, error: 'Empty response' };
        }

        try {
            return JSON.parse(stripMarkdownFences(jsonText));
        } catch (parseErr) {
            console.error(`[tool] ${model.label}: JSON parse failed:`, parseErr.message, '| raw:', jsonText.slice(0, 200));
            return { ...defaultResult, error: `Parse failed: ${parseErr.message}` };
        }
    } catch (e) {
        const isTimeout = e.name === 'AbortError';
        console.error(`[tool] ${model.label} ${isTimeout ? 'TIMEOUT' : 'threw'}:`, e.message);
        return { ...defaultResult, error: isTimeout ? `timed out after ${timeoutMs}ms` : e.message };
    }
}
