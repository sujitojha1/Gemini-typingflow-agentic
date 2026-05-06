// tool_evaluate_chunk.js — Evaluates learning content quality.
// Depends on: tools/tool_helper.js (callToolModel)

async function toolEvaluateChunk({ text }) {
    const prompt = `Evaluate the following learning content chunk for quality. Use this rubric for 'score': 1=incomprehensible or irrelevant, 2=hard to follow or missing context, 3=factual but surface-level, 4=clear explanation with useful detail, 5=rich insight with a memorable takeaway. Apply the same rubric independently for 'clarity' and 'completeness'. Return ONLY valid JSON matching the schema exactly.

Content:
${text}

Schema: {"score":<integer 1-5>,"clarity":<integer 1-5>,"completeness":<integer 1-5>,"critique":"<one sentence identifying the main weakness>","suggestions":"<one sentence concrete improvement>"}`;

    return callToolModel(prompt, { score: null, clarity: null, completeness: null, critique: 'API error', suggestions: '' });
}
