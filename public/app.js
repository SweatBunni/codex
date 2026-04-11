/* ═══════════════════════════════════════════════════════════
   CodexMC v3 — Frontend App
   WebSocket-powered, ChatGPT-style UI
═══════════════════════════════════════════════════════════ */

'use strict';

// ─── State ────────────────────────────────────────────────────
let ws = null;
let wsReady = false;
let isGenerating = false;
let currentJobId = null;
let modHistory = [];
let loaderVersions = { forge: [], fabric: [], neoforge: [] };
let currentLogEl = null;

const thinkingHints = {
  low: '⚡ Low — 2K thinking tokens · ~30s',
  medium: '🧠 Medium — 8K thinking tokens · ~60s',
  high: '💡 High — 24K thinking tokens · ~120s',
};

// ─── Page navigation ──────────────────────────────────────────
function showApp() {
  document.getElementById('landing-page').style.display = 'none';
  document.getElementById('app-page').style.display = 'flex';
  connectWS();
  loadVersions('forge');
}

function showLanding() {
  document.getElementById('app-page').style.display = 'none';
  document.getElementById('landing-page').style.display = '';
  if (ws) { ws.close(); ws = null; }
}

// ─── WebSocket ────────────────────────────────────────────────
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${proto}//${location.host}/ws/generate`;

  setWsStatus('connecting');

  ws = new WebSocket(url);

  ws.onopen = () => {
    wsReady = true;
    setWsStatus('connected');
  };

  ws.onmessage = (e) => {
    try {
      handleWSMessage(JSON.parse(e.data));
    } catch {}
  };

  ws.onclose = () => {
    wsReady = false;
    setWsStatus('error');
    setTimeout(() => { if (document.getElementById('app-page').style.display !== 'none') connectWS(); }, 3000);
  };

  ws.onerror = () => {
    wsReady = false;
    setWsStatus('error');
  };
}

function setWsStatus(state) {
  const dot = document.getElementById('ws-dot');
  const label = document.getElementById('ws-label');
  dot.className = 'ws-dot ' + state;
  label.textContent = { connected: 'Connected', connecting: 'Connecting...', error: 'Disconnected' }[state] || state;
}

// ─── Handle WS messages ───────────────────────────────────────
function handleWSMessage(msg) {
  const { type, message, jobId, ...extra } = msg;

  if (type === 'error') {
    appendLog(type, message);
    stopGenerating(false);
    return;
  }

  if (type === 'complete') {
    appendLog('done', message);
    showResult(jobId, extra);
    stopGenerating(true);
    return;
  }

  // Progress types: status, ai, file, files, build, success, warning, done
  appendLog(type, message);

  if (jobId && !currentJobId) {
    currentJobId = jobId;
  }
}

// ─── Log rendering ────────────────────────────────────────────
function appendLog(type, message) {
  if (!currentLogEl) return;
  const body = currentLogEl.querySelector('.log-body');
  const line = document.createElement('div');
  line.className = `log-line type-${type}`;
  line.textContent = message;
  body.appendChild(line);
  body.scrollTop = body.scrollHeight;
}

function createLogBlock() {
  const wrap = document.createElement('div');
  wrap.className = 'log-block';
  wrap.innerHTML = `
    <div class="log-header">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/></svg>
      Build Console
    </div>
    <div class="log-body"></div>
  `;
  currentLogEl = wrap;
  return wrap;
}

// ─── Result card ──────────────────────────────────────────────
function showResult(jobId, data) {
  const { modId, modName, version, buildSuccess, files, jarUrl, sourceUrl } = data;

  const card = document.createElement('div');
  card.className = 'result-card';

  const filesHtml = (files || []).map(f =>
    `<div class="result-file-item">📄 ${f}</div>`
  ).join('');

  card.innerHTML = `
    <div class="result-title">✅ ${modName || modId} v${version}</div>
    <div class="result-meta">
      ${modId} · ${document.getElementById('sel-loader').value} · ${document.getElementById('sel-version').value}
      ${buildSuccess ? ' · <span style="color:#4ade80">Build successful</span>' : ' · <span style="color:#fb923c">Source only (compile locally)</span>'}
    </div>
    <div class="result-files">
      <div class="result-files-title">Generated files (${(files || []).length})</div>
      ${filesHtml}
    </div>
    <div class="result-downloads">
      ${jarUrl ? `<a class="dl-btn dl-jar" href="${jarUrl}" download>⬇ Download JAR</a>` : ''}
      ${sourceUrl ? `<a class="dl-btn dl-source" href="${sourceUrl}" download>⬇ Source ZIP</a>` : ''}
    </div>
  `;

  // Append after log block
  const aiWrap = document.getElementById('messages').lastElementChild;
  if (aiWrap) {
    const content = aiWrap.querySelector('.ai-content');
    if (content) {
      const indicator = content.querySelector('.thinking-indicator');
      if (indicator) indicator.remove();
      content.appendChild(card);
    }
  }

  // Add to history
  addHistory(modName || modId, jobId);
}

// ─── Send prompt ──────────────────────────────────────────────
function sendPrompt() {
  if (isGenerating || !wsReady) return;

  const prompt = document.getElementById('prompt').value.trim();
  if (!prompt || prompt.length < 5) {
    flashInput();
    return;
  }

  const loader = document.getElementById('sel-loader').value;
  const version = document.getElementById('sel-version').value;
  const thinking = document.getElementById('sel-thinking').value;

  // Hide welcome if visible
  const welcome = document.getElementById('welcome');
  if (welcome) welcome.style.display = 'none';

  // User message
  appendUserMessage(prompt);

  // AI response shell
  const aiWrap = document.createElement('div');
  aiWrap.className = 'msg-wrap ai-wrap';
  aiWrap.innerHTML = `
    <div class="ai-avatar">
      <svg viewBox="0 0 32 32" fill="none" width="18" height="18"><path d="M16 6L8 13h5v3H8l8 10 8-10h-5v-3h5L16 6z" fill="white"/></svg>
    </div>
    <div class="msg-content">
      <div class="ai-content">
        <div class="thinking-indicator">
          <div class="thinking-dots"><span></span><span></span><span></span></div>
          <span>DeepSeek is thinking...</span>
        </div>
      </div>
    </div>
  `;
  const aiContent = aiWrap.querySelector('.ai-content');

  // Create log block
  const logBlock = createLogBlock();
  aiContent.appendChild(logBlock);

  document.getElementById('messages').appendChild(aiWrap);
  scrollToBottom();

  // Clear input
  document.getElementById('prompt').value = '';
  document.getElementById('prompt').style.height = '';

  // Send via WS
  currentJobId = null;
  isGenerating = true;
  document.getElementById('send-btn').disabled = true;

  // Find loader version
  let loaderVersion = '';
  const versionsList = loaderVersions[loader] || [];
  const found = versionsList.find(v => (v.mc || v) === version);
  if (found) {
    loaderVersion = found.forge || found.loader || found.neoforge || '';
  }

  ws.send(JSON.stringify({
    description: prompt,
    loader,
    mcVersion: version,
    loaderVersion,
    thinkingLevel: thinking,
  }));
}

function appendUserMessage(text) {
  const wrap = document.createElement('div');
  wrap.className = 'msg-wrap user-wrap';
  wrap.innerHTML = `<div class="msg-content"><div class="user-bubble">${escapeHtml(text)}</div></div>`;
  document.getElementById('messages').appendChild(wrap);
  scrollToBottom();
}

function stopGenerating(success) {
  isGenerating = false;
  currentLogEl = null;
  document.getElementById('send-btn').disabled = false;
  scrollToBottom();
}

function flashInput() {
  const box = document.querySelector('.input-box');
  box.style.borderColor = '#f87171';
  setTimeout(() => box.style.borderColor = '', 1000);
}

// ─── Version loading ──────────────────────────────────────────
async function loadVersions(loader) {
  const sel = document.getElementById('sel-version');
  sel.innerHTML = '<option>Loading...</option>';

  try {
    const res = await fetch(`/api/versions/${loader}`);
    const data = await res.json();
    const versions = data.versions || [];
    loaderVersions[loader] = versions;

    sel.innerHTML = versions.map((v, i) => {
      const mc = v.mc || v;
      return `<option value="${mc}"${i === 0 ? ' selected' : ''}>${mc}</option>`;
    }).join('');
  } catch (e) {
    sel.innerHTML = '<option value="1.20.1">1.20.1</option>';
  }
}

function onLoaderChange() {
  const loader = document.getElementById('sel-loader').value;
  loadVersions(loader);
}

// ─── Sidebar ──────────────────────────────────────────────────
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

function newMod() {
  document.getElementById('messages').innerHTML = '';
  document.getElementById('welcome').style.display = '';
  document.getElementById('prompt').value = '';
  currentJobId = null;
  currentLogEl = null;
  isGenerating = false;
  document.getElementById('send-btn').disabled = false;
  document.getElementById('app-header-title').textContent = 'CodexMC';

  // Deactivate history items
  document.querySelectorAll('.sb-item').forEach(i => i.classList.remove('active'));

  // Close sidebar on mobile
  document.getElementById('sidebar').classList.remove('open');
}

function addHistory(name, jobId) {
  modHistory.unshift({ name, jobId });
  renderHistory();
}

function renderHistory() {
  const container = document.getElementById('sidebar-history');
  if (modHistory.length === 0) {
    container.innerHTML = '<div class="sb-empty">No mods yet</div>';
    return;
  }
  container.innerHTML = modHistory.slice(0, 20).map((item, i) => `
    <div class="sb-item${i === 0 ? ' active' : ''}" onclick="loadHistoryItem(${i})">
      ⚡ ${escapeHtml(item.name)}
    </div>
  `).join('');
}

function loadHistoryItem(index) {
  document.querySelectorAll('.sb-item').forEach((el, i) => {
    el.classList.toggle('active', i === index);
  });
  document.getElementById('sidebar').classList.remove('open');
}

// ─── Keyboard / input ─────────────────────────────────────────
function handleKey(e) {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    sendPrompt();
  }
}

function autoGrow(el) {
  el.style.height = '';
  el.style.height = Math.min(el.scrollHeight, 200) + 'px';
}

function fillExample(btn) {
  document.getElementById('prompt').value = btn.textContent.trim();
  document.getElementById('prompt').focus();
}

// ─── Thinking hint ────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const sel = document.getElementById('sel-thinking');
  if (sel) {
    sel.addEventListener('change', () => {
      document.getElementById('thinking-hint').textContent = thinkingHints[sel.value] || '';
    });
  }
});

// ─── Utils ───────────────────────────────────────────────────
function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function scrollToBottom() {
  const convo = document.getElementById('convo');
  if (convo) convo.scrollTop = convo.scrollHeight;
}
