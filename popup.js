document.addEventListener('DOMContentLoaded', () => {
    const btnExtract = document.getElementById('btn-extract');
    const btnType = document.getElementById('btn-type');
    const loader = document.getElementById('loader');
    const btnSettings = document.getElementById('btn-settings');

    btnSettings.addEventListener('click', () => {
        chrome.runtime.openOptionsPage();
    });

    function updateLoader(msg) {
        loader.style.display = 'block';
        loader.innerText = `${msg}...`;
    }

    function hideLoader() { loader.style.display = 'none'; }

    // Agentic Tweak 1: Instant page intelligence scan on popup open
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs || tabs.length === 0) return;
        const tabId = tabs[0].id;

        chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
                const root = document.querySelector('article, main, [role="main"]') || document.body;
                const textEls = Array.from(root.querySelectorAll('p, h1, h2, h3, li, blockquote'))
                    .filter(el => !el.closest('nav, header, footer, aside, [role="navigation"]'));
                const text = textEls.map(el => el.innerText.trim()).join(' ');
                const charCount = text.replace(/\s/g, '').length;
                const wordCount = text.split(/\s+/).filter(Boolean).length;
                const imageCount = Array.from(root.querySelectorAll('img'))
                    .filter(img => (img.naturalWidth || img.width) > 100 && !img.src.startsWith('data:')).length;
                return { charCount, wordCount, imageCount };
            }
        }, (results) => {
            if (chrome.runtime.lastError || !results || !results[0]) return;
            const { charCount, wordCount, imageCount } = results[0].result;
            const statsEl = document.getElementById('page-stats');
            const fmt = n => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
            statsEl.innerHTML = `
                <div class="page-stat-chip"><span>${fmt(charCount)}</span> chars</div>
                <div class="page-stat-chip"><span>${fmt(wordCount)}</span> words</div>
                <div class="page-stat-chip"><span>${imageCount}</span> images</div>
            `;
        });

        // Init Logic: Check if a session already exists on this tab
        chrome.tabs.sendMessage(tabId, { action: "check_session" }, (resp) => {
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
