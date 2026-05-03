function isValidHttpUrl(str) {
    try {
        const url = new URL(str);
        return url.protocol === 'https:' || url.protocol === 'http:';
    } catch { return false; }
}

// Phase 2: Advanced DOM Extraction for Semantic LLM Structuring
function extractPageContent() {
    const root = document.querySelector('article, main, [role="main"]') || document.body;
    const elements = Array.from(root.querySelectorAll('p, h1, h2, h3, li, blockquote, img'))
        .filter(el => {
            if (el.closest('nav, header, footer, aside, [role="navigation"]')) return false;
            if (el.tagName === 'IMG') {
                const rect = el.getBoundingClientRect();
                if ((el.width && el.width < 100) || rect.width < 100) return false;
                return true;
            }
            if (el.tagName !== 'IMG' && el.innerText.trim().length < 30) return false;
            return true;
        });

    let structuredPayload = [];
    elements.forEach(el => {
        if (el.tagName === 'IMG') {
            const src = el.src || el.dataset.src;
            if (src && !src.startsWith('data:')) structuredPayload.push({ type: 'image', src: src });
        } else {
            structuredPayload.push({ type: 'text', content: el.innerText.trim() });
        }
    });
    return structuredPayload;
}

// -------------------------------------------------------------
// Phases 3, 4 & 5: Active Recall UI & Second Brain Markdown Export
// -------------------------------------------------------------

let sessionData = null;
let currentNuggetIndex = 0;
let overlayWrapper = null;
let startTime = null;
let errorsMade = 0;

const INJECT_CSS = `
  @keyframes fade-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
  #tf-overlay-root {
    position: fixed; inset: 0; z-index: 2147483647; background: rgba(15, 15, 20, 0.95); backdrop-filter: blur(16px);
    display: flex; flex-direction: column; font-family: 'Menlo', 'Monaco', monospace; color: #ECEBDE;
    animation: fade-in 0.3s cubic-bezier(0.16, 1, 0.3, 1); overflow-y: auto; box-sizing: border-box;
  }
  #tf-overlay-root * { box-sizing: border-box; text-transform: none; }
  
  .tf-topbar { 
    display: flex; justify-content: space-between; align-items: center; 
    padding: 20px 40px; background: rgba(0,0,0,0.3); border-bottom: 1px solid rgba(255,255,255,0.05);
  }
  .tf-dots { display: flex; gap: 8px; }
  .tf-dot { width: 12px; height: 12px; border-radius: 50%; }
  .tf-dot-r { background: #ff5f56; } .tf-dot-y { background: #ffbd2e; } .tf-dot-g { background: #27c93f; }
  .tf-title { color: #888; font-size: 13px; font-weight: 500; letter-spacing: 0.5px; }
  .tf-close-box { 
    width: 32px; height: 32px; display: flex; justify-content: center; align-items: center; 
    border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; cursor: pointer; color: #888; transition: all 0.2s; font-size: 20px;
  }
  .tf-close-box:hover { color: #fff; background: rgba(255,255,255,0.1); }
  
  .tf-stats-bar {
    display: flex; justify-content: space-between; align-items: center; max-width: 1100px; width: 100%; margin: 40px auto 20px;
    font-size: 12px; color: #888; font-family: 'Menlo', monospace; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 20px;
  }
  .tf-nav-btns { display: flex; gap: 20px; }
  .tf-nav-btn { background: none; border: none; color: #4a8cd4; cursor: pointer; font-family: inherit; font-size: 13px; font-weight: 600; padding: 0; outline: none; margin: 0; }
  .tf-nav-btn.disabled { color: #444; cursor: not-allowed; }
  
  .tf-main-container {
    display: flex; gap: 40px; max-width: 1100px; margin: 0 auto; width: 100%; align-items: flex-start;
  }
  
  .tf-image-panel {
    flex: 0 0 450px; border-radius: 8px; overflow: hidden; box-shadow: 0 12px 32px rgba(0,0,0,0.4);
    background: #1a1a1a; display: flex; justify-content: center; align-items: flex-start; position: sticky; top: 120px;
  }
  .tf-image-panel img { width: 100%; height: auto; object-fit: contain; display: block; max-height: 500px; }
  
  .tf-typing-panel { flex: 1; position: relative; }
  .tf-nugget-name { color: #666; font-size: 13px; margin-bottom: 24px; font-family: 'Menlo', monospace; }
  
  #tf-target { font-size: 18px; line-height: 1.8; color: #555; white-space: pre-wrap; word-break: break-word; outline: none; }
  .tf-char.correct { color: #ECEBDE; }
  .tf-char.wrong { color: #ff5555; background: rgba(255, 85, 85, 0.1); border-bottom: 2px solid #ff5555; }
  .tf-char.cursor { color: #4a8cd4; border-bottom: 2px solid #4a8cd4; animation: blink 1s step-end infinite; }
  @keyframes blink { 50% { border-color: transparent; } }
  
  .tf-hidden-input { position: absolute; opacity: 0; top: -100px; }
  
  .tf-nano-loader { font-size: 12px; color: #E1C04C; animation: pulse 1s infinite; padding: 20px; text-align: center; }
  .tf-export-btn { display: block; padding: 16px 32px; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #fff; font-size: 16px; font-family: 'Menlo', monospace; cursor: pointer; margin: 40px auto 0; transition: all 0.2s; border-radius: 4px; }
  .tf-export-btn:hover { background: rgba(74, 140, 212, 0.2); border-color: #4a8cd4; color: #4a8cd4; }

  .tf-gallery-scroll { overflow-y: auto; flex: 1; padding: 0 40px 60px; }
  .tf-gallery-hdr { max-width: 1100px; margin: 40px auto 28px; }
  .tf-gallery-cmd { color: #E1C04C; font-size: 14px; font-family: 'Menlo', monospace; }
  .tf-gallery-sub { color: #555; font-size: 12px; margin-top: 6px; font-family: 'Menlo', monospace; }
  .tf-nugget-cards { max-width: 1100px; margin: 0 auto; display: flex; flex-direction: column; gap: 12px; }
  .tf-ncard {
    border: 1px solid rgba(255,255,255,0.06); border-left: 3px solid #E1C04C; border-radius: 6px;
    background: rgba(255,255,255,0.02); cursor: pointer; overflow: hidden;
    transition: background 0.15s, border-left-color 0.15s;
  }
  .tf-ncard:hover { background: rgba(255,255,255,0.05); border-left-color: #4a8cd4; }
  .tf-ncard-label {
    padding: 10px 20px; font-size: 12px; color: #666; border-bottom: 1px solid rgba(255,255,255,0.04);
    display: flex; justify-content: space-between; align-items: center; font-family: 'Menlo', monospace;
  }
  .tf-ncard-hint { color: #4a8cd4; font-size: 11px; }
  .tf-ncard-body { display: flex; gap: 20px; padding: 16px 20px; align-items: flex-start; }
  .tf-ncard-img { flex: 0 0 130px; height: 80px; background: #111; border-radius: 4px; overflow: hidden; }
  .tf-ncard-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .tf-ncard-img-ph { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: #2a2a2a; font-size: 24px; }
  .tf-ncard-text { flex: 1; font-size: 13px; color: #777; line-height: 1.65; }

  .tf-gallery-meta { display: flex; align-items: center; gap: 20px; margin-top: 12px; }
  .tf-stars { color: #E1C04C; font-size: 16px; letter-spacing: 2px; }
  .tf-coverage { font-size: 12px; color: #555; font-family: 'Menlo', monospace; }
  .tf-coverage-bar { display: inline-block; width: 80px; height: 4px; background: #222; border-radius: 2px; vertical-align: middle; margin: 0 6px; position: relative; overflow: hidden; }
  .tf-coverage-fill { position: absolute; left: 0; top: 0; height: 100%; background: #27c93f; border-radius: 2px; }
`;

function mountUI(data) {
    let s = document.getElementById('tf-style');
    if (s) s.remove();
    s = document.createElement('style');
    s.id = 'tf-style';
    s.textContent = INJECT_CSS;
    document.head.appendChild(s);
    sessionData = data;
}

function renderNuggetGallery() {
    overlayWrapper.innerHTML = `
        <div class="tf-topbar">
            <div class="tf-dots">
                <div class="tf-dot tf-dot-r"></div>
                <div class="tf-dot tf-dot-y"></div>
                <div class="tf-dot tf-dot-g"></div>
            </div>
            <div class="tf-title">~/typingflow</div>
            <div class="tf-close-box" id="tf-close-btn">&times;</div>
        </div>
        <div class="tf-gallery-scroll">
            <div class="tf-gallery-hdr">
                <div class="tf-gallery-cmd">$ extract --page-nuggets</div>
                <div class="tf-gallery-sub" id="tf-gallery-sub"></div>
            </div>
            <div class="tf-nugget-cards" id="tf-ncard-list"></div>
        </div>
    `;

    document.getElementById('tf-close-btn').addEventListener('click', closeOverlay);

    const sub = document.getElementById('tf-gallery-sub');
    sub.textContent = `${sessionData.nuggets.length} fragments · click any to type`;

    // Star rating
    const rating = sessionData.star_rating;
    if (rating) {
        const meta = document.createElement('div');
        meta.className = 'tf-gallery-meta';

        const stars = document.createElement('span');
        stars.className = 'tf-stars';
        stars.textContent = '★'.repeat(rating) + '☆'.repeat(5 - rating);

        const coverage = document.createElement('span');
        coverage.className = 'tf-coverage';
        const pct = sessionData.coverage_pct ?? null;
        if (pct !== null) {
            const bar = document.createElement('span');
            bar.className = 'tf-coverage-bar';
            const fill = document.createElement('span');
            fill.className = 'tf-coverage-fill';
            fill.style.width = `${pct}%`;
            bar.appendChild(fill);
            coverage.appendChild(document.createTextNode('coverage'));
            coverage.appendChild(bar);
            coverage.appendChild(document.createTextNode(`${pct}%`));
        }

        meta.appendChild(stars);
        if (pct !== null) meta.appendChild(coverage);
        sub.parentNode.insertBefore(meta, sub.nextSibling);
    }

    const list = document.getElementById('tf-ncard-list');
    sessionData.nuggets.forEach((nugget, i) => {
        const card = document.createElement('div');
        card.className = 'tf-ncard';

        const label = document.createElement('div');
        label.className = 'tf-ncard-label';
        label.appendChild(document.createTextNode(`[${String(i + 1).padStart(2, '0')}] —`));
        const hint = document.createElement('span');
        hint.className = 'tf-ncard-hint';
        hint.textContent = 'click to type ›';
        label.appendChild(hint);

        const body = document.createElement('div');
        body.className = 'tf-ncard-body';

        const imgBox = document.createElement('div');
        imgBox.className = 'tf-ncard-img';
        if (nugget.img_src && isValidHttpUrl(nugget.img_src)) {
            const img = document.createElement('img');
            img.src = nugget.img_src;
            img.alt = '';
            imgBox.appendChild(img);
        } else {
            const ph = document.createElement('div');
            ph.className = 'tf-ncard-img-ph';
            ph.textContent = '⬡';
            imgBox.appendChild(ph);
        }

        const textEl = document.createElement('div');
        textEl.className = 'tf-ncard-text';
        textEl.textContent = nugget.text.length > 200 ? nugget.text.slice(0, 200) + '…' : nugget.text;

        body.appendChild(imgBox);
        body.appendChild(textEl);
        card.appendChild(label);
        card.appendChild(body);

        card.addEventListener('click', () => {
            currentNuggetIndex = i;
            renderCurrentNugget();
        });

        list.appendChild(card);
    });
}

function openOverlay() {
    if(!sessionData || !sessionData.nuggets || sessionData.nuggets.length === 0) return;
    if (overlayWrapper) overlayWrapper.remove();
    overlayWrapper = document.createElement('div');
    overlayWrapper.id = 'tf-overlay-root';
    document.body.appendChild(overlayWrapper);
    document.body.style.overflow = 'hidden';

    currentNuggetIndex = 0;
    renderNuggetGallery();
}

function renderCurrentNugget() {
    if (currentNuggetIndex >= sessionData.nuggets.length) {
        renderCompletionState();
        return;
    }

    startTime = null;
    errorsMade = 0;
    const nugget = sessionData.nuggets[currentNuggetIndex];
    const capturedIndex = currentNuggetIndex;
    const textToType = nugget.text.replace(/\s+/g, ' ');
    const isFirst = currentNuggetIndex === 0;
    const hasImage = !!nugget.img_src;

    overlayWrapper.innerHTML = `
        <div class="tf-topbar">
            <div class="tf-dots">
                <div class="tf-dot tf-dot-r"></div>
                <div class="tf-dot tf-dot-y"></div>
                <div class="tf-dot tf-dot-g"></div>
            </div>
            <div class="tf-title">typingflow - type</div>
            <div class="tf-close-box" id="tf-close-btn">&times;</div>
        </div>

        <div class="tf-stats-bar">
            <div class="tf-nav-btns">
                <button class="tf-nav-btn" id="tf-all-btn">&#9776; all</button>
                <button class="tf-nav-btn ${isFirst ? 'disabled' : ''}" id="tf-prev-btn">&larr; prev</button>
                <button class="tf-nav-btn" id="tf-next-btn">next &rarr;</button>
            </div>
            <div id="tf-stats">0 wpm &middot; 100% acc &middot; 0/${textToType.length}</div>
        </div>

        <div class="tf-main-container">
            <div class="tf-image-panel" id="tf-image-panel-${capturedIndex}"></div>
            <div class="tf-typing-panel">
                <div class="tf-nugget-name">nugget_${currentNuggetIndex + 1}_of_${sessionData.nuggets.length}.txt</div>
                <div id="tf-target"></div>
                <input type="text" class="tf-hidden-input" id="tf-type-input" autocomplete="off" spellcheck="false" />
            </div>
        </div>
    `;

    // Populate image panel after DOM is set, using captured index to avoid race condition
    const imagePanel = document.getElementById(`tf-image-panel-${capturedIndex}`);
    if (hasImage && isValidHttpUrl(nugget.img_src)) {
        const img = document.createElement('img');
        img.alt = 'Contextual Asset';
        img.src = nugget.img_src;
        imagePanel.appendChild(img);
    } else if (!hasImage) {
        const loader = document.createElement('div');
        loader.className = 'tf-nano-loader';
        loader.id = `tf-nano-${capturedIndex}`;
        loader.textContent = '🖼️ Rendering visual via Gemini Flash Image...';
        imagePanel.appendChild(loader);

        chrome.runtime.sendMessage({
            action: "generate_image_asset",
            payload: { text: nugget.text, tags: sessionData.tags }
        }, (resp) => {
            console.log("[typingflow] Image response:", resp);
            const container = document.getElementById(`tf-nano-${capturedIndex}`);
            if (resp && resp.success && resp.img_src) {
                sessionData.nuggets[capturedIndex].img_src = resp.img_src;
                if (container) {
                    const img = document.createElement('img');
                    img.alt = 'Contextual Asset';
                    img.src = resp.img_src;
                    img.style.animation = 'fade-in 0.5s ease-out';
                    img.onerror = () => console.error('[typingflow] img.src load failed for:', resp.img_src.slice(0, 60));
                    container.replaceWith(img);
                }
            } else if (container) {
                container.textContent = '⬡ visual unavailable';
                console.warn('[typingflow] Image gen failed:', resp?.error);
            }
        });
    }

    // Build char spans via DOM to avoid XSS
    const targetDiv = document.getElementById('tf-target');
    for (let i = 0; i < textToType.length; i++) {
        const span = document.createElement('span');
        span.className = 'tf-char';
        span.textContent = textToType[i];
        targetDiv.appendChild(span);
    }

    document.getElementById('tf-close-btn').addEventListener('click', closeOverlay);
    document.getElementById('tf-all-btn').addEventListener('click', renderNuggetGallery);
    document.getElementById('tf-next-btn').addEventListener('click', () => {
        currentNuggetIndex++;
        renderCurrentNugget();
    });
    
    const prevBtn = document.getElementById('tf-prev-btn');
    if (!isFirst) {
        prevBtn.addEventListener('click', () => {
            currentNuggetIndex--;
            renderCurrentNugget();
        });
    }

    const input = document.getElementById('tf-type-input');
    const statsDiv = document.getElementById('tf-stats');

    targetDiv.querySelectorAll('.tf-char')[0]?.classList.add('cursor');
    setTimeout(() => input.focus(), 100);
    overlayWrapper.addEventListener('click', () => input.focus());

    input.addEventListener('input', (e) => {
        if (!startTime) startTime = Date.now();
        const typed = e.target.value;
        const spans = targetDiv.querySelectorAll('.tf-char');
        if (typed.length > textToType.length) {
            input.value = typed.slice(0, textToType.length);
            return;
        }

        let allCorrect = true;
        let localErrors = 0;
        
        spans.forEach((span, i) => {
            span.className = 'tf-char';
            if (i < typed.length) {
                if (typed[i] === textToType[i]) {
                    span.classList.add('correct');
                } else { 
                    span.classList.add('wrong'); 
                    allCorrect = false; 
                    localErrors++;
                }
            } else if (i === typed.length) span.classList.add('cursor');
        });

        // Basic stats update
        const timeElapsedMin = (Date.now() - startTime) / 60000;
        const wordsTyped = typed.length / 5;
        const wpm = timeElapsedMin > 0 ? Math.round(wordsTyped / timeElapsedMin) : 0;
        const acc = typed.length > 0 ? Math.round(((typed.length - localErrors) / typed.length) * 100) : 100;
        
        statsDiv.innerHTML = `${wpm} wpm &middot; ${acc}% acc &middot; ${typed.length}/${textToType.length}`;

        if (typed.length === textToType.length && allCorrect) {
            currentNuggetIndex++;
            setTimeout(() => renderCurrentNugget(), 300);
        }
    });
}

function renderCompletionState() {
    overlayWrapper.innerHTML = `
        <div class="tf-topbar">
            <div class="tf-dots"><div class="tf-dot tf-dot-r"></div><div class="tf-dot tf-dot-y"></div><div class="tf-dot tf-dot-g"></div></div>
            <div class="tf-title">typingflow - complete</div>
            <div class="tf-close-box" id="tf-final-close">&times;</div>
        </div>
        <div style="max-width:600px; margin: 100px auto; text-align: center;">
            <div style="font-size: 64px; margin-bottom: 20px;">🧠</div>
            <div style="font-size: 24px; color: #ECEBDE; margin-bottom: 16px;">Session Complete</div>
            <p style="color:#aaa; font-size:14px; line-height: 1.6;">You have actively internalized ${sessionData.nuggets.length} key insights.</p>
            <button class="tf-export-btn" id="tf-trigger-export">export_to_markdown() 🗂️</button>
        </div>
    `;
    
    document.getElementById('tf-final-close').addEventListener('click', closeOverlay);
    document.getElementById('tf-trigger-export').addEventListener('click', exportToMarkdown);
}

function closeOverlay() {
    if(overlayWrapper) { overlayWrapper.remove(); overlayWrapper = null; }
    document.body.style.overflow = '';
}

// Phase 5: Second Brain Markdown Export weaving tags and images
function exportToMarkdown() {
    const d = new Date().toISOString().split('T')[0];
    const rawTags = sessionData.tags || [];
    const tagsYaml = rawTags.map(t => t.replace('#','')).join(', ');
    
    let md = `---
title: "Insights: ${document.title.replace(/"/g, "'")}"
date: ${d}
tags: [${tagsYaml}]
source: ${window.location.href}
---

# ${document.title}

> **TL;DR**: *${sessionData.tldr}*

## Core Concepts Internalized
`;

    sessionData.nuggets.forEach((n, i) => {
        md += `\n### Insight ${i+1}\n\n`;
        md += `> ${n.text}\n\n`;
        if (n.img_src) {
            md += `![Contextual Asset](${n.img_src})\n\n`;
        }
    });

    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Gemini_Insights_${Date.now()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

if (!window.geminiTfEventListening) {
    window.geminiTfEventListening = true;
    chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
        if (request.action === 'extract_content') {
            sendResponse({ payload: extractPageContent() });
        } else if (request.action === 'mount_ui') {
            mountUI(request.data);
            sendResponse({ success: true });
        } else if (request.action === 'open_overlay') {
            openOverlay();
            sendResponse({ success: true });
        } else if (request.action === 'check_session') {
            sendResponse({ hasSession: !!sessionData });
        }
    });
}
