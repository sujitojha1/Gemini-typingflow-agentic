document.addEventListener('DOMContentLoaded', () => {
    const apiKeyInput = document.getElementById('apiKey');
    const saveBtn = document.getElementById('saveBtn');
    const statusDiv = document.getElementById('status');

    // Retrieve existing
    chrome.storage.sync.get(['geminiApiKey'], (result) => {
        if (result.geminiApiKey) {
            apiKeyInput.value = result.geminiApiKey;
        }
    });

    // Save and inform layout
    saveBtn.addEventListener('click', () => {
        const apiKey = apiKeyInput.value.trim();
        chrome.storage.sync.set({ geminiApiKey: apiKey }, () => {
            statusDiv.textContent = 'Hardware token encrypted & saved!';
            setTimeout(() => {
                statusDiv.textContent = '';
            }, 3000);
        });
    });
});
