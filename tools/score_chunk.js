const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

export const SCORE_CHUNK_SCHEMA = {
  name: 'score_chunk',
  description: 'Scores a text chunk on readability, clarity, and coherence (each 1–10) and returns one-sentence feedback.',
  parameters: {
    type: 'OBJECT',
    properties: {
      chunk: { type: 'STRING', description: 'The chunk of text to score.' }
    },
    required: ['chunk']
  }
};

const clamp = (n) => Math.min(10, Math.max(0, Number(n) || 0));

export async function score_chunk({ chunk }, apiKey) {
  const prompt = `Score the following passage on three dimensions, each 1 (poor) to 10 (excellent).
Return ONLY valid JSON — no markdown, no explanation:
{ "readability": number, "clarity": number, "coherence": number, "feedback": "one sentence" }

Passage:
${chunk}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  let res;
  try {
    res = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 150, temperature: 0.1 }
      })
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new Error(`Gemini error ${res.status}`);
  const data = await res.json();
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';

  try {
    const cleaned = raw.replace(/```(?:json)?\n?/g, '').replace(/```/g, '').trim();
    // Non-greedy match prevents capturing across multiple JSON objects
    const match = cleaned.match(/\{[^{}]*\}/);
    if (!match) throw new Error('no JSON object found');
    const parsed = JSON.parse(match[0]);
    return {
      readability: clamp(parsed.readability),
      clarity:     clamp(parsed.clarity),
      coherence:   clamp(parsed.coherence),
      feedback:    String(parsed.feedback || '').slice(0, 300)
    };
  } catch {
    return { readability: 0, clarity: 0, coherence: 0, feedback: 'Score parse error.', error: true };
  }
}
