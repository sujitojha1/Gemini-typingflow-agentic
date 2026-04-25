import { TOOL_SCHEMAS, dispatchTool } from './tools/tools.js';

const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

const MAX_ITERATIONS = 30;
const TIMEOUT_MS     = 120_000;

// ─── Action click → toggle panel in active tab ───────────────────────────────

chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_PANEL' }).catch(() => {
    // Content script not yet ready on this page — inject it first
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] })
      .then(() => chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_PANEL' }))
      .catch(console.error);
  });
});

// ─── Message handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case 'GET_API_KEY':
      chrome.storage.local.get('geminiApiKey', (d) =>
        sendResponse({ key: d.geminiApiKey || '' })
      );
      return true; // async

    case 'SAVE_API_KEY':
      chrome.storage.local.set({ geminiApiKey: msg.key }, () => sendResponse({ ok: true }));
      return true;

    case 'RUN_AGENT':
      runAgentLoop(msg.text, msg.prompt, sender.tab.id);
      break;
  }
});

// ─── Agent loop ───────────────────────────────────────────────────────────────

async function runAgentLoop(text, userPrompt, tabId) {
  const { geminiApiKey } = await chrome.storage.local.get('geminiApiKey');
  if (!geminiApiKey) {
    send(tabId, { type: 'AGENT_ERROR', message: 'No API key set. Click the extension icon to configure.' });
    return;
  }

  const messages = [
    { role: 'user', parts: [{ text: buildSystemPrompt(text, userPrompt) }] }
  ];

  let iterations = 0;
  const deadline = Date.now() + TIMEOUT_MS;

  while (iterations < MAX_ITERATIONS) {
    if (Date.now() > deadline) {
      send(tabId, { type: 'AGENT_ERROR', message: 'Agent timed out after 2 minutes.' });
      return;
    }
    iterations++;

    let response;
    try {
      response = await fetch(GEMINI_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': geminiApiKey },
        body: JSON.stringify({
          contents: messages,
          tools: [{ functionDeclarations: TOOL_SCHEMAS }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 4096 }
        })
      });
    } catch (err) {
      send(tabId, { type: 'AGENT_ERROR', message: `Network error: ${err.message}` });
      return;
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      send(tabId, { type: 'AGENT_ERROR', message: `Gemini API error ${response.status}: ${body.slice(0, 200)}` });
      return;
    }

    const data      = await response.json();
    const candidate = data.candidates?.[0];
    if (!candidate) {
      send(tabId, { type: 'AGENT_ERROR', message: 'Empty response from Gemini.' });
      return;
    }

    const parts          = candidate.content?.parts || [];
    const fnCallParts    = parts.filter(p => p.functionCall);
    const textParts      = parts.filter(p => p.text);

    // No function calls → final answer
    if (fnCallParts.length === 0) {
      const finalText = textParts.map(p => p.text).join('\n').trim();
      send(tabId, { type: 'AGENT_DONE', text: finalText });
      return;
    }

    // Append the model's turn (contains the function call parts)
    messages.push({ role: 'model', parts });

    // Execute each tool call and collect responses
    const fnResponseParts = [];
    for (const part of fnCallParts) {
      const { name, args } = part.functionCall;
      let result;
      try {
        result = await dispatchTool(name, args, geminiApiKey);
      } catch (err) {
        result = { error: err.message };
      }
      send(tabId, { type: 'AGENT_STEP', name, args, result });
      fnResponseParts.push({ functionResponse: { name, response: result } });
    }

    // Append all function responses in a single user turn
    messages.push({ role: 'user', parts: fnResponseParts });
  }

  send(tabId, { type: 'AGENT_ERROR', message: 'Agent reached the 30-iteration limit.' });
}

function send(tabId, msg) {
  chrome.tabs.sendMessage(tabId, msg).catch(() => {});
}

// ─── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(text, userPrompt) {
  const hasText = text && text.trim().length > 0;
  return `You are a writing analysis agent embedded in the TypingFlow Chrome extension.

Analyse the user's text by following these stages IN ORDER:

Stage 1 — call count_stats with the FULL text to get baseline statistics.
Stage 2 — call chunk_text with the FULL text (max_words=120) to split it into chunks.
Stage 3 — for EACH chunk returned by chunk_text, call summarize_chunk once.
Stage 4 — for EACH chunk returned by chunk_text, call score_chunk once.
Stage 5 — after ALL chunks have been summarised and scored, write the final report:
  • Overall score: mean of all chunk scores across all three dimensions, shown as X.X / 10
  • Top 3 specific issues ranked by severity
  • 2–3 concrete rewrite suggestions with brief before/after examples

Rules:
- Do not skip any chunk in stages 3 and 4.
- Do not write the final report until every tool call for every chunk is complete.
- In the final report, use clear Markdown headings and bullet points.

${hasText
    ? `User's text (captured from their active text field):\n---\n${text}\n---`
    : 'No text was captured from the page. Ask the user to paste their text in the prompt or focus a text field before running.'}

User instruction: ${userPrompt || 'Analyse my writing and give me a full report.'}`;
}
