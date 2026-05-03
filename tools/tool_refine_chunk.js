async function toolRefineChunk({ text, evaluation }) {
    const { geminiApiKey } = await chrome.storage.sync.get('geminiApiKey');
    if (!geminiApiKey) return { refinedText: text, error: 'No API key' };

    const modelId = 'gemini-3.1-flash-lite-preview';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${geminiApiKey}`;

    const prompt = `Refine the following learning content chunk based on the evaluation feedback. Preserve the author's voice and all original facts. Make it clearer and more complete. Return ONLY valid JSON.

Original content:
${text}

Evaluation:
- Score: ${evaluation.score}/5
- Critique: ${evaluation.critique || 'N/A'}
- Suggestion: ${evaluation.suggestions || 'N/A'}

Schema: {"refinedText":"<the improved content, preserving author voice>"}`;

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { response_mime_type: 'application/json' }
            })
        });
        if (!res.ok) return { refinedText: text, error: `API error ${res.status}` };
        const data = await res.json();
        const jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!jsonText) return { refinedText: text, error: 'Empty response' };
        const parsed = JSON.parse(jsonText);
        return { refinedText: parsed.refinedText || text };
    } catch (e) {
        return { refinedText: text, error: e.message };
    }
}
