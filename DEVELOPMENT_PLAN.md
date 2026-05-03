# Development Plan: Gemini TypingFlow

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
