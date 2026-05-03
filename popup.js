document.addEventListener('DOMContentLoaded', () => {
    const btnExtract      = document.getElementById('btn-extract');
    const btnType         = document.getElementById('btn-type');
    const agentBar        = document.getElementById('popup-agent-bar');
    const agentTask       = document.getElementById('popup-agent-task');
    const agentModel      = document.getElementById('popup-agent-model');
    const btnSettings     = document.getElementById('btn-settings');
    const btnRefresh      = document.getElementById('btn-refresh');
    const statWords       = document.getElementById('stat-words');
    const statImages      = document.getElementById('stat-images');

    btnSettings.addEventListener('click', () => chrome.runtime.openOptionsPage());

    btnRefresh.addEventListener('click', () => {
        btnRefresh.classList.add('spinning');
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs || tabs.length === 0) return;
            chrome.tabs.reload(tabs[0].id, {}, () => {
                setTimeout(() => btnRefresh.classList.remove('spinning'), 600);
            });
        });
    });

    function updateAgentBar(task, model, detail) {
        agentBar.classList.remove('tf-agent-error', 'tf-agent-done');
        
        if (task === 'error') {
            agentBar.classList.add('tf-agent-error');
            agentTask.textContent = `Error: ${detail || task}`;
            agentModel.textContent = '';
        } else if (task === 'complete') {
            agentBar.classList.add('tf-agent-done');
            agentTask.textContent = `agent · complete`;
            agentModel.textContent = model && model !== 'null' ? `· ${model}` : '';
        } else {
            agentBar.classList.add('tf-agent-active');
            agentTask.textContent = `agent · ${task}`;
            agentModel.textContent = model && model !== 'null' ? `· ${model}` : '';
        }
    }

    // Listen for agent status pushed from background
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.action === 'agent_status') {
            updateAgentBar(msg.task, msg.model, msg.detail);
            if (msg.task === 'error') {
                btnExtract.disabled = false;
            }
        }
        if (msg.action === 'agent_close_popup') {
            window.close();
        }
    });

    // On popup open: scan page stats + check existing session
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs || tabs.length === 0) return;
        const tabId = tabs[0].id;

        chrome.scripting.executeScript({
            target: { tabId },
            func: () => {
                const root = document.querySelector('article, main, [role="main"]') || document.body;
                const textEls = Array.from(root.querySelectorAll('p, h1, h2, h3, li, blockquote'))
                    .filter(el => !el.closest('nav, header, footer, aside, [role="navigation"]'));
                const wordCount = textEls.map(el => el.innerText.trim()).join(' ')
                    .split(/\s+/).filter(Boolean).length;
                const imageCount = Array.from(root.querySelectorAll('img'))
                    .filter(img => (img.naturalWidth || img.width) > 100 && !img.src.startsWith('data:')).length;
                return { wordCount, imageCount };
            }
        }, (results) => {
            if (chrome.runtime.lastError || !results || !results[0]) return;
            const { wordCount, imageCount } = results[0].result;
            const fmt = n => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
            statWords.innerHTML = `<span>${fmt(wordCount)}</span> words`;
            statImages.innerHTML = `<span>${imageCount}</span> images`;
        });

        chrome.tabs.sendMessage(tabId, { action: "check_session" }, (resp) => {
            if (!chrome.runtime.lastError && resp && resp.hasSession) {
                btnType.disabled = false;
                btnExtract.innerText = "Extract New Insights";
            }
        });
    });

    // Hand off the entire pipeline to the background agent
    btnExtract.addEventListener('click', () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs || tabs.length === 0) {
                updateAgentBar('error', null, 'No active tab found');
                return;
            }
            btnExtract.disabled = true;
            updateAgentBar('Starting agent', null);
            chrome.runtime.sendMessage({ action: 'agent_start', tabId: tabs[0].id });
        });
    });

    btnType.addEventListener('click', () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs || tabs.length === 0) return;
            chrome.tabs.sendMessage(tabs[0].id, { action: "open_overlay" }, () => {
                if (chrome.runtime.lastError) console.error("Overlay error:", chrome.runtime.lastError.message);
            });
        });
    });
});
