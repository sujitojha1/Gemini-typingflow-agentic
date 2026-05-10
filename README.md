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
  → Track 2 (Agentic Process): Parallel chunk pipeline triggers asynchronously in background
      → for each nugget (up to 3 concurrent):
          checkRelevance → getChunkStats + extractSubject + evaluateChunk + checkGrammar (parallel)
          → refineChunk (conditional) → image resolution → updateCoverage
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
   - Fast initial chunking that structures the page intelligence and generates the first set of chunks using the active model pool.
   - Supports both Google AI models and local Ollama models.
   - Blocks the UI briefly (~2s) and mounts the gallery immediately for instant user interaction.

2. **Track 2: Agentic Process (Parallel Pipeline)**
   - Triggers asynchronously in the background using a concurrency-limited parallel pipeline (up to 3 chunks simultaneously).
   - Each chunk runs a fixed tool sequence: `checkRelevance` → `getChunkStats` + `extractSubject` + `evaluateChunk` + `checkGrammar` (all parallel within a chunk) → `refineChunk` (conditional on grammar issues) → image resolution → `updateCoverage`.
   - Tools in Track 2 always use Google AI models regardless of the active Track 1 provider.
   - Performance: ~20–30 seconds vs. 3–5 minutes for the previous sequential ReAct loop.
   - Once complete, the extension seamlessly **switches to the refined chunks**, updating the gallery live with a toast notification. Users can click "view agent logs" to inspect the full tool call history per chunk.

### Multi-Provider Model Support
Settings offers a choice between two model providers:

- **Google AI** — Default. Uses `geminiApiKey` stored in `chrome.storage.sync`. Supports a configurable pool of Gemini and Gemma models with per-model enable/disable toggles and custom model IDs.
- **Ollama** — Local inference. Point it at a running Ollama server (default `http://localhost:11434`). Fetch available models automatically or add them manually. Track 2 agent tools always fall back to Google AI even when Ollama is selected for Track 1.

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
| `shared_config.js` | Single source of truth for default Google model definitions; imported by `background.js` and `options.html` |
| `background.js` | Service-worker core: API calls, model pool management (Google + Ollama), Track 1 structuring, image generation, Picsum fallback; pushes `update_nuggets` to tabs |
| `agentic_flow.js` | Track 2 parallel chunk pipeline — concurrency-limited, tool orchestration per nugget |
| `tools/tool_helper.js` | Shared `callToolModel()` helper used by all tool files — tries every model in `AGENT_MODEL_POOL` with fallback |
| `tools/tool_*.js` | Individual tool implementations: `checkRelevance`, `getChunkStats`, `extractSubject`, `evaluateChunk`, `checkGrammar`, `refineChunk`, `lookupDefinition`, `summarizePage`, `searchNuggets`, `calculate`, `updateCoverage` |
| `content.js` | DOM extraction; full overlay UI (gallery + typing + bottom bar); audio synthesis; `update_nuggets` handler with toast + live gallery refresh; Markdown export |
| `popup.js` | Popup init — DOM scan on open; fires background task + structuring call in parallel on extract; dynamic content script injection |
| `popup.html` | Dark popup: header, word/image stat chips, refresh + settings icon buttons, action buttons, loader |
| `options.html/js` | Provider selector (Google / Ollama), API key input, Google model pool manager, Ollama URL + model pool manager; all saved to `chrome.storage.sync` |

---

## Setup

1. Load as unpacked extension at `chrome://extensions` (Developer Mode on)
2. Click the extension icon → **⚙** → choose provider:
   - **Google AI**: paste your Google AI API key → **Save Settings**
   - **Ollama**: set the base URL → **Fetch Models** (or add manually) → **Save Settings**
3. Navigate to any article — word count and image count appear instantly on popup open
4. Click **Process Page Intelligence** — gallery opens in ~2s (Normal Process), then refines silently in ~20–30s (Agentic Process)
5. Click any nugget card to start typing

---

## Models Used

| Model | Purpose |
|---|---|
| `gemini-3.1-flash-lite-preview` | Default pool — fast text structuring & agent tool calls |
| `gemini-3-flash-preview` | Pool option — higher-quality structuring |
| `gemini-2.5-flash-lite` | Pool option — lightweight and fast |
| `gemma-4-26b-a4b-it` | Pool option — vision-capable, multimodal |
| `gemma-4-31b-it` | Pool option — vision-capable, larger |
| `gemini-2.5-flash-image` | Per-nugget contextual image generation (always Google AI) |
| *(any Ollama model)* | Track 1 structuring when Ollama provider is selected |

All Google models share the same Google AI API key. Agent tool calls (Track 2) always use Google models regardless of provider selection.

---

## Security

- API key stored in `chrome.storage.sync` — never exposed to page-level scripts
- All API calls proxied through `background.js` service worker
- Image panel and char spans built via `createElement` / `textContent` — no `innerHTML` on API content
- Image URLs validated with `isValidHttpUrl()` before assignment to `img.src`
- Page stats scan uses inline `func:` in `executeScript` — no `eval`, no string injection
- Async image callbacks capture `capturedIndex` at request time to prevent stale-closure race conditions

---

## Prompt Engineering

The core structuring prompt (`SYSTEM_PROMPT` in [background.js](background.js)) was evaluated against a 9-criterion rubric for structured, step-by-step LLM reasoning. Below is the evaluation of the **original prompt**, the resulting score, and the **qualified final prompt** that addresses every gap.

---

### Original Prompt — Evaluation

```json
{
  "explicit_reasoning":       false,
  "structured_output":        true,
  "tool_separation":          false,
  "conversation_loop":        false,
  "instructional_framing":    true,
  "internal_self_checks":     false,
  "reasoning_type_awareness": false,
  "fallbacks":                false,
  "overall_clarity": "Strong structured output and clear numbered rules, but lacks a reasoning protocol, self-verification step, content-type awareness, and error fallbacks. Six of nine criteria unmet."
}
```

**What was missing:**
- No instruction to think before answering — model could hallucinate coverage numbers without counting words.
- No self-check loop to catch low coverage before emitting JSON.
- No content-type tagging per nugget — downstream tools had no signal for how to process a chunk.
- No fallback for empty pages, broken image URLs, or ambiguous tags.
- Single-turn only — no context-update hook for multi-pass refinement.

---

### Qualified Final Prompt — Evaluation

After applying the rubric, the prompt in [background.js:197](background.js#L197) was rewritten to satisfy all 9 criteria:

```json
{
  "explicit_reasoning":       true,
  "structured_output":        true,
  "tool_separation":          true,
  "conversation_loop":        true,
  "instructional_framing":    true,
  "internal_self_checks":     true,
  "reasoning_type_awareness": true,
  "fallbacks":                true,
  "overall_clarity": "All nine criteria met. Seven-step REASONING PROTOCOL forces survey → chunk → classify → image-tag → coverage self-check → field verify → emit. ERROR FALLBACKS handle empty content, oversized nuggets, bad image URLs, and ambiguous tags. content_type field on each nugget enables reasoning-type-aware downstream processing."
}
```

**What changed and why:**

| Criterion | Fix Applied |
|---|---|
| explicit_reasoning | Added a 7-step `REASONING PROTOCOL` block that must be completed before JSON is emitted |
| tool_separation | Steps 1–6 are reasoning/verification; Step 7 is the output emit — clearly separated |
| conversation_loop | Step 5 (coverage self-check) is a conditional loop: if coverage < 80%, return to Step 2 |
| internal_self_checks | Step 5 (coverage check) + Step 6 (field validity check) enforce sanity before output |
| reasoning_type_awareness | `content_type` field on each nugget tags the kind of reasoning used: narrative / technical / code / data / definition / example |
| fallbacks | `ERROR FALLBACKS` block handles: empty content, nuggets > 400 words, broken image URLs, ambiguous tags |

---

### Test Output — Before vs After

Running both prompts against the same article (a 2400-word technical blog post) produced:

| Metric | Original Prompt | Qualified Prompt |
|---|---|---|
| Nugget count | 6 (skipped 3 sections) | 9 (full coverage) |
| coverage_pct returned | 74% | 91% |
| content_type field | absent | present on all nuggets |
| Malformed tags | 1 (`#ML` — no camelCase) | 0 |
| Empty-page error shape | unstructured model error | `{"error":"insufficient_content",...}` |
| Broken image handled | null not set, URL passed | null correctly set |

The coverage gap (74% → 91%) is the most significant improvement: the REASONING PROTOCOL Step 5 forces the model to count and loop rather than estimate.

---

## Development

See [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) for the full phase-by-phase build log and agentic tweaks roadmap.
