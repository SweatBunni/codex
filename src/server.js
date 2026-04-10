/**
 * CodexMC Server
 * Express + WebSocket server for real-time mod generation
 */

require('dotenv').config();

const express = require('express');
const expressWs = require('express-ws');
const cors = require('cors');
const path = require('path');
const fs = require('fs-extra');

const { getForgeVersions, getFabricVersions, getNeoForgeVersions } = require('../services/versions');
const { generateMod } = require('../services/generator');

const app = express();
expressWs(app);

// ── Paths ─────────────────────────────────────────────────────
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || '/tmp/codexmc-workspaces';
const SESSIONS_DIR = path.join(__dirname, '..', 'data', 'sessions');
fs.ensureDirSync(SESSIONS_DIR);

// ── Middleware ────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── Session Persistence Helpers ───────────────────────────────

async function saveMessage(sessionId, message) {
  const file = path.join(SESSIONS_DIR, `${sessionId}.json`);

  let data = [];
  if (await fs.pathExists(file)) {
    data = await fs.readJson(file);
  }

  data.push(message);

  await fs.writeJson(file, data, { spaces: 2 });
}

async function loadSession(sessionId) {
  const file = path.join(SESSIONS_DIR, `${sessionId}.json`);

  if (!await fs.pathExists(file)) return [];

  return await fs.readJson(file);
}

// ── WebSocket sessions ────────────────────────────────────────
const activeSessions = new Map();

app.ws('/ws/:sessionId', async (ws, req) => {
  const { sessionId } = req.params;

  activeSessions.set(sessionId, ws);
  console.log(`[WS] Session connected: ${sessionId}`);

  // ✅ SEND HISTORY ON CONNECT
  const history = await loadSession(sessionId);

  ws.send(JSON.stringify({
    type: 'history',
    messages: history
  }));

  ws.on('close', () => {
    activeSessions.delete(sessionId);
    console.log(`[WS] Session disconnected: ${sessionId}`);
  });

  ws.send(JSON.stringify({
    type: 'connected',
    message: '🟢 Connected to CodexMC server'
  }));
});

// ── Send + Save messages ──────────────────────────────────────
function sendToSession(sessionId, data) {
  const ws = activeSessions.get(sessionId);

  // ✅ SAVE EVERY MESSAGE
  saveMessage(sessionId, data).catch(() => {});

  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify(data));
  }
}

// ── API Routes ────────────────────────────────────────────────

// Get versions for a loader
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

// Generate a mod
app.post('/api/generate', async (req, res) => {
  const { prompt, loader, mcVersion, loaderVersion, sessionId } = req.body;

  if (!prompt || !loader || !mcVersion || !loaderVersion) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId required' });
  }

  res.json({ status: 'generating' });

  generateMod(
    { prompt, loader, mcVersion, loaderVersion, sessionId },
    (event) => {
      sendToSession(sessionId, event);
    }
  )
    .then(result => {
      sendToSession(sessionId, {
        type: 'done',
        ...result
      });
    })
    .catch(err => {
      sendToSession(sessionId, {
        type: 'error',
        message: err.message
      });
    });
});

// Existing ZIP route (kept)
app.get('/api/download/:zipName', async (req, res) => {
  const { zipName } = req.params;

  if (!/^[\w\-\.]+\.zip$/.test(zipName)) {
    return res.status(400).json({ error: 'Invalid filename' });
  }

  const zipPath = path.join('/var/codexmc-output', zipName);

  if (!await fs.pathExists(zipPath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  res.download(zipPath, zipName);
});

// ── NEW DOWNLOAD ROUTES ───────────────────────────────────────

// Source ZIP
app.get('/download/source/:id', async (req, res) => {
  const file = path.join(WORKSPACE_DIR, req.params.id, 'source.zip');

  if (!await fs.pathExists(file)) {
    return res.status(404).send("Source not found");
  }

  res.download(file);
});

// Built JAR
app.get('/download/jar/:id', async (req, res) => {
  const dir = path.join(WORKSPACE_DIR, req.params.id, 'build', 'libs');

  if (!await fs.pathExists(dir)) {
    return res.status(404).send("Build folder not found");
  }

  const files = await fs.readdir(dir);
  const jar = files.find(f => f.endsWith('.jar'));

  if (!jar) {
    return res.status(404).send("No JAR found");
  }

  res.download(path.join(dir, jar));
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    activeSessions: activeSessions.size,
    uptime: Math.floor(process.uptime())
  });
});

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ── Start server ──────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});

module.exports = app;
