async function toolCheckGrammar({ text }) {
    const { geminiApiKey } = await chrome.storage.sync.get('geminiApiKey');
    if (!geminiApiKey) {
        return { isProper: true, issues: 'No API key', error: true };
    }

    const model = pickAgentModel();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model.id}:generateContent?key=${geminiApiKey}`;

    const prompt = `Evaluate the grammar, spelling, and sentence structure of the following text chunk. Determine if the grammar is proper and acceptable for a learning session. If there are noticeable errors, typos, or awkward phrasing, mark it as not proper and list the issues. Return ONLY valid JSON matching the schema exactly.

Content:
${text}

Schema: {"isProper":<boolean>,"issues":"<one sentence summarizing the grammar/spelling issues, or 'None' if proper>"}`;

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
            console.warn(`[agent] toolCheckGrammar ${model.label} HTTP ${res.status}:`, errDetail, errBody);
            return { isProper: true, issues: `API error ${res.status}: ${errDetail}`, error: true };
        }
        const data = await res.json();
        const jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!jsonText) {
            console.warn(`[agent] toolCheckGrammar ${model.label}: empty response. Full:`, JSON.stringify(data).slice(0, 400));
            return { isProper: true, issues: 'Empty response', error: true };
        }
        try {
            return JSON.parse(jsonText);
        } catch (parseErr) {
            console.error(`[agent] toolCheckGrammar ${model.label}: JSON.parse failed:`, parseErr.message, '| raw:', jsonText.slice(0, 200));
            return { isProper: true, issues: `Parse failed: ${parseErr.message}`, error: true };
        }
    } catch (e) {
        console.error(`[agent] toolCheckGrammar ${model.label} threw:`, e.message);
        return { isProper: true, issues: e.message, error: true };
    }
}
