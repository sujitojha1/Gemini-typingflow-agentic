import { count_stats, COUNT_STATS_SCHEMA } from './count_stats.js';
import { chunk_text, CHUNK_TEXT_SCHEMA } from './chunk_text.js';
import { analyze_chunk, ANALYZE_CHUNK_SCHEMA } from './analyze_chunk.js';
import { generate_image, GENERATE_IMAGE_SCHEMA } from './generate_image.js';

const MODELS = [
  'gemini-3.1-flash-lite-preview',
  'gemini-2.5-flash',
  'gemma-4-26b-a4b-it',
  'gemma-4-31b-it'
];
let currentModelIdx = 0;

export function getNextModelUrl() {
  const model = MODELS[currentModelIdx];
  currentModelIdx = (currentModelIdx + 1) % MODELS.length;
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

export const TOOL_SCHEMAS = [
  COUNT_STATS_SCHEMA,
  CHUNK_TEXT_SCHEMA,
  ANALYZE_CHUNK_SCHEMA,
  GENERATE_IMAGE_SCHEMA
];

export async function dispatchTool(name, args, apiKey) {
  switch (name) {
    case 'count_stats': return count_stats(args);
    case 'chunk_text': return chunk_text(args);
    case 'analyze_chunk': return analyze_chunk(args, apiKey);
    case 'generate_image': return generate_image(args);
    default: throw new Error(`Unknown tool: ${name}`);
  }
}
