async function toolRefineChunk({ text, grammar, evaluation }) {
    const { geminiApiKey } = await chrome.storage.sync.get('geminiApiKey');
    if (!geminiApiKey) return { refinedText: text, error: 'No API key' };

    const model = pickAgentModel();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model.id}:generateContent?key=${geminiApiKey}`;

    const prompt = `Refine the following learning content chunk. Fix the grammar issues identified, and preserve the author's voice and all original facts. Keep the refined text STRICTLY UNDER 300 words. Return ONLY valid JSON.

Original content:
${text}

Grammar Issues to Fix:
${grammar ? grammar.issues : 'N/A'}

Evaluation Feedback (for context):
- Score: ${evaluation?.score || 'N/A'}/5
- Critique: ${evaluation?.critique || 'N/A'}
- Suggestion: ${evaluation?.suggestions || 'N/A'}

Schema: {"refinedText":"<the improved content, preserving author voice, max 300 words>"}`;

    try {
        const res = await fetchWithTimeout(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { response_mime_type: 'application/json' },
            })
        }, 20000);
        if (!res.ok) {
            const errBody = await res.json().catch(() => ({}));
            const errDetail = errBody.error?.message || res.statusText;
            console.warn(`[agent] toolRefineChunk ${model.label} HTTP ${res.status}:`, errDetail, errBody);
            return { refinedText: text, error: `API error ${res.status}: ${errDetail}` };
        }
        const data = await res.json();
        const jsonText = pickResponseText(data);
        if (!jsonText) {
            console.warn(`[agent] toolRefineChunk ${model.label}: empty response. Full:`, JSON.stringify(data).slice(0, 400));
            return { refinedText: text, error: 'Empty response' };
        }
        try {
            const parsed = JSON.parse(stripMarkdownFences(jsonText));
            let refined = parsed.refinedText || text;
            const words = refined.split(/\s+/);
            if (words.length > 300) refined = words.slice(0, 300).join(' ') + '…';
            return { refinedText: refined };
        } catch (parseErr) {
            console.error(`[agent] toolRefineChunk ${model.label}: JSON.parse failed:`, parseErr.message, '| raw:', jsonText.slice(0, 200));
            return { refinedText: text, error: `Parse failed: ${parseErr.message}` };
        }
    } catch (e) {
        const isTimeout = e.name === 'AbortError';
        console.error(`[agent] toolRefineChunk ${model.label} ${isTimeout ? 'TIMEOUT' : 'threw'}:`, e.message);
        return { refinedText: text, error: isTimeout ? 'timed out after 20s' : e.message };
    }
}
