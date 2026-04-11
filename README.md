# CodexMC v2 — AI Minecraft Mod Generator

Powered by DeepSeek R1 (free) via OpenRouter + Vercel AI SDK. Self-hosted on VPS.

## Stack
- Next.js 14 (standalone output)
- Vercel AI SDK (streaming)
- OpenRouter (DeepSeek R1:free)
- Tailwind CSS
- PM2 + Nginx

## VPS Setup

### 1. Clone & configure
```bash
git clone https://github.com/SweatBunni/codex /var/www/codexmc
cd /var/www/codexmc
cp .env.example .env.local
nano .env.local   # add your OPENROUTER_API_KEY
```

### 2. Deploy
```bash
chmod +x deploy.sh
./deploy.sh
```

### 3. Nginx
```bash
sudo cp nginx.conf /etc/nginx/sites-available/codexmc
sudo ln -s /etc/nginx/sites-available/codexmc /etc/nginx/sites-enabled/
sudo nano /etc/nginx/sites-available/codexmc   # set your domain/IP
sudo nginx -t && sudo systemctl reload nginx
```

### 4. SSL (optional)
```bash
sudo certbot --nginx -d your-domain.com
```

### 5. Auto-start on reboot
```bash
pm2 startup   # follow the printed command
pm2 save
```

## Local Dev
```bash
npm install
cp .env.example .env.local
npm run dev   # http://localhost:3000
```

## After pulling updates
```bash
git pull && npm install && npm run build
cp -r public .next/standalone/public
cp -r .next/static .next/standalone/.next/static
pm2 restart codexmc
```

## PM2 commands
```bash
pm2 status
pm2 logs codexmc
pm2 restart codexmc
```

## Environment Variables
| Variable | Required | Default | Description |
|---|---|---|---|
| `OPENROUTER_API_KEY` | Yes | — | Get free at openrouter.ai/keys |
| `OPENROUTER_MODEL` | No | `deepseek/deepseek-r1:free` | Any OpenRouter model |
| `NEXT_PUBLIC_SITE_URL` | No | — | Your server URL |
| `PORT` | No | `3000` | Port to listen on |
