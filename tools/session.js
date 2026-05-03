const fs = require('fs');
const path = require('path');

/**
 * Step 1 Tool: Creates an agent session ID based on timestamp and creates a temporary folder.
 * 
 * @returns {Object} Result containing the sessionId and tempFolderPath.
 */
function createSession() {
  // Generate session ID based on current timestamp
  const timestamp = Date.now();
  const sessionId = `session_${timestamp}`;
  
  // Define temporary folder path (e.g., in the root directory under "temp/")
  const tempDir = path.join(__dirname, '..', 'temp', sessionId);
  
  // Create the temporary directory securely
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  
  return {
    success: true,
    sessionId: sessionId,
    tempFolderPath: tempDir,
    message: `Created session ${sessionId} and temporary folder at ${tempDir}`
  };
}

module.exports = {
  createSession
};
