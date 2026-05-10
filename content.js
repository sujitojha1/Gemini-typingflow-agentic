function isValidHttpUrl(str) {
    try {
        const url = new URL(str);
        return url.protocol === 'https:' || url.protocol === 'http:';
    } catch { return false; }
}

// Phase 2: Advanced DOM Extraction for Semantic LLM Structuring
function extractPageContent() {
    const root = document.querySelector('article, main, [role="main"]') || document.body;
    const isHeading = el => /^H[1-5]$/.test(el.tagName);
    const elements = Array.from(root.querySelectorAll('p, h1, h2, h3, h4, h5, li, blockquote, figcaption, pre, img'))
        .filter(el => {
            if (el.closest('nav, header, footer, aside, [role="navigation"]')) return false;
            if (el.tagName === 'IMG') {
                const rect = el.getBoundingClientRect();
                if ((el.width && el.width < 100) || rect.width < 100) return false;
                return true;
            }
            // Headings provide structural context even when short (e.g. "Summary", "Key Takeaways")
            if (isHeading(el)) return el.innerText.trim().length >= 3;
            if (el.innerText.trim().length < 30) return false;
            return true;
        });

    let structuredPayload = [];
    let totalWords = 0;
    elements.forEach(el => {
        if (el.tagName === 'IMG') {
            const src = el.src || el.dataset.src;
            if (src && !src.startsWith('data:')) structuredPayload.push({ type: 'image', src: src });
        } else {
            const txt = el.innerText.trim();
            totalWords += txt.split(/\s+/).length;
            structuredPayload.push({ type: 'text', content: txt });
        }
    });

    const readability = calculateReadability(elements.map(el => el.innerText || '').join(' '), totalWords);
    return { payload: structuredPayload, readability };
}

function calculateReadability(fullText, wordCount) {
    if (!wordCount) return { time: 0, complexity: 'N/A' };
    const sentences = fullText.split(/[.!?]+/).filter(s => s.trim().length > 0).length || 1;
    const avgSentenceLength = wordCount / sentences;
    const readTime = Math.ceil(wordCount / 200);
    
    let complexity = 'Medium';
    if (avgSentenceLength < 14) complexity = 'Simple';
    else if (avgSentenceLength > 24) complexity = 'Complex';

    return { time: readTime, complexity, wordCount };
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
    display: flex; align-items: flex-start; gap: 14px; margin-bottom: 24px;
  }
  .tf-pips {
    display: flex; flex-wrap: wrap; gap: 4px; align-items: flex-start;
    max-width: calc(100% - 80px);
  }
  .tf-pip {
    width: 14px; height: 14px; border-radius: 3px; background: #2a2a2a;
    flex-shrink: 0; transition: background 0.3s ease;
  }
  .tf-pip.done { background: #27c93f; }
  .tf-pip.active { background: #4a8cd4; box-shadow: 0 0 6px rgba(74, 140, 212, 0.5); }
  .tf-progress-label {
    color: #555; font-size: 12px; font-family: 'Menlo', monospace; letter-spacing: 0.3px;
    white-space: nowrap; padding-top: 1px;
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

  .tf-readability-chip {
    display: inline-flex; align-items: center; gap: 6px; background: rgba(255,255,255,0.04);
    padding: 3px 10px; border-radius: 20px; font-size: 11px; color: #777; font-family: 'Menlo', monospace;
  }
  .tf-readability-val { color: #E1C04C; font-weight: 700; }
  .tf-complexity-Simple { color: #27c93f; }
  .tf-complexity-Medium { color: #E1C04C; }
  .tf-complexity-Complex { color: #ff5555; }

  .tf-page-nav {
    display: flex; align-items: center; gap: 12px; margin-bottom: 18px;
  }
  .tf-page-btn {
    width: 30px; height: 30px; display: flex; align-items: center; justify-content: center;
    background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1);
    color: #4a8cd4; font-size: 14px; border-radius: 4px; cursor: pointer;
    font-family: 'Menlo', monospace; transition: all 0.15s; flex-shrink: 0;
  }
  .tf-page-btn:hover:not(:disabled) { background: rgba(74,140,212,0.2); border-color: #4a8cd4; }
  .tf-page-btn:disabled { color: #333; border-color: rgba(255,255,255,0.04); cursor: not-allowed; }
  .tf-page-label {
    font-size: 11px; color: #555; font-family: 'Menlo', monospace; letter-spacing: 0.4px;
  }

  .tf-log-btn { background: rgba(74, 140, 212, 0.1); border: 1px solid rgba(74, 140, 212, 0.4); color: #4a8cd4; font-size: 11px; padding: 5px 12px; border-radius: 4px; cursor: pointer; font-family: 'Menlo', monospace; margin-left: 15px; transition: all 0.15s; }
  .tf-log-btn:hover { background: rgba(74, 140, 212, 0.25); border-color: #4a8cd4; box-shadow: 0 0 10px rgba(74, 140, 212, 0.2); }
  
  .tf-log-modal { 
    position: absolute; inset: 40px 30px; background: rgba(13, 13, 18, 0.94); backdrop-filter: blur(24px); 
    border: 1px solid rgba(255,255,255,0.08); z-index: 100; border-radius: 12px; display: flex; flex-direction: column; 
    overflow: hidden; box-shadow: 0 30px 80px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.03); 
    animation: tf-modal-in 0.4s cubic-bezier(0.16, 1, 0.3, 1); 
  }
  @keyframes tf-modal-in { from { opacity: 0; transform: scale(0.98) translateY(10px); } to { opacity: 1; transform: scale(1) translateY(0); } }

  .tf-log-modal-hdr { 
    padding: 16px 24px; background: rgba(255,255,255,0.02); border-bottom: 1px solid rgba(255,255,255,0.06); 
    display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; 
  }
  .tf-log-title { color: #fff; font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 10px; font-family: 'Inter', sans-serif; }
  .tf-log-title-pip { width: 8px; height: 8px; border-radius: 50%; background: #27c93f; box-shadow: 0 0 8px rgba(39, 201, 63, 0.4); }
  .tf-log-stats { color: #777; font-size: 11px; font-family: 'Menlo', monospace; background: rgba(255,255,255,0.03); padding: 4px 10px; border-radius: 4px; }
  
  .tf-log-dl-btn { background: none; border: 1px solid rgba(255,255,255,0.1); color: #888; font-size: 10px; padding: 4px 10px; border-radius: 4px; cursor: pointer; font-family: 'Menlo', monospace; transition: all 0.2s; }
  .tf-log-dl-btn:hover { border-color: #4a8cd4; color: #4a8cd4; background: rgba(74, 140, 212, 0.05); }

  .tf-log-close { cursor: pointer; color: #555; font-size: 20px; line-height: 1; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 6px; transition: all 0.2s; margin-left: 8px; }
  .tf-log-close:hover { color: #fff; background: rgba(255,255,255,0.08); }
  
  .tf-log-body { padding: 24px; overflow-y: auto; flex: 1; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.1) transparent; }
  .tf-log-body::-webkit-scrollbar { width: 6px; }
  .tf-log-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 3px; }

  .tf-log-chunk { margin-bottom: 16px; border: 1px solid rgba(255,255,255,0.05); border-radius: 10px; overflow: hidden; background: rgba(255,255,255,0.015); transition: border-color 0.2s; }
  .tf-log-chunk.open { border-color: rgba(74, 140, 212, 0.3); background: rgba(255,255,255,0.02); }
  .tf-log-chunk-hdr { display: flex; align-items: center; justify-content: space-between; padding: 12px 20px; cursor: pointer; user-select: none; transition: background 0.2s; }
  .tf-log-chunk-hdr:hover { background: rgba(255,255,255,0.04); }
  
  .tf-log-chunk-title { display: flex; align-items: center; gap: 12px; }
  .tf-log-chunk-arrow { color: #444; font-size: 9px; transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
  .tf-log-chunk.open .tf-log-chunk-arrow { transform: rotate(90deg); color: #4a8cd4; }
  .tf-log-chunk-idx { color: #E1C04C; font-size: 13px; font-weight: 600; font-family: 'Menlo', monospace; }
  .tf-log-chunk-label { color: #555; font-size: 11px; font-family: 'Menlo', monospace; }
  
  .tf-log-chunk-badges { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .tf-log-badge { font-size: 10px; padding: 3px 8px; border-radius: 4px; font-family: 'Menlo', monospace; font-weight: 500; }
  .tf-log-badge-score { background: rgba(225,192,76,0.15); color: #f5d76e; border: 1px solid rgba(225,192,76,0.1); }
  .tf-log-badge-cov { background: rgba(39,201,63,0.12); color: #4ade80; border: 1px solid rgba(39,201,63,0.1); }
  .tf-log-badge-skip { background: rgba(239,68,68,0.15); color: #f87171; border: 1px solid rgba(239,68,68,0.1); }
  .tf-log-badge-ok { background: rgba(74, 140, 212, 0.15); color: #60a5fa; border: 1px solid rgba(74,140,212,0.1); }
  .tf-log-badge-time { background: rgba(255,255,255,0.05); color: #9ca3af; border: 1px solid rgba(255,255,255,0.05); }

  .tf-log-chunk-steps { display: none; padding: 0 20px 16px 48px; border-top: 1px solid rgba(255,255,255,0.03); margin-top: -1px; }
  .tf-log-chunk.open .tf-log-chunk-steps { display: block; animation: tf-slide-down 0.3s ease-out; }
  @keyframes tf-slide-down { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }

  .tf-log-step { display: flex; gap: 0; margin-bottom: 4px; position: relative; animation: tf-step-in 0.4s both; }
  @keyframes tf-step-in { from { opacity: 0; transform: translateX(-10px); } to { opacity: 1; transform: translateX(0); } }
  
  .tf-log-step-line { position: absolute; left: -26px; top: 26px; bottom: -8px; width: 1.5px; background: rgba(255,255,255,0.05); }
  .tf-log-step:last-child .tf-log-step-line { display: none; }
  
  .tf-log-step-dot { position: absolute; left: -31px; top: 7px; width: 11px; height: 11px; display: flex; justify-content: center; align-items: center; }
  .tf-log-step-dot-inner { width: 8px; height: 8px; border-radius: 50%; border: 2px solid #333; background: #0d0d12; box-shadow: 0 0 0 3px #0d0d12; }
  .tf-log-step.done .tf-log-step-dot-inner { background: #27c93f; border-color: #27c93f; box-shadow: 0 0 8px rgba(39, 201, 63, 0.3), 0 0 0 3px #0d0d12; }
  .tf-log-step.skipped .tf-log-step-dot-inner { background: #444; border-color: #444; box-shadow: 0 0 0 3px #0d0d12; }

  .tf-log-step-content { flex: 1; padding: 2px 0 14px; min-width: 0; }
  .tf-log-step-head { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; flex-wrap: wrap; }
  .tf-log-tool-name { font-size: 12px; font-weight: 600; color: #fff; font-family: 'Menlo', monospace; }
  .tf-log-tool-tag { font-size: 9px; padding: 2px 7px; border-radius: 4px; font-family: 'Menlo', monospace; letter-spacing: 0.4px; text-transform: uppercase; font-weight: 700; }
  
  .tf-log-tool-tag.relevance { background: rgba(251,191,36,0.15); color: #fbbf24; }
  .tf-log-tool-tag.image     { background: rgba(167,139,250,0.15); color: #a78bfa; }
  .tf-log-tool-tag.stats     { background: rgba(96,165,250,0.15); color: #60a5fa; }
  .tf-log-tool-tag.eval      { background: rgba(245,158,11,0.15); color: #f59e0b; }
  .tf-log-tool-tag.grammar   { background: rgba(52,211,153,0.15); color: #34d399; }
  .tf-log-tool-tag.refine    { background: rgba(248,113,113,0.15); color: #f87171; }
  .tf-log-tool-tag.coverage  { background: rgba(56,189,248,0.15); color: #38bdf8; }
  
  .tf-log-time { font-size: 9px; color: #555; font-family: 'Menlo', monospace; margin-left: auto; background: rgba(0,0,0,0.2); padding: 2px 6px; border-radius: 4px; }
  .tf-log-time-fast { color: #4ade80; }
  .tf-log-time-mid  { color: #fbbf24; }
  .tf-log-time-slow { color: #f87171; }
  
  .tf-log-thought { font-size: 11px; color: #9ca3af; font-style: italic; line-height: 1.6; margin-bottom: 5px; background: rgba(255,255,255,0.03); padding: 6px 10px; border-radius: 6px; border-left: 2px solid rgba(255,255,255,0.05); }
  .tf-log-next { font-size: 10px; color: #60a5fa; line-height: 1.5; margin-top: 5px; opacity: 0.8; }
  .tf-log-next::before { content: 'NEXT › '; color: #4b5563; font-weight: 700; font-size: 8px; }
  
  .tf-log-output { font-size: 11px; color: #d1d5db; font-family: 'Menlo', monospace; line-height: 1.6; padding: 6px 12px; background: rgba(0,0,0,0.2); border-radius: 6px; margin-top: 4px; }
  .tf-log-output-label { color: #6b7280; margin-right: 6px; font-weight: 700; font-size: 9px; text-transform: uppercase; }
  .tf-log-output-val { color: #9ca3af; }
  .tf-log-output-val.ok { color: #34d399; }
  .tf-log-output-val.warn { color: #f87171; }
  .tf-log-output-val.highlight { color: #fbbf24; }
`;

function agentBarHTML() {
    const isDone = sessionData && sessionData.isAgentRefined;
    const cls    = isDone ? 'tf-agent-done' : 'tf-agent-active';
    const text   = isDone ? 'agent · refined' : 'agent · enhancing';
    return `<div class="tf-agent-bar ${cls}" id="tf-agent-bar">
        <div class="tf-agent-pip"></div>
        <span id="tf-agent-task">${text}</span>
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

    if (sessionData.readability) {
        const r = sessionData.readability;
        const rBox = document.createElement('div');
        rBox.className = 'tf-gallery-meta';
        rBox.style.marginTop = '8px';
        rBox.innerHTML = `
            <div class="tf-readability-chip">
                <span>time: <span class="tf-readability-val">~${r.time} min</span></span>
            </div>
            <div class="tf-readability-chip">
                <span>complexity: <span class="tf-readability-val tf-complexity-${r.complexity}">${r.complexity}</span></span>
            </div>
            <div class="tf-readability-chip">
                <span>words: <span class="tf-readability-val">${r.wordCount}</span></span>
            </div>
        `;
        sub.parentNode.insertBefore(rBox, sub.nextSibling);
    }

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

function _esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function _toolTag(name) {
    const map = {
        checkRelevance: 'relevance', findMatchingImage: 'image', generateChunkImage: 'image',
        getChunkStats: 'stats', extractSubject: 'stats', evaluateChunk: 'eval',
        checkGrammar: 'grammar', refineChunk: 'refine', updateCoverage: 'coverage',
    };
    return map[name] || 'stats';
}

function _toolLabel(name) {
    const map = {
        checkRelevance: 'FILTER', findMatchingImage: 'IMAGE', generateChunkImage: 'IMAGE',
        getChunkStats: 'STATS', extractSubject: 'EXTRACT', evaluateChunk: 'EVAL',
        checkGrammar: 'GRAMMAR', refineChunk: 'REFINE', updateCoverage: 'COV',
    };
    return map[name] || 'TOOL';
}

function _formatVal(obj) {
    if (obj == null) return '<span class="tf-log-sub-val">—</span>';
    if (typeof obj === 'string') return `<span class="tf-log-sub-val">${_esc(obj)}</span>`;
    if (typeof obj === 'boolean') return `<span class="tf-log-sub-val ${obj ? 'ok' : 'warn'}">${obj}</span>`;
    if (typeof obj === 'number') return `<span class="tf-log-sub-val highlight">${obj}</span>`;
    const s = JSON.stringify(obj, null, 2);
    if (s.length < 120) return `<span class="tf-log-sub-val">${_esc(s)}</span>`;
    return `<span class="tf-log-sub-val">${_esc(s.slice(0, 200))}…</span>`;
}

function _timeClass(ms) {
    if (ms == null) return '';
    if (ms < 500) return 'tf-log-time-fast';
    if (ms < 2000) return 'tf-log-time-mid';
    return 'tf-log-time-slow';
}

function _briefOutput(tool, result) {
    if (!result || typeof result !== 'object') return '';
    switch (tool) {
        case 'checkRelevance':
            return result.isAd
                ? `<span class="tf-log-output-val warn">isAd: true</span> — ${_esc(String(result.reason || '').slice(0, 80))}`
                : `<span class="tf-log-output-val ok">isAd: false</span>`;
        case 'findMatchingImage':
            return result.matched
                ? `<span class="tf-log-output-val ok">matched</span> — ${_esc(String(result.src || '').slice(0, 50))}…`
                : `<span class="tf-log-output-val warn">no match</span>`;
        case 'generateChunkImage':
            return result.img_src
                ? `<span class="tf-log-output-val ok">image generated</span>`
                : `<span class="tf-log-output-val warn">failed</span>`;
        case 'getChunkStats':
            return `<span class="tf-log-output-val highlight">${result.wordCount || '?'}</span> words · ${result.sentenceCount || '?'} sentences`;
        case 'extractSubject':
            return `<span class="tf-log-output-val highlight">${_esc(String(result.subject || 'Untitled'))}</span>`;
        case 'evaluateChunk':
            return `score: <span class="tf-log-output-val highlight">${result.score ?? '?'}/5</span> · ${_esc(String(result.critique || '').slice(0, 60))}`;
        case 'checkGrammar':
            return result.isProper
                ? `<span class="tf-log-output-val ok">proper ✓</span>`
                : `<span class="tf-log-output-val warn">issues found</span> — ${_esc(String(result.issues || '').slice(0, 60))}`;
        case 'refineChunk':
            if (result.skipped) return `<span class="tf-log-output-val">skipped: ${_esc(result.reason || '')}</span>`;
            return `<span class="tf-log-output-val ok">refined</span> (${(result.refinedText || '').split(/\s+/).length} words)`;
        case 'updateCoverage':
            return `<span class="tf-log-output-val highlight">${result.coverage ?? '?'}%</span> (${result.processed}/${result.total})`;
        default:
            return _esc(JSON.stringify(result).slice(0, 80));
    }
}

function _buildStepHTML(step, idx) {
    const isSkipped = !!step.result?.skipped;
    const cls = isSkipped ? 'skipped' : 'done';
    const totalMs = step.totalMs;
    const llmMs = step.llmMs;
    const toolMs = step.toolMs;
    const hasTime = totalMs != null;

    let timeHTML = '';
    if (hasTime) {
        timeHTML = `<span class="tf-log-time ${_timeClass(totalMs)}">${totalMs}ms`;
        if (llmMs != null) timeHTML += ` <span style="color:#333">(llm:${llmMs} tool:${toolMs})</span>`;
        timeHTML += '</span>';
    }

    const thoughtHTML = step.thought
        ? `<div class="tf-log-thought">${_esc(String(step.thought).slice(0, 120))}</div>`
        : '';

    const outputHTML = `<div class="tf-log-output"><span class="tf-log-output-label">out:</span> ${_briefOutput(step.tool, step.result)}</div>`;

    const nextHTML = step.nextStep
        ? `<div class="tf-log-next">${_esc(String(step.nextStep).slice(0, 100))}</div>`
        : '';

    return `<div class="tf-log-step ${cls}">
        <div class="tf-log-step-dot"><div class="tf-log-step-dot-inner"></div></div>
        <div class="tf-log-step-line"></div>
        <div class="tf-log-step-content">
            <div class="tf-log-step-head">
                <span class="tf-log-tool-name">${_esc(step.tool)}</span>
                <span class="tf-log-tool-tag ${_toolTag(step.tool)}">${_toolLabel(step.tool)}</span>
                ${step.model ? `<span class="tf-log-badge tf-log-badge-time">${_esc(step.model)}</span>` : ''}
                ${isSkipped ? '<span class="tf-log-badge tf-log-badge-skip">skipped</span>' : ''}
                ${timeHTML}
            </div>
            ${thoughtHTML}
            ${outputHTML}
            ${nextHTML}
        </div>
    </div>`;
}

function showLogModal() {
    let modal = document.getElementById('tf-log-modal');
    if (modal) { modal.remove(); return; }

    modal = document.createElement('div');
    modal.id = 'tf-log-modal';
    modal.className = 'tf-log-modal';

    const history = sessionData.processHistory || [];
    const totalChunks = history.length;
    const totalSteps = history.reduce((s, c) => s + (c.steps?.length || 0), 0);
    const totalPipelineMs = sessionData.totalMs || null;

    // Calculate total time per chunk
    function chunkTotalMs(steps) {
        return steps.reduce((sum, s) => sum + (s.totalMs || 0), 0);
    }

    let chunksHTML = '';
    if (!history.length) {
        chunksHTML = '<div style="color:#555; padding: 40px; text-align:center; font-size: 12px;">No agent logs available yet. Process a page first.</div>';
    } else {
        history.forEach((chunk, ci) => {
            const steps = chunk.steps || [];
            const evalStep = steps.find(s => s.tool === 'evaluateChunk');
            const covStep = steps.find(s => s.tool === 'updateCoverage');
            const gramStep = steps.find(s => s.tool === 'checkGrammar');
            const score = evalStep?.result?.score;
            const cov = covStep?.result?.coverage;
            const isDropped = steps.some(s => s.tool === 'checkRelevance' && s.result?.isAd);
            const cMs = chunkTotalMs(steps);

            let badgesHTML = '';
            if (isDropped) badgesHTML += '<span class="tf-log-badge tf-log-badge-skip">dropped</span>';
            if (score != null) badgesHTML += `<span class="tf-log-badge tf-log-badge-score">score ${score}/5</span>`;
            if (cov != null) badgesHTML += `<span class="tf-log-badge tf-log-badge-cov">${cov}%</span>`;
            if (gramStep?.result?.isProper === true) badgesHTML += '<span class="tf-log-badge tf-log-badge-ok">grammar ✓</span>';
            if (gramStep?.result?.isProper === false) badgesHTML += '<span class="tf-log-badge tf-log-badge-skip">grammar ✗</span>';
            if (cMs) badgesHTML += `<span class="tf-log-badge tf-log-badge-time">${(cMs / 1000).toFixed(1)}s</span>`;

            let stepsHTML = '';
            steps.forEach((step, si) => { stepsHTML += _buildStepHTML(step, si); });

            chunksHTML += `<div class="tf-log-chunk" data-ci="${ci}">
                <div class="tf-log-chunk-hdr">
                    <div class="tf-log-chunk-title">
                        <span class="tf-log-chunk-arrow">▶</span>
                        <span class="tf-log-chunk-idx">Chunk ${chunk.chunkIdx + 1}</span>
                        <span class="tf-log-chunk-label">${steps.length} steps</span>
                    </div>
                    <div class="tf-log-chunk-badges">${badgesHTML}</div>
                </div>
                <div class="tf-log-chunk-steps">${stepsHTML}</div>
            </div>`;
        });
    }

    const pipelineLabel = totalPipelineMs
        ? `${totalChunks} chunks · ${totalSteps} calls · ${(totalPipelineMs / 1000).toFixed(1)}s total`
        : `${totalChunks} chunks · ${totalSteps} tool calls`;

    modal.innerHTML = `
        <div class="tf-log-modal-hdr">
            <div class="tf-log-title"><div class="tf-log-title-pip"></div>Agent Process Logs</div>
            <div style="display:flex; align-items:center; gap:12px;">
                <span class="tf-log-stats">${pipelineLabel}</span>
                <button class="tf-log-dl-btn" id="tf-log-dl-json">Download JSON</button>
                <div class="tf-log-close" id="tf-log-close">&times;</div>
            </div>
        </div>
        <div class="tf-log-body">${chunksHTML}</div>
    `;

    overlayWrapper.appendChild(modal);
    document.getElementById('tf-log-close').addEventListener('click', () => modal.remove());
    
    document.getElementById('tf-log-dl-json').addEventListener('click', () => {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(sessionData, null, 2));
        const dlAnchorElem = document.createElement('a');
        dlAnchorElem.setAttribute("href",     dataStr     );
        dlAnchorElem.setAttribute("download", `agent_process_log_${sessionData.sessionId || 'trace'}.json`);
        dlAnchorElem.click();
    });

    modal.querySelectorAll('.tf-log-chunk-hdr').forEach(hdr => {
        hdr.addEventListener('click', () => {
            hdr.parentElement.classList.toggle('open');
        });
    });

    const first = modal.querySelector('.tf-log-chunk');
    if (first) first.classList.add('open');
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

const PAGE_CHAR_LIMIT = 900;

function paginateText(text, maxChars) {
    if (text.length <= maxChars) return [text];
    const pages = [];
    let start = 0;
    while (start < text.length) {
        if (start + maxChars >= text.length) {
            pages.push(text.slice(start));
            break;
        }
        let end = start + maxChars;
        while (end > start && text[end] !== ' ') end--;
        if (end === start) {
            end = start + maxChars;
        } else {
            end++; // include the trailing space so no character is skipped
        }
        pages.push(text.slice(start, end));
        start = end;
    }
    return pages;
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
    const pages = paginateText(textToType, PAGE_CHAR_LIMIT);
    const isMultiPage = pages.length > 1;
    const totalChars = textToType.length;
    // Pre-compute start char offset of each page within the full text
    const pageStartIdx = [];
    let _acc = 0;
    for (const p of pages) { pageStartIdx.push(_acc); _acc += p.length; }
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
                ${isMultiPage ? `<div class="tf-page-nav" id="tf-page-nav">
                    <button class="tf-page-btn" id="tf-page-up" disabled>↑</button>
                    <span class="tf-page-label" id="tf-page-label">page 1 / ${pages.length}</span>
                    <button class="tf-page-btn" id="tf-page-dn">↓</button>
                </div>` : ''}
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

    // Page state + span helpers
    const targetDiv = document.getElementById('tf-target');
    let currentPage = 0;

    function buildPageSpans(pageText) {
        targetDiv.innerHTML = '';
        for (let i = 0; i < pageText.length; i++) {
            const span = document.createElement('span');
            span.className = 'tf-char';
            span.textContent = pageText[i];
            targetDiv.appendChild(span);
        }
        targetDiv.querySelectorAll('.tf-char')[0]?.classList.add('cursor');
    }

    function updatePageLabel() {
        const lbl = document.getElementById('tf-page-label');
        const upBtn = document.getElementById('tf-page-up');
        if (lbl) lbl.textContent = `page ${currentPage + 1} / ${pages.length}`;
        if (upBtn) upBtn.disabled = currentPage === 0;
    }

    buildPageSpans(pages[0]);

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

    // Page nav buttons — only wired when nugget has >900 chars
    if (isMultiPage) {
        document.getElementById('tf-page-up').addEventListener('click', () => {
            if (currentPage > 0) {
                currentPage--;
                input.value = '';
                prevTypedLen = 0;
                buildPageSpans(pages[currentPage]);
                updatePageLabel();
                input.focus();
            }
        });
        document.getElementById('tf-page-dn').addEventListener('click', () => {
            if (currentPage < pages.length - 1) {
                currentPage++;
                input.value = '';
                prevTypedLen = 0;
                buildPageSpans(pages[currentPage]);
                updatePageLabel();
            } else {
                currentNuggetIndex++;
                renderCurrentNugget();
                return;
            }
            input.focus();
        });
    }

    setTimeout(() => input.focus(), 100);
    overlayWrapper.addEventListener('click', () => input.focus());

    // Escape skips the current nugget (all pages)
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            document.removeEventListener('keydown', escHandler);
            currentNuggetIndex++;
            renderCurrentNugget();
        }
    };
    document.addEventListener('keydown', escHandler);

    input.addEventListener('input', (e) => {
        if (!startTime) startTime = Date.now();
        const typed = e.target.value;
        const pageText = pages[currentPage];
        const spans = targetDiv.querySelectorAll('.tf-char');

        if (typed.length > pageText.length) {
            input.value = typed.slice(0, pageText.length);
            return;
        }

        if (typed.length > prevTypedLen) {
            const newCharIndex = typed.length - 1;
            if (typed[newCharIndex] === pageText[newCharIndex]) {
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
                if (typed[i] === pageText[i]) {
                    span.classList.add('correct');
                } else {
                    span.classList.add('wrong');
                    allCorrect = false;
                    localErrors++;
                }
            } else if (i === typed.length) span.classList.add('cursor');
        });

        // Stats track progress across all pages of this nugget
        const totalTyped = pageStartIdx[currentPage] + typed.length;
        const timeElapsedMin = (Date.now() - startTime) / 60000;
        const wpm = timeElapsedMin > 0 ? Math.round((totalTyped / 5) / timeElapsedMin) : 0;
        const acc = typed.length > 0 ? Math.round(((typed.length - localErrors) / typed.length) * 100) : 100;

        statWpm.textContent = wpm;
        statAcc.textContent = `${acc}%`;
        statChars.textContent = `${totalTyped} / ${totalChars}`;
        bottomBar.style.setProperty('--tf-progress', `${Math.round((totalTyped / totalChars) * 100)}%`);

        if (typed.length === pageText.length && allCorrect) {
            if (currentPage < pages.length - 1) {
                // Auto-advance to next page
                currentPage++;
                input.value = '';
                prevTypedLen = 0;
                buildPageSpans(pages[currentPage]);
                if (isMultiPage) updatePageLabel();
                input.focus();
            } else {
                // All pages of this nugget complete
                currentNuggetIndex++;
                setTimeout(() => renderCurrentNugget(), 300);
            }
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
    const now = new Date();
    const stamp = `${now.getDate()}${now.toLocaleString('en', { month: 'short' })}${now.getFullYear()}`;
    const slug = document.title.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60);
    a.download = `${slug}_${stamp}.md`;
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
            updateAgentBar(request.task, request.model, request.detail);
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
                if (request.data.totalMs) sessionData.totalMs = request.data.totalMs;
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

function updateAgentBar(task, model, detail) {
    const bar     = document.getElementById('tf-agent-bar');
    const taskEl  = document.getElementById('tf-agent-task');
    const modelEl = document.getElementById('tf-agent-model');
    if (!bar) return;

    const isDone  = task === 'complete' || task === 'refined';
    const isError = task === 'error';

    bar.className = 'tf-agent-bar ' + (isError ? 'tf-agent-error' : isDone ? 'tf-agent-done' : 'tf-agent-active');
    if (taskEl) {
        taskEl.textContent = `agent · ${task}`;
        if (detail) taskEl.title = detail; // Show full detail on hover
    }
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
