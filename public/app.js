/**
 * CodexMC — Frontend App
 * Features: thinking levels, JAR download, source ZIP download,
 * WebSocket live console, version management, session history
 */

// ════════════════════════════════════════════════════════
//  STATE
// ════════════════════════════════════════════════════════

const state = {
  sessionId: generateUUID(),
  ws: null,
  wsReconnectTimer: null,
  currentLoader: 'forge',
  versionsCache: {},
  isGenerating: false,
  activeConsoleId: null,
  thinkingLevel: 'medium',
};

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}
const _KEY = 'codexmc__v1';

state.history = loadHistory();


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

    // Subtle grid
    ctx.strokeStyle = 'rgba(255,255,255,0.025)';
    ctx.lineWidth = 1;
    const g = 64;
    for (let x = 0; x < W; x += g) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y < H; y += g) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

    // Glow
    const grad = ctx.createRadialGradient(W / 2, 0, 0, W / 2, 0, W * 0.55);
    grad.addColorStop(0, 'rgba(74,222,128,0.05)');
    grad.addColorStop(1, 'rgba(74,222,128,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Particles
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

    // Connections
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < 100) {
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = `rgba(74,222,128,${0.05 * (1 - d / 100)})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
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

  if (type === 'history') return;
  if (type === 'connected') return;
  if (type === 'done') {
    onGenerationDone(msg);
    return;
  }
  if (type === 'error') {
    onGenerationError(message);
    return;
  }
  if (type === 'thinking_start') {
    showThinkingIndicator(msg.level);
    return;
  }
  if (type === 'thinking_end') {
    hideThinkingIndicator();
    return;
  }

  appendConsoleOutput(type, message);
}

function setStatus(s, text) {
  const dot = document.getElementById('status-dot');
  const label = document.getElementById('status-text');
  if (dot) dot.className = 'status-dot ' + s;
  if (label) label.textContent = text;
}

// ════════════════════════════════════════════════════════
//  VERSION LOADING
// ════════════════════════════════════════════════════════

async function loadVersions(loader) {
  const select = document.getElementById('version-select');
  if (!select) return;

  if (state.versionsCache[loader]) {
    populateVersions(loader, state.versionsCache[loader]);
    return;
  }

  select.innerHTML = '<option value="">Loading...</option>';

  try {
    const res = await fetch(`/api/versions/${loader}`);
    const data = await res.json();
    state.versionsCache[loader] = data.versions;
    populateVersions(loader, data.versions);
  } catch {
    select.innerHTML = '<option value="">Failed to load</option>';
  }
}

function populateVersions(loader, versions) {
  const select = document.getElementById('version-select');
  select.innerHTML = '';

  if (!versions || !versions.length) {
    select.innerHTML = '<option value="">No versions</option>';
    return;
  }

  versions.forEach((v, i) => {
    const lv = v.recommended || v.loaderVersion || v.forgeVersions?.[0] || v.neoforgeVersions?.[0] || '';
    const opt = document.createElement('option');
    opt.value = JSON.stringify({ mcVersion: v.mcVersion, loaderVersion: lv });
    opt.textContent = `MC ${v.mcVersion}`;
    if (i === 0) opt.selected = true;
    select.appendChild(opt);
  });
}

function onLoaderChange() {
  const loader = document.getElementById('loader-select').value;
  state.currentLoader = loader;
  loadVersions(loader);
}

function getSelectedVersion() {
  const v = document.getElementById('version-select')?.value;
  if (!v) return null;
  try { return JSON.parse(v); } catch { return null; }
}

// ════════════════════════════════════════════════════════
//  THINKING LEVEL
// ════════════════════════════════════════════════════════

function onThinkingChange() {
  const level = document.getElementById('thinking-select')?.value || 'medium';
  state.thinkingLevel = level;

  const hint = document.getElementById('thinking-hint');
  if (!hint) return;

  const labels = {
    low:    '⚡ Low thinking — Fast generation mode',
    medium: '🧩 Medium thinking — Extended reasoning enabled',
    high:   '🧠 High thinking — Deep chain-of-thought active',
  };

  hint.textContent = labels[level] || labels.medium;
  hint.className = `thinking-hint ${level}`;
}

// ════════════════════════════════════════════════════════
//  THINKING INDICATOR (UI)
// ════════════════════════════════════════════════════════

function showThinkingIndicator(level) {
  if (!state.activeConsoleId) return;
  const output = document.getElementById('output-' + state.activeConsoleId);
  if (!output) return;

  const div = document.createElement('div');
  div.id = 'thinking-indicator-' + state.activeConsoleId;
  div.className = 'thinking-indicator';
  div.innerHTML = `
    <div class="thinking-spinner"></div>
    <span class="thinking-text">🧠 AI is reasoning deeply... (${level} thinking)</span>
  `;
  output.parentElement.insertBefore(div, output);
}

function hideThinkingIndicator() {
  if (!state.activeConsoleId) return;
  const el = document.getElementById('thinking-indicator-' + state.activeConsoleId);
  if (el) el.remove();
}

// ════════════════════════════════════════════════════════
//  MOD GENERATION
// ════════════════════════════════════════════════════════

async function sendPrompt() {
  if (state.isGenerating) return;

  const promptInput = document.getElementById('prompt-input');
  const prompt = promptInput.value.trim();
  if (!prompt) { promptInput.focus(); return; }

  const loader = document.getElementById('loader-select').value;
  const thinkingLevel = document.getElementById('thinking-select').value;
  const versionData = getSelectedVersion();

  if (!versionData) {
    alert('Please wait for versions to load.');
    return;
  }

  const { mcVersion, loaderVersion } = versionData;

  // Hide welcome
  const welcome = document.getElementById('welcome-state');
  if (welcome) welcome.style.display = 'none';

  // Render user bubble
  addUserMessage(prompt, loader, mcVersion, thinkingLevel);

  promptInput.value = '';
  autoResize(promptInput);

  setGenerating(true);

  const consoleId = 'c-' + Date.now();
  addConsoleMessage(consoleId, loader, mcVersion, thinkingLevel);
  addHistoryItem(prompt, loader, mcVersion, consoleId);

  if (!state.ws || state.ws.readyState > 1) connectWS();

  try {
    const res = await fetch('/api/generate', {
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

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Server error');
    }

    updateConsoleStatus(consoleId, 'running');

  } catch (err) {
    appendConsoleOutput('error', `Failed to start: ${err.message}`);
    setGenerating(false);
    updateConsoleStatus(consoleId, 'error');
  }
}

// ════════════════════════════════════════════════════════
//  MESSAGE RENDERERS
// ════════════════════════════════════════════════════════

function addUserMessage(prompt, loader, mcVersion, thinking) {
  const msgs = document.getElementById('messages');
  const loaderLabel = { forge: '⚙️ Forge', fabric: '🪡 Fabric', neoforge: '✨ NeoForge' }[loader] || loader;
  const thinkLabel = { low: '⚡ Low', medium: '🧩 Medium', high: '🧠 High' }[thinking] || thinking;

  const div = document.createElement('div');
  div.className = 'msg-user';
  div.innerHTML = `
    <div class="msg-user-bubble">
      <div class="msg-user-meta">${loaderLabel} · MC ${mcVersion} · ${thinkLabel} thinking</div>
      ${escapeHtml(prompt)}
    </div>`;
  msgs.appendChild(div);
  scrollBottom();
}

function addConsoleMessage(consoleId, loader, mcVersion, thinking) {
  const msgs = document.getElementById('messages');
  state.activeConsoleId = consoleId;

  const thinkBadge = {
    low:    '<span class="thinking-badge-inline thinking-low-badge">⚡ LOW</span>',
    medium: '<span class="thinking-badge-inline thinking-med-badge">🧩 MED</span>',
    high:   '<span class="thinking-badge-inline thinking-high-badge">🧠 HIGH</span>',
  }[thinking] || '';

  const div = document.createElement('div');
  div.className = 'msg-ai';
  div.id = 'msg-' + consoleId;
  div.innerHTML = `
    <div class="msg-ai-header">
      <div class="ai-avatar">AI</div>
      <div class="ai-name">CodexMC Generator ${thinkBadge}</div>
      <div class="ai-status" id="ai-status-${consoleId}">
        <div class="generating-dots"><span></span><span></span><span></span></div>
      </div>
    </div>
    <div class="console-card">
      <div class="console-titlebar">
        <div class="console-dots">
          <div class="console-dot" style="background:#ff5f57"></div>
          <div class="console-dot" style="background:#ffbd2e"></div>
          <div class="console-dot" style="background:#28c840"></div>
        </div>
        <span class="console-label">codexmc — ${loader} MC ${mcVersion}</span>
        <span class="console-status running" id="status-${consoleId}">⏳ Generating</span>
      </div>
      <div class="console-output" id="output-${consoleId}">
        <span class="console-line type-info">Connecting to AI...</span>
      </div>
    </div>
    <div id="download-area-${consoleId}"></div>
  `;
  msgs.appendChild(div);
  scrollBottom();
}

function appendConsoleOutput(type, message) {
  if (!state.activeConsoleId) return;
  const output = document.getElementById('output-' + state.activeConsoleId);
  if (!output) return;

  const waiting = output.querySelector('.type-info');
  if (waiting && waiting.textContent === 'Connecting to AI...') waiting.remove();

  if (!message) return;

  String(message).split('\n').forEach(line => {
    if (!line.trim()) return;
    const span = document.createElement('span');
    span.className = `console-line type-${type}`;
    span.textContent = line;
    output.appendChild(span);
    output.appendChild(document.createTextNode('\n'));
  });

  output.scrollTop = output.scrollHeight;
  scrollBottom();
}

function updateConsoleStatus(consoleId, status) {
  const el = document.getElementById('status-' + consoleId);
  if (!el) return;
  el.className = 'console-status ' + status;
  el.textContent =
    status === 'running' ? '⏳ Generating' :
    status === 'done'    ? '✅ Complete'   :
    status === 'error'   ? '❌ Error'      : status;
}

// ════════════════════════════════════════════════════════
//  GENERATION DONE → SHOW DOWNLOAD CARDS
// ════════════════════════════════════════════════════════

function onGenerationDone(result) {
  const { modName, workId, buildSuccess, downloads, zipName } = result;

  hideThinkingIndicator();
  updateConsoleStatus(state.activeConsoleId, 'done');

  // Update status chip
  const statusEl = document.getElementById('ai-status-' + state.activeConsoleId);
  if (statusEl) statusEl.innerHTML = `<span style="color:var(--green);font-size:12px;font-family:var(--font-mono)">✅ Done</span>`;

  // Build download area
  const dlArea = document.getElementById('download-area-' + state.activeConsoleId);
  if (!dlArea) { setGenerating(false); return; }

  // Determine download URLs
  let jarUrl = null;
  let sourceUrl = null;

  if (downloads) {
    jarUrl = downloads.jar || null;
    sourceUrl = downloads.source || null;
  } else if (zipName) {
    // legacy fallback
    sourceUrl = `/api/download/${encodeURIComponent(zipName)}`;
  }

  if (workId) {
    jarUrl = jarUrl || `/download/jar/${workId}`;
    sourceUrl = sourceUrl || `/download/source/${workId}`;
  }

  const jarHtml = jarUrl
    ? `<a class="dl-btn dl-btn-jar" href="${escapeHtml(jarUrl)}" download>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Download .jar
      </a>`
    : `<span class="dl-btn dl-btn-source" style="opacity:0.5;cursor:not-allowed" title="Build failed — source available instead">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        Build failed
      </span>`;

  const sourceHtml = sourceUrl
    ? `<a class="dl-btn dl-btn-source" href="${escapeHtml(sourceUrl)}" download>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Download Source (.zip)
      </a>`
    : '';

  const buildNote = buildSuccess
    ? '✅ Compiled JAR + full source ready'
    : '⚠️ JAR build failed — source files ready';

  dlArea.innerHTML = `
    <div class="download-area">
      <div class="download-card">
        <div class="download-card-header">
          <div class="download-card-title">🎉 ${escapeHtml(modName || 'Your Mod')} is ready!</div>
          <div class="download-card-meta">${buildNote}</div>
        </div>
        <div class="download-buttons">
          ${jarHtml}
          ${sourceHtml}
        </div>
      </div>
    </div>`;

  setGenerating(false);
  scrollBottom();

  if (modName) {
    document.getElementById('topbar-title').textContent = modName;
  }
}

function onGenerationError(message) {
  hideThinkingIndicator();
  updateConsoleStatus(state.activeConsoleId, 'error');
  appendConsoleOutput('error', `❌ ${message}`);

  const statusEl = document.getElementById('ai-status-' + state.activeConsoleId);
  if (statusEl) statusEl.innerHTML = `<span style="color:var(--red);font-size:12px;font-family:var(--font-mono)">❌ Failed</span>`;

  setGenerating(false);
}

function setGenerating(val) {
  state.isGenerating = val;
  const btn = document.getElementById('send-btn');
  const inp = document.getElementById('prompt-input');
  if (btn) btn.disabled = val;
  if (inp) inp.disabled = val;
}

// ════════════════════════════════════════════════════════
//  HISTORY (FIXED + SAFE PERSISTENCE)
// ════════════════════════════════════════════════════════

const HISTORY_KEY = 'codexmc_history_v1';

state.history = loadHistorySafe();

/**
 * SAFE LOAD (prevents JSON crash from breaking app)
 */
function loadHistorySafe() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);

    if (!raw || raw === "undefined" || raw === "null") {
      return [];
    }

    return JSON.parse(raw);
  } catch (err) {
    console.warn("⚠️ Corrupted history detected — resetting storage", err);
    localStorage.removeItem(HISTORY_KEY);
    return [];
  }
}

/**
 * SAFE SAVE (never breaks app even if storage is full/blocked)
 */
function saveHistory() {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history || []));
  } catch (err) {
    console.error("❌ Failed to save history:", err);
  }
}

/**
 * RENDER HISTORY UI
 */
function renderHistory() {
  const historyEl = document.getElementById('chat-history');
  if (!historyEl) return;

  historyEl.innerHTML = '';

  if (!state.history || state.history.length === 0) {
    historyEl.innerHTML = `<div class="history-empty">No history yet</div>`;
    return;
  }

  state.history.forEach(item => {
    const div = document.createElement('div');
    div.className = 'history-item';

    div.innerHTML = `
      <div class="history-item-icon">${item.icon || '🎮'}</div>
      <div>
        <div class="history-item-title">
          ${escapeHtml(item.prompt?.slice(0, 38) || '')}
          ${item.prompt?.length > 38 ? '…' : ''}
        </div>
        <div class="history-item-meta">${item.loader} · MC ${item.mcVersion}</div>
      </div>
    `;

    div.onclick = () => {
      document.querySelectorAll('.history-item')
        .forEach(el => el.classList.remove('active'));

      div.classList.add('active');

      const target = document.getElementById('msg-' + item.id);
      if (target) target.scrollIntoView({ behavior: 'smooth' });
    };

    historyEl.appendChild(div);
  });
}

/**
 * ADD HISTORY ITEM (FIXED)
 */
function addHistoryItem(prompt, loader, mcVersion, consoleId) {
  const icon = { forge: '⚙️', fabric: '🪡', neoforge: '✨' }[loader] || '🎮';

  const item = {
    id: consoleId,
    prompt,
    loader,
    mcVersion,
    icon,
    timestamp: Date.now()
  };

  state.history.unshift(item);

  if (state.history.length > 50) {
    state.history = state.history.slice(0, 50);
  }

  saveHistory();
  renderHistory();
}
// ════════════════════════════════════════════════════════
//  UTILITIES
// ════════════════════════════════════════════════════════

function scrollBottom() {
  const area = document.getElementById('conversation-area');
  if (area) area.scrollTop = area.scrollHeight;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function handleInputKey(e) {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    sendPrompt();
  }
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 200) + 'px';
}

function useExample(btn) {
  const inp = document.getElementById('prompt-input');
  inp.value = btn.textContent;
  autoResize(inp);
  inp.focus();
}

// ════════════════════════════════════════════════════════
//  LANDING TERMINAL ANIMATION
// ════════════════════════════════════════════════════════

function animateTerminal() {
  const body = document.getElementById('terminal-preview-body');
  if (!body) return;

  const lines = body.querySelectorAll('.t-line');
  lines.forEach(l => { l.style.opacity = '0'; });
  const cursor = body.querySelector('.t-cursor');
  if (cursor) cursor.style.display = 'none';

  let i = 0;
  function next() {
    if (i < lines.length) {
      lines[i].style.opacity = '1';
      lines[i].style.transition = 'opacity 0.1s';
      i++;
      const delay = i === 1 ? 400 : i < 4 ? 700 : i < 8 ? 450 : 900;
      setTimeout(next, delay);
    } else {
      if (cursor) cursor.style.display = 'inline-block';
    }
  }
  setTimeout(next, 800);
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

  renderHistory(); // ❗ THIS is required on refresh
});
