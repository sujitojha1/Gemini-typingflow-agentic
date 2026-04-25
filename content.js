// Injected into every page. Manages the panel iframe and relays messages
// between the panel (chrome-extension iframe) and background service worker.

const PANEL_ORIGIN = new URL(chrome.runtime.getURL('/')).origin;

let panelFrame   = null;
let panelVisible = false;
let lastFocusedField = null;

// ─── Track the last focused text field ───────────────────────────────────────

document.addEventListener('focusin', (e) => {
  if (isTextField(e.target)) lastFocusedField = e.target;
}, true);

function isTextField(el) {
  if (!el) return false;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName === 'INPUT') {
    return ['text', 'search', 'email', 'url', 'password', ''].includes(el.type || '');
  }
  return el.isContentEditable;
}

function getFieldText() {
  if (!lastFocusedField) return '';
  if (lastFocusedField.tagName === 'TEXTAREA' || lastFocusedField.tagName === 'INPUT') {
    return lastFocusedField.value;
  }
  return lastFocusedField.innerText || '';
}

function insertIntoField(text) {
  if (!lastFocusedField) return;
  if (lastFocusedField.tagName === 'TEXTAREA' || lastFocusedField.tagName === 'INPUT') {
    lastFocusedField.value = text;
    lastFocusedField.dispatchEvent(new Event('input', { bubbles: true }));
  } else if (lastFocusedField.isContentEditable) {
    lastFocusedField.innerText = text;
    lastFocusedField.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

// ─── Panel iframe ─────────────────────────────────────────────────────────────

function createPanel() {
  const frame = document.createElement('iframe');
  frame.src = chrome.runtime.getURL('panel/panel.html');
  frame.id  = 'typingflow-agent-panel';
  Object.assign(frame.style, {
    position:   'fixed',
    top:        '0',
    right:      '0',
    width:      'min(400px, 38vw)',
    height:     '100vh',
    border:     'none',
    zIndex:     '2147483647',
    boxShadow:  '-4px 0 32px rgba(0,0,0,0.18)',
    transition: 'transform 0.25s ease',
    background: '#fff'
  });
  document.body.appendChild(frame);
  return frame;
}

function togglePanel() {
  if (!panelFrame) {
    panelFrame   = createPanel();
    panelVisible = true;
  } else {
    panelVisible = !panelVisible;
    panelFrame.style.transform = panelVisible ? '' : 'translateX(100%)';
  }
}

function forwardToPanel(msg) {
  if (panelFrame?.contentWindow) {
    panelFrame.contentWindow.postMessage(msg, PANEL_ORIGIN);
  }
}

// ─── Messages from background → forward to panel ─────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  switch (msg.type) {
    case 'TOGGLE_PANEL':
      togglePanel();
      break;
    case 'AGENT_STEP':
    case 'AGENT_DONE':
    case 'AGENT_ERROR':
      forwardToPanel(msg);
      break;
  }
});

// ─── Messages from panel iframe → handle or relay to background ───────────────

window.addEventListener('message', (e) => {
  if (!panelFrame || e.source !== panelFrame.contentWindow) return;
  const msg = e.data;
  if (!msg?.type) return;

  switch (msg.type) {
    case 'GET_FIELD_TEXT':
      forwardToPanel({ type: 'FIELD_TEXT', text: getFieldText() });
      break;

    case 'RUN_AGENT':
      // Merge captured field text if the panel didn't pass any
      chrome.runtime.sendMessage({
        type:   'RUN_AGENT',
        text:   msg.text || getFieldText(),
        prompt: msg.prompt
      });
      break;

    case 'COPY_TEXT':
      insertIntoField(msg.text);
      break;
  }
});
