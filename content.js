// Injected into every page. Extracts text when requested.

let lastFocusedField = null;

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
  if (lastFocusedField) {
    if (lastFocusedField.tagName === 'TEXTAREA' || lastFocusedField.tagName === 'INPUT') {
      return lastFocusedField.value;
    }
    const text = lastFocusedField.innerText || '';
    if (text.trim()) return text;
  }
  const contentEl =
    document.querySelector('article') ||
    document.querySelector('main') ||
    document.querySelector('[role="main"]') ||
    document.body;
  return contentEl.innerText || '';
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_FIELD_TEXT') {
    sendResponse({ text: getFieldText() });
  }
  if (msg.type === 'OPEN_TYPING_IFRAME') {
    if (document.getElementById('tf-fullscreen-iframe')) return;
    const frame = document.createElement('iframe');
    frame.id = 'tf-fullscreen-iframe';
    frame.src = chrome.runtime.getURL('panel/panel.html?mode=typing');
    frame.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;border:none;z-index:2147483647;background:#0d0c0b;';
    document.body.appendChild(frame);
    document.body.style.overflow = 'hidden';
  }
});

window.addEventListener('message', e => {
  if (e.data?.type === 'CLOSE_TYPING_IFRAME') {
    const frame = document.getElementById('tf-fullscreen-iframe');
    if (frame) frame.remove();
    document.body.style.overflow = '';
  }
});
