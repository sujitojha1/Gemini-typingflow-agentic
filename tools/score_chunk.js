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

export async function score_chunk({ chunk }, apiKey) {
  const prompt = `Score the following passage on three dimensions, each 1 (poor) to 10 (excellent).
Return ONLY valid JSON — no markdown, no explanation:
{ "readability": number, "clarity": number, "coherence": number, "feedback": "one sentence" }

Passage:
${chunk}`;

  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 150, temperature: 0.1 }
    })
  });
  if (!res.ok) throw new Error(`Gemini error ${res.status}`);
  const data = await res.json();
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';

  try {
    const cleaned = raw.replace(/```(?:json)?\n?/g, '').replace(/```/g, '').trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('no JSON object found');
    return JSON.parse(match[0]);
  } catch {
    return { readability: 0, clarity: 0, coherence: 0, feedback: 'Score parse error.' };
  }
}
