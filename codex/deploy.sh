#!/bin/bash
# CodexMC VPS Deploy Script
# Run once to set up, then use 'npm run build && pm2 restart codexmc' to update

set -e

echo "=== CodexMC VPS Setup ==="

# Check Node version
NODE_VERSION=$(node -v | cut -d'.' -f1 | tr -d 'v')
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "❌ Node.js 18+ required. Current: $(node -v)"
  exit 1
fi
echo "✓ Node.js $(node -v)"

# Install PM2 globally if not present
if ! command -v pm2 &> /dev/null; then
  echo "Installing PM2..."
  npm install -g pm2
fi
echo "✓ PM2 $(pm2 -v)"

# Install dependencies
echo "Installing dependencies..."
npm install --production=false

# Check for .env.local
if [ ! -f .env.local ]; then
  if [ -f .env.example ]; then
    cp .env.example .env.local
    echo ""
    echo "⚠️  Created .env.local from example."
    echo "   Edit it and add your OPENROUTER_API_KEY, then re-run this script."
    echo ""
    exit 1
  fi
fi

# Check API key is set (non-empty value after =)
if ! grep -qE '^[[:space:]]*OPENROUTER_API_KEY=.+$' .env.local 2>/dev/null; then
  echo "❌ Set OPENROUTER_API_KEY in .env.local"
  exit 1
fi
echo "✓ .env.local configured"

# Create logs dir
mkdir -p logs

# Build Next.js
echo "Building..."
npm run build

# Static assets are copied by `npm run build` (see scripts/copy-standalone-assets.cjs)
echo "✓ Build complete"

# Start / restart with PM2
if pm2 describe codexmc > /dev/null 2>&1; then
  echo "Restarting existing PM2 process..."
  pm2 restart ecosystem.config.js --update-env
else
  echo "Starting with PM2..."
  pm2 start ecosystem.config.js
fi

# Save PM2 config so it survives reboots
pm2 save

echo ""
echo "=== Done! ==="
echo "App running at http://localhost:3000"
echo ""
echo "Next steps:"
echo "  1. Point nginx at port 3000 using nginx.conf"
echo "     sudo cp nginx.conf /etc/nginx/sites-available/codexmc"
echo "     sudo ln -s /etc/nginx/sites-available/codexmc /etc/nginx/sites-enabled/"
echo "     sudo nginx -t && sudo systemctl reload nginx"
echo "  2. Get SSL:  sudo certbot --nginx -d your-domain.com"
echo "  3. Auto-start on reboot:  pm2 startup"
echo ""
echo "Useful commands:"
echo "  pm2 logs codexmc       — view logs"
echo "  pm2 status             — check status"
echo "  pm2 restart codexmc    — restart after code changes"
