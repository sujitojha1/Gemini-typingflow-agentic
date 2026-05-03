async function toolCheckRelevance({ text }) {
    const { geminiApiKey } = await chrome.storage.sync.get('geminiApiKey');
    if (!geminiApiKey) {
        return { isAd: false, reason: 'No API key', error: true };
    }

    const model = pickAgentModel();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model.id}:generateContent?key=${geminiApiKey}`;

    const prompt = `Analyze the following text chunk and determine if it is an advertisement, sponsored content, site navigation, cookie notice, or irrelevant boilerplate that should not be part of a learning session. Return ONLY valid JSON matching the schema exactly.

Content:
${text}

Schema: {"isAd":<boolean>,"reason":"<one short sentence explaining why>"}`;

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { response_mime_type: 'application/json' }
            })
        });
        if (!res.ok) {
            const errBody = await res.json().catch(() => ({}));
            const errDetail = errBody.error?.message || res.statusText;
            console.warn(`[agent] toolCheckRelevance ${model.label} HTTP ${res.status}:`, errDetail, errBody);
            return { isAd: false, reason: `API error ${res.status}: ${errDetail}`, error: true };
        }
        const data = await res.json();
        const jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!jsonText) {
            console.warn(`[agent] toolCheckRelevance ${model.label}: empty response. Full:`, JSON.stringify(data).slice(0, 400));
            return { isAd: false, reason: 'Empty response', error: true };
        }
        try {
            return JSON.parse(jsonText);
        } catch (parseErr) {
            console.error(`[agent] toolCheckRelevance ${model.label}: JSON.parse failed:`, parseErr.message, '| raw:', jsonText.slice(0, 200));
            return { isAd: false, reason: `Parse failed: ${parseErr.message}`, error: true };
        }
    } catch (e) {
        console.error(`[agent] toolCheckRelevance ${model.label} threw:`, e.message);
        return { isAd: false, reason: e.message, error: true };
    }
}
