# Development Plan — Gemini TypingFlow Agentic

## Goal

Extend the Gemini-typingflow Chrome extension (assignment 2) into a fully agentic AI plugin (assignment 3). The extension must:

- Run a multi-turn Gemini conversation with tool-calling enabled
- Execute at least 3 custom tool functions
- Display the full reasoning chain (each tool call + result), not just the final answer
- Maintain complete conversation history across every LLM hop

---

## Starting Point

Base repo: [Gemini-typingflow](https://github.com/sujitojha1/Gemini-typingflow)

That repo already has:
- `manifest.json` with basic permissions
- A content script that detects active text fields
- A popup / panel that sends a prompt to Gemini and shows the reply

What we are adding: agent loop, tool definitions, and a real-time reasoning chain UI.

---

## Phase 1 — Repository Setup (Day 1)

**Tasks**
- [ ] Clone base repo into `Gemini-typingflow-agentic`
- [ ] Audit existing `manifest.json` — add `storage`, `scripting`, `tabs` permissions if missing
- [ ] Create folder structure shown in README (`tools/`, `panel/`)
- [ ] Add `.gitignore` (node_modules, secrets)
- [ ] Confirm extension loads in Chrome with no console errors

**Files touched**
- `manifest.json`
- `.gitignore`

**Acceptance check:** Extension loads, popup opens, existing text-insertion still works.

---

## Phase 2 — Tool Implementations (Days 2–3)

Each tool is a plain JavaScript function plus a JSON schema declaration for the Gemini API.

### Tool 1: `evaluate_expression`

**File:** `tools/evaluate_expression.js`

```js
// Schema (sent to Gemini as a function declaration)
{
  name: "evaluate_expression",
  description: "Evaluates a mathematical expression and returns a numeric result.",
  parameters: {
    type: "OBJECT",
    properties: {
      expression: { type: "STRING", description: "Math expression, e.g. 'e^1 + e^2 + e^3'" }
    },
    required: ["expression"]
  }
}

// Implementation
function evaluate_expression({ expression }) {
  // Use mathjs (CDN) for safe evaluation — no eval()
  return { result: math.evaluate(expression) };
}
```

**Test case:** `evaluate_expression({ expression: "e^1+e^1+e^2+e^3+e^5+e^8" })` → `49.33`

---

### Tool 2: `get_stock_price`

**File:** `tools/get_stock_price.js`

```js
{
  name: "get_stock_price",
  description: "Returns daily OHLCV stock data for a ticker over a date range.",
  parameters: {
    type: "OBJECT",
    properties: {
      ticker:     { type: "STRING", description: "Stock symbol, e.g. AAPL" },
      start_date: { type: "STRING", description: "YYYY-MM-DD" },
      end_date:   { type: "STRING", description: "YYYY-MM-DD" }
    },
    required: ["ticker", "start_date", "end_date"]
  }
}

async function get_stock_price({ ticker, start_date, end_date }) {
  const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY`
            + `&symbol=${ticker}&apikey=${FINANCE_API_KEY}`;
  const data = await fetch(url).then(r => r.json());
  // filter to requested date range, return array of { date, open, close, volume }
}
```

**Test case:** `get_stock_price({ ticker: "AAPL", start_date: "2025-03-01", end_date: "2025-03-31" })`

---

### Tool 3: `search_news`

**File:** `tools/search_news.js`

```js
{
  name: "search_news",
  description: "Searches for recent news articles matching a query.",
  parameters: {
    type: "OBJECT",
    properties: {
      query:     { type: "STRING", description: "Search term, e.g. 'Ola stock'" },
      days_back: { type: "INTEGER", description: "How many days back to search" }
    },
    required: ["query", "days_back"]
  }
}

async function search_news({ query, days_back }) {
  const from = new Date(Date.now() - days_back * 86400000).toISOString().slice(0,10);
  const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}`
            + `&from=${from}&sortBy=publishedAt&apiKey=${NEWS_API_KEY}`;
  const data = await fetch(url).then(r => r.json());
  return data.articles.slice(0, 10).map(a => ({
    title: a.title, url: a.url, published_at: a.publishedAt, summary: a.description
  }));
}
```

**Test case:** `search_news({ query: "Tesla earnings", days_back: 14 })`

---

**Phase 2 acceptance check:** Each function can be called from the browser console and returns valid data.

---

## Phase 3 — Agent Loop in background.js (Days 3–4)

The agent loop lives in the service worker so it can make `fetch` calls across origins.

```
background.js
  ├── onMessage listener (receives prompt from panel)
  ├── runAgentLoop(userMessage)
  │     ├── messages = [{ role: "user", parts: [{ text }] }]
  │     ├── loop:
  │     │     POST to Gemini /generateContent with tools declared
  │     │     if candidate.finishReason === "STOP" → done
  │     │     if candidate has functionCall parts:
  │     │           execute matching tool function
  │     │           push { role: "model", parts: [functionCallPart] }
  │     │           push { role: "user", parts: [{ functionResponse: { name, response } }] }
  │     │           sendStep(toolName, args, result)  ← streams to panel
  │     │           continue loop
  └── sendFinalAnswer(text)
```

**Key details:**
- `messages` array is rebuilt and passed in full on every Gemini call — this is how history is preserved
- `sendStep()` uses `chrome.tabs.sendMessage` to push each intermediate step to `panel.js` in real time
- Cap loop iterations at 10 to avoid infinite cycles

**Files:** `background.js`, `tools/tools.js` (barrel that exports all tool schemas + implementations)

---

## Phase 4 — Panel UI (Days 4–5)

### Layout (panel.html)

```
┌── TypingFlow Agent ──────────────────┐
│  [text input]           [Send]        │
├───────────────────────────────────────┤
│  Reasoning Chain                      │
│  ┌─ Step 1 ────────────────────────┐ │
│  │  Tool: evaluate_expression       │ │
│  │  Args: { expression: "..." }     │ │
│  │  Result: 49.33              ▼    │ │
│  └──────────────────────────────────┘ │
│  ┌─ Step 2 ────────────────────────┐ │
│  │  Tool: search_news               │ │
│  │  ...                        ▼    │ │
│  └──────────────────────────────────┘ │
├───────────────────────────────────────┤
│  Final Answer                         │
│  [answer text]          [Copy]        │
└───────────────────────────────────────┘
```

### panel.js responsibilities

- Listen for `chrome.runtime.onMessage` events of type `AGENT_STEP` → append a step card
- Listen for `AGENT_DONE` → render final answer, enable Copy button
- Copy button inserts text into the last focused text field via `content.js`

### panel.css

- Step cards use a left border color to distinguish tool vs. LLM commentary
- Collapsible raw JSON section inside each card (click to expand)
- Spinner while agent is running

---

## Phase 5 — Integration & End-to-End Testing (Day 5–6)

**Scenario A — Math:** 
Prompt: "Calculate the sum of e raised to each of the first 6 Fibonacci numbers"
Expected: Agent calls `evaluate_expression` once, returns ≈49.33

**Scenario B — Stock Research:**
Prompt: "Search news about Tesla in the last 14 days and compare with its stock price movement"
Expected: Agent calls `search_news`, then `get_stock_price`, then synthesizes a written summary linking headlines to price dates

**Scenario C — Pure Calculation Chain:**
Prompt: "What is (Fibonacci(10))^2 + sqrt(144)?"
Expected: Agent may call `evaluate_expression` twice or once with a combined expression

For each scenario, capture the full LLM log (request + response JSON for each hop) for submission.

---

## Phase 6 — Polish & Submission (Day 7)

- [ ] Clip a YouTube demo video: show the panel opening, a complex query, each step card appearing, and the final answer being copied into a text field
- [ ] Copy-paste the raw LLM logs (all request/response JSON) from the DevTools Network tab
- [ ] Tag the release `v1.0.0` on GitHub
- [ ] Submit video link + logs

---

## File Inventory (target state)

```
Gemini-typingflow-agentic/
├── manifest.json
├── background.js            ← agent loop
├── content.js               ← page injection, text field focus tracking
├── panel/
│   ├── panel.html
│   ├── panel.js
│   └── panel.css
├── tools/
│   ├── tools.js             ← barrel: exports TOOL_SCHEMAS, dispatchTool()
│   ├── evaluate_expression.js
│   ├── get_stock_price.js
│   └── search_news.js
├── icons/
│   └── icon128.png
├── tests/
│   ├── evaluate_expression.test.js
│   ├── get_stock_price.test.js
│   └── search_news.test.js
├── README.md
└── DEV_PLAN.md
```

---

## Key Constraints

| Constraint | Decision |
|---|---|
| No backend server | All API calls made from background service worker using `fetch` |
| API keys must not be in source | Stored via `chrome.storage.local`, entered once in options page |
| No `eval()` for math | Use `mathjs` library (loaded via `importScripts` in service worker) |
| Loop safety | Hard cap at 10 iterations; surface error if hit |
| History fidelity | Full `messages` array passed on every Gemini call — no summarization |

---

## Dependencies

| Library | Purpose | How Loaded |
|---|---|---|
| [math.js](https://mathjs.org) | Safe expression evaluation | CDN script tag in panel.html + importScripts in background.js |
| Gemini API | LLM + function calling | Direct `fetch` — no SDK needed |
| NewsAPI.org | News search | Direct `fetch` |
| Alpha Vantage | Stock price data | Direct `fetch` |

---

## Risk & Mitigations

| Risk | Mitigation |
|---|---|
| NewsAPI free tier rate limit | Cache results in `chrome.storage.session` keyed by query + date |
| Alpha Vantage 5 req/min limit | Debounce tool calls; show spinner |
| Gemini misidentifies tool args | Add strict JSON schema types + required fields to each declaration |
| Infinite agent loop | Max 10 iterations + timeout of 60 s |
| CORS errors on finance APIs | These calls go through background service worker (not content script), which bypasses page CORS |
