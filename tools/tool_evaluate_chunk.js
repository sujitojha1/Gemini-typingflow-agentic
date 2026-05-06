// tool_evaluate_chunk.js — Evaluates learning content quality.
// Depends on: tools/tool_helper.js (callToolModel)

async function toolEvaluateChunk({ text }) {
    const prompt = `Evaluate the following learning content chunk for quality. Return ONLY valid JSON matching the schema exactly.

Content:
${text}

Schema: {"score":<integer 1-5>,"clarity":<integer 1-5>,"completeness":<integer 1-5>,"critique":"<one sentence identifying the main weakness>","suggestions":"<one sentence concrete improvement>"}`;

    return callToolModel(prompt, { score: 0, clarity: 0, completeness: 0, critique: 'API error', suggestions: '' });
}
