/**
 * CodexMC — Frontend App
 */

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
  history: []
};

// ═══════════════════════════════════════
// HISTORY (FIXED + SAFE)
// ═══════════════════════════════════════

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistory() {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history));
  } catch (e) {
    console.warn('History save failed:', e);
  }
}

function pushHistory(item) {
  state.history.unshift(item);

  if (state.history.length > 50) {
    state.history = state.history.slice(0, 50);
  }

  saveHistory();
}

// ═══════════════════════════════════════
// INIT
// ═══════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  state.history = loadHistory();

  initCanvas();
  animateTerminal();

  renderHistory();

  const thinkingSelect = document.getElementById('thinking-select');
  if (thinkingSelect) thinkingSelect.addEventListener('change', onThinkingChange);

  const loaderSelect = document.getElementById('loader-select');
  if (loaderSelect) loaderSelect.addEventListener('change', onLoaderChange);

  // ✅ CTRL + ENTER FIX
  const promptInput = document.getElementById('prompt-input');
  if (promptInput) {
    promptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        sendPrompt();
      }
    });
  }
});

// ═══════════════════════════════════════
// PROMPT SENDING (FIXED SAFE STATE)
// ═══════════════════════════════════════

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
  } finally {
    setGenerating(false);
  }
}

// ═══════════════════════════════════════
// HISTORY SYSTEM (FIXED)
// ═══════════════════════════════════════

function addHistoryItem(prompt, loader, mcVersion, consoleId) {
  const icon = {
    forge: '⚙️',
    fabric: '🪡',
    neoforge: '✨'
  }[loader] || '🎮';

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
  const el = document.getElementById('chat-history');
  if (!el) return;

  el.innerHTML = '';

  if (!state.history.length) {
    el.innerHTML = `<div class="history-empty">No history yet</div>`;
    return;
  }

  state.history.forEach((item, i) => {
    const div = document.createElement('div');
    div.className = 'history-item';

    div.innerHTML = `
      <div class="history-item-icon">${item.icon}</div>
      <div>
        <div class="history-item-title">
          ${escapeHtml(item.prompt.slice(0, 38))}${item.prompt.length > 38 ? '…' : ''}
        </div>
        <div class="history-item-meta">
          ${item.loader} · MC ${item.mcVersion}
        </div>
      </div>
    `;

    div.onclick = () => {
      document.querySelectorAll('.history-item')
        .forEach(x => x.classList.remove('active'));

      div.classList.add('active');

      document.getElementById('msg-' + item.id)
        ?.scrollIntoView({ behavior: 'smooth' });
    };

    el.appendChild(div);

    if (i === 0) div.classList.add('active');
  });
}

// ═══════════════════════════════════════
// NEW SESSION (SAFE)
// ═══════════════════════════════════════

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
