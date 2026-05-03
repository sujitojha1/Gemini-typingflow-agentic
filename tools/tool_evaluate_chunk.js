async function toolEvaluateChunk({ text }) {
    const { geminiApiKey } = await chrome.storage.sync.get('geminiApiKey');
    if (!geminiApiKey) {
        return { score: 0, clarity: 0, completeness: 0, critique: 'No API key', suggestions: '', error: true };
    }

    const model = pickAgentModel();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model.id}:generateContent?key=${geminiApiKey}`;

    const prompt = `Evaluate the following learning content chunk for quality. Return ONLY valid JSON matching the schema exactly.

Content:
${text}

Schema: {"score":<integer 1-5>,"clarity":<integer 1-5>,"completeness":<integer 1-5>,"critique":"<one sentence identifying the main weakness>","suggestions":"<one sentence concrete improvement>"}`;

    try {
        const res = await fetchWithTimeout(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                ...(supportsJsonMode(model.id) ? { generationConfig: { response_mime_type: 'application/json' } } : {}),
            })
        }, 20000);
        if (!res.ok) {
            const errBody = await res.json().catch(() => ({}));
            const errDetail = errBody.error?.message || res.statusText;
            console.warn(`[agent] toolEvaluateChunk ${model.label} HTTP ${res.status}:`, errDetail, errBody);
            return { score: 0, critique: `API error ${res.status}: ${errDetail}`, error: true };
        }
        const data = await res.json();
        const jsonText = pickResponseText(data);
        if (!jsonText) {
            console.warn(`[agent] toolEvaluateChunk ${model.label}: empty response. Full:`, JSON.stringify(data).slice(0, 400));
            return { score: 0, critique: 'Empty response', error: true };
        }
        try {
            return JSON.parse(stripMarkdownFences(jsonText));
        } catch (parseErr) {
            console.error(`[agent] toolEvaluateChunk ${model.label}: JSON.parse failed:`, parseErr.message, '| raw:', jsonText.slice(0, 200));
            return { score: 0, critique: `Parse failed: ${parseErr.message}`, error: true };
        }
    } catch (e) {
        const isTimeout = e.name === 'AbortError';
        console.error(`[agent] toolEvaluateChunk ${model.label} ${isTimeout ? 'TIMEOUT' : 'threw'}:`, e.message);
        return { score: 0, critique: isTimeout ? 'timed out after 20s' : e.message, error: true };
    }
}
