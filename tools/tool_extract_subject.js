async function toolExtractSubject({ text }) {
    const { geminiApiKey } = await chrome.storage.sync.get('geminiApiKey');
    if (!geminiApiKey) return { subject: 'Untitled' };

    const model = pickAgentModel();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model.id}:generateContent?key=${geminiApiKey}`;

    const prompt = `Extract a concise subject title (4–8 words) for this learning chunk. Return ONLY valid JSON: {"subject":"<title>"}

CHUNK:
${text.slice(0, 600)}`;

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
            console.warn(`[agent] toolExtractSubject ${model.label} HTTP ${res.status}:`, errDetail, errBody);
            return { subject: 'Untitled' };
        }
        const data = await res.json();
        const jsonText = pickResponseText(data);
        if (!jsonText) {
            console.warn(`[agent] toolExtractSubject ${model.label}: empty response. Full:`, JSON.stringify(data).slice(0, 400));
            return { subject: 'Untitled' };
        }
        try {
            return { subject: JSON.parse(stripMarkdownFences(jsonText)).subject || 'Untitled' };
        } catch (parseErr) {
            console.error(`[agent] toolExtractSubject ${model.label}: JSON.parse failed:`, parseErr.message, '| raw:', jsonText.slice(0, 200));
            return { subject: 'Untitled' };
        }
    } catch (e) {
        const isTimeout = e.name === 'AbortError';
        console.error(`[agent] toolExtractSubject ${model.label} ${isTimeout ? 'TIMEOUT' : 'threw'}:`, e.message);
        return { subject: 'Untitled' };
    }
}
