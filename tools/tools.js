import { count_stats, COUNT_STATS_SCHEMA }         from './count_stats.js';
import { chunk_text, CHUNK_TEXT_SCHEMA }           from './chunk_text.js';
import { summarize_chunk, SUMMARIZE_CHUNK_SCHEMA } from './summarize_chunk.js';
import { score_chunk, SCORE_CHUNK_SCHEMA }         from './score_chunk.js';

export const TOOL_SCHEMAS = [
  COUNT_STATS_SCHEMA,
  CHUNK_TEXT_SCHEMA,
  SUMMARIZE_CHUNK_SCHEMA,
  SCORE_CHUNK_SCHEMA
];

export async function dispatchTool(name, args, apiKey) {
  switch (name) {
    case 'count_stats':     return count_stats(args);
    case 'chunk_text':      return chunk_text(args);
    case 'summarize_chunk': return summarize_chunk(args, apiKey);
    case 'score_chunk':     return score_chunk(args, apiKey);
    default: throw new Error(`Unknown tool: ${name}`);
  }
}
