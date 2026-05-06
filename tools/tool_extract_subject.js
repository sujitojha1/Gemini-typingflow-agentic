// tool_extract_subject.js — Extracts a concise subject title for a chunk.
// Depends on: tools/tool_helper.js (callToolModel)

async function toolExtractSubject({ text }) {
    // Strip leading byline/date noise before sending to the model
    const cleaned = text.replace(/^[\s\S]{0,120}?(by\s+\w[\w\s]+·|©|\d{4}|min read)/i, '').trim() || text;
    const prompt = `Extract a concise subject title (4–8 words) that captures the core concept of this learning chunk. Return ONLY valid JSON: {"subject":"<title>"}

CHUNK:
${cleaned.slice(0, 800)}`;

    const result = await callToolModel(prompt, { subject: 'Untitled' });
    return result.error
        ? { subject: 'Untitled', error: result.error }
        : { subject: result.subject || 'Untitled' };
}
