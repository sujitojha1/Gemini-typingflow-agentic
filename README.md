# Gemini TypingFlow — Agentic Edition

A Chrome extension that sits inside any text field and runs a **multi-stage AI agent** on whatever you are writing. The agent does not just reply — it works through your text in structured passes: counting, chunking, summarising, and scoring, then delivers a full writing report with every intermediate step visible.

---

## The Core Idea

You type. You trigger the agent. It analyses your writing through four deterministic stages before the LLM ever writes a sentence of commentary:

```
Your text (from the active field)
        │
        ▼
 Stage 1 ── count_stats
        │    words · sentences · paragraphs · avg sentence length · reading time
        │
        ▼
 Stage 2 ── chunk_text
        │    splits into N semantically coherent chunks
        │
        ▼
 Stage 3 ── summarize_chunk  (called once per chunk)
        │    one-sentence summary of each chunk
        │
        ▼
 Stage 4 ── score_chunk  (called once per chunk)
        │    readability · clarity · coherence scores + feedback per chunk
        │
        ▼
 Stage 5 ── LLM synthesis
             overall report · top issues · rewrite suggestions
```

Every tool call and its raw result appears in the **Reasoning Chain panel** in real time. You see exactly what the agent found before it tells you what to do about it.

---

## Four Custom Tool Functions

### `count_stats(text)`
Returns word count, sentence count, paragraph count, average sentence length (words), and estimated reading time. Pure local computation — no API call needed.

```json
{ "words": 312, "sentences": 21, "paragraphs": 6,
  "avg_sentence_length": 14.9, "reading_time_sec": 75 }
```

### `chunk_text(text, max_words_per_chunk)`
Splits the text into chunks that respect paragraph boundaries. If a paragraph exceeds `max_words_per_chunk` it is split at sentence boundaries. Returns an ordered array of chunk strings.

```json
["Chunk 1 text...", "Chunk 2 text...", "Chunk 3 text..."]
```

### `summarize_chunk(chunk)`
Calls Gemini with a one-shot summarisation prompt scoped to a single chunk. Returns a one-sentence distillation. Called once per chunk produced by `chunk_text`.

```json
{ "summary": "Introduces the main argument about memory management in Rust." }
```

### `score_chunk(chunk)`
Calls Gemini with a scoring prompt. Returns three integer scores (1–10) plus a short feedback string for each dimension.

```json
{
  "readability": 7,
  "clarity":     5,
  "coherence":   8,
  "feedback": "Sentence 3 introduces a new term without definition; consider a brief gloss."
}
```

---

## What the Agent Loop Looks Like

The agent is a Gemini conversation where **the full message history is passed on every call**. Each tool result is appended as a `functionResponse` turn before the next Gemini request is made.

```
messages = [ { role: "user", text: prompt } ]

Loop:
  POST /generateContent  (messages + tool declarations)
  ↓
  finishReason === "TOOL_CALLS"?
    → execute tool → append functionCall + functionResponse to messages → repeat
  finishReason === "STOP"?
    → extract final text → done
```

Because the full history is carried forward, later stages have full context of earlier results — the LLM knows the word count when it is scoring chunks, and knows all chunk summaries when it writes the final report.

---

## Reasoning Chain UI

The floating panel renders each stage as a collapsible card:

```
┌── TypingFlow Agent ─────────────────────────────────┐
│  [Analyse my draft]                        [Run]     │
├──────────────────────────────────────────────────────┤
│  Reasoning Chain                                      │
│                                                       │
│  ✓ Stage 1 · count_stats                 [expand]    │
│    words: 312  sentences: 21  paragraphs: 6          │
│                                                       │
│  ✓ Stage 2 · chunk_text                  [expand]    │
│    3 chunks produced                                  │
│                                                       │
│  ✓ Stage 3 · summarize_chunk × 3         [expand]    │
│    Chunk 1: "Introduces the Rust ownership model."   │
│    Chunk 2: "Explains borrow checker rules."         │
│    Chunk 3: "Contrasts with GC-based languages."     │
│                                                       │
│  ✓ Stage 4 · score_chunk × 3             [expand]    │
│    Chunk 1  R:7  C:5  Co:8                           │
│    Chunk 2  R:8  C:7  Co:9                           │
│    Chunk 3  R:6  C:6  Co:7                           │
│                                                       │
├──────────────────────────────────────────────────────┤
│  Final Report                                         │
│  Overall score 7.1/10. Clarity is the weakest area:  │
│  chunk 1 introduces "ownership" without grounding... │
│                                          [Copy]       │
└──────────────────────────────────────────────────────┘
```

---

## Architecture

```
Gemini-typingflow-agentic/
├── manifest.json          — permissions: storage, scripting, tabs, activeTab
├── background.js          — service worker: agent loop, Gemini API calls
├── content.js             — injected into pages: captures text field content, opens panel
├── panel/
│   ├── panel.html         — floating side panel
│   ├── panel.js           — renders reasoning chain cards, final report
│   └── panel.css
└── tools/
    ├── tools.js            — barrel: TOOL_SCHEMAS array + dispatchTool()
    ├── count_stats.js
    ├── chunk_text.js
    ├── summarize_chunk.js  — thin Gemini call (reuses API key from storage)
    └── score_chunk.js      — thin Gemini call
```

`count_stats` and `chunk_text` are **pure local functions** (no network).  
`summarize_chunk` and `score_chunk` each make a single focused Gemini call — they are not recursive agent loops, just direct `generateContent` calls returning structured JSON.

---

## Setup

### Prerequisites
- Google Chrome 120+
- A [Gemini API key](https://aistudio.google.com/app/apikey)

### Load the Extension

```bash
git clone https://github.com/sujitojha1/Gemini-typingflow-agentic.git
```

1. Open `chrome://extensions` → enable **Developer mode**
2. Click **Load unpacked** → select the repo folder
3. Click the extension icon → enter your Gemini API key → Save

### Use It

1. Click inside any text field on any webpage
2. Click the TypingFlow toolbar icon — the panel slides open
3. Type a prompt such as "Analyse this draft" or just click **Run**
4. Watch each stage execute and collapse into a summary card
5. Read the final report — click **Copy** to paste suggestions back into the field

---

## License

MIT — see [LICENSE](./LICENSE).
