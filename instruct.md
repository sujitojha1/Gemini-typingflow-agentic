# Agent Instructions (Parallel Agentic Track)

This document outlines the instructions for the parallel, agent-driven background process (Track 2). The agent must execute the following steps by calling the appropriate functions from the `tools/` directory:

**Step 1: Create an Agent Session**
- **Tool:** Call `createSession()` from `tools/session.js`.
- **Purpose:** Generate a unique timestamp-based `sessionId` and securely set up a temporary workspace folder (`tempFolderPath`) to isolate this processing run.

**Step 2: Initial Content Storage**
- **Tool:** Call `saveInitialContent(params)` from `tools/storage.js`.
- **Parameters:** Pass the `tempFolderPath` (from Step 1) and the raw extracted `content`.
- **Purpose:** Securely cache the extracted payload (text blocks and image URLs) into the temporary folder. This cached file serves as the raw material for the agent's deep processing.

**Step 3: Multimodal Chunk Processing**
- **Tool:** Call `processChunk(data)` from `tools/example.js` (acting as the Gemma processor).
- **Prompt/Directive:** Pass the saved chunk data and instruct the agent to run a parallel background task using the `gemma-4-31b-it` model. The agent must deeply refine the structured nuggets by processing text and base64 images simultaneously for accurate visual mapping.

**Step 4: State Handoff**
- **Action:** Once tool execution is complete, dynamically push the refined chunks chronologically back to the active tab.
- **Purpose:** Ensure the extension seamlessly switches to these later chunks without interrupting the user's active session.
