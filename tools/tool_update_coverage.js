async function toolUpdateCoverage({ chunkIdx, totalChunks }) {
    const processed = chunkIdx + 1;
    const coverage = Math.round((processed / totalChunks) * 100);
    const { tf_pt_coverage = [] } = await chrome.storage.local.get('tf_pt_coverage');
    tf_pt_coverage[chunkIdx] = { done: true, ts: Date.now() };
    await chrome.storage.local.set({ tf_pt_coverage });
    return { coverage, processed, total: totalChunks };
}
