# Development Plan: Gemini TypingFlow — Agentic

---

## Phase 1: Foundation & API Security
- [x] Manifest V3 project initialised.
- [x] `options.html` / `options.js` for secure API key entry; key stored in `chrome.storage.sync`.
- [x] `background.js` as a secure service-worker proxy to the Google AI API, bypassing content-script CORS restrictions.

## Phase 2: LLM Processing Engine
- [x] System prompt engineering in `background.js` enforcing strict JSON schema:
    - `tldr` — single-sentence summary
    - `tags` — semantic domain tags array
    - `nuggets` — author-voice text chunks each with `img_src` or null
    - `star_rating` — 1–5 editorial quality score
    - `coverage_pct` — 0–100 content coverage estimate
- [x] Advanced DOM extraction in `content.js`: collects `<p>`, `<h1–h3>`, `<li>`, `<blockquote>`, `<img>` from article/main root; filters nav/header/footer/aside; preserves image `src` URLs for LLM semantic mapping.

## Phase 3: Hybrid Visuals & Asset Generation
- [x] Display `img_src` values returned by the LLM directly on nugget cards.
- [x] `gemini-2.5-flash-image` called asynchronously per nugget where `img_src` is null.
- [x] Image `parts[]` parsing: searches all parts for `inlineData` rather than assuming index 0.
- [x] Picsum fallback converted to base64 `data:` URI in service worker to bypass page CSP.
- [x] `img.onerror` logging + `⬡ visual unavailable` UI state on failed generation.

## Phase 4: Active Recall Typing UI
- [x] Full-screen overlay via injected CSS — immune to host-page style collisions.
- [x] Character-by-character typing validation: green correct, red wrong, blue cursor.
- [x] Prev / Next nugget navigation; auto-advance on perfect completion.

## Phase 5: Second Brain Integration
- [x] `exportToMarkdown()` — YAML frontmatter (date, tags, source URL), TL;DR block, nugget sections with embedded images.
- [x] Auto-download as `.md` on session completion.

## Phase 6: Terminal Popup & Pipeline Polish
- [x] Dark-themed `popup.html` with gradient background.
- [x] Loader states: "Parsing Sequence", "Synthesizing with Gemini...", "Rendering Image Assets...".
- [x] Session persistence check on popup open: re-enables Launch Typing Session if session exists on tab.
- [x] Auto-open gallery on extraction complete; popup closes automatically.
- [x] Robust dynamic content script injection: if content script is missing (post-update), `chrome.scripting.executeScript` injects it, waits 250ms, then retries messaging.

## Phase 7: Nugget Gallery Screen
- [x] `renderNuggetGallery()` — full-screen between-state with:
    - `$ extract --page-nuggets` header with fragment count + star rating + coverage bar
    - Clickable nugget cards: amber left border, `[01] — click to type ›` label, thumbnail, 200-char preview
    - Hover highlight with blue border transition
- [x] `☰ all` button in typing view returns to gallery without losing session state.
- [x] Star rating and coverage % bar displayed in gallery header from LLM response.

## Phase 8: Security Hardening
- [x] XSS — image panel built with `createElement` + validated `img.src`, not `innerHTML`.
- [x] XSS — char spans built with `createElement` + `span.textContent`, not `innerHTML`.
- [x] Race condition — async image callbacks capture `capturedIndex` at request time.
- [x] Model constants (`GEMINI_TEXT_MODEL`, `GEMINI_IMAGE_MODEL`, `GEMMA_MODEL`) at top of `background.js`.
- [x] Optional chaining on `candidates[0]?.content?.parts[0]?.text`.
- [x] Null guards on all `tabs[0]` accesses.

## Phase 9: Audio Feedback
- [x] Web Audio API sound synthesis — no external audio files.
    - **Correct key**: bandpass-filtered white noise burst at ~2200 Hz, 50ms exponential decay, gain 0.09.
    - **Wrong key**: sine wave 200→90 Hz through waveshaper distortion, 120ms decay, gain 0.07.
- [x] `AudioContext.resume()` called before each sound to bypass Chrome's autoplay suspension in content scripts.
- [x] `prevTypedLen` tracks previous input length so sound fires only on newly typed characters, not on delete.

## Phase 10: UI Refinements
- [x] Nugget progress indicator: segmented pip track (green done / blue active glow / dark pending) + bold "2 of 4" label — replaces `nugget_2_of_4.txt` filename display.
- [x] Bottom metrics bar: fixed to viewport bottom, three boxes (WPM · Accuracy · Chars) with a `--tf-progress` CSS variable driving a live gradient fill line at top edge.
- [x] Popup header: "Gemini TypingFlow — Agentic".
- [x] Settings moved to inline icon button (⚙) in popup meta row.
- [x] Refresh icon button (↻) in popup meta row with 0.6s spin animation.

---

## Agentic Tweaks

### Tweak 1 — Instant Page Intelligence Scan ✅

On every popup open, before any API call, `chrome.scripting.executeScript` runs an inline DOM function and populates two stat chips:

| Chip | Measurement |
|---|---|
| `words` | Word count of extractable text nodes (p, h1–h3, li, blockquote outside nav/header/footer) |
| `images` | Images wider than 100px and not data-URIs |

Displayed in a `page-meta` row between the header and action buttons, alongside the ↻ and ⚙ icon buttons. Chips initialise as `—` and populate within milliseconds of popup render.

---

### Tweak 2 — Dual-Track Agentic Workflow ✅

Two processes run on every extraction. The user sees the deterministic Normal Process results immediately, while the Agentic Process refines them in the background via a multi-step toolchain without blocking the UI.

**Flow:**

```
User clicks Process Page Intelligence
  ↓
DOM extracted (text blocks + image URLs)
  ↓
┌─────────────────────────────────┐   ┌──────────────────────────────────────────────┐
│ Track 1: Normal Process         │   │ Track 2: Agentic Process                     │
│ (Primary Model Pool)            │   │ (4-Phase Async Pipeline)                     │
│                                 │   │                                              │
│ Fast text-only structuring      │   │ 1. Session & Content Indexing                │
│ ~2s                             │   │ 2. Semantic Chunk Identification             │
│                                 │   │ 3. Parallel Agent Loops (per chunk)          │
│                                 │   │    • checkRelevance (ad filter)              │
│                                 │   │    • Image matching / generation             │
│                                 │   │    • getChunkStats, extractSubject           │
│                                 │   │    • evaluateChunk, refineChunk              │
│                                 │   │    • updateCoverage                          │
│                                 │   │ 4. State Handoff                             │
└────────────┬────────────────────┘   └───────────────┬──────────────────────────────┘
             ↓                                        ↓
     Gallery mounts immediately            background.js pushes update_nuggets
     popup closes                          to tab via chrome.tabs.sendMessage
                                                       ↓
                                           content.js receives update_nuggets:
                                             • sessionData.geminiNuggets = original
                                             • sessionData.nuggets = Agent refined
                                             • sessionData.isAgentRefined = true
                                             • toast: "✦ Agent refined your nuggets"
                                             • gallery re-renders if open
```

**Why an Agentic Loop for re-chunking:**
The agent runs an independent async loop per chunk. It checks relevance to filter ads and boilerplate, extracts subjects, evaluates chunk quality, optionally refines the text if the clarity score is low, and dynamically matches or generates images contextually. This ensures the nuggets are deeply synthesized rather than just structured.

**Session state preservation:**
Both versions are kept in memory — `sessionData.geminiNuggets` (original) and `sessionData.nuggets` (Agent refined, live after update). The gallery subtitle appends `· ✦ refined by Agent` when the update arrives.

---

### Tweak 3 — Readability & Complexity Score *(planned)*

Before extraction, score the page inline (no API): estimated read time, avg words/sentence, vocabulary density. Surface as additional stat chips: `~6 min · complexity: medium`.

### Tweak 4 — Smart Nugget Count Hint *(planned)*

Based on word count and paragraph density, predict likely nugget count and hint it in the button label before extraction: `Process Page Intelligence (~4 nuggets)`.

### Tweak 5 — Revisit Detection *(planned)*

On popup open, fingerprint the page (hostname + title hash) against `chrome.storage.local`. If a prior session exists, show a "Revisit" badge and offer to reload it — skipping the API call entirely.

### Tweak 6 — Auto-Extract on Long-Form Domains *(planned)*

Detect known long-form domains (Substack, Medium, arXiv, HN articles) and auto-trigger extraction when word count exceeds a threshold, surfacing a one-click confirm rather than requiring manual button press.
