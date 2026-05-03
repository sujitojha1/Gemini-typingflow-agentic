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
let audioCtx = null;

function getAudioCtx() {
    if (!audioCtx) audioCtx = new AudioContext();
    return audioCtx;
}

function playCorrectSound() {
    const ctx = getAudioCtx();
    ctx.resume().then(() => {
        const duration = 0.05;
        const bufferSize = Math.floor(ctx.sampleRate * duration);
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufferSize, 6);
        }

        const source = ctx.createBufferSource();
        source.buffer = buffer;

        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 2200;
        filter.Q.value = 0.8;

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.09, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

        source.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        source.start();
    });
}

function playWrongSound() {
    const ctx = getAudioCtx();
    ctx.resume().then(() => {
        const now = ctx.currentTime;

        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(200, now);
        osc.frequency.exponentialRampToValueAtTime(90, now + 0.12);

        const distortion = ctx.createWaveShaper();
        const curve = new Float32Array(256);
        for (let i = 0; i < 256; i++) {
            const x = (i * 2) / 256 - 1;
            curve[i] = (Math.PI + 80) * x / (Math.PI + 80 * Math.abs(x));
        }
        distortion.curve = curve;

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.07, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

        osc.connect(distortion);
        distortion.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.12);
    });
}

const INJECT_CSS = `
  @keyframes fade-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
  #tf-overlay-root {
    position: fixed; inset: 0; z-index: 2147483647; background: rgba(15, 15, 20, 0.95); backdrop-filter: blur(16px);
    display: flex; flex-direction: column; font-family: 'Menlo', 'Monaco', monospace; color: #ECEBDE;
    animation: fade-in 0.3s cubic-bezier(0.16, 1, 0.3, 1); overflow-y: auto; box-sizing: border-box;
  }
  #tf-overlay-root * { box-sizing: border-box; text-transform: none; }

  .tf-agent-bar {
    display: flex; align-items: center; gap: 10px; padding: 5px 24px;
    background: rgba(0,0,0,0.45); border-bottom: 1px solid rgba(255,255,255,0.03);
    font-size: 11px; font-family: 'Menlo', monospace; letter-spacing: 0.4px;
    color: #374151; min-height: 26px; flex-shrink: 0;
  }
  .tf-agent-pip {
    width: 5px; height: 5px; border-radius: 50%; background: #1f2937; flex-shrink: 0; transition: background 0.4s;
  }
  .tf-agent-bar.tf-agent-active .tf-agent-pip { background: #4a8cd4; animation: pulse 1.5s infinite; }
  .tf-agent-bar.tf-agent-active { color: #4b5563; }
  .tf-agent-bar.tf-agent-done .tf-agent-pip { background: #27c93f; }
  .tf-agent-bar.tf-agent-done { color: #374151; }
  .tf-agent-bar.tf-agent-error .tf-agent-pip { background: #ff5555; animation: none; }
  .tf-agent-bar.tf-agent-error { color: #ff5555; }
  .tf-agent-model-label { color: #4a8cd4; margin-left: 2px; }
  
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
    display: flex; align-items: center; justify-content: space-between; max-width: 1100px; width: 100%; margin: 40px auto 20px;
    font-size: 12px; color: #888; font-family: 'Menlo', monospace; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 20px;
  }
  .tf-nav-btns { display: flex; gap: 20px; }
  .tf-nav-btn { background: none; border: none; color: #4a8cd4; cursor: pointer; font-family: inherit; font-size: 13px; font-weight: 600; padding: 0; outline: none; margin: 0; }
  .tf-nav-btn.disabled { color: #444; cursor: not-allowed; }
  .tf-chunk-meta { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; }
  .tf-chunk-subject { color: #ECEBDE; font-size: 13px; font-weight: 600; letter-spacing: 0.1px; }
  .tf-chunk-metrics { font-size: 10px; color: #444; letter-spacing: 0.3px; }

  .tf-bottom-bar {
    position: fixed; bottom: 0; left: 0; right: 0; z-index: 10;
    display: flex;
    background: rgba(8, 8, 12, 0.96); backdrop-filter: blur(16px);
    border-top: 1px solid rgba(255,255,255,0.07);
  }
  .tf-bottom-bar::before {
    content: ''; position: absolute; top: 0; left: 0; height: 2px;
    width: var(--tf-progress, 0%); background: linear-gradient(90deg, #4a8cd4, #27c93f);
    transition: width 0.1s linear;
  }
  .tf-metric-box {
    flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
    padding: 16px 20px; border-right: 1px solid rgba(255,255,255,0.06);
  }
  .tf-metric-box:last-child { border-right: none; }
  .tf-metric-val {
    font-size: 26px; font-weight: 700; color: #ECEBDE; font-family: 'Menlo', monospace;
    letter-spacing: -0.5px; line-height: 1;
  }
  .tf-metric-lbl {
    font-size: 10px; color: #444; font-family: 'Menlo', monospace;
    text-transform: uppercase; letter-spacing: 1.5px; margin-top: 5px;
  }
  
  .tf-main-container {
    display: flex; gap: 40px; max-width: 1100px; margin: 0 auto; width: 100%; align-items: flex-start;
  }
  
  .tf-image-panel {
    flex: 0 0 450px; border-radius: 8px; overflow: hidden; box-shadow: 0 12px 32px rgba(0,0,0,0.4);
    background: #1a1a1a; display: flex; justify-content: center; align-items: flex-start; position: sticky; top: 120px;
  }
  .tf-image-panel img { width: 100%; height: auto; object-fit: contain; display: block; max-height: 500px; }
  
  .tf-typing-panel { flex: 1; position: relative; }

  .tf-progress-bar {
    display: flex; align-items: center; gap: 14px; margin-bottom: 24px;
  }
  .tf-pips { display: flex; gap: 5px; align-items: center; }
  .tf-pip {
    width: 28px; height: 3px; border-radius: 2px; background: #2a2a2a;
    transition: background 0.3s ease;
  }
  .tf-pip.done { background: #27c93f; }
  .tf-pip.active { background: #4a8cd4; box-shadow: 0 0 6px rgba(74, 140, 212, 0.5); }
  .tf-progress-label {
    color: #555; font-size: 12px; font-family: 'Menlo', monospace; letter-spacing: 0.3px;
  }
  .tf-progress-label strong { color: #ECEBDE; font-weight: 600; }
  
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
    padding: 8px 20px 4px; font-size: 12px; color: #666; border-bottom: 1px solid rgba(255,255,255,0.04);
    font-family: 'Menlo', monospace;
  }
  .tf-ncard-label-row { display: flex; justify-content: space-between; align-items: center; }
  .tf-ncard-subject { color: #ECEBDE; font-size: 12px; font-weight: 600; margin-top: 2px; letter-spacing: 0.1px; }
  .tf-ncard-metrics { display: flex; gap: 12px; margin-top: 4px; padding-bottom: 4px; font-size: 10px; color: #444; }
  .tf-ncard-metric-score { color: #E1C04C; }
  .tf-ncard-hint { color: #4a8cd4; font-size: 11px; }
  .tf-ncard-body { display: flex; gap: 20px; padding: 16px 20px; align-items: flex-start; }
  .tf-ncard-img { flex: 0 0 130px; height: 80px; background: #111; border-radius: 4px; overflow: hidden; }
  .tf-ncard-img img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .tf-ncard-img-ph { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; color: #2a2a2a; font-size: 24px; }
  .tf-ncard-text { flex: 1; font-size: 13px; color: #777; line-height: 1.65; }

  @keyframes tf-toast-in { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes tf-toast-out { from { opacity: 1; } to { opacity: 0; } }
  .tf-toast {
    position: fixed; bottom: 90px; left: 50%; transform: translateX(-50%);
    background: rgba(20, 20, 30, 0.95); border: 1px solid rgba(74, 140, 212, 0.4);
    color: #4a8cd4; font-size: 12px; font-family: 'Menlo', monospace;
    padding: 8px 18px; border-radius: 20px; z-index: 2147483647;
    animation: tf-toast-in 0.3s ease-out forwards;
    pointer-events: none; white-space: nowrap;
  }
  .tf-toast.out { animation: tf-toast-out 0.4s ease-in forwards; }

  .tf-gallery-meta { display: flex; align-items: center; gap: 20px; margin-top: 12px; }
  .tf-stars { color: #E1C04C; font-size: 16px; letter-spacing: 2px; }
  .tf-coverage { font-size: 12px; color: #555; font-family: 'Menlo', monospace; }
  .tf-coverage-bar { display: inline-block; width: 80px; height: 4px; background: #222; border-radius: 2px; vertical-align: middle; margin: 0 6px; position: relative; overflow: hidden; }
  .tf-coverage-fill { position: absolute; left: 0; top: 0; height: 100%; background: #27c93f; border-radius: 2px; }

  .tf-log-btn { background: rgba(74, 140, 212, 0.1); border: 1px solid rgba(74, 140, 212, 0.4); color: #4a8cd4; font-size: 11px; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-family: 'Menlo', monospace; margin-left: 15px; }
  .tf-log-btn:hover { background: rgba(74, 140, 212, 0.2); }
  .tf-log-modal { position: absolute; inset: 60px 40px; background: #111; border: 1px solid #333; z-index: 100; border-radius: 8px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,0.8); animation: fade-in 0.2s; }
  .tf-log-modal-hdr { padding: 15px 20px; background: #1a1a1a; border-bottom: 1px solid #333; display: flex; justify-content: space-between; align-items: center; }
  .tf-log-title { color: #ECEBDE; font-size: 13px; font-weight: bold; }
  .tf-log-close { cursor: pointer; color: #888; font-size: 18px; line-height: 1; }
  .tf-log-close:hover { color: #fff; }
  .tf-log-body { padding: 20px; overflow-y: auto; flex: 1; color: #aaa; font-size: 12px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; font-family: 'Menlo', monospace; }
`;

function agentBarHTML() {
    return `<div class="tf-agent-bar tf-agent-active" id="tf-agent-bar">
        <div class="tf-agent-pip"></div>
        <span id="tf-agent-task">agent · ready</span>
        <span class="tf-agent-model-label" id="tf-agent-model"></span>
    </div>`;
}

function topbarHTML(title) {
    return `<div class="tf-topbar">
        <div class="tf-dots">
            <div class="tf-dot tf-dot-r"></div>
            <div class="tf-dot tf-dot-y"></div>
            <div class="tf-dot tf-dot-g"></div>
        </div>
        <div class="tf-title">${title}</div>
        <div class="tf-close-box" id="tf-close-btn">&times;</div>
    </div>`;
}

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
    const logBtnHtml = sessionData.processHistory ? `<button class="tf-log-btn" id="tf-log-btn">view agent logs</button>` : '';

    overlayWrapper.innerHTML = `
        ${agentBarHTML()}
        ${topbarHTML('~/typingflow')}
        <div class="tf-gallery-scroll">
            <div class="tf-gallery-hdr">
                <div style="display: flex; align-items: baseline;">
                    <div class="tf-gallery-cmd">$ extract --page-nuggets</div>
                    ${logBtnHtml}
                </div>
                <div class="tf-gallery-sub" id="tf-gallery-sub"></div>
            </div>
            <div class="tf-nugget-cards" id="tf-ncard-list"></div>
        </div>
    `;

    document.getElementById('tf-close-btn').addEventListener('click', closeOverlay);
    const logBtn = document.getElementById('tf-log-btn');
    if (logBtn) logBtn.addEventListener('click', showLogModal);

    const sub = document.getElementById('tf-gallery-sub');
    const refinedLabel = sessionData.isAgentRefined ? ' · ✦ refined by Agent' : (sessionData.isGemmaRefined ? ' · ✦ refined by Gemma 4' : '');
    sub.textContent = `${sessionData.nuggets.length} fragments${refinedLabel} · click any to type`;

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

        const labelRow = document.createElement('div');
        labelRow.className = 'tf-ncard-label-row';
        const labelIdx = document.createTextNode(`[${String(i + 1).padStart(2, '0')}] —`);
        const hint = document.createElement('span');
        hint.className = 'tf-ncard-hint';
        hint.textContent = 'click to type ›';
        labelRow.appendChild(labelIdx);
        labelRow.appendChild(hint);
        label.appendChild(labelRow);

        if (nugget.subject) {
            const subjectEl = document.createElement('div');
            subjectEl.className = 'tf-ncard-subject';
            subjectEl.textContent = nugget.subject;
            label.appendChild(subjectEl);
        }

        const metricsEl = document.createElement('div');
        metricsEl.className = 'tf-ncard-metrics';
        if (nugget.score != null) {
            const scoreEl = document.createElement('span');
            scoreEl.className = 'tf-ncard-metric-score';
            scoreEl.textContent = `score ${nugget.score}/5`;
            metricsEl.appendChild(scoreEl);
        }
        if (nugget.stats?.wordCount) {
            const wEl = document.createElement('span');
            wEl.textContent = `${nugget.stats.wordCount} words`;
            metricsEl.appendChild(wEl);
        }
        if (nugget.coverage != null) {
            const cEl = document.createElement('span');
            cEl.textContent = `cov ${nugget.coverage}%`;
            metricsEl.appendChild(cEl);
        }
        if (metricsEl.children.length) label.appendChild(metricsEl);

        const body = document.createElement('div');
        body.className = 'tf-ncard-body';

        const imgBox = document.createElement('div');
        imgBox.className = 'tf-ncard-img';
        if (nugget.img_src && (isValidHttpUrl(nugget.img_src) || nugget.img_src.startsWith('data:'))) {
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

function showLogModal() {
    let modal = document.getElementById('tf-log-modal');
    if (modal) { modal.remove(); return; } // toggle off
    
    modal = document.createElement('div');
    modal.id = 'tf-log-modal';
    modal.className = 'tf-log-modal';
    
    let logText = 'Agentic Process History:\\n========================\\n\\n';
    if (!sessionData.processHistory) {
        logText += 'No logs available.';
    } else {
        sessionData.processHistory.forEach(chunk => {
            logText += `[ Chunk ${chunk.chunkIdx + 1} ]\\n`;
            chunk.steps.forEach(step => {
                logText += `  > Tool: ${step.tool}\\n`;
                logText += `    Input:  ${JSON.stringify(step.input)}\\n`;
                logText += `    Result: ${JSON.stringify(step.result)}\\n`;
            });
            logText += '\\n';
        });
    }

    modal.innerHTML = `
        <div class="tf-log-modal-hdr">
            <div class="tf-log-title">Agent Tool Logs</div>
            <div class="tf-log-close" id="tf-log-close">&times;</div>
        </div>
        <div class="tf-log-body">${logText.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
    `;
    
    overlayWrapper.appendChild(modal);
    document.getElementById('tf-log-close').addEventListener('click', () => modal.remove());
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
    const total = sessionData.nuggets.length;
    const current = currentNuggetIndex + 1;
    const pipsHtml = sessionData.nuggets.map((_, i) => {
        const cls = i < currentNuggetIndex ? 'done' : i === currentNuggetIndex ? 'active' : '';
        return `<span class="tf-pip ${cls}"></span>`;
    }).join('');

    overlayWrapper.innerHTML = `
        ${agentBarHTML()}
        ${topbarHTML('typingflow - type')}

        <div class="tf-stats-bar">
            <div class="tf-nav-btns">
                <button class="tf-nav-btn" id="tf-all-btn">&#9776; all</button>
                <button class="tf-nav-btn ${isFirst ? 'disabled' : ''}" id="tf-prev-btn">&larr; prev</button>
                <button class="tf-nav-btn" id="tf-next-btn">next &rarr;</button>
            </div>
            <div class="tf-chunk-meta" id="tf-chunk-meta"></div>
        </div>

        <div class="tf-main-container" style="padding-bottom: 100px;">
            <div class="tf-image-panel" id="tf-image-panel-${capturedIndex}"></div>
            <div class="tf-typing-panel">
                <div class="tf-progress-bar">
                    <div class="tf-pips">${pipsHtml}</div>
                    <span class="tf-progress-label"><strong>${current}</strong> of ${total}</span>
                </div>
                <div id="tf-target"></div>
                <input type="text" class="tf-hidden-input" id="tf-type-input" autocomplete="off" spellcheck="false" />
            </div>
        </div>

        <div class="tf-bottom-bar" id="tf-bottom-bar">
            <div class="tf-metric-box">
                <div class="tf-metric-val" id="tf-stat-wpm">0</div>
                <div class="tf-metric-lbl">wpm</div>
            </div>
            <div class="tf-metric-box">
                <div class="tf-metric-val" id="tf-stat-acc">100%</div>
                <div class="tf-metric-lbl">accuracy</div>
            </div>
            <div class="tf-metric-box">
                <div class="tf-metric-val" id="tf-stat-chars">0 / ${textToType.length}</div>
                <div class="tf-metric-lbl">chars</div>
            </div>
        </div>
    `;

    // Populate image panel after DOM is set, using captured index to avoid race condition
    const imagePanel = document.getElementById(`tf-image-panel-${capturedIndex}`);
    const validSrc = nugget.img_src && (isValidHttpUrl(nugget.img_src) || nugget.img_src.startsWith('data:'));
    if (validSrc) {
        const img = document.createElement('img');
        img.alt = 'Contextual Asset';
        img.src = nugget.img_src;
        imagePanel.appendChild(img);
    } else {
        const loader = document.createElement('div');
        loader.className = 'tf-nano-loader';
        loader.id = `tf-nano-${capturedIndex}`;
        loader.textContent = '🖼️ Rendering visual via Gemini Flash Image...';
        imagePanel.appendChild(loader);

        chrome.runtime.sendMessage({
            action: "generate_image_asset",
            payload: { text: nugget.text, tags: sessionData.tags }
        }, (resp) => {
            const container = document.getElementById(`tf-nano-${capturedIndex}`);
            if (resp && resp.success && resp.img_src) {
                sessionData.nuggets[capturedIndex].img_src = resp.img_src;
                if (container) {
                    const img = document.createElement('img');
                    img.alt = 'Contextual Asset';
                    img.src = resp.img_src;
                    img.style.animation = 'fade-in 0.5s ease-out';
                    container.replaceWith(img);
                }
            } else if (container) {
                container.textContent = '⬡ visual unavailable';
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

    const chunkMetaEl = document.getElementById('tf-chunk-meta');
    if (chunkMetaEl) {
        if (nugget.subject) {
            const sEl = document.createElement('div');
            sEl.className = 'tf-chunk-subject';
            sEl.textContent = nugget.subject;
            chunkMetaEl.appendChild(sEl);
        }
        const metaParts = [];
        if (nugget.score != null) metaParts.push(`score ${nugget.score}/5`);
        if (nugget.stats?.wordCount) metaParts.push(`${nugget.stats.wordCount} words`);
        if (nugget.coverage != null) metaParts.push(`cov ${nugget.coverage}%`);
        if (metaParts.length) {
            const mEl = document.createElement('div');
            mEl.className = 'tf-chunk-metrics';
            mEl.textContent = metaParts.join(' · ');
            chunkMetaEl.appendChild(mEl);
        }
    }

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
    const statWpm = document.getElementById('tf-stat-wpm');
    const statAcc = document.getElementById('tf-stat-acc');
    const statChars = document.getElementById('tf-stat-chars');
    const bottomBar = document.getElementById('tf-bottom-bar');
    let prevTypedLen = 0;

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

        if (typed.length > prevTypedLen) {
            const newCharIndex = typed.length - 1;
            if (typed[newCharIndex] === textToType[newCharIndex]) {
                playCorrectSound();
            } else {
                playWrongSound();
            }
        }
        prevTypedLen = typed.length;

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
        
        statWpm.textContent = wpm;
        statAcc.textContent = `${acc}%`;
        statChars.textContent = `${typed.length} / ${textToType.length}`;
        bottomBar.style.setProperty('--tf-progress', `${Math.round((typed.length / textToType.length) * 100)}%`);

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
        } else if (request.action === 'agent_status') {
            updateAgentBar(request.task, request.model);
            sendResponse({ ok: true });
        } else if (request.action === 'update_nuggets') {
            if (sessionData) {
                sessionData.geminiNuggets = sessionData.geminiNuggets || sessionData.nuggets;
                sessionData.nuggets = request.data.nuggets;
                if (request.data.tldr) sessionData.tldr = request.data.tldr;
                if (request.data.tags) sessionData.tags = request.data.tags;
                if (request.data.star_rating) sessionData.star_rating = request.data.star_rating;
                if (request.data.coverage_pct != null) sessionData.coverage_pct = request.data.coverage_pct;
                if (request.data.processHistory) sessionData.processHistory = request.data.processHistory;
                sessionData.isAgentRefined = true;

                // Show toast regardless of which view is active
                showAgentToast();

                // If gallery is open, re-render cards in place
                if (overlayWrapper && document.getElementById('tf-ncard-list')) {
                    renderNuggetGallery();
                }
            }
            sendResponse({ success: true });
        }
    });
}

function updateAgentBar(task, model) {
    const bar     = document.getElementById('tf-agent-bar');
    const taskEl  = document.getElementById('tf-agent-task');
    const modelEl = document.getElementById('tf-agent-model');
    if (!bar) return;

    const isDone  = task === 'complete' || task === 'refined';
    const isError = task === 'error';

    bar.className = 'tf-agent-bar ' + (isError ? 'tf-agent-error' : isDone ? 'tf-agent-done' : 'tf-agent-active');
    if (taskEl) taskEl.textContent = `agent · ${task}`;
    if (modelEl) modelEl.textContent = model && model !== 'null' ? `· ${model}` : '';
}

function showAgentToast() {
    if (!overlayWrapper) return;
    const toast = document.createElement('div');
    toast.className = 'tf-toast';
    toast.textContent = '✦ Agent refined your nuggets';
    overlayWrapper.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('out');
        setTimeout(() => toast.remove(), 400);
    }, 3000);
}
