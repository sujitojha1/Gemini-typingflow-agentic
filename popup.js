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
    const querySection    = document.getElementById('agent-query-section');
    const queryInput      = document.getElementById('agent-query-input');
    const btnAsk          = document.getElementById('btn-ask-agent');
    const chainContainer  = document.getElementById('agent-chain');

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

    // ── Reasoning chain renderer ─────────────────────────────────────────────

    function appendChainCard(step) {
        const card = document.createElement('div');
        if (step.type === 'tool_call') {
            card.className = 'chain-card tool';
            const argsStr  = JSON.stringify(step.toolArgs || {});
            let   resultPreview = '';
            try {
                const r = JSON.parse(step.toolResult || '{}');
                resultPreview = r.result ?? r.tldr ?? r.error ?? JSON.stringify(r).slice(0, 120);
            } catch (_) {
                resultPreview = String(step.toolResult || '').slice(0, 120);
            }
            card.innerHTML = `
                <div class="chain-hdr">
                    <span class="chain-name">${step.toolName}()</span>
                    <span class="chain-iter">iter ${step.iteration}</span>
                </div>
                <div class="chain-body">
                    <div class="chain-args">↳ ${argsStr.slice(0, 100)}</div>
                    <div class="chain-divider"></div>
                    <div class="chain-result">← ${resultPreview}</div>
                </div>`;
        } else if (step.type === 'answer') {
            card.className = 'chain-card answer';
            card.innerHTML = `
                <div class="chain-hdr">
                    <span class="chain-name">answer</span>
                    <span class="chain-iter">iter ${step.iteration}</span>
                </div>
                <div class="chain-body">${step.text}</div>`;
            btnAsk.disabled = false;
        } else if (step.type === 'error') {
            card.className = 'chain-card error';
            card.innerHTML = `
                <div class="chain-hdr"><span class="chain-name">error</span></div>
                <div class="chain-body">${step.text}</div>`;
            btnAsk.disabled = false;
        }
        chainContainer.appendChild(card);
        chainContainer.scrollTop = chainContainer.scrollHeight;
    }

    // Listen for agent status pushed from background
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.action === 'agent_status') {
            updateAgentBar(msg.task, msg.model, msg.detail);
            if (msg.task === 'error') {
                btnExtract.disabled = false;
            }
        }
        if (msg.action === 'agent_loop_step') {
            appendChainCard(msg.step);
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
                querySection.style.display = 'block';
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

    btnAsk.addEventListener('click', () => {
        const query = queryInput.value.trim();
        if (!query) return;
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (!tabs || tabs.length === 0) return;
            btnAsk.disabled = true;
            chainContainer.innerHTML = '';
            chrome.runtime.sendMessage({ action: 'run_agent_loop', tabId: tabs[0].id, query });
        });
    });

    queryInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') btnAsk.click();
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
