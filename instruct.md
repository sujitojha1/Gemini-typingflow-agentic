# Agent Instructions

**Step 1: Create an agent session**
- Create a Session ID based on timestamp and create temporary folder.

**Step 2: Initial Content Storage**
- Execute the content-saving tool to extract the provided data and save it securely into a temporary folder. This cached content will serve as the source material for later reference during processing.

**Step 3: Structuring nuggets**
- Send the extracted content to the LLM model pool (rotating through models upon failure) to logically structure the data into semantic fragments or "nuggets" and evaluate context.

**Step 4: Mounting gallery**
- Forward the successfully structured JSON payload to the content interface, mounting the visual typing overlay and gallery for user interaction.

**Step 5: Background Gemma Refinement**
- If the primary model used was not Gemma 4, run a parallel background task using the Gemma 4 model to further refine the structured nuggets without blocking the user interface.
