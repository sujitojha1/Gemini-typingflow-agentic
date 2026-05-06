// tool_refine_chunk.js — Refines a chunk by fixing grammar while preserving author voice.
// Depends on: tools/tool_helper.js (callToolModel)

async function toolRefineChunk({ text, grammar, evaluation }) {
    const prompt = `Refine the following learning content chunk. Fix the grammar issues identified, and preserve the author's voice and all original facts. Keep the refined text STRICTLY UNDER 300 words. Return ONLY valid JSON.

Original content:
${text}

Grammar Issues to Fix:
${grammar ? grammar.issues : 'N/A'}

Evaluation Feedback (for context):
- Score: ${evaluation?.score ?? 'N/A'}/5
- Critique: ${evaluation?.critique ?? 'N/A'}
- Suggestion: ${evaluation?.suggestions ?? 'N/A'}

Schema: {"refinedText":"<the improved content, preserving author voice, max 300 words>"}`;

    const result = await callToolModel(prompt, { refinedText: text });
    // Hard-enforce the 300-word limit as a safety net
    if (result.refinedText) {
        const words = result.refinedText.split(/\s+/);
        if (words.length > 300) result.refinedText = words.slice(0, 300).join(' ') + '…';
    }
    return result;
}
