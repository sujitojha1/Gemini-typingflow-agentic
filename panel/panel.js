// Runs inside the chrome-extension:// iframe.
// Talks to background via chrome.runtime.sendMessage.
// Talks to content.js via window.parent.postMessage.

let capturedText = '';

// ─── Boot ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  checkApiKey();
  wireButtons();
});

function checkApiKey() {
  chrome.runtime.sendMessage({ type: 'GET_API_KEY' }, (res) => {
    if (chrome.runtime.lastError) { showView('setup-view'); return; }
    if (res?.key) {
      showView('main-view');
      requestFieldText();
    } else {
      showView('setup-view');
    }
  });
}

function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

// ─── Button wiring ────────────────────────────────────────────────────────────

function wireButtons() {
  $('save-key-btn').addEventListener('click', saveKey);
  $('api-key-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveKey(); });
  $('settings-btn').addEventListener('click', () => showView('setup-view'));
  $('refresh-btn').addEventListener('click', requestFieldText);
  $('run-btn').addEventListener('click', runAgent);
  $('reset-btn').addEventListener('click', resetUI);
  $('copy-btn').addEventListener('click', copyReport);
}

function $(id) { return document.getElementById(id); }

function saveKey() {
  const key = $('api-key-input').value.trim();
  if (!key) return;
  chrome.runtime.sendMessage({ type: 'SAVE_API_KEY', key }, () => {
    showView('main-view');
    requestFieldText();
  });
}

// ─── Field text ───────────────────────────────────────────────────────────────

function requestFieldText() {
  window.parent.postMessage({ type: 'GET_FIELD_TEXT' }, '*');
}

function updatePreview(text) {
  capturedText = text || '';
  const words  = capturedText.trim().split(/\s+/).filter(Boolean).length;
  const badge  = $('word-badge');
  const box    = $('field-preview');
  if (capturedText) {
    box.textContent = capturedText.slice(0, 280) + (capturedText.length > 280 ? '…' : '');
    badge.textContent = `${words} words`;
    badge.classList.remove('hidden');
  } else {
    box.textContent = 'Focus a text field on the page, then click ↻.';
    badge.textContent = '';
  }
}

// ─── Agent controls ───────────────────────────────────────────────────────────

function runAgent() {
  if (!capturedText.trim()) {
    const box = $('field-preview');
    box.textContent = 'No text captured — focus a text field on the page and click ↻ first.';
    box.style.color = 'var(--red, #dc2626)';
    setTimeout(() => { box.style.color = ''; updatePreview(capturedText); }, 3000);
    return;
  }
  const prompt = $('prompt-input').value.trim() || 'Analyse my writing and give a full report.';
  resetUI(false);
  $('chain-section').classList.remove('hidden');
  $('spinner').classList.remove('hidden');
  $('run-btn').disabled    = true;
  $('run-btn').textContent = '⏳ Running…';
  window.parent.postMessage({ type: 'RUN_AGENT', text: capturedText, prompt }, '*');
}

function resetUI(full = true) {
  $('steps-container').innerHTML = '';
  $('chain-section').classList.add('hidden');
  $('report-section').classList.add('hidden');
  $('spinner').classList.add('hidden');
  $('run-btn').disabled    = false;
  $('run-btn').textContent = '▶ Run Agent';
  if (full) $('prompt-input').value = '';
}

function copyReport() {
  const text = $('report-body').innerText;
  window.parent.postMessage({ type: 'COPY_TEXT', text }, '*');
  navigator.clipboard.writeText(text)
    .then(() => {
      $('copy-btn').textContent = '✓ Copied';
      setTimeout(() => { $('copy-btn').textContent = 'Copy report'; }, 2000);
    })
    .catch(() => {
      $('copy-btn').textContent = 'Copy failed — try again';
      setTimeout(() => { $('copy-btn').textContent = 'Copy report'; }, 2500);
    });
}

// ─── Incoming messages from content.js ───────────────────────────────────────

window.addEventListener('message', (e) => {
  const msg = e.data;
  if (!msg?.type) return;
  switch (msg.type) {
    case 'FIELD_TEXT':  updatePreview(msg.text); break;
    case 'AGENT_STEP':  onStep(msg); break;
    case 'AGENT_DONE':  onDone(msg.text); break;
    case 'AGENT_ERROR': onError(msg.message); break;
  }
});

// ─── Step cards ───────────────────────────────────────────────────────────────

const TOOL_META = {
  count_stats:      { icon: '📊', label: 'count_stats',      css: 'count-stats' },
  chunk_text:       { icon: '✂️',  label: 'chunk_text',       css: 'chunk-text' },
  summarize_chunk:  { icon: '📝', label: 'summarize_chunk',  css: 'summarize-chunk' },
  score_chunk:      { icon: '⭐', label: 'score_chunk',      css: 'score-chunk' }
};

function onStep({ name, args, result }) {
  $('spinner').classList.add('hidden');

  const meta      = TOOL_META[name] || { icon: '🔧', label: name, css: 'unknown' };
  const summary   = buildSummary(name, result);

  const card = document.createElement('div');
  card.className = `step-card step-${meta.css}`;

  // Build inner HTML
  const detailHtml = buildDetailHtml(name, args, result);

  card.innerHTML = `
    <div class="step-header">
      <span class="step-icon">${meta.icon}</span>
      <span class="step-name">${meta.label}</span>
      <span class="step-summary">${esc(summary)}</span>
      <button class="step-toggle" aria-label="Toggle details">▾</button>
    </div>
    <div class="step-body hidden">${detailHtml}</div>
  `;

  card.querySelector('.step-header').addEventListener('click', () => {
    const body = card.querySelector('.step-body');
    const btn  = card.querySelector('.step-toggle');
    body.classList.toggle('hidden');
    btn.textContent = body.classList.contains('hidden') ? '▾' : '▴';
  });

  $('steps-container').appendChild(card);
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function buildSummary(name, result) {
  if (!result) return '';
  switch (name) {
    case 'count_stats':
      return `${result.word_count ?? '?'} words · ${result.sentence_count ?? '?'} sentences · ${result.paragraph_count ?? '?'} paragraphs`;
    case 'chunk_text': {
      const n = result.chunks?.length ?? 0;
      return `${n} chunk${n !== 1 ? 's' : ''} produced`;
    }
    case 'summarize_chunk':
      return (result.summary || '').slice(0, 72) + ((result.summary || '').length > 72 ? '…' : '');
    case 'score_chunk': {
      const { readability: r = 0, clarity: c = 0, coherence: co = 0 } = result;
      return `R:${r}  C:${c}  Co:${co}  avg:${((r + c + co) / 3).toFixed(1)}`;
    }
    default: return '';
  }
}

function buildDetailHtml(name, args, result) {
  const safeArgs = sanitiseArgs(args);
  const argsJson = JSON.stringify(safeArgs, null, 2);

  if (name === 'score_chunk' && result && !result.error) {
    const { readability: r = 0, clarity: c = 0, coherence: co = 0, feedback = '' } = result;
    return `
      <div class="step-sub-label">Args</div>
      <pre class="step-json">${esc(argsJson)}</pre>
      <div class="step-sub-label">Scores</div>
      <div class="score-grid">
        ${scorePill('Readability', r)}
        ${scorePill('Clarity', c)}
        ${scorePill('Coherence', co)}
      </div>
      ${feedback ? `<div class="score-feedback">"${esc(feedback)}"</div>` : ''}
    `;
  }

  const resultJson = JSON.stringify(result, null, 2);
  return `
    <div class="step-sub-label">Args</div>
    <pre class="step-json">${esc(argsJson)}</pre>
    <div class="step-sub-label">Result</div>
    <pre class="step-json">${esc(resultJson)}</pre>
  `;
}

function scorePill(label, value) {
  const cls = value >= 7 ? 'high' : value >= 4 ? 'mid' : 'low';
  return `
    <div class="score-pill">
      <div class="score-label">${label}</div>
      <div class="score-value ${cls}">${value}</div>
    </div>`;
}

function sanitiseArgs(args) {
  const out = { ...args };
  ['text', 'chunk'].forEach(k => {
    if (typeof out[k] === 'string' && out[k].length > 120) {
      out[k] = out[k].slice(0, 120) + '…';
    }
  });
  return out;
}

// ─── Final report ─────────────────────────────────────────────────────────────

function onDone(text) {
  $('spinner').classList.add('hidden');
  $('run-btn').disabled    = false;
  $('run-btn').textContent = '▶ Run Agent';

  $('report-body').innerHTML = renderMarkdown(text || '(No report returned.)');
  $('report-section').classList.remove('hidden');
  $('report-section').scrollIntoView({ behavior: 'smooth' });
}

function onError(message) {
  $('spinner').classList.add('hidden');
  $('run-btn').disabled    = false;
  $('run-btn').textContent = '▶ Run Agent';

  const el = document.createElement('div');
  el.className   = 'error-card';
  el.textContent = `Error: ${message}`;
  $('steps-container').appendChild(el);
}

// ─── Minimal Markdown renderer ────────────────────────────────────────────────

function renderMarkdown(text) {
  let html = esc(text);
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm,  '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm,   '<h1>$1</h1>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g,     '<em>$1</em>');
  html = html.replace(/^[-•] (.+)$/gm,  '<li>$1</li>');
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
  // Wrap consecutive <li> runs in <ul>
  html = html.replace(/(<li>[\s\S]*?<\/li>)(\n<li>[\s\S]*?<\/li>)*/g,
    m => `<ul>${m}</ul>`);
  html = html.replace(/\n{2,}/g, '</p><p>');
  html = `<p>${html}</p>`;
  // Remove empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, '');
  return html;
}

function esc(s) {
  return String(s)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;');
}
