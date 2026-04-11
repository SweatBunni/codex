/**
 * CodexMC Server
 * Express + WebSocket — real-time mod generation
 * Model: mistral /mistral 7b via OpenRouter
 */

require('dotenv').config();

const express = require('express');
const expressWs = require('express-ws');
const cors = require('cors');
const path = require('path');
const fs = require('fs-extra');
const crypto = require('crypto');

const { getForgeVersions, getFabricVersions, getNeoForgeVersions } = require('../services/versions');
const { generateMod } = require('../services/generator');

const app = express();
expressWs(app);

// ─────────────────────────────────────────────
// PATHS
// ─────────────────────────────────────────────

const WORKSPACE_DIR = process.env.WORKSPACE_DIR || '/tmp/codexmc-workspaces';
const SESSIONS_DIR = path.join(__dirname, '..', 'data', 'sessions');
fs.ensureDirSync(SESSIONS_DIR);
fs.ensureDirSync(WORKSPACE_DIR);

// ─────────────────────────────────────────────
// SESSION STORAGE
// ─────────────────────────────────────────────

async function loadChat(sessionId) {
  const file = path.join(SESSIONS_DIR, `${sessionId}.json`);
  if (!(await fs.pathExists(file))) return [];
  return await fs.readJson(file);
}

async function saveChat(sessionId, message) {
  const file = path.join(SESSIONS_DIR, `${sessionId}.json`);
  let data = [];
  if (await fs.pathExists(file)) data = await fs.readJson(file);
  data.push({ ...message, timestamp: Date.now() });
  await fs.writeJson(file, data, { spaces: 2 });
}

// ─────────────────────────────────────────────
// MIDDLEWARE
// ─────────────────────────────────────────────

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// ─────────────────────────────────────────────
// WEBSOCKET
// ─────────────────────────────────────────────

const activeSessions = new Map();

app.ws('/ws/:sessionId', async (ws, req) => {
  const { sessionId } = req.params;
  activeSessions.set(sessionId, ws);
  console.log(`[WS] Connected: ${sessionId}`);

  const history = await loadChat(sessionId);
  ws.send(JSON.stringify({ type: 'history', messages: history }));
  ws.send(JSON.stringify({ type: 'connected', message: '🟢 Connected to CodexMC' }));

  ws.on('close', () => {
    activeSessions.delete(sessionId);
    console.log(`[WS] Disconnected: ${sessionId}`);
  });
});

function sendToSession(sessionId, data) {
  saveChat(sessionId, data).catch(() => {});
  const ws = activeSessions.get(sessionId);
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(data));
  }
}

// ─────────────────────────────────────────────
// API: VERSION LISTS
// ─────────────────────────────────────────────

app.get('/api/versions/:loader', async (req, res) => {
  try {
    const { loader } = req.params;
    let versions;
    switch (loader.toLowerCase()) {
      case 'forge':    versions = await getForgeVersions(); break;
      case 'fabric':   versions = await getFabricVersions(); break;
      case 'neoforge': versions = await getNeoForgeVersions(); break;
      default: return res.status(400).json({ error: 'Unknown loader' });
    }
    res.json({ loader, versions });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────
// API: GENERATE MOD
// ─────────────────────────────────────────────

app.post('/api/generate', async (req, res) => {
  let { prompt, loader, mcVersion, loaderVersion, thinkingLevel, sessionId } = req.body;

  console.log('[Generate]', { loader, mcVersion, thinkingLevel, prompt: prompt?.slice(0, 60) });

  if (!sessionId) sessionId = crypto.randomUUID();
  if (!loaderVersion) loaderVersion = 'latest';
  if (!thinkingLevel || !['low', 'medium', 'high'].includes(thinkingLevel)) {
    thinkingLevel = 'medium';
  }

  if (!prompt || !loader || !mcVersion) {
    return res.status(400).json({ error: 'Missing required fields: prompt, loader, mcVersion' });
  }

  // Respond immediately — generation streams via WS
  res.json({ status: 'generating', sessionId });

  generateMod(
    { prompt, loader, mcVersion, loaderVersion, thinkingLevel, sessionId },
    (event) => sendToSession(sessionId, event)
  )
    .then(result => {
      sendToSession(sessionId, { type: 'done', ...result });
    })
    .catch(err => {
      sendToSession(sessionId, { type: 'error', message: err.message });
    });
});

// ─────────────────────────────────────────────
// DOWNLOADS
// ─────────────────────────────────────────────

// Source ZIP
app.get('/download/source/:workId', async (req, res) => {
  const { workId } = req.params;
  if (!/^[\w-]+$/.test(workId)) return res.status(400).json({ error: 'Invalid workId' });

  const zipPath = path.join(WORKSPACE_DIR, workId, 'source.zip');
  if (!(await fs.pathExists(zipPath))) return res.status(404).json({ error: 'Source not found' });

  res.download(zipPath, `codexmc-source-${workId.slice(0, 8)}.zip`);
});

// Compiled JAR
app.get('/download/jar/:workId', async (req, res) => {
  const { workId } = req.params;
  if (!/^[\w-]+$/.test(workId)) return res.status(400).json({ error: 'Invalid workId' });

  const libsDir = path.join(WORKSPACE_DIR, workId, 'build', 'libs');
  if (!(await fs.pathExists(libsDir))) return res.status(404).json({ error: 'Build directory not found' });

  const files = await fs.readdir(libsDir);
  const jar = files.find(f => f.endsWith('.jar') && !f.includes('sources') && !f.includes('javadoc'));
  if (!jar) return res.status(404).json({ error: 'No JAR found. Build may have failed.' });

  res.download(path.join(libsDir, jar), jar);
});

// Legacy download route
app.get('/api/download/:zipName', async (req, res) => {
  const { zipName } = req.params;
  if (!/^[\w\-\.]+\.zip$/.test(zipName)) return res.status(400).json({ error: 'Invalid filename' });

  const zipPath = path.join('/var/codexmc-output', zipName);
  if (!(await fs.pathExists(zipPath))) return res.status(404).json({ error: 'File not found' });

  res.download(zipPath, zipName);
});

// ─────────────────────────────────────────────
// HEALTH
// ─────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    model: 'mistral /mistral:free',
    activeSessions: activeSessions.size,
    uptime: Math.floor(process.uptime()),
    workspace: WORKSPACE_DIR,
  });
});

// ─────────────────────────────────────────────
// SPA FALLBACK
// ─────────────────────────────────────────────

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ─────────────────────────────────────────────
// START
// ─────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`✅ CodexMC running at http://${HOST}:${PORT}`);
  console.log(`🤖 Model: mistral /mistral 7b (via OpenRouter)`);
  console.log(`📁 Workspace: ${WORKSPACE_DIR}`);
});

module.exports = app;
