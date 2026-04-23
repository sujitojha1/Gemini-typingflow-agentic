# Development Plan — Gemini TypingFlow Agentic

## Goal

Extend Gemini-typingflow (assignment 2) into a multi-stage agentic writing analyser. The agent captures text from the active browser field and processes it through a fixed pipeline of tool calls — counting, chunking, summarising, scoring — before the LLM synthesises a final report. Every stage is visible to the user in the panel's reasoning chain.

---

## Pipeline Overview

```
User text (from focused field)
        │
        ▼ Tool call 1
   count_stats(text)
   → word count, sentence count, paragraph count,
     avg sentence length, reading time
        │
        ▼ Tool call 2
   chunk_text(text, max_words=120)
   → [ chunk_0, chunk_1, ..., chunk_N ]
        │
        ├─ Tool call 3a  summarize_chunk(chunk_0) → { summary }
        ├─ Tool call 3b  summarize_chunk(chunk_1) → { summary }
        │   ...
        ├─ Tool call 4a  score_chunk(chunk_0) → { readability, clarity, coherence, feedback }
        ├─ Tool call 4b  score_chunk(chunk_1) → { scores... }
        │   ...
        ▼
   LLM synthesis
   → overall score, ranked issues, rewrite suggestions
```

The full `messages` array (user prompt + every functionCall/functionResponse pair) is passed to Gemini on each iteration. Later stages therefore have full context of earlier results.

---

## Stage Breakdown

### Stage 1 — `count_stats`

**Purpose:** Establish baseline metrics before any LLM work. Grounds the model in concrete numbers so it cannot hallucinate statistics.

**Implementation:** Pure JavaScript, no network call.

```js
// tools/count_stats.js
export function count_stats({ text }) {
  const words      = text.trim().split(/\s+/).filter(Boolean);
  const sentences  = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const paragraphs = text.split(/\n{2,}/).filter(p => p.trim().length > 0);
  return {
    word_count:          words.length,
    sentence_count:      sentences.length,
    paragraph_count:     paragraphs.length,
    avg_sentence_length: +(words.length / sentences.length).toFixed(1),
    reading_time_sec:    Math.ceil(words.length / 3.3)   // ~200 wpm
  };
}
```

**Gemini function declaration:**
```json
{
  "name": "count_stats",
  "description": "Counts words, sentences, paragraphs, average sentence length, and reading time in the provided text.",
  "parameters": {
    "type": "OBJECT",
    "properties": {
      "text": { "type": "STRING", "description": "The full text to analyse." }
    },
    "required": ["text"]
  }
}
```

---

### Stage 2 — `chunk_text`

**Purpose:** Break the text into coherent pieces so summarisation and scoring can be applied at a granular level rather than to the whole blob.

**Implementation:** Pure JavaScript. Respects paragraph boundaries first; splits oversized paragraphs at sentence boundaries.

```js
// tools/chunk_text.js
export function chunk_text({ text, max_words = 120 }) {
  const paragraphs = text.split(/\n{2,}/).filter(p => p.trim());
  const chunks = [];
  for (const para of paragraphs) {
    const wordCount = para.split(/\s+/).length;
    if (wordCount <= max_words) {
      chunks.push(para.trim());
    } else {
      // split at sentence boundaries
      const sentences = para.split(/(?<=[.!?])\s+/);
      let current = [];
      let currentLen = 0;
      for (const sent of sentences) {
        const len = sent.split(/\s+/).length;
        if (currentLen + len > max_words && current.length) {
          chunks.push(current.join(' '));
          current = [];
          currentLen = 0;
        }
        current.push(sent);
        currentLen += len;
      }
      if (current.length) chunks.push(current.join(' '));
    }
  }
  return { chunks };
}
```

**Gemini function declaration:**
```json
{
  "name": "chunk_text",
  "description": "Splits text into semantically coherent chunks of at most max_words words, respecting paragraph and sentence boundaries.",
  "parameters": {
    "type": "OBJECT",
    "properties": {
      "text":           { "type": "STRING",  "description": "Full text to split." },
      "max_words":      { "type": "INTEGER", "description": "Target max words per chunk (default 120)." }
    },
    "required": ["text"]
  }
}
```

---

### Stage 3 — `summarize_chunk`

**Purpose:** Produce a one-sentence distillation of each chunk. Called once per chunk. Gives the LLM (and the user) a quick map of the text's structure before scoring.

**Implementation:** A focused `generateContent` call — not a recursive agent loop. Uses the same Gemini API key already in storage.

```js
// tools/summarize_chunk.js
export async function summarize_chunk({ chunk }) {
  const prompt = `Summarise the following passage in exactly one sentence:\n\n${chunk}`;
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 80, temperature: 0.2 }
  };
  const res  = await callGemini(body);          // shared fetch wrapper
  const text = res.candidates[0].content.parts[0].text.trim();
  return { summary: text };
}
```

**Gemini function declaration:**
```json
{
  "name": "summarize_chunk",
  "description": "Returns a one-sentence summary of the provided text chunk.",
  "parameters": {
    "type": "OBJECT",
    "properties": {
      "chunk": { "type": "STRING", "description": "The chunk of text to summarise." }
    },
    "required": ["chunk"]
  }
}
```

---

### Stage 4 — `score_chunk`

**Purpose:** Score each chunk on three dimensions and provide a short actionable feedback note. This is the highest-signal output for the writer.

**Implementation:** Focused `generateContent` call with a structured JSON output instruction.

```js
// tools/score_chunk.js
export async function score_chunk({ chunk }) {
  const prompt = `Score the following passage on three dimensions, each from 1 (poor) to 10 (excellent).
Return ONLY valid JSON matching this schema:
{ "readability": int, "clarity": int, "coherence": int, "feedback": "one sentence" }

Passage:
${chunk}`;
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: 120, temperature: 0.1 }
  };
  const res  = await callGemini(body);
  const raw  = res.candidates[0].content.parts[0].text;
  return JSON.parse(raw.match(/\{[\s\S]*\}/)[0]);
}
```

**Gemini function declaration:**
```json
{
  "name": "score_chunk",
  "description": "Scores a text chunk on readability, clarity, and coherence (each 1–10) and returns one-sentence feedback.",
  "parameters": {
    "type": "OBJECT",
    "properties": {
      "chunk": { "type": "STRING", "description": "The chunk of text to score." }
    },
    "required": ["chunk"]
  }
}
```

---

## Agent Loop — background.js

```
onMessage({ type: "RUN_AGENT", text, prompt })
  │
  ├─ messages = [
  │    { role: "user", parts: [{ text: buildSystemPrompt(text, prompt) }] }
  │  ]
  │
  └─ loop (max 30 iterations):
       POST /generateContent
         { contents: messages, tools: [{ functionDeclarations: TOOL_SCHEMAS }] }
       │
       ├─ finishReason === "STOP"
       │    → sendMessage(tab, { type: "AGENT_DONE", text: finalText })
       │    → break
       │
       └─ has functionCall parts?
            for each call:
              result = await dispatchTool(name, args)
              sendMessage(tab, { type: "AGENT_STEP", name, args, result })
            append { role: "model", parts: [functionCallPart] }
            append { role: "user",  parts: [functionResponseParts] }
            continue loop
```

`buildSystemPrompt` wraps the captured text and user's instruction into a single prompt that tells the model to run the four stages in order and produce a structured final report.

`dispatchTool(name, args)` is a switch over the four function names — local execution for `count_stats` and `chunk_text`, async execution for `summarize_chunk` and `score_chunk`.

---

## Panel UI — panel.js / panel.html / panel.css

### Message types from background.js

| Type | Payload | UI action |
|---|---|---|
| `AGENT_STEP` | `{ name, args, result }` | Append a new stage card to the chain |
| `AGENT_DONE` | `{ text }` | Render final report section, enable Copy button |
| `AGENT_ERROR` | `{ message }` | Show error banner |

### Stage card structure (one per tool call)

```html
<div class="stage-card stage--done">
  <div class="stage-header">
    <span class="stage-icon">✓</span>
    <span class="stage-name">score_chunk · chunk 2</span>
    <button class="stage-toggle">▾</button>
  </div>
  <div class="stage-body">
    <div class="stage-args">...</div>
    <div class="stage-result">R:8  C:7  Co:9 — "Consider..."</div>
  </div>
</div>
```

### Score display

Chunk scores are rendered as a small 3-column grid. The overall score in the final report is the mean across all chunks and all three dimensions, displayed as `X.X / 10`.

---

## File Inventory

```
Gemini-typingflow-agentic/
├── manifest.json
├── background.js               ← agent loop, dispatchTool, Gemini fetch
├── content.js                  ← captures active text field, relays to panel
├── panel/
│   ├── panel.html
│   ├── panel.js                ← renders AGENT_STEP / AGENT_DONE events
│   └── panel.css
└── tools/
    ├── tools.js                ← TOOL_SCHEMAS array + dispatchTool()
    ├── count_stats.js          ← pure local
    ├── chunk_text.js           ← pure local
    ├── summarize_chunk.js      ← Gemini call
    └── score_chunk.js          ← Gemini call
```

---

## Build Phases

### Phase 1 — Scaffold (Day 1)
- Fork base typingflow repo
- Verify extension loads with no console errors
- Add `storage`, `scripting`, `tabs`, `activeTab` to `manifest.json`
- Create folder structure above
- Stub out all tool files with placeholder returns

### Phase 2 — Local Tools (Day 2)
- Implement and unit-test `count_stats` and `chunk_text`
- Test from browser console: paste text, call function, verify output
- Edge cases: empty string, single paragraph, single sentence, very long paragraph

### Phase 3 — LLM Tools (Day 2–3)
- Implement shared `callGemini(body)` fetch wrapper in `background.js`
- Implement `summarize_chunk` — test with a single paragraph
- Implement `score_chunk` — test JSON parse robustness (model sometimes wraps in markdown fences)
- Add regex strip for ` ```json ... ``` ` fences before `JSON.parse`

### Phase 4 — Agent Loop (Day 3–4)
- Wire `dispatchTool` switch in `background.js`
- Implement full loop with iteration cap (30) and 60 s timeout
- Add `buildSystemPrompt` — instructs model to run stages in order
- Test with a 3-paragraph draft: confirm all 4 tool types are called
- Verify `messages` array grows correctly across iterations

### Phase 5 — Panel UI (Day 4–5)
- Build `panel.html` layout: input area, chain container, report section
- Implement `AGENT_STEP` handler: append card, auto-scroll
- Implement `AGENT_DONE` handler: render report, show scores grid
- Copy button: `content.js` inserts final text into the original field
- Add loading spinner that disappears on first `AGENT_STEP`

### Phase 6 — End-to-End Testing (Day 5–6)

**Scenario A — Short text (1 paragraph)**
- Expected: 1 chunk, count_stats → chunk_text → 1× summarize_chunk → 1× score_chunk → report

**Scenario B — Medium text (3–4 paragraphs)**
- Expected: 3 chunks, full pipeline, overall score shown

**Scenario C — Edge case: one very long paragraph (>400 words)**
- Expected: chunk_text splits at sentence boundaries, produces 3+ chunks

**Scenario D — Prompt override**
- User types "Focus only on clarity" before clicking Run
- Expected: LLM report emphasises clarity feedback, scores still computed for all dimensions

### Phase 7 — Polish & Submission (Day 7)
- Record YouTube demo: open panel on a real draft, show all stage cards expanding, copy final report into the text field
- Export LLM logs (all request/response JSON from DevTools Network tab)
- Tag `v1.0.0` and push

---

## Key Constraints

| Constraint | Decision |
|---|---|
| No backend server | All calls from background service worker (`fetch` bypasses page CORS) |
| API key not in source | Stored in `chrome.storage.local` via options page |
| No `eval()` for scoring JSON | Use regex extraction + `JSON.parse` |
| Loop safety | Hard cap 30 iterations, 60 s wall-clock timeout |
| `summarize_chunk` / `score_chunk` called per chunk | Agent decides how many times; system prompt instructs it to call for every chunk produced |
| Full history on every call | `messages` array never truncated during one agent run |

---

## Risk & Mitigations

| Risk | Mitigation |
|---|---|
| Model skips a stage | System prompt enumerates stages explicitly; tool schemas include descriptions that hint ordering |
| `score_chunk` returns malformed JSON | Strip markdown fences; fall back to `{ readability:0, clarity:0, coherence:0, feedback:"parse error" }` |
| Too many chunks → too many tool calls → context overflow | Cap `chunk_text` at 8 chunks; warn user if text is very long |
| Gemini rate limits on parallel chunk calls | Agent calls tools sequentially (one functionCall response per loop turn) — no parallelism at the API level |
| Content script cannot read cross-origin iframes | Capture only the top-level active element; document this limitation |
