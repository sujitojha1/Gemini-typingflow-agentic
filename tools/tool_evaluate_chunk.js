async function toolEvaluateChunk({ text }) {
    const { geminiApiKey } = await chrome.storage.sync.get('geminiApiKey');
    if (!geminiApiKey) {
        return { score: 0, clarity: 0, completeness: 0, critique: 'No API key', suggestions: '', error: true };
    }

    const modelId = pickAgentModel().id;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${geminiApiKey}`;

    const prompt = `Evaluate the following learning content chunk for quality. Return ONLY valid JSON matching the schema exactly.

Content:
${text}

Schema: {"score":<integer 1-5>,"clarity":<integer 1-5>,"completeness":<integer 1-5>,"critique":"<one sentence identifying the main weakness>","suggestions":"<one sentence concrete improvement>"}`;

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { response_mime_type: 'application/json' }
            })
        });
        if (!res.ok) return { score: 0, critique: `API error ${res.status}`, error: true };
        const data = await res.json();
        const jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        return jsonText ? JSON.parse(jsonText) : { score: 0, critique: 'Empty response', error: true };
    } catch (e) {
        return { score: 0, critique: e.message, error: true };
    }
}
