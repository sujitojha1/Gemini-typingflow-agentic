async function toolExtractSubject({ text }) {
    const { geminiApiKey } = await chrome.storage.sync.get('geminiApiKey');
    if (!geminiApiKey) return { subject: 'Untitled' };

    const modelId = 'gemini-3.1-flash-lite-preview';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${geminiApiKey}`;

    const prompt = `Extract a concise subject title (4–8 words) for this learning chunk. Return ONLY valid JSON: {"subject":"<title>"}

CHUNK:
${text.slice(0, 600)}`;

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { response_mime_type: 'application/json' }
            })
        });
        if (!res.ok) return { subject: 'Untitled' };
        const data = await res.json();
        const jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!jsonText) return { subject: 'Untitled' };
        return { subject: JSON.parse(jsonText).subject || 'Untitled' };
    } catch (e) {
        return { subject: 'Untitled' };
    }
}
