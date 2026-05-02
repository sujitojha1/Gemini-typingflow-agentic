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
});
