# Session 3: Developer Foundations & Your First Agent
## EAG V3 — Session 3: Developer Foundations & Introduction to Agentic AI

Welcome back! In the last two sessions, we looked at transformers, attention, embeddings, tokenization, scaling laws, and alignment. You now have some understanding about WHY LLMs work. Today we take a very important step — we go from understanding LLMs to converting them into Agents. By the end of today, you will have built your first AI agent.

---

## Part 1: Python That Helps You Debug Agentic Systems

Claude Code, Cursor, Copilot — these tools are incredible. But they've created a dangerous illusion: people are shipping code they cannot read and building systems they cannot debug.

In this course, you'll build systems where an LLM makes decisions in a loop, calls functions, gets results, and makes more decisions. When this goes wrong, you can't just re-prompt your Copilot — you need to pause execution, inspect the state, and trace what happened.

### `code.interact()` — Your Emergency Inspection Window

The `code.interact()` function allows you to drop into an interactive shell at any point in your script.

```python
import code

x = 42
y = "Hello TSAI"

# Drop into interactive shell
code.interact(local=locals())
print("This will execute if you use Ctrl+D")
```

- Exiting with `exit()` terminates the script immediately.
- Exiting with `Ctrl+D` resumes execution.

**Agent debugging example:**

```python
import code
import json

def agent_loop(user_query):
    conversation = [{"role": "user", "content": user_query}]
    while True:
        llm_response = call_llm(conversation)
        # FREEZE HERE - inspect what the LLM actually said
        code.interact(local=locals())
        parsed = json.loads(llm_response)
        if parsed.get("tool_name"):
            result = call_tool(parsed["tool_name"], parsed["arguments"])
            conversation.append({"role": "tool", "content": result})
        else:
            return parsed["answer"]
```

---

### `pdb` — Python's Built-In Debugger

```python
from pdb import set_trace

x = 10
set_trace()  # debugger starts here
y = 20
print(x + y)
```

**Essential `pdb` commands:**

| Command | Description |
|---------|-------------|
| `c` or `continue` | Resume execution until the next breakpoint |
| `h` or `help` | Show available commands |
| `s` or `step` | Execute the next line and step INTO functions |
| `n` or `next` | Execute the next line but DON'T step into functions |
| `p variable` | Print the value of a variable |
| `pp variable` | Pretty-print variable |
| `q` or `quit` | Quit the debugger and stop execution |
| `b 10` | Set a breakpoint at line 10 |
| `cl` | Clear all breakpoints |

In Python 3.7+, you can use `breakpoint()` instead of importing pdb:

```python
x = 10
breakpoint()  # same as from pdb import set_trace; set_trace()
y = 20
```

**Comparison: `pdb` vs `code.interact()`**

| Feature | pdb Debugger | code.interact() |
|---------|-------------|----------------|
| Pause Execution | Yes (step-by-step) | Yes (interactive shell) |
| Step Through Code? | Yes | No |
| Inspect Variables? | Yes (`p var`) | Yes |
| Modify Variables? | Yes | Yes |
| Continue Execution? | Yes (`c`) | No (unless in a function) |
| Set Breakpoints? | Yes (`b line#`) | No |
| Best Use Case? | Debugging (tracing execution) | Exploring variables at a point |

---

### Python `async` and `await` — Because LLMs Are Slow

A single LLM API call takes 1–5 seconds. If your agent needs to call the LLM 5 times, that's up to 25 seconds doing nothing. You need `async`.

**Blocking version (~4 seconds):**

```python
import time

def say_hello():
    time.sleep(2)
    print("Hello World!")

def say_good_bye():
    time.sleep(2)
    print("GoodBye World!")

start = time.time()
say_hello()
say_good_bye()
print(f"Total time: {time.time() - start:.2f} seconds")
```

**Non-blocking version (~2 seconds):**

```python
import asyncio
import time

async def say_hello():
    await asyncio.sleep(2)
    print("Hello World!")

async def say_good_bye():
    await asyncio.sleep(2)
    print("GoodBye World!")

async def main():
    start = time.time()
    await asyncio.gather(say_hello(), say_good_bye())
    print(f"Total time: {time.time() - start:.2f} seconds")

asyncio.run(main())
```

Key concepts:
- `async def` — Defines an asynchronous function (a coroutine)
- `await` — Pauses execution until an async task completes, but lets OTHER tasks run
- `asyncio.run()` — Starts the event loop
- `asyncio.gather()` — Runs multiple async tasks concurrently

> **Common mistake:** Forgetting `await` when calling an async function gives you a coroutine object, not the response!

---

### New Python Essentials for Agentic Systems

#### `try/except` — Because Everything Can Fail

```python
import json

llm_response = '```json\n{"tool": "calculate", "args": {"expr": "2+2"}}\n```'

try:
    data = json.loads(llm_response)
except json.JSONDecodeError:
    cleaned = llm_response.strip().strip('`').strip()
    if cleaned.startswith('json'):
        cleaned = cleaned[4:].strip()
    data = json.loads(cleaned)
```

#### Type Hints + Dataclasses — Contracts Between Your LLM and Tools

```python
from dataclasses import dataclass

@dataclass
class ToolCall:
    name: str
    arguments: dict

@dataclass
class AgentResponse:
    tool_call: ToolCall | None = None
    final_answer: str | None = None
```

#### Decorators — Register Tools Without Maintaining a List

```python
TOOLS = {}

def tool(func):
    TOOLS[func.__name__] = func
    return func

@tool
def calculate(expression: str) -> str:
    """Evaluate a mathematical expression"""
    return str(eval(expression))

@tool
def get_weather(city: str) -> str:
    """Get current weather for a city"""
    return f"Weather in {city}: 28°C, partly cloudy"
```

#### Virtual Environments — Non-Negotiable

```bash
# Create and activate
python -m venv .venv
source .venv/bin/activate  # macOS/Linux
.venv\Scripts\activate     # Windows

pip install google-generativeai

# Or with uv (faster):
uv venv
source .venv/bin/activate
uv pip install google-generativeai
```

---

## Part 2: Emergent Abilities — Why Agents Are Even Possible

### What Are Emergent Abilities?

Emergent abilities refer to capabilities that arise in LLMs as a result of increased scale, even though they were not explicitly programmed. They appear **suddenly** at scale — not gradually. This is a phase transition, like water turning to ice.

**Characteristics:**
- **Unpredictable:** Not explicitly encoded, often emerges without specific supervision
- **Threshold Dependent:** Appear when the model crosses a "scaling threshold"
- **Quantitative Shift:** Represent a significant LEAP in performance
- **Generalization:** Indicates the model's ability to generalize to unseen tasks

**These abilities include:**
- Few-shot and Zero-shot learning
- In-context learning
- Complex reasoning
- Code generation and understanding
- Common sense and world knowledge
- Abstract thinking and metaphorical understanding
- Translation and multilingual understanding
- Tool use and API integration ← *most important for us*

### Parameter Threshold Trends

| Year | Model | Scale (Parameters) | Key Emergent Behaviors |
|------|-------|-------------------|------------------------|
| 2020 | GPT-3 | 175B | Few-shot learning, reasoning, code generation |
| 2022 | Chinchilla | 70B | Efficient scaling, emergence at smaller sizes |
| 2023 | LLaMA | 7B–13B | Zero-shot, multilingual, reasoning |
| 2023 | Falcon-40B | 40B | Comparable to GPT-3 in language tasks |
| 2024 | Fine-tuned LLaMA | 7B | Instruction-following, reasoning via fine-tuning |

### The 2025–2026 Update: Internal Reasoning

Models like Claude (extended thinking), OpenAI o-series, and Gemini (thinking mode) can now **think step by step internally** before responding. They can:

- Break complex problems into sub-problems
- Consider multiple approaches and evaluate them
- Catch their own mistakes before outputting
- Reason about uncertainty and ask for clarification

| Year | Model | What's New |
|------|-------|-----------|
| 2025 | Claude 4.x (thinking) | Internal reasoning chains, extended thinking |
| 2025 | OpenAI o-series (o1, o3) | Test-time compute scaling |
| 2025 | Gemini 2.x (thinking) | Multi-modal reasoning |
| 2025–26 | Llama 4, Qwen 3, Phi-4 | Open-source reasoning models catching up |

> The emergent ability that makes this entire course possible is **tool use and instruction following**.

---

## Part 3: What Are AI Agents?

An **AI agent** is a system that can perceive its environment, make decisions, and take actions to achieve specific goals.

### Key Distinctions: LLMs vs RAG vs AI Agents

**Standard LLMs** — text in, text out, everything forgotten:
```python
response = model.generate_content("What is the weather in Mumbai right now?")
# This is a GUESS. It has no idea what the actual weather is.
```

**RAG (Retrieval-Augmented Generation)** — grounded in real data, but still can't DO anything:
```python
relevant_docs = vector_db.search(query, top_k=3)
context = "\n".join(relevant_docs)
response = model.generate_content(f"Based on these documents:\n{context}\n\nAnswer: {query}")
```

**AI Agents** — LLMs that can ACT, not just SPEAK:
```python
conversation_history = []
tools = {"calculate": calculate, "get_weather": get_weather, "search": search}

while not done:
    response = model.generate_content(system_prompt + conversation_history)
    if response.has_tool_call:
        result = tools[response.tool_call.name](**response.tool_call.arguments)
        conversation_history.append({"tool": tool_name, "result": result})
    else:
        done = True
        print(response.final_answer)
```

### The Three Core Pillars of Agency

1. **Goal-Directed Behavior** — An agent has specific objectives it works to accomplish.
2. **Interactive Capacity** — Agents interact with their environment via tools, databases, APIs (now via MCP).
3. **Autonomous Decision-Making** — Agents can make decisions without continuous human guidance.

### Core Capabilities

#### 1. Reasoning Mechanisms
- **Deductive:** If A is true, and A → B, then B must be true
- **Inductive:** From specific observations to generalizations
- **Abductive:** Best guesses on incomplete information

#### 2. Memory Systems
- **Working Memory:** The `conversation_history` list — every message, tool call, and result accumulated in order
- **Long-term Memory:** Persistent across sessions, often implemented via vector databases (covered in Session 7)

#### 3. Autonomous Action
- **Action Space:** The tools dictionary defines what the agent can do
- **Action Selection:** The LLM decides which tool to call based on the system prompt and history

---

## Part 4: State of the Art — The Agentic AI Landscape in 2026

### The Protocol Stack Revolution

| Layer | Protocol | What It Connects | Status in 2026 |
|-------|----------|-----------------|----------------|
| Tools | MCP (Anthropic) | Agent ↔ Tools/APIs | Mature, industry standard. Session 4. |
| Agents | A2A (Google) | Agent ↔ Agent | Production-ready. Session 13. |
| UI | A2UI / AG-UI | Agent ↔ User Interface | Emerging. Session 14. |

### The Autonomy Frontier

**Level 1 — Chat Assistants (2023):** One turn at a time. No tools, no memory.

**Level 2 — Tool-Using Agents (2024):** Agent can call functions, but still reactive.

**Level 3 — Autonomous Agents (2025–2026):**
- **Claude Code / Cursor / Windsurf** — Coding agents that read entire codebases, write code, run tests, fix failures, and commit.
- **Anthropic Computer Use / OpenAI Operator** — Agents that can see your screen, move the mouse, click buttons, fill forms.
- **Karpathy's autoresearch** — Agent modifies code, trains for 5 minutes, checks if results improved, keeps or discards via git, and repeats (~100 experiments overnight).

**Level 4 — Multi-Agent Systems (2026):** Multiple autonomous agents coordinating via A2A protocol. (Session 13)

---

## Part 5: Hands-On — Build Your First Agent

### Step 1: Talk to an LLM

```python
import google.generativeai as genai
import os

genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
model = genai.GenerativeModel('gemini-3.0-flash')

response = model.generate_content("What is 2 raised to the power of 10?")
print(response.text)
```

### Step 2: System Prompt That Makes It an Agent

```python
system_prompt = """You are a helpful AI agent that can use tools to answer questions.

You have access to the following tools:
1. calculate(expression: str) -> str
2. get_weather(city: str) -> str
3. search_notes(query: str) -> str

Respond in ONE of these two JSON formats:
If you need to use a tool: {"tool_name": "<name>", "tool_arguments": {"<arg_name>": "<value>"}}
If you have the final answer: {"answer": "<your final answer>"}

IMPORTANT: Respond with ONLY the JSON. No other text. No markdown. No code fences.
"""
```

### Step 3: Define Tools

```python
import json, math

def calculate(expression: str) -> str:
    try:
        allowed_names = {"math": math, "abs": abs, "round": round}
        result = eval(expression, {"__builtins__": {}}, allowed_names)
        return json.dumps({"result": str(result)})
    except Exception as e:
        return json.dumps({"error": str(e)})

def get_weather(city: str) -> str:
    weather_data = {
        "Mumbai": "32°C, Humid, Partly Cloudy",
        "Delhi": "28°C, Clear Sky",
        "London": "15°C, Rainy",
        "New York": "22°C, Sunny",
    }
    return json.dumps({"weather": weather_data.get(city, f"No data for {city}")})

def search_notes(query: str) -> str:
    notes = [
        {"title": "Meeting Agenda", "content": "Discuss Q3 targets, review agent architecture"},
        {"title": "Shopping List", "content": "Milk, eggs, bread, coffee"},
        {"title": "Project Ideas", "content": "Build a stock monitoring agent, voice-based assistant"},
    ]
    results = [n for n in notes if query.lower() in n["title"].lower() or query.lower() in n["content"].lower()]
    return json.dumps({"results": results if results else "No notes found matching your query"})

tools = {"calculate": calculate, "get_weather": get_weather, "search_notes": search_notes}
```

### Step 4 & 5: Robust Response Parsing

```python
import re

def parse_llm_response(response_text: str) -> dict:
    text = response_text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        lines = lines[1:-1] if lines[-1].strip() == "```" else lines[1:]
        text = "\n".join(lines).strip()
    if text.startswith("json"):
        text = text[4:].strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        json_match = re.search(r'\{.*\}', text, re.DOTALL)
        if json_match:
            return json.loads(json_match.group())
        raise ValueError(f"Could not parse LLM response: {text}")
```

### Step 6 & 7: The Full Agent Loop

```python
def run_agent(user_query: str, max_iterations: int = 5):
    print(f"\nUser: {user_query}")
    
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_query},
    ]

    for iteration in range(max_iterations):
        print(f"\n--- Iteration {iteration + 1} ---")
        
        # Build the prompt from message history
        prompt = ""
        for msg in messages:
            if msg["role"] == "system": prompt += msg["content"] + "\n\n"
            elif msg["role"] == "user": prompt += f"User: {msg['content']}\n\n"
            elif msg["role"] == "assistant": prompt += f"Assistant: {msg['content']}\n\n"
            elif msg["role"] == "tool": prompt += f"Tool Result: {msg['content']}\n\n"

        response = model.generate_content(prompt)
        
        try:
            parsed = parse_llm_response(response.text)
        except (ValueError, json.JSONDecodeError):
            messages.append({"role": "assistant", "content": response.text})
            messages.append({"role": "user", "content": "Please respond with valid JSON only."})
            continue

        if "answer" in parsed:
            print(f"\nAgent Answer: {parsed['answer']}")
            return parsed["answer"]

        if "tool_name" in parsed:
            tool_name = parsed["tool_name"]
            tool_args = parsed.get("tool_arguments", {})
            tool_result = tools[tool_name](**tool_args)
            print(f"Tool: {tool_name}({tool_args}) → {tool_result}")
            messages.append({"role": "assistant", "content": response.text})
            messages.append({"role": "tool", "content": tool_result})

    print("\nMax iterations reached.")
    return None
```

### The Agent Loop Visualized

```
User Query: "What's the weather in Mumbai and is it hotter than 30°C?"
     │
     ▼
┌──────────────────────────────────────────────┐
│  LLM (system prompt + conversation history)  │
│  Returns: {"tool_name": "get_weather",        │
│            "tool_arguments": {"city":"Mumbai"}}│
└──────────────┬───────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────┐
│  Execute: get_weather("Mumbai")              │
│  Result: {"weather": "32°C, Humid, Cloudy"}  │
└──────────────┬───────────────────────────────┘
               │
               ▼  Append to history
               │
               ▼
┌──────────────────────────────────────────────┐
│  LLM (system prompt + UPDATED history)        │
│  Returns: {"answer": "The weather in Mumbai   │
│            is 32°C. Yes, it is hotter."}      │
└──────────────────────────────────────────────┘
```

> **The core loop:** LLM decides → Tool executes → Result feeds back → LLM decides again

---

## Part 6: Why You Must Code Without AI

You just built an agent. But ask yourself honestly: could you have written that code without Copilot?

People can get AI to write an entire agent framework. But when it breaks, they can't read the stack trace. They can't reason about the control flow. They can't set a breakpoint and step through the logic.

> "The best agent developers don't use AI to write code they don't understand. They use AI to write code FASTER that they ALREADY understand."

---

## Assignment 3: Agentic AI Chrome Plugin

Build a Chrome Extension with an Agentic AI that uses LLM tool-calling in a loop.

**Example ideas:**
- **Calculations:** Calculate the sum of exponential values of the first 6 Fibonacci Numbers
- **External Tools:** Find the top OTT series this week and send them via Telegram/Email
- **Continuous Monitoring:** Track a stock price and notify when it crosses a threshold
- **Multi-step Research:** Find news about a stock, link it to price changes, and summarize

**Requirements:**
1. Call your LLM **multiple times** in a loop: Query → LLM → Tool Call → Result → Query → ...
2. Each query stores **ALL** past interactions (full conversation history)
3. **NEW:** Display the agent's **reasoning chain** — show each tool call and result, not just the final answer
4. **NEW:** Implement at least **3 custom tool functions** (each student should have different tools!)

**Submission:** A YouTube video showing how your Agent works + copy-paste your LLM logs.

> *Note: Chrome Plugin is a suggestion — if you want to build something more complex, that's fine too.*
