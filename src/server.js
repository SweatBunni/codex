require('dotenv').config();

const express = require('express');
const expressWs = require('express-ws');
const cors = require('cors');
const path = require('path');
const fs = require('fs-extra');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const compression = require('compression');

const config = require('./config');
const { logger } = require('./utils/logger');
const { generateMod } = require('./services/generator');
const { getForgeVersions, getFabricVersions, getNeoForgeVersions } = require('./services/versions');

const WORKSPACE_DIR = path.resolve(config.workspace.dir);

const app = express();
expressWs(app);

// Ensure dirs
fs.ensureDirSync(WORKSPACE_DIR);

// Security
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: config.rateLimit.maxPerHour,
  message: { error: 'Too many requests. Please try again in an hour.' },
});

// ─── REST API ────────────────────────────────────────────────────

// Health
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', model: config.openrouter.model, uptime: Math.floor(process.uptime()) });
});

// Versions
app.get('/api/versions/:loader', async (req, res) => {
  try {
    const { loader } = req.params;
    let versions;
    if (loader === 'forge') versions = await getForgeVersions();
    else if (loader === 'fabric') versions = await getFabricVersions();
    else if (loader === 'neoforge') versions = await getNeoForgeVersions();
    else return res.status(400).json({ error: 'Unknown loader' });
    res.json({ loader, versions });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Download JAR
app.get('/api/download/jar/:jobId', async (req, res) => {
  try {
    const workDir = path.join(WORKSPACE_DIR, req.params.jobId);
    const buildLibs = path.join(workDir, 'build', 'libs');
    if (!await fs.pathExists(buildLibs)) return res.status(404).json({ error: 'JAR not found' });
    const files = await fs.readdir(buildLibs);
    const jar = files.find(f => f.endsWith('.jar') && !f.includes('sources') && !f.includes('dev'));
    if (!jar) return res.status(404).json({ error: 'JAR not found' });
    res.download(path.join(buildLibs, jar), jar);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Download Source ZIP
app.get('/api/download/source/:jobId', async (req, res) => {
  try {
    const workDir = path.join(WORKSPACE_DIR, req.params.jobId);
    const files = await fs.readdir(workDir);
    const zip = files.find(f => f.endsWith('-source.zip'));
    if (!zip) return res.status(404).json({ error: 'Source ZIP not found' });
    res.download(path.join(workDir, zip), zip);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── WebSocket — Real-time mod generation ────────────────────────
app.ws('/ws/generate', (ws, req) => {
  logger.info('WebSocket client connected');

  ws.on('message', async (raw) => {
    let request;
    try {
      request = JSON.parse(raw);
    } catch {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
      return;
    }

    const { description, loader, mcVersion, loaderVersion, thinkingLevel } = request;

    if (!description || description.trim().length < 5) {
      ws.send(JSON.stringify({ type: 'error', message: 'Please provide a mod description (at least 5 characters)' }));
      return;
    }

    if (!['forge', 'fabric', 'neoforge'].includes(loader)) {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid loader' }));
      return;
    }

    function send(type, message, extra = {}) {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type, message, ...extra }));
      }
    }

    try {
      const result = await generateMod(
        { description, loader, mcVersion, loaderVersion, thinkingLevel: thinkingLevel || 'medium' },
        (progress) => send(progress.type, progress.message, { jobId: progress.jobId })
      );

      send('complete', 'Mod generation complete!', {
        jobId: result.jobId,
        modId: result.modId,
        modName: result.modName,
        version: result.version,
        buildSuccess: result.buildSuccess,
        files: result.files,
        jarUrl: result.buildSuccess ? `/api/download/jar/${result.jobId}` : null,
        sourceUrl: `/api/download/source/${result.jobId}`,
      });
    } catch (error) {
      send('error', `Generation failed: ${error.message}`);
    }
  });

  ws.on('close', () => logger.info('WebSocket client disconnected'));
});

// ─── Start ───────────────────────────────────────────────────────
const PORT = config?.server?.port || process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`CodexMC v3 running on http://localhost:${PORT}`);

  const model =
    config?.openrouter?.model ||
    process.env.OPENROUTER_MODEL ||
    "unknown";

  logger.info(`AI Model: ${model}`);
});
