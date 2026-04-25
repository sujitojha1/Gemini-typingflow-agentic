export const CHUNK_TEXT_SCHEMA = {
  name: 'chunk_text',
  description: 'Splits text into semantically coherent chunks respecting paragraph and sentence boundaries. Returns at most 8 chunks.',
  parameters: {
    type: 'OBJECT',
    properties: {
      text:      { type: 'STRING',  description: 'Full text to split.' },
      max_words: { type: 'INTEGER', description: 'Target max words per chunk (default 120).' }
    },
    required: ['text']
  }
};

export function chunk_text({ text, max_words = 120 }) {
  const limit = Math.max(1, Number(max_words) || 120);
  const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  if (paragraphs.length === 0) paragraphs.push(text.trim());

  const chunks = [];

  for (const para of paragraphs) {
    const wordCount = para.split(/\s+/).filter(Boolean).length;
    if (wordCount <= limit) {
      chunks.push(para);
    } else {
      // Split at sentence boundaries; require uppercase start to avoid splitting abbreviations
      const sentences = para.split(/(?<=[.!?])\s+(?=[A-Z])/);
      let current = [];
      let currentLen = 0;
      for (const sent of sentences) {
        const len = sent.split(/\s+/).filter(Boolean).length;
        if (currentLen + len > limit && current.length > 0) {
          chunks.push(current.join(' '));
          current = [];
          currentLen = 0;
        }
        current.push(sent);
        currentLen += len;
      }
      if (current.length > 0) chunks.push(current.join(' '));
    }
  }

  return { chunks: chunks.slice(0, 8) };
}
