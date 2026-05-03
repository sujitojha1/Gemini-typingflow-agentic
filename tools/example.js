/**
 * Example tool for function calling
 * 
 * @param {Object} data - The chunk data to process
 * @returns {Object} The processed result
 */
function processChunk(data) {
  // Identify intent and process the data chunk
  console.log("Processing chunk:", data);
  
  // Perform some operation on the chunk
  const result = {
    original: data,
    processed: true,
    timestamp: new Date().toISOString()
  };
  
  return result;
}

// Export the tool so the agent/system can call it
module.exports = {
  processChunk
};
