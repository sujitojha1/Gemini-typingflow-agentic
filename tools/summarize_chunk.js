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
        generationConfig: { maxOutputTokens: 100, temperature: 0.2 }
      })
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw new Error(`Gemini error ${res.status}`);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
  return { summary: text };
}
