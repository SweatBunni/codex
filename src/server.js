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
const crypto = require('crypto');

const { getForgeVersions, getFabricVersions, getNeoForgeVersions } = require('../services/versions');
const { generateMod } = require('../services/generator');

const app = express();
expressWs(app);

// ─────────────────────────────────────────────
// PATHS
// ─────────────────────────────────────────────

const WORKSPACE_DIR = process.env.WORKSPACE_DIR || '/tmp/codexmc-workspaces';
const SESSIONS_DIR = path.join(__dirname, "..", "data", "sessions");
fs.ensureDirSync(SESSIONS_DIR);

// ─────────────────────────────────────────────
// CHAT STORAGE (FIXED - SINGLE SYSTEM)
// ─────────────────────────────────────────────

async function loadChat(sessionId) {
  const file = path.join(SESSIONS_DIR, `${sessionId}.json`);
  if (!(await fs.pathExists(file))) return [];
  return await fs.readJson(file);
}

async function saveChat(sessionId, message) {
  const file = path.join(SESSIONS_DIR, `${sessionId}.json`);

  let data = [];
  if (await fs.pathExists(file)) {
    data = await fs.readJson(file);
  }

  data.push({
    ...message,
    timestamp: Date.now()
  });

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

  // send chat history on reconnect
  const history = await loadChat(sessionId);

  ws.send(JSON.stringify({
    type: "history",
    messages: history
  }));

  ws.send(JSON.stringify({
    type: "connected",
    message: "🟢 Connected to CodexMC"
  }));

  ws.on('close', () => {
    activeSessions.delete(sessionId);
    console.log(`[WS] Disconnected: ${sessionId}`);
  });
});

// ─────────────────────────────────────────────
// SEND + SAVE MESSAGE (FIXED)
// ─────────────────────────────────────────────

function sendToSession(sessionId, data) {
  const ws = activeSessions.get(sessionId);

  // save EVERY message
  saveChat(sessionId, data).catch(() => {});

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
      case 'forge': versions = await getForgeVersions(); break;
      case 'fabric': versions = await getFabricVersions(); break;
      case 'neoforge': versions = await getNeoForgeVersions(); break;
      default:
        return res.status(400).json({ error: 'Unknown loader' });
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
  let { prompt, loader, mcVersion, loaderVersion, sessionId } = req.body;

  console.log("REQUEST:", req.body);

  if (!sessionId) {
    sessionId = crypto.randomUUID();
  }

  if (!loaderVersion) {
    loaderVersion = "latest";
  }

  if (!prompt || !loader || !mcVersion) {
    return res.status(400).json({
      error: 'Missing required fields',
      required: ['prompt', 'loader', 'mcVersion']
    });
  }

  res.json({
    status: 'generating',
    sessionId
  });

  generateMod(
    { prompt, loader, mcVersion, loaderVersion, sessionId },
    (event) => sendToSession(sessionId, event)
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

// ─────────────────────────────────────────────
// DOWNLOAD ROUTES
// ─────────────────────────────────────────────

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

// source
app.get('/download/source/:id', async (req, res) => {
  const file = path.join(WORKSPACE_DIR, req.params.id, 'source.zip');

  if (!await fs.pathExists(file)) {
    return res.status(404).send("Source not found");
  }

  res.download(file);
});

// jar
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

// ─────────────────────────────────────────────
// HEALTH
// ─────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    activeSessions: activeSessions.size,
    uptime: Math.floor(process.uptime())
  });
});

// ─────────────────────────────────────────────
// SPA FALLBACK
// ─────────────────────────────────────────────

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ─────────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

app.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});

module.exports = app;
