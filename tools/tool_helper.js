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

    // Try every model in the pool before giving up — mirrors the Track 1 structuring loop
    let lastError = 'no models available';
    for (const model of AGENT_MODEL_POOL) {
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
                lastError = `API ${res.status}: ${errBody.error?.message || res.statusText}`;
                console.warn(`[tool] ${model.label} HTTP ${res.status} — trying next model`);
                continue;
            }

            const data = await res.json();
            const jsonText = pickResponseText(data);
            if (!jsonText) {
                lastError = 'Empty response';
                console.warn(`[tool] ${model.label}: empty response — trying next model`);
                continue;
            }

            try {
                return JSON.parse(stripMarkdownFences(jsonText));
            } catch (parseErr) {
                lastError = `Parse failed: ${parseErr.message}`;
                console.error(`[tool] ${model.label}: JSON parse failed:`, parseErr.message, '| raw:', jsonText.slice(0, 200));
                continue;
            }
        } catch (e) {
            const isTimeout = e.name === 'AbortError';
            lastError = isTimeout ? `timed out after ${timeoutMs}ms` : e.message;
            console.error(`[tool] ${model.label} ${isTimeout ? 'TIMEOUT' : 'threw'}:`, e.message);
            continue;
        }
    }

    console.warn('[tool] callToolModel: all models exhausted —', lastError);
    return { ...defaultResult, error: lastError };
}
