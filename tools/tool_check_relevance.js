// tool_check_relevance.js — Checks if a chunk is an ad/boilerplate.
// Uses a fast local heuristic first, only calls LLM if needed.
// Depends on: tools/tool_helper.js (callToolModel)

function isHeuristicIrrelevant(text) {
    const t = text.trim();
    if (t.length < 50) return true;
    if (/^(accept all|cookie|privacy policy|subscribe|sign up|log in|advertisement|sponsored content)/i.test(t)) return true;
    if (/(\d+% off|buy now|limited offer|click here|free trial|terms of service)/i.test(t)) return true;
    return false;
}

async function toolCheckRelevance({ text }) {
    // Fast heuristic — skip LLM for obvious cases (~30% of chunks on ad-heavy pages)
    if (isHeuristicIrrelevant(text)) {
        return { isAd: true, reason: 'Heuristic: boilerplate or promotional content detected' };
    }

    const prompt = `Analyze the following text chunk and determine if it is an advertisement, sponsored content, site navigation, cookie notice, or irrelevant boilerplate that should not be part of a learning session. Return ONLY valid JSON matching the schema exactly.

Content:
${text}

Schema: {"isAd":<boolean>,"reason":"<one short sentence explaining why>"}`;

    return callToolModel(prompt, { isAd: false, reason: 'Default — API error' });
}
