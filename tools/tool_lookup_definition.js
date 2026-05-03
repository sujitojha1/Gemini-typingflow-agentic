async function toolLookupDefinition({ term }) {
    const { tf_agent_nuggets } = await chrome.storage.local.get('tf_agent_nuggets');
    if (!tf_agent_nuggets?.length) return JSON.stringify({ results: 'No page has been processed yet.' });
    const t = String(term).toLowerCase();
    const sentences = [];
    for (const n of tf_agent_nuggets) {
        for (const s of n.text.split(/[.!?]+/).map(s => s.trim()).filter(Boolean)) {
            if (s.toLowerCase().includes(t)) sentences.push(s);
        }
    }
    return JSON.stringify({
        results: sentences.length ? sentences.slice(0, 5) : `No definition found for "${term}".`
    });
}
