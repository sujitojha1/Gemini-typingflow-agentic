// tool_check_relevance.js — Checks if a chunk is an ad/boilerplate.
// Uses a fast local heuristic first, only calls LLM if needed.
// Depends on: tools/tool_helper.js (callToolModel)

function isHeuristicIrrelevant(text) {
    const t = text.trim();
    if (t.length < 50) return true;
    if (/^(accept all|cookie|privacy policy|subscribe|sign up|log in|advertisement|sponsored content|share this|tweet|follow us|newsletter|related articles|you might also like|read more|breadcrumb)/i.test(t)) return true;
    if (/(\d+% off|buy now|limited offer|click here|free trial|terms of service|all rights reserved|©\s*\d{4})/i.test(t)) return true;
    // Short author-byline / social-share / breadcrumb patterns
    if (t.split(/\s+/).length < 12 && /^(by |home\s*[>›/]|share|tweet|facebook|linkedin|email this)/i.test(t)) return true;
    return false;
}

async function toolCheckRelevance({ text }) {
    // Fast heuristic — skip LLM for obvious cases (~30% of chunks on ad-heavy pages)
    if (isHeuristicIrrelevant(text)) {
        return { isAd: true, reason: 'Heuristic: boilerplate or promotional content detected' };
    }

    const prompt = `Analyze the following text chunk and determine if it is irrelevant to a learning session. Irrelevant content includes: advertisements, sponsored content, site navigation, breadcrumbs, cookie notices, social sharing buttons ("Share", "Tweet", "Follow us"), newsletter sign-ups, author bios under 2 sentences, "related articles" lists, footer text, or any other boilerplate. Return ONLY valid JSON matching the schema exactly.

Content:
${text}

Schema: {"isAd":<boolean>,"reason":"<one short sentence explaining why>"}`;

    return callToolModel(prompt, { isAd: false, reason: 'Default — API error' });
}
