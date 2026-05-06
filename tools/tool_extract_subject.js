// tool_extract_subject.js — Extracts a concise subject title for a chunk.
// Depends on: tools/tool_helper.js (callToolModel)

async function toolExtractSubject({ text }) {
    const prompt = `Extract a concise subject title (4–8 words) for this learning chunk. Return ONLY valid JSON: {"subject":"<title>"}

CHUNK:
${text.slice(0, 600)}`;

    const result = await callToolModel(prompt, { subject: 'Untitled' });
    return { subject: result.subject || 'Untitled' };
}
