async function toolSearchNuggets({ query }) {
    const { tf_agent_nuggets } = await chrome.storage.local.get('tf_agent_nuggets');
    if (!tf_agent_nuggets?.length) return JSON.stringify({ results: 'No page has been processed yet.' });
    const q = String(query).toLowerCase();
    const hits = tf_agent_nuggets.filter(n => n.text.toLowerCase().includes(q));
    return JSON.stringify({
        results: hits.length ? hits.map(n => n.text.slice(0, 300)) : 'No matching nuggets found.'
    });
}
