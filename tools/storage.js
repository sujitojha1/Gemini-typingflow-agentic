const fs = require('fs');
const path = require('path');

/**
 * Step 2 Tool: Saves the extracted data securely into the temporary folder.
 * 
 * @param {Object} params - The parameters for the tool.
 * @param {string} params.tempFolderPath - The path to the temporary folder created in Step 1.
 * @param {string|Object} params.content - The extracted data to be saved.
 * @param {string} [params.filename='raw_content.txt'] - Optional filename to store the data as.
 * @returns {Object} Result containing the path to the saved file.
 */
function saveInitialContent(params) {
  const { tempFolderPath, content, filename = 'raw_content.txt' } = params;

  if (!tempFolderPath) {
    throw new Error("Missing 'tempFolderPath' parameter. You must create a session first.");
  }

  // Ensure the directory exists
  if (!fs.existsSync(tempFolderPath)) {
    fs.mkdirSync(tempFolderPath, { recursive: true });
  }

  // Determine file path
  const filePath = path.join(tempFolderPath, filename);
  
  // Format content (stringify if it's an object/JSON)
  const dataToSave = typeof content === 'string' ? content : JSON.stringify(content, null, 2);

  // Write content securely to the file
  fs.writeFileSync(filePath, dataToSave, 'utf8');

  return {
    success: true,
    filePath: filePath,
    bytesWritten: Buffer.byteLength(dataToSave, 'utf8'),
    message: `Source content securely saved to ${filePath}`
  };
}

module.exports = {
  saveInitialContent
};
