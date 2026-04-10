/**
 * CodexMC — Frontend App
 * Features: thinking levels, JAR download, source ZIP download,
 * WebSocket live console, version management, session history
 */

// ════════════════════════════════════════════════════════
//  STATE
// ════════════════════════════════════════════════════════

const HISTORY_KEY = 'codexmc_history_v1';

const state = {
  sessionId: generateUUID(),
  ws: null,
  wsReconnectTimer: null,
  currentLoader: 'forge',
  versionsCache: {},
  isGenerating: false,
  activeConsoleId: null,
  thinkingLevel: 'medium',

  // ✅ FIX: persistent history
  history: loadHistory()
};

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ════════════════════════════════════════════════════════
//  HISTORY STORAGE (NEW FIX)
// ════════════════════════════════════════════════════════

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
  } catch {
    return [];
  }
}

function saveHistory() {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history));
}

function pushHistory(item) {
  state.history.unshift(item);
  if (state.history.length > 50) state.history.pop();
  saveHistory();
}

// ════════════════════════════════════════════════════════
//  BACKGROUND CANVAS
// ════════════════════════════════════════════════════════

function initCanvas() {
  const canvas = document.getElementById('bg-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let W, H, particles, raf;

  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  function makeParticles() {
    particles = Array.from({ length: 60 }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.3,
      vy: (Math.random() - 0.5) * 0.3,
      r: Math.random() * 1.2 + 0.4,
      alpha: Math.random() * 0.35 + 0.05
    }));
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    const g = 64;
    ctx.strokeStyle = 'rgba(255,255,255,0.025)';
    ctx.lineWidth = 1;

    for (let x = 0; x < W; x += g) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 0; y < H; y += g) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }

    const grad = ctx.createRadialGradient(W / 2, 0, 0, W / 2, 0, W * 0.55);
    grad.addColorStop(0, 'rgba(74,222,128,0.05)');
    grad.addColorStop(1, 'rgba(74,222,128,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    for (const p of particles) {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0) p.x = W;
      if (p.x > W) p.x = 0;
      if (p.y < 0) p.y = H;
      if (p.y > H) p.y = 0;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(74,222,128,${p.alpha})`;
      ctx.fill();
    }

    raf = requestAnimationFrame(draw);
  }

  resize();
  makeParticles();
  draw();
  window.addEventListener('resize', () => { resize(); makeParticles(); });
}

// ════════════════════════════════════════════════════════
//  NAVIGATION
// ════════════════════════════════════════════════════════

function showApp() {
  document.getElementById('landing-page').style.display = 'none';
  const app = document.getElementById('app-page');
  app.style.display = 'flex';
  app.classList.add('fade-in');
  connectWS();
  loadVersions('forge');

  // ✅ restore history on enter
  renderHistory();
}

function showLanding() {
  document.getElementById('app-page').style.display = 'none';
  document.getElementById('landing-page').style.display = 'block';
  if (state.ws) { state.ws.close(); state.ws = null; }
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('collapsed');
}

// ════════════════════════════════════════════════════════
//  WEBSOCKET
// ════════════════════════════════════════════════════════

function connectWS() {
  if (state.ws && state.ws.readyState < 2) return;

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  state.ws = new WebSocket(`${proto}//${location.host}/ws/${state.sessionId}`);

  state.ws.onopen = () => {
    setStatus('connected', 'Connected');
    clearTimeout(state.wsReconnectTimer);
  };

  state.ws.onclose = () => {
    setStatus('error', 'Disconnected');
    state.wsReconnectTimer = setTimeout(connectWS, 3000);
  };

  state.ws.onerror = () => setStatus('error', 'Error');

  state.ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      handleWsMessage(msg);
    } catch {}
  };
}

function handleWsMessage(msg) {
  const { type, message } = msg;

  if (type === 'done') return onGenerationDone(msg);
  if (type === 'error') return onGenerationError(message);
  if (type === 'thinking_start') return showThinkingIndicator(msg.level);
  if (type === 'thinking_end') return hideThinkingIndicator();

  appendConsoleOutput(type, message);
}

function setStatus(s, text) {
  const dot = document.getElementById('status-dot');
  const label = document.getElementById('status-text');
  if (dot) dot.className = 'status-dot ' + s;
  if (label) label.textContent = text;
}

// ════════════════════════════════════════════════════════
//  VERSION LOADING (UNCHANGED)
// ════════════════════════════════════════════════════════
// (keep your existing version functions as-is)

// ════════════════════════════════════════════════════════
//  GENERATION
// ════════════════════════════════════════════════════════

async function sendPrompt() {
  if (state.isGenerating) return;

  const promptInput = document.getElementById('prompt-input');
  const prompt = promptInput.value.trim();
  if (!prompt) return;

  const loader = document.getElementById('loader-select').value;
  const thinkingLevel = document.getElementById('thinking-select').value;
  const versionData = getSelectedVersion();

  if (!versionData) return;

  const { mcVersion, loaderVersion } = versionData;

  const consoleId = 'c-' + Date.now();

  addUserMessage(prompt, loader, mcVersion, thinkingLevel);
  addConsoleMessage(consoleId, loader, mcVersion, thinkingLevel);

  // ✅ FIX: save history immediately
  addHistoryItem(prompt, loader, mcVersion, consoleId);

  promptInput.value = '';
  autoResize(promptInput);

  setGenerating(true);

  try {
    await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        loader,
        mcVersion,
        loaderVersion,
        thinkingLevel,
        sessionId: state.sessionId,
      })
    });
  } catch (err) {
    appendConsoleOutput('error', err.message);
    setGenerating(false);
  }
}

// ════════════════════════════════════════════════════════
//  HISTORY (FIXED FULL SYSTEM)
// ════════════════════════════════════════════════════════

function addHistoryItem(prompt, loader, mcVersion, consoleId) {
  const icon = { forge: '⚙️', fabric: '🪡', neoforge: '✨' }[loader] || '🎮';

  pushHistory({
    id: consoleId,
    prompt,
    loader,
    mcVersion,
    icon,
    timestamp: Date.now()
  });

  renderHistory();
}

function renderHistory() {
  const historyEl = document.getElementById('chat-history');
  if (!historyEl) return;

  historyEl.innerHTML = '';

  if (!state.history.length) {
    historyEl.innerHTML = `<div class="history-empty">No history yet</div>`;
    return;
  }

  state.history.forEach(item => {
    const div = document.createElement('div');
    div.className = 'history-item';

    div.innerHTML = `
      <div class="history-item-icon">${item.icon}</div>
      <div>
        <div class="history-item-title">
          ${escapeHtml(item.prompt.slice(0, 38))}${item.prompt.length > 38 ? '…' : ''}
        </div>
        <div class="history-item-meta">${item.loader} · MC ${item.mcVersion}</div>
      </div>
    `;

    div.onclick = () => {
      document.querySelectorAll('.history-item')
        .forEach(el => el.classList.remove('active'));

      div.classList.add('active');

      document.getElementById('msg-' + item.id)
        ?.scrollIntoView({ behavior: 'smooth' });
    };

    historyEl.appendChild(div);
  });
}

// ════════════════════════════════════════════════════════
//  NEW SESSION (FIXED)
// ════════════════════════════════════════════════════════

function newSession() {
  document.getElementById('messages').innerHTML = '';
  document.getElementById('prompt-input').value = '';

  state.sessionId = generateUUID();
  state.activeConsoleId = null;
  state.isGenerating = false;

  if (state.ws) state.ws.close();

  setTimeout(connectWS, 100);

  renderHistory();
}

// ════════════════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  initCanvas();
  animateTerminal();

  const thinkingSelect = document.getElementById('thinking-select');
  if (thinkingSelect) thinkingSelect.addEventListener('change', onThinkingChange);

  const loaderSelect = document.getElementById('loader-select');
  if (loaderSelect) loaderSelect.addEventListener('change', onLoaderChange);

  // ✅ RESTORE HISTORY ON REFRESH
  renderHistory();
});
