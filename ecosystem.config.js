/**
 * PM2 config for CodexMC (Next.js `output: "standalone"`).
 *
 * From the project root (where this file lives):
 *   npm run build
 *   # Build runs scripts/copy-standalone-assets.cjs so standalone can serve /_next/static (CSS/JS).
 *   pm2 start ecosystem.config.js
 *   pm2 save && pm2 startup
 *
 * Env: variables from `.env.local` are merged when this file is loaded (PM2 has no env_file).
 * After editing .env.local:  pm2 reload ecosystem.config.js
 */
const path = require("path");
const fs = require("fs");

const root = __dirname;
const standaloneDir = path.join(root, ".next", "standalone");

function loadEnvLocal(dir) {
  const envPath = path.join(dir, ".env.local");
  const out = {};
  if (!fs.existsSync(envPath)) return out;
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

const fileEnv = loadEnvLocal(root);

module.exports = {
  apps: [
    {
      name: "codexmc",
      cwd: standaloneDir,
      script: "server.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "800M",
      env: {
        ...fileEnv,
        NODE_ENV: "production",
        HOSTNAME: "0.0.0.0",
        PORT: fileEnv.PORT || process.env.PORT || "3000",
      },
      error_file: path.join(root, "logs", "pm2-error.log"),
      out_file: path.join(root, "logs", "pm2-out.log"),
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
    },
  ],
};
