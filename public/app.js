'use strict';

let ws = null;
let wsReady = false;
let isGenerating = false;
let currentJobId = null;
let currentChatId = null;
let modHistory = [];
let loaderVersions = { forge: [], fabric: [], neoforge: [] };
let currentLogEl = null;

const thinkingHints = {
  low: 'Low - 2K thinking tokens · ~30s',
  medium: 'Medium - 8K thinking tokens · ~60s',
  high: 'High - 24K thinking tokens · ~120s',
};

function showApp() {
  document.getElementById('landing-page').style.display = 'none';
  document.getElementById('app-page').style.display = 'flex';
  connectWS();
  loadVersions(document.getElementById('sel-loader').value);
  loadChatHistory();
}

function showLanding() {
  document.getElementById('app-page').style.display = 'none';
  document.getElementById('landing-page').style.display = '';
  if (ws) {
    ws.close();
    ws = null;
  }
}

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
    setTimeout(() => {
      if (document.getElementById('app-page').style.display !== 'none') connectWS();
    }, 3000);
  };

  ws.onerror = () => {
    wsReady = false;
    setWsStatus('error');
  };
}

function setWsStatus(state) {
  const dot = document.getElementById('ws-dot');
  const label = document.getElementById('ws-label');
  dot.className = `ws-dot ${state}`;
  label.textContent = { connected: 'Connected', connecting: 'Connecting...', error: 'Disconnected' }[state] || state;
}

function handleWSMessage(msg) {
  const { type, message, jobId, chatId, ...extra } = msg;

  if (chatId) currentChatId = chatId;

  if (type === 'error') {
    appendLog(type, message);
    showErrorResult(message);
    stopGenerating(false);
    loadChatHistory();
    return;
  }

  if (type === 'complete') {
    appendLog('done', message);
    showResult(jobId, { chatId, ...extra });
    stopGenerating(true);
    loadChatHistory();
    return;
  }

  appendLog(type, message);

  if (jobId && !currentJobId) {
    currentJobId = jobId;
  }
}

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

function createResultCard(data) {
  const { modId, modName, version, buildSuccess, files, jarUrl, sourceUrl, request } = data;
  const card = document.createElement('div');
  card.className = 'result-card';

  const filesHtml = (files || []).map((file) => `<div class="result-file-item">File ${escapeHtml(file)}</div>`).join('');
  const loader = request?.loader || document.getElementById('sel-loader').value;
  const mcVersion = request?.mcVersion || document.getElementById('sel-version').value;

  card.innerHTML = `
    <div class="result-title">${escapeHtml(modName || modId || 'Generated mod')} v${escapeHtml(version || '1.0.0')}</div>
    <div class="result-meta">
      ${escapeHtml(modId || 'unknown')} · ${escapeHtml(loader)} · ${escapeHtml(mcVersion)}
      ${buildSuccess ? ' · <span style="color:#4ade80">Build successful</span>' : ' · <span style="color:#fb923c">Source only (compile locally)</span>'}
    </div>
    <div class="result-files">
      <div class="result-files-title">Generated files (${(files || []).length})</div>
      ${filesHtml}
    </div>
    <div class="result-downloads">
      ${jarUrl ? `<a class="dl-btn dl-jar" href="${jarUrl}" download>Download JAR</a>` : ''}
      ${sourceUrl ? `<a class="dl-btn dl-source" href="${sourceUrl}" download>Source ZIP</a>` : ''}
    </div>
  `;

  return card;
}

function showResult(jobId, data) {
  const card = createResultCard(data);
  const aiWrap = document.getElementById('messages').lastElementChild;

  if (aiWrap) {
    const content = aiWrap.querySelector('.ai-content');
    if (content) {
      const indicator = content.querySelector('.thinking-indicator');
      if (indicator) indicator.remove();
      content.appendChild(card);
    }
  }

  currentChatId = data.chatId || currentChatId;
}

function showErrorResult(message) {
  const aiWrap = document.getElementById('messages').lastElementChild;
  if (!aiWrap) return;
  const content = aiWrap.querySelector('.ai-content');
  if (!content) return;

  const indicator = content.querySelector('.thinking-indicator');
  if (indicator) indicator.remove();

  const errorBox = document.createElement('div');
  errorBox.className = 'result-card';
  errorBox.innerHTML = `
    <div class="result-title">Generation failed</div>
    <div class="result-meta">${escapeHtml(message)}</div>
  `;
  content.appendChild(errorBox);
}

function createAssistantShell() {
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
          <span>Model is thinking...</span>
        </div>
      </div>
    </div>
  `;
  const aiContent = aiWrap.querySelector('.ai-content');
  aiContent.appendChild(createLogBlock());
  document.getElementById('messages').appendChild(aiWrap);
  scrollToBottom();
}

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

  hideWelcome();
  appendUserMessage(prompt);
  createAssistantShell();

  document.getElementById('prompt').value = '';
  document.getElementById('prompt').style.height = '';

  currentJobId = null;
  isGenerating = true;
  document.getElementById('send-btn').disabled = true;

  let loaderVersion = '';
  const versionsList = loaderVersions[loader] || [];
  const found = versionsList.find((entry) => (entry.mc || entry) === version);
  if (found) {
    loaderVersion = found.forge || found.loader || found.neoforge || '';
  }

  ws.send(JSON.stringify({
    chatId: currentChatId,
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

function appendSavedAssistantTurn(turn) {
  const wrap = document.createElement('div');
  wrap.className = 'msg-wrap ai-wrap';
  wrap.innerHTML = `
    <div class="ai-avatar">
      <svg viewBox="0 0 32 32" fill="none" width="18" height="18"><path d="M16 6L8 13h5v3H8l8 10 8-10h-5v-3h5L16 6z" fill="white"/></svg>
    </div>
    <div class="msg-content">
      <div class="ai-content"></div>
    </div>
  `;

  const content = wrap.querySelector('.ai-content');
  if (turn.error) {
    const errorBox = document.createElement('div');
    errorBox.className = 'result-card';
    errorBox.innerHTML = `
      <div class="result-title">Generation failed</div>
      <div class="result-meta">${escapeHtml(turn.error)}</div>
    `;
    content.appendChild(errorBox);
  } else if (turn.result) {
    content.appendChild(createResultCard({
      ...turn.result,
      request: turn.request,
    }));
  }

  document.getElementById('messages').appendChild(wrap);
}

function stopGenerating() {
  isGenerating = false;
  currentLogEl = null;
  document.getElementById('send-btn').disabled = false;
  scrollToBottom();
}

function flashInput() {
  const box = document.querySelector('.input-box');
  box.style.borderColor = '#f87171';
  setTimeout(() => {
    box.style.borderColor = '';
  }, 1000);
}

async function loadVersions(loader) {
  const sel = document.getElementById('sel-version');
  sel.innerHTML = '<option>Loading...</option>';

  try {
    const res = await fetch(`/api/versions/${loader}`);
    const data = await res.json();
    const versions = data.versions || [];
    loaderVersions[loader] = versions;

    sel.innerHTML = versions.map((entry, index) => {
      const mc = entry.mc || entry;
      return `<option value="${escapeHtml(mc)}"${index === 0 ? ' selected' : ''}>${escapeHtml(mc)}</option>`;
    }).join('');
  } catch {
    sel.innerHTML = '<option value="1.20.1">1.20.1</option>';
  }
}

function onLoaderChange() {
  loadVersions(document.getElementById('sel-loader').value);
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

function newMod() {
  currentChatId = null;
  currentJobId = null;
  previousJobId = null;
  currentLogEl = null;
  isGenerating = false;
  document.getElementById('send-btn').disabled = false;
  document.getElementById('app-header-title').textContent = 'CodexMC';
  document.getElementById('prompt').value = '';
  document.getElementById('messages').innerHTML = '';
  showWelcome();
  setActiveHistoryItem(null);
  document.getElementById('sidebar').classList.remove('open');
}

async function loadChatHistory() {
  try {
    const res = await fetch('/api/chats');
    const data = await res.json();
    modHistory = data.chats || [];
    renderHistory();
  } catch {
    modHistory = [];
    renderHistory();
  }
}

function renderHistory() {
  const container = document.getElementById('sidebar-history');
  if (!modHistory.length) {
    container.innerHTML = '<div class="sb-empty">No mods yet</div>';
    return;
  }

  container.innerHTML = modHistory.slice(0, 30).map((item) => `
    <div class="sb-item${item.id === currentChatId ? ' active' : ''}" onclick="loadHistoryItem('${escapeJs(item.id)}')">
      <div class="sb-item-main">
        <div class="sb-item-title">${escapeHtml(item.title || item.lastModName || 'Untitled mod')}</div>
        <div class="sb-item-sub">${escapeHtml(item.lastModName || item.lastPrompt || '')}</div>
      </div>
    </div>
  `).join('');
}

async function loadHistoryItem(chatId) {
  try {
    const res = await fetch(`/api/chats/${encodeURIComponent(chatId)}`);
    if (!res.ok) throw new Error('Failed to load chat');
    const chat = await res.json();

    currentChatId = chat.id;
    renderChat(chat);
    renderHistory();
    document.getElementById('sidebar').classList.remove('open');
  } catch (error) {
    console.error(error);
  }
}

function renderChat(chat) {
  document.getElementById('messages').innerHTML = '';
  hideWelcome();
  document.getElementById('app-header-title').textContent = chat.title || 'CodexMC';

  for (const turn of (chat.turns || [])) {
    if (turn.prompt) appendUserMessage(turn.prompt);
    appendSavedAssistantTurn(turn);
  }

  const latestRequest = chat.turns?.length ? chat.turns[chat.turns.length - 1].request : null;
  if (latestRequest?.loader) {
    document.getElementById('sel-loader').value = latestRequest.loader;
    loadVersions(latestRequest.loader).then(() => {
      if (latestRequest.mcVersion) document.getElementById('sel-version').value = latestRequest.mcVersion;
    });
  }
  if (latestRequest?.thinkingLevel) {
    document.getElementById('sel-thinking').value = latestRequest.thinkingLevel;
    document.getElementById('thinking-hint').textContent = thinkingHints[latestRequest.thinkingLevel] || '';
  }

  scrollToBottom();
}

function setActiveHistoryItem(chatId) {
  document.querySelectorAll('.sb-item').forEach((el) => {
    const isActive = chatId && el.getAttribute('onclick')?.includes(chatId);
    el.classList.toggle('active', Boolean(isActive));
  });
}

function handleKey(e) {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    sendPrompt();
  }
}

function autoGrow(el) {
  el.style.height = '';
  el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
}

function fillExample(btn) {
  document.getElementById('prompt').value = btn.textContent.trim();
  document.getElementById('prompt').focus();
}

document.addEventListener('DOMContentLoaded', () => {
  const sel = document.getElementById('sel-thinking');
  if (sel) {
    sel.addEventListener('change', () => {
      document.getElementById('thinking-hint').textContent = thinkingHints[sel.value] || '';
    });
  }
});

function hideWelcome() {
  const welcome = document.getElementById('welcome');
  if (welcome) welcome.style.display = 'none';
}

function showWelcome() {
  const welcome = document.getElementById('welcome');
  if (welcome) welcome.style.display = '';
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeJs(str) {
  return String(str || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function scrollToBottom() {
  const convo = document.getElementById('convo');
  if (convo) convo.scrollTop = convo.scrollHeight;
}
