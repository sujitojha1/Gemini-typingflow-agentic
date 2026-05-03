# Gemini TypingFlow — Agentic

A Chrome extension that transforms dense web articles into active-recall typing sessions. It extracts page content, structures it into semantic nuggets via LLM, generates contextual visuals, and drops you into a focused typing interface — burning key ideas into memory through doing, not passive reading.

---

## How It Works

```
Popup opens
  → instant DOM scan → word count + image count displayed

User clicks "Process Page Intelligence"
  → content.js extracts text blocks + image URLs from the page
  → Gemini Flash Lite called immediately → nuggets mounted → gallery opens → popup closes
  → Gemma 4 runs in background service worker simultaneously
      → fetches page images as base64, sends multimodal request to Google AI
      → on completion → pushes refined nuggets directly to the tab
      → toast: "✦ Gemma 4 refined your nuggets" → gallery updates in place

User clicks any nugget card
  → typing overlay opens
  → Gemini Flash Image generates contextual visuals in background per nugget

Session complete → one-click Markdown export
```

---

## Features

### Dual-Model Nugget Pipeline
Two models run in parallel on every extraction:

| Model | Role | Timing |
|---|---|---|
| `gemini-3.1-flash-lite-preview` | Fast initial chunking — mounts gallery immediately | Blocks until done (~2s) |
| `gemma-4-31b-it` | Multimodal re-chunking with visual image mapping | Background, non-blocking |

Gemini gets the user into the gallery fast. Gemma 4 takes its time with the page images (fetched as base64 `inlineData`) to produce a visually-grounded, more accurate chunk-to-image mapping. When Gemma finishes, the gallery updates live with a toast notification. Both versions are preserved in session state (`sessionData.geminiNuggets` and `sessionData.nuggets`).

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
- `· ✦ refined by Gemma 4` suffix in subtitle once background model completes
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
| `background.js` | Owns all API calls: Gemma 4 background chunking, Gemini text structuring, Gemini image generation, picsum fallback; pushes `update_nuggets` directly to tabs |
| `content.js` | DOM extraction; full overlay UI (gallery + typing + bottom bar); audio synthesis; `update_nuggets` handler with toast + live gallery refresh; Markdown export |
| `popup.js` | Popup init — DOM scan on open; fires Gemma background task + Gemini call in parallel on extract; dynamic content script injection |
| `popup.html` | Dark popup: header, word/image stat chips, refresh + settings icon buttons, action buttons, loader |
| `options.html/js` | API key input, saved to `chrome.storage.sync` |

---

## Setup

1. Load as unpacked extension at `chrome://extensions` (Developer Mode on)
2. Click the extension icon → **⚙** → paste your Google AI API key → **Secure API Key**
3. Navigate to any article — word count and image count appear instantly on popup open
4. Click **Process Page Intelligence** — gallery opens in ~2s (Gemini), then refines silently (Gemma 4)
5. Click any nugget card to start typing

---

## Models Used

| Model | Purpose |
|---|---|
| `gemma-4-31b-it` | Multimodal background chunking — text + images via Google AI |
| `gemini-3.1-flash-lite-preview` | Fast initial text structuring |
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
