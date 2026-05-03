async function toolSummarizePage() {
    const { tf_agent_session } = await chrome.storage.local.get('tf_agent_session');
    if (!tf_agent_session) return JSON.stringify({ error: 'No page has been processed yet.' });
    return JSON.stringify({
        tldr: tf_agent_session.tldr,
        tags: tf_agent_session.tags,
        star_rating: tf_agent_session.star_rating,
        nugget_count: tf_agent_session.nuggetCount,
    });
}
