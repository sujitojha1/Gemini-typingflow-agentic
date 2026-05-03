function toolGetChunkStats({ text }) {
    const trimmed = text.trim();
    const words = trimmed.split(/\s+/).filter(Boolean);
    const sentences = trimmed.split(/[.!?]+/).filter(s => s.trim().length > 0);
    return {
        wordCount: words.length,
        charCount: trimmed.length,
        sentenceCount: sentences.length,
        avgWordLength: words.length
            ? Math.round(words.reduce((sum, w) => sum + w.length, 0) / words.length)
            : 0,
    };
}
