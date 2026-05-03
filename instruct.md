# Parallel Agentic Track — ReAct Processing Pipeline

## Architecture: LLM-Driven ReAct Loop

The agent pipeline uses a **ReAct (Reasoning + Acting)** pattern:
1. A system prompt defines the agent's role, lists all available tools, and outlines the full processing plan.
2. The LLM generates a JSON response: `{ "thought": "...", "tool": "<NAME>", "args": { ... } }`
3. The runtime executes the requested tool with the provided args.
4. The tool result is appended to the conversation history.
5. The LLM is called again with the accumulated history to decide the next step.
6. This loops until the agent emits `{ "tool": "DONE" }`.

---

## Phase 1: Session & Content Indexing
- Generate a unique timestamp-based `sessionId`
- Index all text blocks (with positional indices) extracted from the page
- Index all valid image URLs (with positional indices) from the page
- Store both indices in session storage

## Phase 2: Semantic Chunk Identification
- Send indexed text blocks and image positions to the LLM
- LLM groups related consecutive text blocks into semantic chunks, ensuring each chunk is strictly under 300 words
- Each chunk carries: grouped original text, semantic tags, source block indices, nearest image index position
- Fallback: if LLM fails, treat each text block as its own chunk

## Phase 3: ReAct Agent Loop

The system prompt provides the LLM with the full chunk data and tells it to process each chunk (referenced as `0/N`, `1/N`, ...) through these steps:

### Step A — Content Filtering
- **checkRelevance** `{ text }` → `{ isAd, reason }`
- If `isAd=true`, skip to Step H for this chunk.

### Step B — Image Resolution
- **findMatchingImage** `{ chunkIdx, nearbyImageIdx }` → `{ matched, src }` — if chunk has a `nearbyImageIdx`
- **generateChunkImage** `{ text, tags }` → `{ img_src }` — if no matching image exists

### Step C — Content Statistics
- **getChunkStats** `{ text }` → `{ wordCount, charCount, sentenceCount, avgWordLength }`

### Step D — Subject Extraction
- **extractSubject** `{ text }` → `{ subject }`

### Step E — Content Evaluation
- **evaluateChunk** `{ text }` → `{ score, clarity, completeness, critique, suggestions }`

### Step F — Grammar Check
- **checkGrammar** `{ text }` → `{ isProper, issues }`

### Step G — Content Refinement (conditional)
- **refineChunk** `{ text, grammar, evaluation }` → `{ refinedText }`
- Only called if `checkGrammar` returned `isProper=false`
- Output is strictly under 300 words

### Step H — Coverage Update
- **updateCoverage** `{ chunkIdx, totalChunks }` → `{ coverage, processed, total }`

After processing all chunks, the LLM calls the **DONE** tool to terminate the loop.

Each tool call is recorded as `{ tool, input, result }` in the chunk's history array.

## Phase 4: State Handoff
- Assemble all refined nuggets: `{ text: refinedText, img_src, tags, subject, stats, score, coverage }`
- Store full `processHistory` (all chunk histories) in session storage under `tf_pt_refined`
- Send `{ action: 'update_nuggets', data: refinedData }` to the active tab overlay to replace the initial gallery with refined content
