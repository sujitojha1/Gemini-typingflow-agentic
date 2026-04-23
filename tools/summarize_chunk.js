const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

export const SUMMARIZE_CHUNK_SCHEMA = {
  name: 'summarize_chunk',
  description: 'Returns a one-sentence summary of the provided text chunk.',
  parameters: {
    type: 'OBJECT',
    properties: {
      chunk: { type: 'STRING', description: 'The chunk of text to summarise.' }
    },
    required: ['chunk']
  }
};

export async function summarize_chunk({ chunk }, apiKey) {
  const prompt = `Summarise the following passage in exactly one concise sentence:\n\n${chunk}`;
  const res = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 100, temperature: 0.2 }
    })
  });
  if (!res.ok) throw new Error(`Gemini error ${res.status}`);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
  return { summary: text };
}
