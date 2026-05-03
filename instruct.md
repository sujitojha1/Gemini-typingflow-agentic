# Parallel Agentic Track — Processing Pipeline

## Phase 1: Session & Content Indexing
- Generate a unique timestamp-based `sessionId`
- Index all text blocks (with positional indices) extracted from the page
- Index all valid image URLs (with positional indices) from the page
- Store both indices in session storage for fast lookup during chunk processing

## Phase 2: Semantic Chunk Identification
- Send indexed text blocks and image positions to the LLM
- LLM groups related consecutive text blocks into 3–8 semantic chunks
- Each chunk carries: grouped original text, semantic tags, source block indices, nearest image index position
- Fallback: if LLM fails, treat each text block as its own chunk

## Phase 3: Per-Chunk Async Agent Loop (all chunks run in parallel)

For each semantic chunk, an independent agent loop runs the following steps sequentially and records every call in a `history` array:

### Step 1 — Image Resolution
- **findMatchingImage**: check if the chunk's `nearbyImageIdx` points to a valid image in the index; if yes, use that image URL directly
- **generateChunkImage** (if no match): build a semantic prompt from the chunk text and tags, then call the Gemini Image API to generate a contextually aligned visual

### Step 2 — Content Statistics
- **getChunkStats**: compute `wordCount`, `charCount`, `sentenceCount`, `avgWordLength` for the chunk text

### Step 3 — Content Evaluation
- **evaluateChunk**: ask the LLM to score the chunk (1–5) on `clarity` and `completeness`, returning a one-sentence `critique` and `suggestions`

### Step 4 — Content Refinement
- **refineChunk**: if `score < 4`, ask the LLM to produce an improved version of the chunk using the critique and suggestion as guidance; preserve the author's voice and all original facts
- Skip refinement if the score is acceptable (≥ 4) or if evaluation errored

### Step 5 — Coverage Update
- **updateCoverage**: mark this chunk as complete in session storage, compute overall pipeline `coverage %` as `(processed / total) * 100`

Each chunk's `history` array records `{ tool, input, result }` for every step above.

## Phase 4: State Handoff
- Assemble all refined nuggets: `{ text: refinedText, img_src, tags, stats, coverage }`
- Store full `processHistory` (all chunk histories) in session storage under `tf_pt_refined`
- Send `{ action: 'update_nuggets', data: refinedData }` to the active tab overlay to replace the initial gallery with refined content
