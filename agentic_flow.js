// Depends on: background.js globals (MODEL_POOL, GEMMA_MODEL, callGeminiWithModel, callGemmaAPI)
// Depends on: tools/tool_*.js (toolCalculate, toolSearchNuggets, toolSummarizePage, toolLookupDefinition)

// ── Agent utilities ──────────────────────────────────────────────────────────

function agentBroadcast(tabId, task, model, detail = '') {
    const msg = { action: 'agent_status', task, model, detail };
    chrome.tabs.sendMessage(tabId, msg, () => { chrome.runtime.lastError; });
    chrome.runtime.sendMessage(msg, () => { chrome.runtime.lastError; });
}

function tabMessage(tabId, msg) {
    return new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, msg, (resp) => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(resp);
        });
    });
}

async function extractFromTab(tabId) {
    try {
        const resp = await tabMessage(tabId, { action: 'extract_content' });
        if (resp?.payload) return resp.payload;
    } catch (_) {}
    // content script not loaded — inject it
    await new Promise((resolve, reject) => {
        chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }, r => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(r);
        });
    });
    await new Promise(r => setTimeout(r, 300));
    const resp = await tabMessage(tabId, { action: 'extract_content' });
    return resp?.payload || null;
}

function callModelForStructuring(payload, model) {
    return model.vision ? callGemmaAPI(payload) : callGeminiWithModel(payload, model.id);
}

// ── LLM Response Parser ──────────────────────────────────────────────────────

function parseLLMResponse(text) {
    text = text.trim();
    if (text.startsWith('```')) {
        const lines = text.split('\n');
        const end = lines[lines.length - 1].trim() === '```' ? lines.length - 1 : lines.length;
        text = lines.slice(1, end).join('\n').trim();
        if (text.startsWith('json')) text = text.slice(4).trim();
    }
    try { return JSON.parse(text); } catch (_) {}
    const m = text.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch (_) {} }
    throw new Error('Cannot parse: ' + text.slice(0, 200));
}

// ── Agent Tools Registry ─────────────────────────────────────────────────────

const AGENT_TOOLS = {
    calculate:        toolCalculate,
    searchNuggets:    toolSearchNuggets,
    summarizePage:    toolSummarizePage,
    lookupDefinition: toolLookupDefinition,
};

// ── Agent System Prompt ──────────────────────────────────────────────────────

const AGENT_SYSTEM_PROMPT = `You are a helpful AI agent that can use tools to answer questions about web page content.

You have access to the following tools:

1. calculate(expression: string)
   Evaluate a math expression. Supports: +, -, *, /, **, %, sqrt, abs, round, floor, ceil, sin, cos, tan, log, exp, pow, min, max, sum.
   Example: calculate({"expression": "sum(exp(1), exp(1), exp(2), exp(3), exp(5), exp(8))"})

2. searchNuggets(query: string)
   Search the structured knowledge nuggets extracted from the current page.
   Example: searchNuggets({"query": "transformer attention"})

3. summarizePage({})
   Get the TL;DR and tags for the current page.
   Example: summarizePage({})

4. lookupDefinition(term: string)
   Find sentences in the page that explain a specific term or concept.
   Example: lookupDefinition({"term": "backpropagation"})

Respond in ONE of these two JSON formats ONLY:

To call a tool:
{"tool_name": "<name>", "tool_arguments": {"<arg>": "<value>"}}

To give the final answer:
{"answer": "<your complete answer>"}

RULES: Respond with ONLY the JSON. No markdown, no extra text. Use tools for page info and math. ALWAYS use calculate for numbers.`;

// ── Agent Pipeline ───────────────────────────────────────────────────────────

async function runAgentPipeline(tabId) {
    const { geminiApiKey } = await chrome.storage.sync.get('geminiApiKey');
    if (!geminiApiKey) {
        agentBroadcast(tabId, 'error', null, 'API key not configured');
        return;
    }

    agentBroadcast(tabId, 'Step 1: Create an agent session', '—');
    const sessionId = 'session_' + Date.now();
    await new Promise(r => setTimeout(r, 600));

    agentBroadcast(tabId, 'Step 2: Initial Content Storage', '—');
    let payload;
    try {
        payload = await extractFromTab(tabId);
    } catch (e) {
        agentBroadcast(tabId, 'error', null, 'injection blocked by Chrome');
        return;
    }
    if (!payload?.length) {
        agentBroadcast(tabId, 'error', null, 'no extractable content');
        return;
    }

    await chrome.storage.local.set({ [`tf_agent_payload_${sessionId}`]: payload, tf_agent_tab: tabId });
    await new Promise(r => setTimeout(r, 600));

    let structureResult = null;
    let usedModel = null;
    for (const model of MODEL_POOL) {
        agentBroadcast(tabId, 'Step 3: Structuring nuggets', model.label);
        try {
            const result = await callModelForStructuring(payload, model);
            if (result.success) { structureResult = result; usedModel = model; break; }
            console.warn(`[agent] ${model.label} failed:`, result.error);
        } catch (e) {
            console.warn(`[agent] ${model.label} threw:`, e.message);
        }
    }
    if (!structureResult) {
        agentBroadcast(tabId, 'error', null, 'all models exhausted');
        return;
    }

    agentBroadcast(tabId, 'Step 4: Mounting gallery', usedModel.label);
    await tabMessage(tabId, { action: 'mount_ui', data: structureResult.api_response })
        .catch(() => {});
    chrome.tabs.sendMessage(tabId, { action: 'open_overlay' }, () => { chrome.runtime.lastError; });

    chrome.runtime.sendMessage({ action: 'agent_close_popup' }, () => { chrome.runtime.lastError; });

    await chrome.storage.local.set({
        tf_agent_nuggets: structureResult.api_response.nuggets || [],
        tf_agent_session: {
            timestamp: Date.now(),
            model: usedModel.label,
            nuggetCount: structureResult.api_response.nuggets?.length,
            tldr: structureResult.api_response.tldr,
            tags: structureResult.api_response.tags,
            star_rating: structureResult.api_response.star_rating,
        }
    });

    agentBroadcast(tabId, 'complete (Steps 1-4 Done)', usedModel.label,
        `${structureResult.api_response.nuggets?.length} nuggets`);

    if (usedModel.id !== GEMMA_MODEL) {
        runAgenticParallelTrack(tabId, payload);
    }
}

// ── Parallel Agentic Track (function-calling orchestration) ──────────────────

async function runAgenticParallelTrack(tabId, payload) {
    const { geminiApiKey } = await chrome.storage.sync.get('geminiApiKey');
    if (!geminiApiKey) return;

    let instructText = "";
    try {
        const url = chrome.runtime.getURL('instruct.md');
        const res = await fetch(url);
        instructText = await res.text();
    } catch(e) {
        console.warn("[agent loop] Failed to read instruct.md", e);
        return;
    }

    const tools = [{
        functionDeclarations: [
            {
                name: "createSession",
                description: "Generate a unique timestamp-based sessionId and securely set up a temporary workspace folder to isolate this processing run."
            },
            {
                name: "saveInitialContent",
                description: "Securely cache the extracted payload (text blocks and image URLs) into the temporary folder. This cached file serves as the raw material for the agent's deep processing.",
                parameters: {
                    type: "OBJECT",
                    properties: { tempFolderPath: { type: "STRING" } },
                    required: ["tempFolderPath"]
                }
            },
            {
                name: "processChunk",
                description: "Pass the saved chunk data and instruct the agent to run a parallel background task using the gemma-4-31b-it model. The agent must deeply refine the structured nuggets by processing text and base64 images simultaneously for accurate visual mapping."
            },
            {
                name: "stateHandoff",
                description: "Ensure the extension seamlessly switches to these later chunks without interrupting the user's active session."
            }
        ]
    }];

    const modelId = "gemini-3.1-flash-lite-preview";
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${geminiApiKey}`;

    let history = [
        { role: "user", parts: [{ text: `You are the orchestrator for the parallel agentic track. Follow these instructions step-by-step by calling the provided tools sequentially:\n\n${instructText}` }] }
    ];

    let gemmaRefinedData = null;

    for (let i = 0; i < 10; i++) {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: history, tools: tools })
        });

        if (!response.ok) {
            console.warn("[agent loop] API error:", await response.text());
            break;
        }

        const data = await response.json();
        const candidate = data.candidates?.[0];
        if (!candidate) break;

        history.push(candidate.content);

        const parts = candidate.content.parts || [];
        const functionCallPart = parts.find(p => p.functionCall);

        if (functionCallPart) {
            const name = functionCallPart.functionCall.name;
            agentBroadcast(tabId, `Agent Call: ${name}`, modelId);

            let funcResult = { status: "Success" };

            if (name === "createSession") {
                funcResult = { sessionId: "session_" + Date.now(), tempFolderPath: "/tmp/agent_workspace" };
            } else if (name === "saveInitialContent") {
                funcResult = { cachedBytes: JSON.stringify(payload).length };
            } else if (name === "processChunk") {
                agentBroadcast(tabId, 'refining with Gemma 4', 'Gemma 4 31B');
                const gemmaRes = await callGemmaAPI(payload);
                if (gemmaRes.success) {
                    gemmaRefinedData = gemmaRes.api_response;
                    funcResult = { status: "Refined", nuggetCount: gemmaRefinedData.nuggets?.length };
                } else {
                    funcResult = { status: "Failed", error: gemmaRes.error };
                }
            } else if (name === "stateHandoff") {
                if (gemmaRefinedData) {
                    chrome.tabs.sendMessage(tabId,
                        { action: 'update_nuggets', data: gemmaRefinedData },
                        () => { chrome.runtime.lastError; });
                    agentBroadcast(tabId, 'refined', 'Gemma 4 31B');
                }
                funcResult = { status: "Handoff Complete" };
            }

            history.push({
                role: "user",
                parts: [{ functionResponse: { name: name, response: funcResult } }]
            });

            if (name === "stateHandoff") break;
        } else {
            history.push({ role: "user", parts: [{ text: "Please continue executing the next step using function calling." }]});
        }
    }
}

// ── Agent Loop (ReAct-style tool use) ────────────────────────────────────────

async function runAgentLoop(tabId, userQuery, maxIter = 6) {
    const { geminiApiKey } = await chrome.storage.sync.get('geminiApiKey');
    if (!geminiApiKey) {
        chrome.runtime.sendMessage({ action: 'agent_loop_step', step: { type: 'error', text: 'API key not configured' } }, () => { chrome.runtime.lastError; });
        return;
    }

    const modelId = 'gemini-3.1-flash-lite-preview';
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${geminiApiKey}`;

    const messages = [
        { role: 'system', content: AGENT_SYSTEM_PROMPT },
        { role: 'user',   content: userQuery },
    ];

    agentBroadcast(tabId, 'agent loop: starting', modelId);

    for (let iter = 0; iter < maxIter; iter++) {
        let prompt = '';
        for (const msg of messages) {
            if      (msg.role === 'system')    prompt += msg.content + '\n\n';
            else if (msg.role === 'user')      prompt += `User: ${msg.content}\n\n`;
            else if (msg.role === 'assistant') prompt += `Assistant: ${msg.content}\n\n`;
            else if (msg.role === 'tool')      prompt += `Tool Result: ${msg.content}\n\n`;
        }

        let responseText;
        try {
            const res = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error?.message || res.statusText);
            }
            const data = await res.json();
            responseText = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!responseText) throw new Error('Empty response from LLM');
        } catch (e) {
            chrome.runtime.sendMessage({ action: 'agent_loop_step', step: { type: 'error', text: e.message } }, () => { chrome.runtime.lastError; });
            return;
        }

        let parsed;
        try {
            parsed = parseLLMResponse(responseText);
        } catch (_) {
            messages.push({ role: 'assistant', content: responseText });
            messages.push({ role: 'user',      content: 'Please respond with valid JSON only. No markdown, no extra text.' });
            continue;
        }

        if (parsed.answer) {
            chrome.runtime.sendMessage({
                action: 'agent_loop_step',
                step: { type: 'answer', text: parsed.answer, iteration: iter + 1 }
            }, () => { chrome.runtime.lastError; });
            agentBroadcast(tabId, 'agent loop: complete', modelId);
            return;
        }

        if (parsed.tool_name) {
            const toolName = parsed.tool_name;
            const toolArgs = parsed.tool_arguments || {};

            if (!(toolName in AGENT_TOOLS)) {
                const errMsg = JSON.stringify({ error: `Unknown tool: ${toolName}. Available: ${Object.keys(AGENT_TOOLS).join(', ')}` });
                messages.push({ role: 'assistant', content: responseText });
                messages.push({ role: 'tool',      content: errMsg });
                continue;
            }

            agentBroadcast(tabId, `loop: ${toolName}`, modelId);
            const toolResult = await Promise.resolve(AGENT_TOOLS[toolName](toolArgs));

            chrome.runtime.sendMessage({
                action: 'agent_loop_step',
                step: { type: 'tool_call', toolName, toolArgs, toolResult, iteration: iter + 1 }
            }, () => { chrome.runtime.lastError; });

            messages.push({ role: 'assistant', content: responseText });
            messages.push({ role: 'tool',      content: toolResult });
            continue;
        }

        messages.push({ role: 'assistant', content: responseText });
        messages.push({ role: 'user',      content: 'Please respond with valid JSON only.' });
    }

    chrome.runtime.sendMessage({
        action: 'agent_loop_step',
        step: { type: 'error', text: 'Max iterations reached without a final answer.' }
    }, () => { chrome.runtime.lastError; });
}
