// DEFAULT_GOOGLE_MODELS is defined in shared_config.js, loaded before this script via <script> in options.html

// Google model pool state
let customModelIds = [];
let enabledModelIds = null;

// Ollama model pool state
let ollamaModelIds = [];       // all model IDs in the pool
let ollamaEnabledModelIds = null; // null = all enabled

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
const ollamaModelList    = document.getElementById('ollamaModelList');
const customOllamaInput  = document.getElementById('customOllamaModelId');
const addOllamaModelBtn  = document.getElementById('addOllamaModelBtn');
const testBtn            = document.getElementById('testOllamaBtn');
const fetchModelsBtn     = document.getElementById('fetchOllamaModelsBtn');
const ollamaStatus       = document.getElementById('ollamaTestStatus');
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

// ── Google model list ─────────────────────────────────────────────────────────

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
        const labelDiv = document.createElement('div');
        labelDiv.className = 'model-row-label';
        labelDiv.textContent = model.label;
        const idDiv = document.createElement('div');
        idDiv.className = 'model-row-id';
        idDiv.textContent = model.id;
        info.appendChild(labelDiv);
        info.appendChild(idDiv);

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
                syncEnabledFromUI();
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
    const allDefaultIds = DEFAULT_GOOGLE_MODELS.map(m => m.id);
    const onlyDefaults = ids.every(id => allDefaultIds.includes(id));
    const allDefaultsOn = allDefaultIds.every(id => ids.includes(id));
    enabledModelIds = (onlyDefaults && allDefaultsOn && customModelIds.length === 0) ? null : ids;
}

addModelBtn.addEventListener('click', () => {
    const val = customInput.value.trim();
    if (!val) return;
    const allIds = [...DEFAULT_GOOGLE_MODELS.map(m => m.id), ...customModelIds];
    if (allIds.includes(val)) { customInput.value = ''; return; }
    customModelIds.push(val);
    if (enabledModelIds !== null) enabledModelIds.push(val);
    customInput.value = '';
    buildModelRows();
});

customInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') addModelBtn.click();
});

// ── Ollama model list ─────────────────────────────────────────────────────────

function buildOllamaModelRows() {
    ollamaModelList.innerHTML = '';

    if (ollamaModelIds.length === 0) {
        const hint = document.createElement('div');
        hint.style.cssText = 'font-size:12px;color:#4a4640;padding:8px 0;';
        hint.textContent = 'No models added yet. Type a model name above and click + Add.';
        ollamaModelList.appendChild(hint);
        return;
    }

    for (const modelId of ollamaModelIds) {
        const isEnabled = ollamaEnabledModelIds === null || ollamaEnabledModelIds.includes(modelId);
        const row = document.createElement('div');
        row.className = 'model-row';
        row.dataset.modelId = modelId;

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = isEnabled;
        cb.addEventListener('change', () => syncOllamaEnabledFromUI());

        const info = document.createElement('div');
        info.className = 'model-row-info';
        info.innerHTML = `<div class="model-row-label">${modelId}</div>`;

        const rmBtn = document.createElement('button');
        rmBtn.className = 'model-remove-btn';
        rmBtn.title = 'Remove';
        rmBtn.textContent = '×';
        rmBtn.addEventListener('click', () => {
            ollamaModelIds = ollamaModelIds.filter(id => id !== modelId);
            syncOllamaEnabledFromUI();
            buildOllamaModelRows();
        });

        row.appendChild(cb);
        row.appendChild(info);
        row.appendChild(rmBtn);
        ollamaModelList.appendChild(row);
    }
}

function syncOllamaEnabledFromUI() {
    const rows = ollamaModelList.querySelectorAll('.model-row');
    const ids = [];
    rows.forEach(row => {
        const cb = row.querySelector('input[type="checkbox"]');
        if (cb && cb.checked) ids.push(row.dataset.modelId);
    });
    const allOn = ollamaModelIds.every(id => ids.includes(id));
    ollamaEnabledModelIds = allOn ? null : ids;
}

addOllamaModelBtn.addEventListener('click', () => {
    const val = customOllamaInput.value.trim();
    if (!val) return;
    if (ollamaModelIds.includes(val)) { customOllamaInput.value = ''; return; }
    ollamaModelIds.push(val);
    if (ollamaEnabledModelIds !== null) ollamaEnabledModelIds.push(val);
    customOllamaInput.value = '';
    buildOllamaModelRows();
});

customOllamaInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') addOllamaModelBtn.click();
});

// ── Test / Fetch Ollama models ────────────────────────────────────────────────

async function fetchOllamaTags() {
    const url = (ollamaUrlIn.value.trim() || 'http://localhost:11434').replace(/\/$/, '');
    const res = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (res.status === 403) throw new Error('403 Forbidden — restart Ollama with: OLLAMA_ORIGINS=* ollama serve');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data.models || []).map(m => m.name);
}

testBtn.addEventListener('click', async () => {
    ollamaStatus.textContent = 'Testing…';
    ollamaStatus.className = '';
    try {
        const models = await fetchOllamaTags();
        ollamaStatus.textContent = `Connected — models: ${models.join(', ') || '(none)'}`;
        ollamaStatus.className = 'status-ok';
    } catch (e) {
        ollamaStatus.textContent = `Failed: ${e.message}`;
        ollamaStatus.className = 'status-err';
    }
});

fetchModelsBtn.addEventListener('click', async () => {
    ollamaStatus.textContent = 'Fetching…';
    ollamaStatus.className = '';
    try {
        const models = await fetchOllamaTags();
        if (models.length === 0) {
            ollamaStatus.textContent = 'No models found on this Ollama server.';
            ollamaStatus.className = 'status-err';
            return;
        }
        let added = 0;
        for (const id of models) {
            if (!ollamaModelIds.includes(id)) {
                ollamaModelIds.push(id);
                added++;
            }
        }
        buildOllamaModelRows();
        ollamaStatus.textContent = added > 0
            ? `Added ${added} model${added > 1 ? 's' : ''}: ${models.join(', ')}`
            : `Already up to date (${models.length} model${models.length > 1 ? 's' : ''} present)`;
        ollamaStatus.className = 'status-ok';
    } catch (e) {
        ollamaStatus.textContent = `Failed: ${e.message}`;
        ollamaStatus.className = 'status-err';
    }
});

// ── Load settings ─────────────────────────────────────────────────────────────

chrome.storage.sync.get(
    ['modelProvider', 'geminiApiKey', 'enabledModelIds', 'customModelIds',
     'ollamaBaseUrl', 'ollamaModels', 'ollamaEnabledModels', 'ollamaModel'],
    (result) => {
        const provider = result.modelProvider || 'google';
        if (provider === 'ollama') {
            provOllama.checked = true;
        } else {
            provGoogle.checked = true;
        }
        applyProviderUI();

        if (result.geminiApiKey) apiKeyInput.value = result.geminiApiKey;

        customModelIds = result.customModelIds || [];
        enabledModelIds = result.enabledModelIds || null;
        buildModelRows();

        ollamaUrlIn.value = result.ollamaBaseUrl || 'http://localhost:11434';

        // Migrate old single ollamaModel string to ollamaModels array
        if (result.ollamaModels && result.ollamaModels.length > 0) {
            ollamaModelIds = result.ollamaModels;
        } else if (result.ollamaModel) {
            ollamaModelIds = [result.ollamaModel];
        } else {
            ollamaModelIds = [];
        }
        ollamaEnabledModelIds = result.ollamaEnabledModels || null;
        buildOllamaModelRows();
    }
);

// ── Save ──────────────────────────────────────────────────────────────────────

saveBtn.addEventListener('click', () => {
    syncEnabledFromUI();
    syncOllamaEnabledFromUI();

    const provider = provGoogle.checked ? 'google' : 'ollama';

    chrome.storage.sync.set({
        modelProvider:       provider,
        geminiApiKey:        apiKeyInput.value.trim(),
        enabledModelIds:     enabledModelIds,
        customModelIds:      customModelIds,
        ollamaBaseUrl:       ollamaUrlIn.value.trim() || 'http://localhost:11434',
        ollamaModels:        ollamaModelIds,
        ollamaEnabledModels: ollamaEnabledModelIds,
        // keep legacy key in sync for any code that still reads it
        ollamaModel:         ollamaModelIds[0] || '',
    }, () => {
        saveStatus.textContent = 'Settings saved.';
        setTimeout(() => { saveStatus.textContent = ''; }, 3000);
    });
});
