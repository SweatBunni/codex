/**
 * Next.js `output: "standalone"` does not copy `public/` or `.next/static/` into
 * `.next/standalone/` automatically. Without this step, production serves HTML but
 * all `/_next/static/*` CSS and JS chunks 404 → completely unstyled UI.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const standalone = path.join(root, ".next", "standalone");

if (!fs.existsSync(standalone)) {
  console.warn("[copy-standalone-assets] .next/standalone missing (run next build first); skip.");
  process.exit(0);
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    console.warn("[copy-standalone-assets] skip missing:", src);
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(src, dest, { recursive: true });
}

copyDir(path.join(root, "public"), path.join(standalone, "public"));
copyDir(path.join(root, ".next", "static"), path.join(standalone, ".next", "static"));
console.log("[copy-standalone-assets] public + .next/static → .next/standalone/");
