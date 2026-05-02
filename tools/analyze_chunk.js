import { getNextModelUrl } from './tools.js';

export const ANALYZE_CHUNK_SCHEMA = {
  name: 'analyze_chunk',
  description: 'Scores a text chunk on readability, clarity, and coherence (each 1-10), provides one-sentence feedback, and a concise one-sentence summary.',
  parameters: {
    type: 'OBJECT',
    properties: {
      chunk: { type: 'STRING', description: 'The chunk of text to analyze.' }
    },
    required: ['chunk']
  }
};

const clamp = (n) => Math.min(10, Math.max(0, Number(n) || 0));

export async function analyze_chunk({ chunk }, apiKey) {
  const prompt = `Analyze the following passage. Score it on three dimensions, each 1 (poor) to 10 (excellent), and provide a one-sentence summary and one-sentence feedback.
Return ONLY valid JSON — no markdown, no explanation:
{ "summary": "one sentence", "readability": number, "clarity": number, "coherence": number, "feedback": "one sentence" }

Passage:
${chunk}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  let res;
  try {
    res = await fetch(getNextModelUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 250, temperature: 0.1 }
      })
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new Error(`Gemini API error ${res.status}`);
  const data = await res.json();
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';

  try {
    const cleaned = raw.replace(/```(?:json)?\n?/g, '').replace(/```/g, '').trim();
    const match = cleaned.match(/\{[^{}]*\}/);
    if (!match) throw new Error('no JSON object found');
    const parsed = JSON.parse(match[0]);
    return {
      summary:     String(parsed.summary || '').slice(0, 300),
      readability: clamp(parsed.readability),
      clarity:     clamp(parsed.clarity),
      coherence:   clamp(parsed.coherence),
      feedback:    String(parsed.feedback || '').slice(0, 300)
    };
  } catch {
    return { summary: 'Error parsing response.', readability: 0, clarity: 0, coherence: 0, feedback: 'Score parse error.', error: true };
  }
}
