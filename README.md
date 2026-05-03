# Gemini TypingFlow — Agentic

A Chrome extension that transforms dense web articles into active-recall typing sessions. It extracts page content, structures it into semantic nuggets via LLM, generates contextual visuals, and drops you into a focused typing interface — burning key ideas into memory through doing, not passive reading.

---

## How It Works

```
Popup opens
  → instant DOM scan → word count + image count displayed

User clicks "Process Page Intelligence"
  → content.js extracts text blocks + image URLs from the page
  → Track 1 (Normal Process): Primary Model Pool called immediately to generate chunks → gallery opens → popup closes
  → Track 2 (Agentic Process): LLM-driven ReAct loop triggers asynchronously in background
      → system prompt + tool definitions → LLM generates { thought, tool, args } → runtime executes → result fed back
      → loops per-chunk: checkRelevance → image → stats → evaluation → grammar → refinement → coverage
      → on completion → extension switches to the refined chunks
      → toast: "✦ Agent refined your nuggets" → gallery updates in place

User clicks any nugget card
  → typing overlay opens
  → Gemini Flash Image generates contextual visuals in background per nugget

Session complete → one-click Markdown export
```

---

## Features

### Two-Track Processing Pipeline
TypingFlow utilizes a dual-track architecture triggered simultaneously when you click "Process Page Intelligence":

1. **Track 1: Normal Process (Deterministic)**
   - Fast initial chunking that structures the page intelligence and generates the first set of chunks using the primary model pool (e.g., `gemini-3.1-flash-lite-preview`).
   - Blocks the UI briefly (~2s) and mounts the gallery immediately for instant user interaction.

2. **Track 2: Agentic Process (ReAct Loop)**
   - Triggers asynchronously in the background.
   - Uses a **ReAct (Reasoning + Acting)** pattern: a system prompt provides the LLM with all available tools and the full plan. The LLM generates `{ thought, tool, args }`, the runtime executes the tool, feeds the result back, and the LLM decides the next step — looping until it emits `DONE`.
   - Processes each chunk through: `checkRelevance` → `findMatchingImage`/`generateChunkImage` → `getChunkStats` → `extractSubject` → `evaluateChunk` → `checkGrammar` → `refineChunk` (conditional) → `updateCoverage`.
   - Once complete, the extension seamlessly **switches to the refined chunks**, updating the gallery live with a toast notification. Users can click "view agent logs" to inspect the full tool call history per chunk.

### Agentic Page Intelligence
The popup runs a lightweight DOM scan the instant it opens — before any API call — and surfaces two real-time chips:
- **words** — word count of extractable article text
- **images** — qualifying images (>100px, non-data-URI) on the page

Implemented as an inline `func:` passed to `chrome.scripting.executeScript` — no round-trip, zero latency.

### Nugget Gallery
Full-screen between-state shown immediately after extraction:
- `[01] — click to type ›` card per nugget with amber left-border accent
- Thumbnail image or hexagon placeholder + 200-char text preview
- Star rating (★★★★☆) and coverage % progress bar in header
- `· ✦ refined by Agent` suffix in subtitle once background agent completes
- Click any card to jump directly into typing

### Active Recall Typing Interface
- Character-by-character validation — green correct, red wrong
- **Segmented pip progress bar** — done (green) / active (blue glow) / pending (dark), with "2 of 4" counter
- **Web Audio feedback** — soft bandpass noise burst on correct key, low sine-wave thud on wrong key (synthesized, no external files, `AudioContext.resume()` handles Chrome's autoplay suspension)
- **Fixed bottom metrics bar** — three boxes: WPM · Accuracy · Chars, with a live gradient fill line tracking completion
- Prev / Next navigation; auto-advances on perfect nugget completion

### Hybrid Visual Context
- Page images mapped to nuggets by the LLM are displayed immediately
- For nuggets without a page image, `gemini-2.5-flash-image` generates a contextual visual asynchronously
- All images converted to base64 `data:` URIs in the service worker to bypass page Content-Security-Policy

### Second Brain Markdown Export
On session completion, exports an Obsidian/Notion-ready `.md` file:
- YAML frontmatter: date, tags, source URL
- TL;DR block quote
- Each nugget as a section with embedded image

---

## Architecture

| File | Role |
|---|---|
| `manifest.json` | MV3 manifest — permissions, background service worker, options UI |
| `background.js` | Owns all API calls: Agent pipeline orchestration, Gemini text structuring, Gemini image generation, picsum fallback; pushes `update_nuggets` directly to tabs |
| `content.js` | DOM extraction; full overlay UI (gallery + typing + bottom bar); audio synthesis; `update_nuggets` handler with toast + live gallery refresh; Markdown export |
| `popup.js` | Popup init — DOM scan on open; fires background task + Gemini call in parallel on extract; dynamic content script injection |
| `popup.html` | Dark popup: header, word/image stat chips, refresh + settings icon buttons, action buttons, loader |
| `options.html/js` | API key input, saved to `chrome.storage.sync` |

---

## Setup

1. Load as unpacked extension at `chrome://extensions` (Developer Mode on)
2. Click the extension icon → **⚙** → paste your Google AI API key → **Secure API Key**
3. Navigate to any article — word count and image count appear instantly on popup open
4. Click **Process Page Intelligence** — gallery opens in ~2s (Normal Process), then refines silently (Agentic Process)
5. Click any nugget card to start typing

---

## Models Used

| Model | Purpose |
|---|---|
| `gemma-4-31b-it` | Alternative model in the pool for multimodal text/image background processing |
| `gemini-3.1-flash-lite-preview` | Fast initial text structuring & Agentic semantic chunking and refinement loops |
| `gemini-2.5-flash-image` | Per-nugget contextual image generation |

All three use the same Google AI API key.

---

## Security

- API key stored in `chrome.storage.sync` — never exposed to page-level scripts
- All API calls proxied through `background.js` service worker
- Image panel and char spans built via `createElement` / `textContent` — no `innerHTML` on API content
- Image URLs validated with `isValidHttpUrl()` before assignment to `img.src`
- Page stats scan uses inline `func:` in `executeScript` — no `eval`, no string injection
- Async image callbacks capture `capturedIndex` at request time to prevent stale-closure race conditions

---

## Development

See [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) for the full phase-by-phase build log and agentic tweaks roadmap.
