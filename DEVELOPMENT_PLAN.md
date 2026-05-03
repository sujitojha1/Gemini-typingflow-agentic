# Development Plan: Gemini TypingFlow — Agentic

## Phase 1: Foundation & API Security
- [x] Initialize project with Manifest V3.
- [x] Create `options.html` and `options.js` for secure local storage of the Gemini API Key.
- [x] Build the `background.js` architecture to act as a secure proxy to the Gemini API, bypassing content-script CORS restrictions.

## Phase 2: The LLM Processing Engine
- [x] Develop the core Prompt Engineering strategy in `background.js`. Enforces a strict JSON schema output:
    - `tldr`: Single-sentence page summary.
    - `tags`: Array of semantic domain tags.
    - `nuggets`: Array of objects grouping original author text (`text`) with a related image reference (`img_src` or `null`).
- [x] Implement advanced DOM extraction in `content.js` to preserve image `src` URLs and pass them alongside adjacent text blocks to the LLM for semantic mapping.

## Phase 3: Hybrid Visuals & Asset Generation
- [x] Display existing `img_src` attached to a nugget by the LLM.
- [x] Interface with **gemini-2.5-flash-image** as an asynchronous background routine.
- [x] For nuggets where `img_src` is null, generate a representative image based on nugget text.
- [x] Fix image parts parsing: search all `parts[]` for `inlineData` rather than assuming `parts[0]` is the image (model returns text + image parts).
- [x] Convert fallback images (picsum) to base64 `data:` URIs in the service worker to bypass page Content-Security-Policy restrictions on external image URLs.

## Phase 4: Active Learning UI
- [x] Build the premium overlay using vanilla CSS injected into `content.js`, immune to host-page style collisions.
- [x] Wire up character-by-character active recall typing mechanics with real-time green/red validation.
- [x] Live WPM and accuracy stats bar.
- [x] Prev / Next nugget navigation; auto-advance on perfect completion.

## Phase 5: Second Brain Integration
- [x] Build `exportToMarkdown()` in `content.js`.
- [x] Rich Markdown output with YAML frontmatter (date, tags, source URL), TL;DR block, nugget sections with embedded images.
- [x] Trigger automatic `.md` download on session completion.

## Phase 6: Terminal Popup & Polish
- [x] Terminal-styled `popup.html` as the main control center.
- [x] Loader states during async LLM calls ("Parsing Sequence", "Synthesizing with Gemini...", "Rendering Image Assets...").
- [x] Session persistence check: if a session exists on the current tab, re-enable the Type button immediately on popup open.
- [x] Auto-open gallery after extraction completes; popup closes automatically.

## Phase 7: Nugget Gallery Screen
- [x] `renderNuggetGallery()`: full-screen between-state shown immediately after extraction, before typing begins.
    - Header: `$ extract --page-nuggets` with fragment count.
    - Each nugget rendered as a clickable card with amber left border, label `[01] — click to type ›`, thumbnail image or placeholder, 200-char text preview.
    - Hover highlight with blue border transition.
    - Click any card to jump directly into typing that nugget at any index.
- [x] `☰ all` button in the typing view's nav bar returns to the gallery without losing session state.
- [x] **LLM-assessed star rating** (`star_rating` 1–5): Gemini returns an editorial quality score; displayed as ★★★★☆ in the gallery header.
- [x] **Content coverage indicator** (`coverage_pct` 0–100): Gemini returns what percentage of the page's meaningful content is captured; displayed as a labeled green progress bar in the gallery header.

## Phase 8: Security Hardening
- [x] XSS fix — image panel: `img_src` from API previously injected into `innerHTML`; now built with `createElement` + `img.src` after `isValidHttpUrl()` validation.
- [x] XSS fix — char spans: nugget text previously interpolated into `innerHTML`; now uses `createElement` + `span.textContent`.
- [x] Race condition fix — async image-generation callback now captures `capturedIndex = currentNuggetIndex` at request time, preventing mid-navigation requests from targeting the wrong nugget or DOM element.
- [x] Model name constants (`GEMINI_TEXT_MODEL`, `GEMINI_IMAGE_MODEL`) at top of `background.js` as the single update point when Google deprecates model versions.
- [x] Null guard in `popup.js` `btnType` handler: checks `tabs && tabs.length > 0` before accessing `tabs[0]`.
- [x] Optional chaining on `candidates[0]?.content?.parts[0]?.text` guards against unexpected Gemini API response shapes.
- [x] Image error logging: `img.onerror` handler + `console.warn` on failed generation responses; loader updates to `⬡ visual unavailable` to surface failures visibly.

## Phase 9: Audio Feedback & Pipeline Polish
- [x] Integrate Web Audio API for subtle, synthesized sound effects on correct/incorrect keystrokes without requiring external audio file dependencies.
    - Correct: soft bandpass-filtered white noise burst (~2200 Hz, 50ms decay).
    - Wrong: sine wave dropping 200→90 Hz through a waveshaper for a dull thud.
    - Both functions call `ctx.resume()` before playback to bypass Chrome's AudioContext autoplay suspension in content scripts.
- [x] Implement robust dynamic content script injection in `popup.js` to ensure the extension works seamlessly even if the page was loaded before the extension was updated.
- [x] Add a direct settings access icon (⚙) in the popup header (top-right) for easier API key management.

## Phase 10: UI Refinements
- [x] Replace `nugget_2_of_4.txt` filename label with a proper segmented progress bar — pip track (green done, blue active, dark pending) + bold "2 of 4" counter.
- [x] Move WPM / accuracy / char-progress stats out of the top nav into a fixed bottom bar with three distinct metric boxes and a live gradient progress line at the top edge.
- [x] Popup header updated to "Gemini TypingFlow — Agentic".

---

## Agentic Tweaks Roadmap

These tweaks layer autonomous, proactive intelligence on top of the base extraction pipeline — moving from a user-triggered tool toward a context-aware learning agent.

### Tweak 1 — Instant Page Intelligence Scan ✅
**Status:** Complete

On popup open (before any API call), `chrome.scripting.executeScript` runs an inline DOM scan and surfaces three chips in the popup UI:

| Chip | What it measures |
|---|---|
| `chars` | Non-whitespace character count in article body |
| `words` | Word count of extractable text nodes |
| `images` | Qualifying images (>100px wide, non-data-URI) |

**Why it matters:** Gives the user an instant read on article density without waiting for Gemini. A 12k-char / 2k-word article with 8 images suggests rich multi-nugget output; a 400-char stub suggests low yield before wasting an API call.

**Implementation:** Inline `func:` passed to `executeScript` — no string eval, no content-script message round-trip, zero latency.

---

### Tweak 2 — Gemma 4 via Google AI as Primary Structuring Engine ✅
**Status:** Complete

After DOM extraction, `background.js` sends text chunks + up to 5 page images (fetched as base64 `inlineData` in parallel) to `gemma-4-31b-it` via the Google AI API. Falls back to Gemini Flash Lite silently on any error.

| Step | Detail |
|---|---|
| **Model** | `gemma-4-31b-it` via `generativelanguage.googleapis.com` |
| **API key** | Same `geminiApiKey` from `chrome.storage.sync` |
| **Input** | Text chunks array + up to 5 page images fetched as base64 `inlineData` parts |
| **Task** | Identify chunk count, visually map chunks to images, return nuggets JSON |
| **Fallback** | Any Gemma error silently falls back to `gemini-3.1-flash-lite-preview` |

**Loader states:**
- `Analysing with Gemma 4 (Google AI)...` — primary path
- `Synthesizing with Gemini Flash Lite 3.1 Preview...` — fallback only

### Tweak 3 — Readability & Complexity Score *(planned)*
Before extraction, score the page for estimated reading time, sentence complexity (avg words/sentence), and vocabulary density. Surface as a second row of chips: `~6 min read · complexity: medium`.

### Tweak 3 — Smart Nugget Count Estimation *(planned)*
Based on char count and paragraph density, predict how many nuggets Gemini is likely to produce and hint this in the Extract button label: `Extract (~4 nuggets)`.

### Tweak 4 — Duplicate / Revisit Detection *(planned)*
On popup open, check `chrome.storage.local` for a fingerprint (hostname + title hash) of previously extracted pages. If found, show a "Revisit" badge and offer to reload the prior session instead of re-calling the API.

### Tweak 5 — Auto-Extract on High-Confidence Articles *(planned)*
If the page is a known long-form domain (e.g. substack, medium, arxiv) and char count exceeds a threshold, offer a one-click "Auto-Extract" prompt instead of requiring manual button press.
