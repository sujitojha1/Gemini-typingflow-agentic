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
- [x] Model constants at top of `background.js`.
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

## Phase 11: Multi-Provider Model Support
- [x] **Provider toggle in Settings** — Google AI (default) or local Ollama server.
- [x] **Google model pool manager** — per-model enable/disable checkboxes, custom model ID input, vision badge; defaults defined in `shared_config.js`.
- [x] **Ollama integration** — configurable base URL (default `http://localhost:11434`); "Test Connection" button fetches `/api/tags` and reports available models; "Fetch Models" button auto-populates the model pool; per-model enable/disable toggles.
- [x] **Provider-aware Track 1** — `callModelForStructuring` uses Ollama API (`/api/generate` with `num_ctx` auto-sized from content length) when Ollama provider is active; falls back to Google API otherwise.
- [x] **Track 2 always Google** — `AGENT_MODEL_POOL` is always `DEFAULT_GOOGLE_MODELS` regardless of provider, ensuring tool calls use the Gemini API.
- [x] **`refreshActiveSettings()`** — rebuilds `MODEL_POOL` and `AGENT_MODEL_POOL` from `chrome.storage.sync` before each pipeline run.
- [x] Ollama 403 error surfaced with actionable fix message: `OLLAMA_ORIGINS=* ollama serve`.

## Phase 12: Tool Infrastructure Refactor
- [x] **`shared_config.js`** — single source of truth for `DEFAULT_GOOGLE_MODELS`; imported via `importScripts` in `background.js` and via `<script>` tag in `options.html`.
- [x] **`tool_helper.js`** — shared `callToolModel(prompt, defaultResult, timeoutMs)` helper used by all `tool_*.js` files; eliminates ~35 lines of boilerplate per tool; iterates `AGENT_MODEL_POOL` with per-model fallback on HTTP error, empty response, or parse failure.
- [x] **`agentic_flow.js`** — replaces the old sequential ReAct loop with a concurrency-limited parallel pipeline:
    - Old: 70+ sequential LLM calls → 3–5 minutes end-to-end.
    - New: up to 3 chunks processed simultaneously; within each chunk, `getChunkStats` + `extractSubject` + `evaluateChunk` + `checkGrammar` run in parallel → **~20–30 seconds**.
- [x] Improved error handling in `toolEvaluateChunk` and `toolExtractSubject` — structured error fields instead of thrown exceptions.
- [x] Enhanced evaluation prompts across tools for rubric clarity and output specificity.
- [x] Removed unused Gemma 3 models from pool; standardised JSON response handling across all models.

## Phase 13: Full-Document Chunking & Real Coverage
- [x] **System prompt: mandatory full coverage** — rule 3 now explicitly instructs the LLM to "systematically work through the source content from FIRST item to LAST", with no upper limit on nugget count, and a NEVER-skip directive for minor/short sections.
- [x] **System prompt: anchored coverage_pct** — rule 6 now defines `coverage_pct` as `(sum of nugget word counts) ÷ (sum of source text word counts) × 100`, with a ≥ 90% target and a feedback loop: "if coverage would fall below 80%, add more nuggets."
- [x] **Nugget word limit raised** — max per nugget increased from 300 → 400 words so dense sections don't have to be artificially split mid-thought.
- [x] **DOM extraction expanded** — `content.js` now captures `h4`, `h5`, `figcaption`, and `pre` elements; heading char threshold lowered from 30 → 3 so structural labels like "Summary" and "Key Takeaways" are preserved.
- [x] **Multi-pass chunking for long articles** — articles above 3 000 words are split into ~2 000-word sections in `agentic_flow.js`; each section is structured independently (`structureWithFallback`) and the results are merged via `mergeStructuredSections` (deduplicated tags, averaged star rating, computed coverage).
- [x] **Real coverage_pct in Track 2** — `processChunksInParallel` now computes coverage as `(refined nugget words) ÷ (original article words) × 100` rather than using the LLM's self-reported value.
- [x] **processOneChunk: positional coverage removed** — the per-chunk `coverage` field (which was just chunk index progress) is replaced by a `chunkProgress` log-only value; the authoritative `coverage_pct` is now computed once over all results after Track 2 finishes.

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

Two processes run on every extraction. The user sees the Normal Process results immediately, while the Agentic Process refines them in the background via a **parallel chunk pipeline** without blocking the UI.

**Flow:**

```
User clicks Process Page Intelligence
  ↓
DOM extracted (text blocks + image URLs)
  ↓
┌─────────────────────────────────┐   ┌──────────────────────────────────────────────┐
│ Track 1: Normal Process         │   │ Track 2: Agentic Process (Parallel Pipeline) │
│ (Active Model Pool)             │   │ (always Google AI models)                    │
│                                 │   │                                              │
│ Fast text-only structuring      │   │ For each nugget (≤3 concurrent):             │
│ Google AI or Ollama             │   │   A: checkRelevance                          │
│ ~2s                             │   │   C+D+E+F: getChunkStats + extractSubject    │
│                                 │   │            + evaluateChunk + checkGrammar    │
│                                 │   │            (parallel within chunk)           │
│                                 │   │   G: refineChunk (if grammar issues)         │
│                                 │   │   B: image resolution                        │
│                                 │   │   H: updateCoverage                          │
└────────────┬────────────────────┘   └───────────────┬──────────────────────────────┘
             ↓                                        ↓
     Gallery mounts immediately            background.js pushes update_nuggets
     popup closes                          to tab via chrome.tabs.sendMessage (~20-30s)
                                                       ↓
                                           content.js receives update_nuggets:
                                             • sessionData.geminiNuggets = original
                                             • sessionData.nuggets = Agent refined
                                             • sessionData.isAgentRefined = true
                                             • toast: "✦ Agent refined your nuggets"
                                             • gallery re-renders if open
```

**Why parallel instead of ReAct:**
The original sequential ReAct loop had the LLM decide each next tool call — introducing 70+ round-trips and 3–5 minutes of latency per page. The parallel pipeline replaces LLM-driven sequencing with a fixed, well-understood tool plan. Since the tool sequence is deterministic per chunk (checkRelevance → stats/subject/evaluate/grammar → conditional refine → image → coverage), hardcoding it as concurrent async work is faster, cheaper, and equally effective. The LLM reasoning budget is spent on *within-tool* quality (evaluation scores, grammar judgements, refinements) rather than meta-decisions about which tool to call next.

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
