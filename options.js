const DEFAULT_GOOGLE_MODELS = [
    { id: 'gemini-3.1-flash-lite-preview', label: 'Gemini Flash Lite 3.1', vision: false },
    { id: 'gemini-3-flash-preview',        label: 'Gemini 3 Flash',        vision: false },
    { id: 'gemini-2.5-flash-lite',         label: 'Gemini 2.5 Flash Lite', vision: false },
    { id: 'gemma-4-26b-a4b-it',           label: 'Gemma 4 26B',           vision: true  },
    { id: 'gemma-4-31b-it',               label: 'Gemma 4 31B',           vision: true  },
];

// State
let customModelIds = [];   // user-added model IDs (strings)
let enabledModelIds = null; // null means "all defaults enabled"

// ── DOM refs ──────────────────────────────────────────────────────────────────

const provGoogle    = document.getElementById('provGoogle');
const provOllama    = document.getElementById('provOllama');
const googleSection = document.getElementById('googleSection');
const ollamaSection = document.getElementById('ollamaSection');
const apiKeyInput   = document.getElementById('apiKey');
const modelList     = document.getElementById('modelList');
const customInput   = document.getElementById('customModelId');
const addModelBtn   = document.getElementById('addModelBtn');
const ollamaUrlIn   = document.getElementById('ollamaUrl');
const ollamaModelIn = document.getElementById('ollamaModel');
const testBtn       = document.getElementById('testOllamaBtn');
const ollamaStatus  = document.getElementById('ollamaTestStatus');
const saveBtn       = document.getElementById('saveBtn');
const saveStatus    = document.getElementById('saveStatus');

// ── Provider toggle ───────────────────────────────────────────────────────────

function applyProviderUI() {
    const isGoogle = provGoogle.checked;
    googleSection.style.display = isGoogle ? '' : 'none';
    ollamaSection.style.display = isGoogle ? 'none' : '';
}

provGoogle.addEventListener('change', applyProviderUI);
provOllama.addEventListener('change', applyProviderUI);

// ── Model list rendering ──────────────────────────────────────────────────────

function buildModelRows() {
    modelList.innerHTML = '';

    const allModels = [
        ...DEFAULT_GOOGLE_MODELS,
        ...customModelIds.map(id => ({ id, label: id, vision: false, custom: true })),
    ];

    for (const model of allModels) {
        const isEnabled = enabledModelIds === null || enabledModelIds.includes(model.id);
        const row = document.createElement('div');
        row.className = 'model-row';
        row.dataset.modelId = model.id;

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = isEnabled;
        cb.addEventListener('change', () => syncEnabledFromUI());

        const info = document.createElement('div');
        info.className = 'model-row-info';
        info.innerHTML = `<div class="model-row-label">${model.label}</div>
                          <div class="model-row-id">${model.id}</div>`;

        row.appendChild(cb);
        row.appendChild(info);

        if (model.vision) {
            const badge = document.createElement('span');
            badge.className = 'model-badge';
            badge.textContent = 'vision';
            row.appendChild(badge);
        }

        if (model.custom) {
            const rmBtn = document.createElement('button');
            rmBtn.className = 'model-remove-btn';
            rmBtn.title = 'Remove';
            rmBtn.textContent = '×';
            rmBtn.addEventListener('click', () => {
                customModelIds = customModelIds.filter(id => id !== model.id);
                syncEnabledFromUI();   // capture checked state before rebuild
                buildModelRows();
            });
            row.appendChild(rmBtn);
        }

        modelList.appendChild(row);
    }
}

function syncEnabledFromUI() {
    const rows = modelList.querySelectorAll('.model-row');
    const ids = [];
    rows.forEach(row => {
        const cb = row.querySelector('input[type="checkbox"]');
        if (cb && cb.checked) ids.push(row.dataset.modelId);
    });
    // If all defaults are enabled and no custom models, treat as "all" (null)
    const allDefaultIds = DEFAULT_GOOGLE_MODELS.map(m => m.id);
    const onlyDefaults = ids.every(id => allDefaultIds.includes(id));
    const allDefaultsOn = allDefaultIds.every(id => ids.includes(id));
    enabledModelIds = (onlyDefaults && allDefaultsOn && customModelIds.length === 0) ? null : ids;
}

// ── Add custom model ──────────────────────────────────────────────────────────

addModelBtn.addEventListener('click', () => {
    const val = customInput.value.trim();
    if (!val) return;
    const allIds = [...DEFAULT_GOOGLE_MODELS.map(m => m.id), ...customModelIds];
    if (allIds.includes(val)) {
        customInput.value = '';
        return;
    }
    customModelIds.push(val);
    if (enabledModelIds !== null) enabledModelIds.push(val);
    customInput.value = '';
    buildModelRows();
});

customInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') addModelBtn.click();
});

// ── Test Ollama ───────────────────────────────────────────────────────────────

testBtn.addEventListener('click', async () => {
    const url = (ollamaUrlIn.value.trim() || 'http://localhost:11434').replace(/\/$/, '');
    ollamaStatus.textContent = 'Testing…';
    ollamaStatus.className = '';
    try {
        const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const models = (data.models || []).map(m => m.name).join(', ') || '(none)';
        ollamaStatus.textContent = `Connected — models: ${models}`;
        ollamaStatus.className = 'status-ok';
    } catch (e) {
        ollamaStatus.textContent = `Failed: ${e.message}`;
        ollamaStatus.className = 'status-err';
    }
});

// ── Load settings ─────────────────────────────────────────────────────────────

chrome.storage.sync.get(
    ['modelProvider', 'geminiApiKey', 'enabledModelIds', 'customModelIds', 'ollamaBaseUrl', 'ollamaModel'],
    (result) => {
        // Provider
        const provider = result.modelProvider || 'google';
        if (provider === 'ollama') {
            provOllama.checked = true;
        } else {
            provGoogle.checked = true;
        }
        applyProviderUI();

        // API key
        if (result.geminiApiKey) apiKeyInput.value = result.geminiApiKey;

        // Model pool
        customModelIds = result.customModelIds || [];
        enabledModelIds = result.enabledModelIds || null;
        buildModelRows();

        // Ollama
        ollamaUrlIn.value = result.ollamaBaseUrl || 'http://localhost:11434';
        ollamaModelIn.value = result.ollamaModel || '';
    }
);

// ── Save ──────────────────────────────────────────────────────────────────────

saveBtn.addEventListener('click', () => {
    syncEnabledFromUI();

    const provider = provGoogle.checked ? 'google' : 'ollama';

    chrome.storage.sync.set({
        modelProvider:  provider,
        geminiApiKey:   apiKeyInput.value.trim(),
        enabledModelIds: enabledModelIds,
        customModelIds:  customModelIds,
        ollamaBaseUrl:  ollamaUrlIn.value.trim() || 'http://localhost:11434',
        ollamaModel:    ollamaModelIn.value.trim(),
    }, () => {
        saveStatus.textContent = 'Settings saved.';
        setTimeout(() => { saveStatus.textContent = ''; }, 3000);
    });
});
