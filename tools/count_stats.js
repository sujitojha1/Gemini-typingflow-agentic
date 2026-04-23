export const COUNT_STATS_SCHEMA = {
  name: 'count_stats',
  description: 'Counts words, sentences, paragraphs, average sentence length, and reading time in the provided text.',
  parameters: {
    type: 'OBJECT',
    properties: {
      text: { type: 'STRING', description: 'The full text to analyse.' }
    },
    required: ['text']
  }
};

export function count_stats({ text }) {
  const words      = text.trim().split(/\s+/).filter(Boolean);
  const sentences  = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const paragraphs = text.split(/\n{2,}/).filter(p => p.trim().length > 0);
  const wordCount  = words.length;
  const sentCount  = sentences.length || 1;
  return {
    word_count:          wordCount,
    sentence_count:      sentCount,
    paragraph_count:     paragraphs.length || 1,
    avg_sentence_length: +(wordCount / sentCount).toFixed(1),
    reading_time_sec:    Math.ceil(wordCount / 3.3)
  };
}
