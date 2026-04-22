# Gemini TypingFlow — Agentic Edition

A Chrome extension that embeds a **Gemini-powered AI agent** directly into any text field on the web. Unlike a plain chat assistant, the agent autonomously breaks down complex requests into tool calls, runs them in sequence, and shows you every step of its reasoning before delivering a final answer.

---

## What Makes This "Agentic"

A standard LLM call is one round-trip: you send a prompt, you get text back. An agent loop is different:

```
User Prompt
   ↓
LLM → decides to call a tool
   ↓
Tool executes → result returned to LLM
   ↓
LLM → decides to call another tool (or finish)
   ↓
... repeat until LLM produces a final answer
```

The extension renders **every hop** in the chain — which tool was called, with what arguments, and what came back — so the reasoning is auditable and not just a black box.

---

## Core Use Cases

| Request | How the Agent Handles It |
|---|---|
| "Calculate the sum of exponential values of the first 6 Fibonacci numbers" | Calls `compute_fibonacci`, then `evaluate_expression`, returns verified result |
| "Find top news about Ola stock in the last 30 days and link it to price changes" | Calls `search_news` → `get_stock_price` → `correlate_events`, narrates findings |
| "Track AAPL and notify me when it crosses $200" | Calls `get_stock_price` on a polling interval, surfaces alert in the panel |

---

## Three Custom Tool Functions

These are the agent's capabilities — each is a JavaScript function registered with the Gemini tool-calling API.

### 1. `search_news(query, days_back)`
Queries a news aggregation endpoint for headlines and summaries matching `query` over the past `days_back` days. Returns a list of `{ title, url, published_at, summary }` objects.

**Why it exists:** The base LLM has a training cutoff and cannot retrieve live news. This tool bridges that gap.

### 2. `get_stock_price(ticker, start_date, end_date)`
Fetches OHLCV (open/high/low/close/volume) data for a given stock ticker from a public finance API. Returns daily records over the requested range.

**Why it exists:** Price data is live and numerical — hallucination-prone without grounding. A deterministic API call is always more accurate.

### 3. `evaluate_expression(expression)`
Safely evaluates a mathematical expression string (e.g. `"e^1 + e^1 + e^2 + e^3 + e^5 + e^8"`) and returns the numeric result. Handles constants (`e`, `pi`), powers, and standard functions.

**Why it exists:** LLMs make arithmetic errors on non-trivial expressions. Offloading to a sandboxed evaluator guarantees a correct number.

---

## Architecture

```
Chrome Extension
├── manifest.json          — permissions, service worker, content script config
├── background.js          — service worker: runs the agent loop, calls Gemini API
├── content.js             — injected into every page: captures selected text, renders panel
├── panel/
│   ├── panel.html         — floating side panel UI
│   ├── panel.js           — receives agent steps, renders reasoning chain
│   └── panel.css          — styling for step cards
└── tools/
    ├── tools.js            — tool definitions (schema + implementations)
    ├── search_news.js      — news tool
    ├── get_stock_price.js  — finance tool
    └── evaluate_expression.js — math tool
```

### Agent Loop (background.js)

```
1. Receive user message from panel
2. Build messages array  [ { role: "user", content: ... } ]
3. POST to Gemini API with tool declarations
4. If response.stopReason === "TOOL_USE":
     a. Parse toolUse blocks
     b. Execute matching local function
     c. Append { role: "tool", content: result } to messages
     d. Go to step 3
5. If response.stopReason === "END_TURN":
     a. Extract final text
     b. Send full trace + answer to panel
```

All intermediate steps (tool name, args, result) are streamed to `panel.js` so the UI updates in real time.

---

## Setup

### Prerequisites
- Google Chrome 120+
- A [Gemini API key](https://aistudio.google.com/app/apikey)
- Node.js 18+ (for optional local dev server)

### Load the Extension

```bash
git clone https://github.com/sujitojha1/Gemini-typingflow-agentic.git
cd Gemini-typingflow-agentic
```

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select the repo folder
4. Click the extension icon → paste your Gemini API key → Save

### Configure API Keys (optional tools)

Create a `.env`-style config (stored in `chrome.storage.local`, never sent anywhere except the declared APIs):

| Key | Used By |
|---|---|
| `GEMINI_API_KEY` | All LLM calls |
| `NEWS_API_KEY` | `search_news` tool (NewsAPI.org) |
| `FINANCE_API_KEY` | `get_stock_price` tool (Alpha Vantage) |

---

## Usage

1. On any webpage, **select some text** or click the TypingFlow icon in the toolbar.
2. A floating panel opens on the right side of the page.
3. Type a complex query (e.g., "Search for TSLA news last 2 weeks and compare with its price movement").
4. Watch the **reasoning chain** unfold — each tool call appears as a collapsible card showing:
   - Tool name and input arguments
   - Raw tool output
   - LLM commentary on the result
5. The final answer appears at the bottom with a "Copy" button to insert it back into the active text field.

---

## Development

```bash
# Lint
npx eslint .

# Run unit tests for tools
node --test tests/
```

After any file change, go to `chrome://extensions` and click the **refresh** icon on the extension card — no rebuild step required.

---

## Reasoning Chain UI

Each agent step is rendered as a timeline card:

```
┌─────────────────────────────────────┐
│ 🔧  Tool: evaluate_expression        │
│  Args: { expression: "e^1+e^1+..." } │
│  Result: 49.33                       │
└─────────────────────────────────────┘
         ↓
┌─────────────────────────────────────┐
│ 💬  LLM Commentary                  │
│  "The sum equals 49.33. Now I will  │
│   search for related news..."        │
└─────────────────────────────────────┘
         ↓
┌─────────────────────────────────────┐
│  Final Answer                        │
│  ...                                 │
└─────────────────────────────────────┘
```

---

## License

MIT — see [LICENSE](./LICENSE).
