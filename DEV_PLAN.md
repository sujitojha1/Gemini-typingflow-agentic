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

### Phase 1 — Scaffold `[DONE]`

| Task | Status | Notes |
|---|---|---|
| Initialise repo from base typingflow | ✅ Done | Forked into `Gemini-typingflow-agentic` |
| `manifest.json` with storage, scripting, tabs, activeTab | ✅ Done | All four permissions present; MV3 module service worker |
| Folder structure: `panel/`, `tools/`, `icons/` | ✅ Done | Created and populated |
| Stub out tool files | ✅ Done | Went straight to full implementation; no separate stub step needed |

---

### Phase 2 — Local Tools `[DONE]`

| Task | Status | Notes |
|---|---|---|
| Implement `count_stats` | ✅ Done | `tools/count_stats.js` — pure JS, no network call |
| Implement `chunk_text` | ✅ Done | `tools/chunk_text.js` — paragraph-first, sentence fallback, 8-chunk cap |
| Edge case: empty string | ✅ Done | Falls through to `text.trim()` push; returns `{ chunks: [''] }` |
| Edge case: single paragraph | ✅ Done | Fits within max_words → single-element array |
| Edge case: very long paragraph | ✅ Done | Sentence-boundary splitting activated when wordCount > max_words |
| Unit tests in `tests/` | ❌ Pending | No test files created yet — needed before Phase 6 |

---

### Phase 3 — LLM Tools `[DONE]`

| Task | Status | Notes |
|---|---|---|
| `summarize_chunk` with Gemini call | ✅ Done | `tools/summarize_chunk.js`; direct fetch, 100-token cap, temp 0.2 |
| `score_chunk` with structured JSON output | ✅ Done | `tools/score_chunk.js`; temp 0.1 for determinism |
| Markdown fence strip before `JSON.parse` | ✅ Done | Regex strips ` ```json ``` ` fences before parsing |
| Fallback for malformed JSON | ✅ Done | Returns `{ readability:0, clarity:0, coherence:0, feedback:'Score parse error.' }` |
| Shared `callGemini` wrapper | ⚠️ Deviated | Each LLM tool owns its own `fetch` call instead. Simpler; no functional gap. |

---

### Phase 4 — Agent Loop `[DONE]`

| Task | Status | Notes |
|---|---|---|
| `dispatchTool` switch in `tools/tools.js` | ✅ Done | Routes to all four tool functions; passes `apiKey` to LLM tools |
| Full loop with iteration cap | ✅ Done | `MAX_ITERATIONS = 30` |
| Wall-clock timeout | ✅ Done | `TIMEOUT_MS = 120 000 ms` (2 min) — planned was 60 s; doubled for safety |
| `buildSystemPrompt` with stage ordering | ✅ Done | Enumerates all 5 stages explicitly; handles empty-text case |
| Full `messages` history on every call | ✅ Done | Array appends model turn + user functionResponse turn each iteration |
| Multiple function calls per turn handled | ✅ Done | `fnCallParts` loop executes all calls before appending responses |
| Dynamic tool injection on action click | ✅ Done | `chrome.scripting.executeScript` injects content.js if not yet loaded |

---

### Phase 5 — Panel UI `[DONE]`

| Task | Status | Notes |
|---|---|---|
| `panel.html` — setup view (API key entry) | ✅ Done | Password input + Save button + link to AI Studio |
| `panel.html` — main view layout | ✅ Done | Field preview, word-count badge, prompt input, chain, report |
| `AGENT_STEP` handler — append card, auto-scroll | ✅ Done | `onStep()` in `panel.js`; `scrollIntoView` on each new card |
| `AGENT_DONE` handler — render report | ✅ Done | `onDone()` with minimal Markdown renderer |
| `AGENT_ERROR` handler — error banner | ✅ Done | `onError()` renders `.error-card` in the chain |
| Copy button → inserts into active field | ✅ Done | `COPY_TEXT` postMessage → `content.js` → `insertIntoField()` |
| Spinner — disappears on first `AGENT_STEP` | ✅ Done | Hidden in `onStep()` before card is appended |
| Score grid for `score_chunk` cards | ✅ Done | 3-column CSS grid; colour-coded (green ≥7, amber ≥4, red <4) |
| Collapsible card expand/collapse | ✅ Done | Toggle button shows/hides `.step-body` |
| Args truncated in card detail view | ✅ Done | `text` and `chunk` fields capped at 120 chars for readability |
| Settings button to re-enter API key | ✅ Done | Shows setup view on click |
| Refresh button to re-capture field text | ✅ Done | Sends `GET_FIELD_TEXT` postMessage |

---

### Phase 6 — End-to-End Testing `[PENDING]`

| Scenario | Status | Expected behaviour |
|---|---|---|
| A — Short text (1 paragraph) | ❌ Not tested | 1 chunk → count_stats → chunk_text → 1× summarize + score → report |
| B — Medium text (3–4 paragraphs) | ❌ Not tested | 3–4 chunks → full pipeline → overall score in report |
| C — Very long single paragraph (>400 words) | ❌ Not tested | chunk_text sentence-splits → 3+ chunks produced |
| D — Prompt override ("Focus only on clarity") | ❌ Not tested | All tool calls still run; LLM report emphasises clarity findings |
| E — No text captured (empty field) | ❌ Not tested | System prompt triggers "no text" branch; model asks user to paste |
| F — Invalid/expired API key | ❌ Not tested | Gemini returns 400/403; `AGENT_ERROR` shown with status code |

**Action required before Phase 7:** run all six scenarios manually in Chrome and note any failures.

---

### Phase 7 — Polish & Submission `[PENDING]`

| Task | Status | Notes |
|---|---|---|
| YouTube demo video | ❌ Not started | Show panel open, complex query, each stage card, copy to field |
| Export raw LLM logs | ❌ Not started | DevTools → Network → copy request+response JSON for each Gemini call |
| Tag `v1.0.0` and push | ❌ Not started | `git tag v1.0.0 && git push origin v1.0.0` |
| Write unit tests (`tests/`) | ❌ Not started | At minimum: `count_stats` and `chunk_text` edge cases |

---

## Implementation Deviations from Original Plan

| Item | Planned | Actual | Impact |
|---|---|---|---|
| Wall-clock timeout | 60 s | 120 s | Beneficial — gives model more time on longer texts |
| Shared `callGemini` wrapper | Single helper function | Each LLM tool has its own `fetch` | Neutral — slightly more verbose but each tool is fully self-contained |
| API key UI | Separate options page | Inline setup view in panel | Simpler UX — no separate options tab needed |
| Empty-paragraph handling in chunk_text | Not specified | Single-paragraph fallback added | Prevents empty `chunks` array on single-block text |

---

## Key Constraints

| Constraint | Decision | Status |
|---|---|---|
| No backend server | All calls from background service worker (`fetch` bypasses page CORS) | ✅ Implemented |
| API key not in source | Stored in `chrome.storage.local` via inline setup view | ✅ Implemented |
| No `eval()` for scoring JSON | Use regex extraction + `JSON.parse` | ✅ Implemented |
| Loop safety | Hard cap 30 iterations, 120 s wall-clock timeout | ✅ Implemented |
| `summarize_chunk` / `score_chunk` called per chunk | Agent decides; system prompt instructs call for every chunk | ✅ Implemented |
| Full history on every call | `messages` array never truncated during one agent run | ✅ Implemented |
| Cross-origin iframe limitation | Capture only top-level active element; documented | ✅ Documented, not yet surfaced in UI |

---

## Risk & Mitigations

| Risk | Mitigation | Status |
|---|---|---|
| Model skips a stage | System prompt enumerates stages explicitly with numbered steps | ✅ Mitigated |
| `score_chunk` returns malformed JSON | Strip markdown fences; structured fallback object | ✅ Mitigated |
| Too many chunks → context overflow | `chunk_text` capped at 8 chunks | ✅ Mitigated |
| Gemini rate limits | Sequential tool calls (one function call response per loop turn) | ✅ Mitigated |
| Content script not yet loaded on first action click | `chrome.scripting.executeScript` injects content.js on demand | ✅ Mitigated |
| Empty text field on run | System prompt has explicit empty-text branch; model asks user to paste | ✅ Mitigated |
| No unit tests | `count_stats` and `chunk_text` are pure functions — easy to test | ❌ Tests not written yet |
