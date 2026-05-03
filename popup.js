document.addEventListener('DOMContentLoaded', () => {
    const btnExtract = document.getElementById('btn-extract');
    const btnType = document.getElementById('btn-type');
    const loader = document.getElementById('loader');

    function updateLoader(msg) {
        loader.style.display = 'block';
        loader.innerText = `${msg}...`;
    }
    
    function hideLoader() { loader.style.display = 'none'; }

    // Init Logic: Check if the content script already has processing done for this tab
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        if (!tabs || tabs.length === 0) return;
        chrome.tabs.sendMessage(tabs[0].id, { action: "check_session" }, (resp) => {
            if (!chrome.runtime.lastError && resp && resp.hasSession) {
                btnType.disabled = false;
                btnExtract.innerText = "Extract New Insights";
            }
        });
    });

    btnExtract.addEventListener('click', () => {
        btnExtract.disabled = true;
        updateLoader('Parsing Sequence');

        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
            if (!tabs || tabs.length === 0) {
                updateLoader('Error: No active tab found');
                btnExtract.disabled = false;
                return;
            }
            
            const tabId = tabs[0].id;

            const handleExtractionResponse = (resp) => {
                if (!resp || !resp.payload) {
                    updateLoader('DOM Extraction Failed');
                    btnExtract.disabled = false;
                    return;
                }

                updateLoader('Synthesizing with Gemini Flash Lite 3.1 Preview');
                chrome.runtime.sendMessage({ action: "proxy_gemini_api", payload: resp.payload }, (apiResp) => {
                    if (chrome.runtime.lastError) {
                        updateLoader('Error: Background Service Worker offline');
                        btnExtract.disabled = false;
                        return;
                    }

                    if (apiResp.error) {
                        updateLoader(`Error: ${apiResp.error}`);
                        btnExtract.disabled = false;
                        return;
                    }

                    const json = apiResp.api_response;
                    updateLoader('Rendering Image Assets via Flash 2.5');
                    
                    chrome.tabs.sendMessage(tabId, { action: "mount_ui", data: json }, () => {
                        if (chrome.runtime.lastError) {
                            console.error(chrome.runtime.lastError.message);
                        }
                        hideLoader();
                        btnType.disabled = false;
                        btnExtract.innerText = "Extract New Insights";
                        btnExtract.disabled = false;
                        // Auto-open gallery immediately after mount
                        chrome.tabs.sendMessage(tabId, { action: "open_overlay" });
                        window.close();
                    });
                });
            };

            const attemptExtraction = () => {
                chrome.tabs.sendMessage(tabId, { action: "extract_content" }, (resp) => {
                    if (chrome.runtime.lastError) {
                        updateLoader('Init Failed: Chrome restricted script execution on this page.');
                        btnExtract.disabled = false;
                        return;
                    }
                    handleExtractionResponse(resp);
                });
            };

            // Attempt primary messaging sequence
            chrome.tabs.sendMessage(tabId, { action: "extract_content" }, (resp) => {
                // If content script isn't loaded (user recently updated the extension and didn't refresh the page)
                if (chrome.runtime.lastError) {
                    console.warn("Content script disconnected. Automatically injecting via execution pipeline...");
                    updateLoader('Dynamically Injecting Content Script');
                    
                    chrome.scripting.executeScript({
                        target: { tabId: tabId },
                        files: ['content.js']
                    }, () => {
                        if (chrome.runtime.lastError) {
                            console.error(chrome.runtime.lastError.message);
                            updateLoader('Init Failed: Chrome restricted injection on this tab.');
                            btnExtract.disabled = false;
                            return;
                        }
                        // Give the newly injected script 250ms to attach its listeners, then hit it again
                        setTimeout(attemptExtraction, 250);
                    });
                    return;
                }
                
                // If the script was already there, process naturally
                handleExtractionResponse(resp);
            });
        });
    });

    btnType.addEventListener('click', () => {
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
            if (!tabs || tabs.length === 0) return;
            chrome.tabs.sendMessage(tabs[0].id, { action: "open_overlay" }, () => {
                if (chrome.runtime.lastError) {
                    console.error("Overlay error:", chrome.runtime.lastError.message);
                }
            });
        });
    });
});
