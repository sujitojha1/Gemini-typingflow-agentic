async function toolCheckRelevance({ text }) {
    const { geminiApiKey } = await chrome.storage.sync.get('geminiApiKey');
    if (!geminiApiKey) {
        return { isAd: false, reason: 'No API key', error: true };
    }

    const modelId = 'gemini-3.1-flash-lite-preview';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${geminiApiKey}`;

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
        if (!res.ok) return { isAd: false, reason: `API error ${res.status}`, error: true };
        const data = await res.json();
        const jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        return jsonText ? JSON.parse(jsonText) : { isAd: false, reason: 'Empty response', error: true };
    } catch (e) {
        return { isAd: false, reason: e.message, error: true };
    }
}
