# Gemini TypingFlow

An intelligent Chrome extension that transforms dense web articles into active-recall typing sessions, powered by the Google Gemini API.

It extracts page content, structures it into semantic nuggets via LLM, generates contextual visuals, and drops you into a focused typing interface — burning key ideas into memory, not just passive reading.

---

## Features

### LLM-Powered Semantic Structuring
Gemini analyzes the full page and returns a structured JSON payload:
- **TL;DR** — single-sentence page summary
- **Tags** — auto-extracted semantic domain tags (e.g. `#machinelearning`)
- **Nuggets** — logically grouped chunks of the original author's text, preserving voice
- **Star Rating** — Gemini's 1–5 editorial quality and depth assessment of the article
- **Coverage %** — percentage of the page's meaningful content captured across nuggets

### Nugget Gallery (Between-Screen)
After extraction, a full-screen gallery opens automatically showing all nuggets as cards before typing begins:
- `[01] — click to type ›` label per card with amber left-border accent
- Thumbnail image (if pre-existing from the page) or hexagon placeholder
- 200-char text preview
- Star rating (★★★★☆) and coverage progress bar in the header
- Click any card to jump directly into typing that nugget
- `☰ all` button in the typing view returns to the gallery at any time

### Active Recall Typing Interface
A full-screen monospace overlay with:
- Character-by-character real-time validation (green correct / red wrong)
- Live WPM and accuracy stats
- Prev / Next nugget navigation
- Contextual image panel (sticky, left side)
- Auto-advances to the next nugget on perfect completion

### Hybrid Visual Context
- Page images semantically matched to nuggets by the LLM are preserved and displayed
- For nuggets without a page image, **gemini-2.5-flash-image** generates a representative visual in the background
- All images are returned as base64 `data:` URIs from the background service worker, bypassing page Content-Security-Policy restrictions

### Second Brain Markdown Export
On session completion, one click exports an Obsidian/Notion-ready `.md` file:
- YAML frontmatter with date, tags, and source URL
- TL;DR block quote
- Each nugget formatted as a section with embedded image

---

## Architecture

| File | Role |
|---|---|
| `manifest.json` | MV3 manifest — permissions, service worker declaration |
| `background.js` | Secure proxy to Gemini APIs; handles text structuring and image generation; converts fallback images to base64 data URLs to bypass CSP |
| `content.js` | DOM extraction, full overlay UI (gallery + typing), markdown export |
| `popup.js` | Extension popup — triggers extraction, shows loader states, auto-opens gallery on completion |
| `popup.html` | Terminal-styled popup UI |
| `options.html` / `options.js` | API key management (stored in `chrome.storage.sync`) |

### Data Flow

```
User clicks Extract
  → popup.js extracts DOM via content.js
  → background.js calls gemini-3.1-flash-lite-preview
  → JSON payload (tldr, tags, nuggets, star_rating, coverage_pct) returned
  → content.js mounts session data
  → Gallery screen auto-opens (popup closes)
  → User clicks any nugget card
  → Typing overlay renders; background starts image generation via gemini-2.5-flash-image
  → On completion → Markdown export
```

---

## Setup

1. Clone the repo and load it as an unpacked extension in `chrome://extensions` (Developer Mode on)
2. Click the extension icon → Options → paste your Gemini API key → Save
3. Navigate to any article and click the extension icon → **Extract**
4. The nugget gallery opens automatically — click any card to start typing

---

## Models Used

| Purpose | Model |
|---|---|
| Text structuring & nugget extraction | `gemini-3.1-flash-lite-preview` |
| Contextual image generation | `gemini-2.5-flash-image` |

---

## Security Notes

- API key is stored in `chrome.storage.sync` (synced across signed-in Chrome profiles)
- All Gemini API calls are proxied through `background.js` — the key is never exposed to page-level content scripts
- Image panel and char spans are built via DOM methods (`createElement` / `textContent`) — no `innerHTML` interpolation of API-supplied content
- Image URLs from the API are validated against `http:`/`https:` protocol before being set as `img.src`
- Async image callbacks capture nugget index at request time (`capturedIndex`) to prevent race conditions during navigation

---

## Development

See [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) for the full phase-by-phase build history.
