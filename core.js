// core.js - extended calculator logic with click sounds & history
// - Adds a low keyboard-like click using Web Audio API (toggle-able)
// - Adds a history drawer: save, recall, delete, clear
// - Keeps all previous behavior: memory (M+/M-/MR/MC), trig tokens, DEG/RAD, dark mode, full-screen layout
// - Code intentionally expanded with comments and helper functions for readability and future extension.

(() => {
  // ---------- DOM references ----------
  const displayEl = document.getElementById('display');
  const memoryIndicator = document.getElementById('memoryIndicator');
  const angleToggle = document.getElementById('angleToggle');
  const angleLabel = document.getElementById('angleLabel');
  const buttons = document.querySelectorAll('.buttons-grid .btn');
  const themeToggle = document.getElementById('themeToggle');
  const themeIcon = document.getElementById('themeIcon');
  const soundToggle = document.getElementById('soundToggle');
  const soundIcon = document.getElementById('soundIcon');
  const historyToggle = document.getElementById('historyToggle');
  const historyPanel = document.getElementById('historyPanel');
  const historyList = document.getElementById('historyList');
  const closeHistoryBtn = document.getElementById('closeHistoryBtn');
  const clearHistoryBtn = document.getElementById('clearHistoryBtn');

  // ---------- Application state ----------
  let expression = '';
  let lastResult = null;
  let memory = 0;
  let justEvaluated = false;

  // History settings
  const HISTORY_KEY = 'calcHistoryV2';
  const HISTORY_MAX = 100;

  // Sound settings
  const SOUND_KEY = 'calcSoundEnabled';
  let soundEnabled = (localStorage.getItem(SOUND_KEY) ?? 'true') === 'true';

  // Small note: We lazily create AudioContext because some browsers require a user gesture first.
  let audioCtx = null;

  // ---------- Initialization ----------
  updateDisplay();
  updateMemoryIndicator();
  angleToggle.checked = false;
  angleLabel.textContent = 'DEG';
  initTheme();
  initSoundToggle();
  renderHistoryPanel(); // show persisted history (hidden until user opens)

  // ---------- Utility helpers ----------
  function updateDisplay() {
    displayEl.value = expression || (lastResult !== null ? String(lastResult) : '0');
  }

  function updateMemoryIndicator() {
    memoryIndicator.textContent = memory !== 0 ? `M = ${memory}` : '';
  }

  function tidyNumber(n) {
    if (!Number.isFinite(n)) return NaN;
    if (Math.abs(n) < 1e-12) return 0;
    return Number.parseFloat(Number(n).toPrecision(12));
  }

  // ---------- Sound: lightweight keyboard-like click ----------
  // We synthesize a short percussive click using a very short oscillator + gain envelope.
  function ensureAudioCtx() {
    if (!audioCtx) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        // Audio not available
        audioCtx = null;
      }
    }
    return audioCtx;
  }

  function playClick() {
    if (!soundEnabled) return;
    const ctx = ensureAudioCtx();
    if (!ctx) return;

    // Parameters chosen to sound like a soft keyboard click:
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    // A short pulse with a slightly higher frequency gives the 'click' character
    osc.type = 'triangle';
    osc.frequency.value = 1200; // Hz (keyboard-esque)
    gain.gain.value = 0.0001;

    // Envelope: very short attack, slightly longer decay
    const attack = 0.001;
    const decay = 0.06;
    const sustain = 0.0001;

    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(0.000001, now);
    gain.gain.linearRampToValueAtTime(0.04, now + attack); // peak
    gain.gain.exponentialRampToValueAtTime(sustain, now + attack + decay); // decay
    // stop sound shortly after
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + attack + decay + 0.01);

    // cleanup when finished
    osc.onended = () => {
      if (gain.disconnect) try { gain.disconnect(); } catch(e){}
      if (osc.disconnect) try { osc.disconnect(); } catch(e){}
    };
  }

  function initSoundToggle() {
    // update visual state
    soundToggle.setAttribute('aria-pressed', String(soundEnabled));
    updateSoundIcon();
    // click handler
    soundToggle.addEventListener('click', () => {
      soundEnabled = !soundEnabled;
      localStorage.setItem(SOUND_KEY, String(soundEnabled));
      soundToggle.setAttribute('aria-pressed', String(soundEnabled));
      updateSoundIcon();
      // play a test click when turning on
      if (soundEnabled) {
        setTimeout(playClick, 60);
      }
    });
  }

  function updateSoundIcon() {
    // simply tint icon based on state
    if (soundEnabled) {
      soundToggle.style.opacity = '1';
      soundToggle.title = 'Click sounds: on';
    } else {
      soundToggle.style.opacity = '0.6';
      soundToggle.title = 'Click sounds: off';
    }
  }

  // ---------- Safe-ish evaluation ----------
  // We define wrappers to control DEG/RAD behavior and expose a limited API to Function()
  function safeEval(expr) {
    if (!/^[0-9+\-*/().\s%a-zA-Z_,]*$/.test(expr)) {
      throw new Error('Invalid characters in expression');
    }

    const angleMode = angleToggle.checked ? 'RAD' : 'DEG';

    const prelude = `
      "use strict";
      const __angle = "${angleMode}";
      const __toAngle = v => (__angle === "DEG") ? (v * Math.PI / 180) : v;
      const __sin = v => Math.sin(__toAngle(v));
      const __cos = v => Math.cos(__toAngle(v));
      const __tan = v => Math.tan(__toAngle(v));
      const __asin = v => { const r = Math.asin(v); return (__angle === "DEG") ? (r * 180 / Math.PI) : r; };
      const __acos = v => { const r = Math.acos(v); return (__angle === "DEG") ? (r * 180 / Math.PI) : r; };
      const __atan = v => { const r = Math.atan(v); return (__angle === "DEG") ? (r * 180 / Math.PI) : r; };
      const __sec = v => 1 / __cos(v);
      const __csc = v => 1 / __sin(v);
      const __cot = v => 1 / __tan(v);
      const __sqrt = v => Math.sqrt(v);
      const __pow = (a,b) => Math.pow(a,b);
    `;

    // replacements: sin( -> __sin( etc
    const replacements = [
      ['sin(', '__sin('],
      ['cos(', '__cos('],
      ['tan(', '__tan('],
      ['asin(', '__asin('],
      ['acos(', '__acos('],
      ['atan(', '__atan('],
      ['sec(', '__sec('],
      ['csc(', '__csc('],
      ['cot(', '__cot('],
      ['sqrt(', '__sqrt('],
      ['^', '**'],
      ['pow(', '__pow(']
    ];
    for (const [from, to] of replacements) {
      expr = expr.split(from).join(to);
    }

    // percent handling
    expr = expr.replace(/(\d+(\.\d+)?)%/g, '($1/100)');

    const finalCode = `${prelude} return (${expr});`;
    return Function(finalCode)();
  }

  // ---------- Button wiring ----------
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      // play click for UI tactile feedback
      playClick();

      if (btn.dataset.value) {
        handleValue(btn.dataset.value);
      } else if (btn.dataset.action) {
        const act = btn.dataset.action;
        if (act === 'fn' && btn.dataset.value) {
          insertFunctionToken(btn.dataset.value);
        } else {
          handleAction(act);
        }
      }
    });
  });

  // insert token (numbers, operators, parentheses)
  function handleValue(val) {
    if (justEvaluated && /[0-9.]/.test(val)) {
      expression = '';
    }
    justEvaluated = false;

    if (val === '.') {
      const tokens = expression.split(/[\+\-\*\/\(\)]/);
      const last = tokens[tokens.length - 1];
      if (last.includes('.')) return;
      if (last === '') expression += '0';
    }
    expression += val;
    updateDisplay();
  }

  // insert function token like 'sin('
  function insertFunctionToken(token) {
    if (justEvaluated) { expression = ''; justEvaluated = false; }
    expression += token;
    updateDisplay();
  }

  // ---------- Top-level actions (clear, equals, mem ops, sqrt, square) ----------
  function handleAction(action) {
    switch (action) {
      case 'clear':
        expression = '';
        lastResult = null;
        updateDisplay();
        break;
      case 'clearAll':
        expression = '';
        lastResult = null;
        memory = 0;
        updateDisplay();
        updateMemoryIndicator();
        break;
      case 'equals':
        evaluateExpression();
        break;
      case 'mplus':
        mPlus();
        break;
      case 'mminus':
        mMinus();
        break;
      case 'mr':
        recallMemory();
        break;
      case 'mc':
        memory = 0; updateMemoryIndicator(); justEvaluated = true;
        break;
      case 'sqrt':
        insertFunctionToken('sqrt(');
        break;
      case 'square':
        if (!expression && lastResult !== null) {
          lastResult = tidyNumber(lastResult * lastResult);
          justEvaluated = true;
          updateDisplay();
        } else if (expression) {
          // wrap as __pow(expression,2) so safeEval handles it
          expression = `__pow(${expression},2)`;
          evaluateExpression();
        }
        break;
      default:
        console.warn('Unknown action', action);
    }
  }

  // ---------- Evaluate and history handling ----------
  function evaluateExpression() {
    if (!expression && lastResult === null) return;

    try {
      const exprToEval = expression || String(lastResult);
      let prepared = exprToEval.split('pow(').join('__pow(').split('PI').join(`${Math.PI}`);
      // Evaluate
      const raw = safeEval(prepared);
      if (!Number.isFinite(raw)) throw new Error('Result not finite');
      lastResult = tidyNumber(raw);
      // Save to history: show original typed expression if present, otherwise expression = lastResult
      const historyEntry = {
        expr: expression || String(lastResult),
        result: lastResult,
        time: Date.now()
      };
      pushHistory(historyEntry);

      expression = '';
      justEvaluated = true;
      updateDisplay();
    } catch (err) {
      console.error(err);
      expression = '';
      lastResult = null;
      displayEl.value = 'Error';
      justEvaluated = true;
    }
  }

  // ---------- Memory helpers ----------
  function getCurrentValueForMemory() {
    if (expression) {
      try {
        const val = safeEval(expression);
        return Number.isFinite(val) ? val : null;
      } catch { return null; }
    }
    return lastResult !== null ? lastResult : 0;
  }

  function mPlus() {
    const cv = getCurrentValueForMemory();
    if (cv === null) return;
    memory = tidyNumber(memory + cv);
    updateMemoryIndicator();
    justEvaluated = true;
  }

  function mMinus() {
    const cv = getCurrentValueForMemory();
    if (cv === null) return;
    memory = tidyNumber(memory - cv);
    updateMemoryIndicator();
    justEvaluated = true;
  }

  function recallMemory() {
    if (memory !== 0) {
      if (justEvaluated) expression = String(memory);
      else expression += String(memory);
      updateDisplay();
    }
  }

  // clicking memory indicator recalls memory too
  memoryIndicator.addEventListener('click', () => {
    playClick();
    recallMemory();
  });

  // ---------- Theme handling ----------
  function initTheme() {
    const savedTheme = localStorage.getItem('calcTheme') || 'light';
    if (savedTheme === 'dark') document.body.classList.add('dark');
    updateThemeIcon();
    themeToggle.addEventListener('click', () => {
      playClick();
      document.body.classList.toggle('dark');
      const isDark = document.body.classList.contains('dark');
      localStorage.setItem('calcTheme', isDark ? 'dark' : 'light');
      themeToggle.setAttribute('aria-pressed', String(isDark));
      updateThemeIcon();
    });
  }

  function updateThemeIcon() {
    const isDark = document.body.classList.contains('dark');
    themeIcon.style.color = isDark ? '#ffd166' : '#0f62fe';
    themeToggle.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
  }

  // ---------- Keyboard support (with click) ----------
  window.addEventListener('keydown', (e) => {
    // Play click for keyboard interactions too (but avoid duplicate for non-interactive keys)
    // We'll only play for keys that map to calculator actions
    const key = e.key;
    const mapped = (() => {
      if (key >= '0' && key <= '9') return true;
      if (key === '.') return true;
      if (['+','-','*','/','(',')','Enter','=', 'Backspace', 'Escape'].includes(key)) return true;
      if (['s','c','t'].includes(key.toLowerCase())) return true;
      return false;
    })();

    if (mapped) playClick();

    // numbers and dot
    if (key >= '0' && key <= '9') { handleValue(key); e.preventDefault(); return; }
    if (key === '.') { handleValue('.'); e.preventDefault(); return; }

    // operators & parens
    if (['+','-','*','/','(',')'].includes(key)) { handleValue(key); e.preventDefault(); return; }

    // Enter or '=' -> evaluate
    if (key === 'Enter' || key === '=') { handleAction('equals'); e.preventDefault(); return; }

    // Backspace -> remove last char
    if (key === 'Backspace') {
      if (expression) { expression = expression.slice(0, -1); updateDisplay(); }
      e.preventDefault(); return;
    }

    // Escape -> clear
    if (key === 'Escape') { handleAction('clear'); e.preventDefault(); return; }

    // quick trig typing shortcuts
    if (key.toLowerCase() === 's' && !e.ctrlKey && !e.metaKey) { insertFunctionToken('sin('); e.preventDefault(); return; }
    if (key.toLowerCase() === 'c' && !e.ctrlKey && !e.metaKey) { insertFunctionToken('cos('); e.preventDefault(); return; }
    if (key.toLowerCase() === 't' && !e.ctrlKey && !e.metaKey) { insertFunctionToken('tan('); e.preventDefault(); return; }
  });

  // ---------- History: persistence and UI ----------
  function loadHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  function saveHistory(arr) {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(arr)); } catch (e) { console.error('Failed to save history', e); }
  }

  function pushHistory(item) {
    const arr = loadHistory();
    // keep length limited
    arr.unshift(item);
    if (arr.length > HISTORY_MAX) arr.length = HISTORY_MAX;
    saveHistory(arr);
    // re-render if panel open
    if (historyPanel.classList.contains('open')) renderHistoryPanel();
  }

  function clearHistory() {
    saveHistory([]);
    renderHistoryPanel();
  }

  function removeHistoryAt(idx) {
    const arr = loadHistory();
    if (idx < 0 || idx >= arr.length) return;
    arr.splice(idx, 1);
    saveHistory(arr);
    renderHistoryPanel();
  }

  function renderHistoryPanel() {
    // build panel items
    const arr = loadHistory();
    historyList.innerHTML = '';
    if (arr.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'history-item';
      empty.textContent = 'No history yet — results will appear here after evaluation.';
      historyList.appendChild(empty);
      return;
    }
    arr.forEach((h, i) => {
      const item = document.createElement('div');
      item.className = 'history-item';
      const top = document.createElement('div');
      top.className = 'meta';
      const time = new Date(h.time);
      top.innerHTML = `<span>${time.toLocaleString()}</span><span>${h.result}</span>`;
      const expr = document.createElement('div');
      expr.textContent = h.expr;
      expr.style.fontWeight = '700';
      expr.style.fontSize = '14px';
      const actions = document.createElement('div');
      actions.className = 'history-actions-row';
      const recallResBtn = document.createElement('button');
      recallResBtn.textContent = 'Recall ▶';
      recallResBtn.title = 'Insert result into input';
      recallResBtn.addEventListener('click', () => {
        playClick();
        if (justEvaluated) expression = String(h.result);
        else expression += String(h.result);
        updateDisplay();
      });
      const recallExprBtn = document.createElement('button');
      recallExprBtn.textContent = 'Expr ⤓';
      recallExprBtn.title = 'Insert full expression';
      recallExprBtn.addEventListener('click', () => {
        playClick();
        expression = h.expr;
        updateDisplay();
      });
      const delBtn = document.createElement('button');
      delBtn.textContent = 'Delete ✕';
      delBtn.title = 'Remove from history';
      delBtn.addEventListener('click', () => {
        playClick();
        removeHistoryAt(i);
      });
      actions.appendChild(recallResBtn);
      actions.appendChild(recallExprBtn);
      actions.appendChild(delBtn);

      item.appendChild(top);
      item.appendChild(expr);
      item.appendChild(actions);
      historyList.appendChild(item);
    });
  }

  // History toggle wiring
  historyToggle.addEventListener('click', () => {
    playClick();
    const open = historyPanel.classList.toggle('open');
    historyPanel.setAttribute('aria-hidden', String(!open));
    historyToggle.setAttribute('aria-pressed', String(open));
    if (open) renderHistoryPanel();
  });
  closeHistoryBtn.addEventListener('click', () => {
    playClick();
    historyPanel.classList.remove('open');
    historyPanel.setAttribute('aria-hidden', 'true');
    historyToggle.setAttribute('aria-pressed', 'false');
  });
  clearHistoryBtn.addEventListener('click', () => {
    playClick();
    if (confirm('Clear all history?')) clearHistory();
  });

  // ---------- Small accessibility / extras ----------
  // allow clicking outside the drawer to close (optional)
  window.addEventListener('click', (e) => {
    if (!historyPanel.classList.contains('open')) return;
    const inside = historyPanel.contains(e.target) || historyToggle.contains(e.target);
    if (!inside) {
      historyPanel.classList.remove('open');
      historyPanel.setAttribute('aria-hidden', 'true');
      historyToggle.setAttribute('aria-pressed', 'false');
    }
  });

  // ---------- Expose debug for dev convenience ----------
  window._calc = {
    get state() { return { expression, lastResult, memory, justEvaluated, soundEnabled, angleMode: angleToggle.checked ? 'RAD' : 'DEG' }; },
    clearHistory: () => { clearHistory(); },
    eval: (s) => { expression = s; evaluateExpression(); return lastResult; }
  };

})();