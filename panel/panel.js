// Runs inside the chrome-extension:// iframe.

let capturedWordCount = 0;
let typingChunks      = [];   // set from chunk_text tool result or local extract
let pendingTyping     = false;
let analyzeCardNode   = null;
let analyzeCount      = 0;

// ─── Typing session state ─────────────────────────────────────────────────────

let typingIdx         = 0;
let sessionStart      = 0;
let chunkStart        = 0;
let sessionTotalChars = 0;
let statsTimer        = null;

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
  $('api-key-input').addEventListener('keydown', e => { if (e.key === 'Enter') saveKey(); });
  $('settings-btn').addEventListener('click', () => showView('setup-view'));
  $('refresh-btn').addEventListener('click', requestFieldText);
  $('run-btn').addEventListener('click', runAgent);
  $('typing-btn').addEventListener('click', openTypingSession);
  $('reset-btn').addEventListener('click', resetUI);
  $('copy-btn').addEventListener('click', copyReport);

  // Typing view controls
  $('t-close').addEventListener('click', closeTypingSession);
  $('t-exit').addEventListener('click', closeTypingSession);
  $('t-prev').addEventListener('click', () => { typingIdx = Math.max(0, typingIdx - 1); renderChunk(); });
  $('t-next').addEventListener('click', () => { typingIdx++; renderChunk(); });

  // Hidden input handlers
  const inp = $('t-input');
  inp.addEventListener('input',   onTypingInput);
  inp.addEventListener('paste',   e => e.preventDefault());
  inp.addEventListener('drop',    e => e.preventDefault());
  inp.addEventListener('keydown', e => {
    // Allow backspace, arrow keys; block clipboard shortcuts
    if ((e.ctrlKey || e.metaKey) && ['v','c','x','a'].includes(e.key.toLowerCase())) {
      e.preventDefault();
    }
  });

  // Click on target re-focuses input
  $('t-target').addEventListener('click', () => $('t-input').focus());
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

function updateWordBadge(text) {
  capturedWordCount = text ? text.trim().split(/\s+/).filter(Boolean).length : 0;
  const badge = $('word-badge');
  if (capturedWordCount > 0) {
    badge.textContent = `${capturedWordCount} words`;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

// ─── Agent run ────────────────────────────────────────────────────────────────

function runAgent() {
  const prompt = 'Analyse my writing and give a full report.';
  resetUI(false);

  $('pipeline').classList.remove('hidden');
  $('chain-section').classList.remove('hidden');
  $('spinner').classList.remove('hidden');
  setPipelineStep('count_stats', 'active');

  $('run-btn').disabled    = true;
  $('run-btn').textContent = '⏳ Analysing…';

  // Empty text → content.js calls getFieldText() to grab full page content
  window.parent.postMessage({ type: 'RUN_AGENT', text: '', prompt }, '*');
}

function resetUI(full = true) {
  $('steps-container').innerHTML = '';
  $('chain-section').classList.add('hidden');
  $('report-section').classList.add('hidden');
  $('pipeline').classList.add('hidden');
  $('spinner').classList.add('hidden');
  $('run-btn').disabled    = false;
  $('run-btn').textContent = 'Process Page Intelligence';
  analyzeCardNode = null;
  analyzeCount = 0;
  resetPipeline();
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
      $('copy-btn').textContent = 'Copy failed';
      setTimeout(() => { $('copy-btn').textContent = 'Copy report'; }, 2500);
    });
}

// ─── Pipeline ─────────────────────────────────────────────────────────────────

const PIPE_ORDER = ['count_stats', 'chunk_text', 'analyze_chunk', 'done'];

function resetPipeline() {
  PIPE_ORDER.forEach(n => setPipelineStep(n, 'idle'));
}

function setPipelineStep(name, state) {
  const el = $(`pipe-${name}`);
  if (el) el.className = `pipe-step ${state}`;
}

function updatePipeline(name) {
  const idx = PIPE_ORDER.indexOf(name);
  if (idx === -1) return;
  PIPE_ORDER.slice(0, idx).forEach(s => setPipelineStep(s, 'done'));
  setPipelineStep(name, 'active');
}

// ─── Incoming messages ────────────────────────────────────────────────────────

window.addEventListener('message', (e) => {
  const msg = e.data;
  if (!msg?.type) return;
  switch (msg.type) {
    case 'FIELD_TEXT':
      updateWordBadge(msg.text);
      if (pendingTyping) startTypingWithText(msg.text);
      break;
    case 'AGENT_STEP':  onStep(msg);          break;
    case 'AGENT_DONE':  onDone(msg.text);     break;
    case 'AGENT_ERROR': onError(msg.message); break;
  }
});

// ─── Step cards ───────────────────────────────────────────────────────────────

const TOOL_META = {
  count_stats:     { icon: '📊', label: 'count_stats',     css: 'count-stats' },
  chunk_text:      { icon: '✂️',  label: 'chunk_text',      css: 'chunk-text' },
  analyze_chunk:   { icon: '🧠', label: 'analyze_chunk',   css: 'analyze-chunk' }
};

function onStep({ name, args, result }) {
  $('spinner').classList.add('hidden');
  updatePipeline(name);

  // Store chunks from chunk_text for typing session
  if (name === 'chunk_text' && result?.chunks?.length) {
    typingChunks = result.chunks;
  }

  const meta    = TOOL_META[name] || { icon: '🔧', label: name, css: 'unknown' };

  if (name === 'analyze_chunk') {
    analyzeCount++;
    const total = typingChunks.length || '?';
    const summaryText = `${analyzeCount} / ${total} chunks analyzed`;

    if (!analyzeCardNode) {
      analyzeCardNode = document.createElement('div');
      analyzeCardNode.className = `step-card step-${meta.css}`;
      analyzeCardNode.innerHTML = `
        <div class="step-header t-topbar" style="border-radius: 8px; padding: 8px 12px; cursor: pointer; display: flex; align-items: center; border-bottom: none;">
          <div style="display: flex; gap: 6px; margin-right: 12px;">
            <div class="t-dot" style="background:#ED655A; width: 10px; height: 10px; border-radius: 50%;"></div>
            <div class="t-dot" style="background:#E1C04C; width: 10px; height: 10px; border-radius: 50%;"></div>
            <div class="t-dot" style="background:#72BE47; width: 10px; height: 10px; border-radius: 50%;"></div>
          </div>
          <span class="step-icon">${meta.icon}</span>
          <span class="step-name" style="flex:1; margin-left: 8px; color: var(--text);">analyze_chunks</span>
          <span class="step-summary" id="analyze-summary-text" style="margin-right: 12px;">${summaryText}</span>
          <button class="step-toggle" aria-label="Toggle details" style="background:none; border:none; color:var(--text-muted); cursor:pointer;">▾</button>
        </div>
        <div class="step-body hidden" id="analyze-body-container" style="padding-top: 12px;"></div>
      `;

      analyzeCardNode.querySelector('.step-header').addEventListener('click', () => {
        const body = analyzeCardNode.querySelector('.step-body');
        const btn  = analyzeCardNode.querySelector('.step-toggle');
        body.classList.toggle('hidden');
        btn.textContent = body.classList.contains('hidden') ? '▾' : '▴';
      });

      $('steps-container').appendChild(analyzeCardNode);
    } else {
      const summaryEl = analyzeCardNode.querySelector('#analyze-summary-text');
      if (summaryEl) summaryEl.textContent = summaryText;
    }

    const detailHtml = buildDetailHtml(name, args, result);
    const chunkBlock = document.createElement('div');
    chunkBlock.className = 'analyze-chunk-block';
    chunkBlock.style.borderTop = '1px solid #333';
    chunkBlock.style.marginTop = '12px';
    chunkBlock.style.paddingTop = '12px';
    
    const { readability: r = 0, clarity: c = 0, coherence: co = 0 } = result || {};

    chunkBlock.innerHTML = `
      <div style="font-weight: 600; margin-bottom: 8px; color: #888;">Chunk ${analyzeCount} &middot; R:${r} C:${c} Co:${co}</div>
      ${detailHtml}
    `;
    analyzeCardNode.querySelector('#analyze-body-container').appendChild(chunkBlock);
    analyzeCardNode.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }

  const summary = buildSummary(name, result);
  const card    = document.createElement('div');
  card.className = `step-card step-${meta.css}`;

  card.innerHTML = `
    <div class="step-header">
      <span class="step-icon">${meta.icon}</span>
      <span class="step-name">${meta.label}</span>
      <span class="step-summary">${esc(summary)}</span>
      <button class="step-toggle" aria-label="Toggle details">▾</button>
    </div>
    <div class="step-body hidden">${buildDetailHtml(name, args, result)}</div>
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
      return `${result.word_count ?? '?'} words · ${result.sentence_count ?? '?'} sentences`;
    case 'chunk_text': {
      const n = result.chunks?.length ?? 0;
      return `${n} chunk${n !== 1 ? 's' : ''} produced`;
    }
    case 'analyze_chunk': {
      const sum = (result.summary || '').slice(0, 40) + ((result.summary || '').length > 40 ? '…' : '');
      const { readability: r = 0, clarity: c = 0, coherence: co = 0 } = result;
      return `${sum} | R:${r} C:${c} Co:${co}`;
    }
    default: return '';
  }
}

function buildDetailHtml(name, args, result) {
  const safeArgs   = sanitiseArgs(args);
  const argsJson   = JSON.stringify(safeArgs, null, 2);

  if (name === 'analyze_chunk' && result && !result.error) {
    const { summary = '', readability: r = 0, clarity: c = 0, coherence: co = 0, feedback = '' } = result;
    return `
      <div class="step-sub-label">Args</div>
      <pre class="step-json">${esc(argsJson)}</pre>
      <div class="step-sub-label">Summary</div>
      <div class="score-feedback">"${esc(summary)}"</div>
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
    if (typeof out[k] === 'string' && out[k].length > 120) out[k] = out[k].slice(0, 120) + '…';
  });
  return out;
}

function onDone(text) {
  $('spinner').classList.add('hidden');
  $('run-btn').disabled    = false;
  $('run-btn').textContent = 'Process Page Intelligence';
  PIPE_ORDER.forEach(s => setPipelineStep(s, 'done'));
  $('report-body').innerHTML = renderMarkdown(text || '(No report returned.)');
  $('report-section').classList.remove('hidden');
  $('report-section').scrollIntoView({ behavior: 'smooth' });
}

function onError(message) {
  $('spinner').classList.add('hidden');
  $('run-btn').disabled    = false;
  $('run-btn').textContent = 'Process Page Intelligence';
  const el = document.createElement('div');
  el.className   = 'error-card';
  el.textContent = `Error: ${message}`;
  $('steps-container').appendChild(el);
  $('chain-section').classList.remove('hidden');
}

// ─── Typing session ───────────────────────────────────────────────────────────

function openTypingSession() {
  if (typingChunks.length > 0) {
    // Use chunks already extracted by the agent
    startTyping();
    return;
  }
  // No agent run yet — pull page text and chunk locally
  pendingTyping = true;
  $('typing-btn').disabled    = true;
  $('typing-btn').textContent = '⏳ Extracting…';
  requestFieldText();
}

function startTypingWithText(text) {
  pendingTyping = false;
  $('typing-btn').disabled    = false;
  $('typing-btn').textContent = 'Launch Typing Session';

  if (!text?.trim()) {
    setTypingBtnError('No content — click ↻ first');
    return;
  }

  typingChunks = extractChunks(text);
  if (!typingChunks.length) {
    setTypingBtnError('No chunks found');
    return;
  }

  startTyping();
}

function setTypingBtnError(msg) {
  $('typing-btn').textContent = msg;
  setTimeout(() => { $('typing-btn').textContent = 'Launch Typing Session'; }, 3000);
}

function startTyping() {
  window.parent.postMessage({ type: 'TYPING_START' }, '*');
  typingIdx         = 0;
  sessionStart      = Date.now();
  sessionTotalChars = 0;
  showView('typing-view');
  renderChunk();
}

function renderChunk() {
  clearInterval(statsTimer);

  if (typingIdx >= typingChunks.length) {
    showComplete();
    return;
  }

  const text = typingChunks[typingIdx].replace(/\s+/g, ' ').trim();

  // Build character spans
  $('t-target').innerHTML = text.split('').map((ch, i) =>
    `<span class="tc" data-i="${i}">${ch === ' ' ? ' ' : esc(ch)}</span>`
  ).join('');

  // Set cursor on first char
  const first = $('t-target').querySelector('.tc');
  if (first) first.classList.add('cursor');

  $('t-chunk-num').textContent = `${typingIdx + 1} / ${typingChunks.length}`;
  $('t-wpm').textContent       = '0';
  $('t-acc').textContent       = '—';
  $('t-time').textContent      = '0s';
  $('t-prev').disabled         = typingIdx === 0;

  const inp = $('t-input');
  inp.value = '';
  chunkStart = Date.now();

  statsTimer = setInterval(() => {
    const sec = Math.round((Date.now() - chunkStart) / 1000);
    $('t-time').textContent = sec + 's';
  }, 500);

  setTimeout(() => inp.focus(), 60);
}

function onTypingInput() {
  requestAnimationFrame(updateTypingState);
}

function updateTypingState() {
  const inp   = $('t-input');
  const typed = inp.value;
  const text  = typingChunks[typingIdx].replace(/\s+/g, ' ').trim();
  const pos   = typed.length;
  const spans = $('t-target').querySelectorAll('.tc');

  spans.forEach((sp, i) => {
    sp.className = 'tc';
    if (i < pos) {
      sp.classList.add(typed[i] === text[i] ? 'correct' : 'wrong');
    } else if (i === pos) {
      sp.classList.add('cursor');
    }
  });

  // WPM
  const elapsedMin = (Date.now() - chunkStart) / 60000;
  $('t-wpm').textContent = elapsedMin > 0.005
    ? Math.round((pos / 5) / elapsedMin)
    : '0';

  // Accuracy
  let correct = 0;
  for (let i = 0; i < pos; i++) if (typed[i] === text[i]) correct++;
  $('t-acc').textContent = pos > 0 ? Math.round((correct / pos) * 100) + '%' : '—';

  // Advance when the full chunk is typed correctly
  if (pos >= text.length && typed === text) {
    clearInterval(statsTimer);
    sessionTotalChars += pos;
    setTimeout(() => { typingIdx++; renderChunk(); }, 350);
  }
}

function showComplete() {
  clearInterval(statsTimer);
  $('t-body').classList.add('hidden');
  $('t-complete').classList.remove('hidden');

  const elapsed = Math.round((Date.now() - sessionStart) / 1000);
  const wpm     = elapsed > 0 ? Math.round((sessionTotalChars / 5) / (elapsed / 60)) : 0;

  $('tc-time').textContent  = elapsed + 's';
  $('tc-chars').textContent = sessionTotalChars;
  $('tc-wpm').textContent   = wpm;
  $('t-done-sub').textContent = `all ${typingChunks.length} chunk${typingChunks.length !== 1 ? 's' : ''} engaged`;
}

function closeTypingSession() {
  window.parent.postMessage({ type: 'TYPING_END' }, '*');
  clearInterval(statsTimer);
  typingChunks = [];
  $('t-body').classList.remove('hidden');
  $('t-complete').classList.add('hidden');
  showView('main-view');
  $('typing-btn').textContent = 'Launch Typing Session';
  $('typing-btn').disabled    = false;
}

// ─── Local chunk extraction (no API — mirrors chunk_text tool logic) ──────────

function extractChunks(text, maxWords = 120) {
  const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(p => p.length > 60);
  if (!paragraphs.length) paragraphs.push(text.trim());

  const chunks = [];
  for (const para of paragraphs) {
    if (chunks.length >= 8) break;
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length <= maxWords) {
      chunks.push(para);
    } else {
      const sentences = para.split(/(?<=[.!?])\s+(?=[A-Z])/);
      let cur = [], curLen = 0;
      for (const s of sentences) {
        const len = s.split(/\s+/).filter(Boolean).length;
        if (curLen + len > maxWords && cur.length) {
          chunks.push(cur.join(' '));
          cur = []; curLen = 0;
          if (chunks.length >= 8) break;
        }
        cur.push(s); curLen += len;
      }
      if (cur.length && chunks.length < 8) chunks.push(cur.join(' '));
    }
  }
  return chunks.slice(0, 8);
}

// ─── Markdown renderer ────────────────────────────────────────────────────────

function renderMarkdown(text) {
  let html = esc(text);
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm,  '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm,   '<h1>$1</h1>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g,     '<em>$1</em>');
  html = html.replace(/^[-•] (.+)$/gm,  '<li>$1</li>');
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>[\s\S]*?<\/li>)(\n<li>[\s\S]*?<\/li>)*/g, m => `<ul>${m}</ul>`);
  html = html.replace(/\n{2,}/g, '</p><p>');
  html = `<p>${html}</p>`;
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
