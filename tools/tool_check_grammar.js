// tool_check_grammar.js — Evaluates grammar and spelling.
// Depends on: tools/tool_helper.js (callToolModel)

async function toolCheckGrammar({ text }) {
    const prompt = `Evaluate the grammar, spelling, and sentence structure of the following text chunk. Determine if it is proper and acceptable for a learning session. Return ONLY valid JSON matching the schema exactly.

Content:
${text}

Schema: {"isProper":<boolean>,"issues":"<one sentence summarizing the grammar/spelling issues, or 'None' if proper>"}`;

    return callToolModel(prompt, { isProper: true, issues: 'API error' });
}
