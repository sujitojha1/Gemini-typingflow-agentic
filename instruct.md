# Agent Instructions
Step 1: Create an Agent Session
- Generate a unique timestamp-based `sessionId` and securely set up a temporary workspace folder (`tempFolderPath`) to isolate this processing run.

Step 2: Initial Content Storage
- Securely cache the extracted payload (text blocks and image URLs) into the temporary folder. This cached file serves as the raw material for the agent's deep processing.

Step 3: Multimodal Chunk Processing
- Pass the saved chunk data and instruct the agent to run a parallel background task using the `gemma-4-31b-it` model. The agent must deeply refine the structured nuggets by processing text and base64 images simultaneously for accurate visual mapping.

Step 4: State Handoff
- Ensure the extension seamlessly switches to these later chunks without interrupting the user's active session.
