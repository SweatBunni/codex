# CodexMC — AI Minecraft Mod Generator

AI-powered Minecraft mod generator powered by **[puter.js](https://puter.com)**.

Describe your mod idea in plain English → CodexMC writes the Java, compiles a real `.jar`, and gives you the full source.

## What changed from the original

- **Replaced LM Studio / OpenRouter** with `@heyputer/puter.js` for AI calls
- **No API keys required** — puter.js uses a "user pays" model
- **400+ models available**: Claude, GPT, Gemini, and more — switchable via one env var
- Removed `openrouterClient.js` — all AI routing is now handled by puter.js

## Setup

```bash
npm install
cp .env.example .env
# Edit .env — optionally set PUTER_API_TOKEN and PUTER_MODEL
npm start
```

Open `http://localhost:3000`

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PUTER_API_TOKEN` | *(empty)* | Optional puter.com API token |
| `PUTER_MODEL` | `claude-sonnet-4-5` | Primary AI model |
| `PUTER_FAST_MODEL` | same as above | Model used for repair passes |
| `PORT` | `3000` | Server port |
| `WORKSPACE_DIR` | `./data/workspaces` | Temp build directory |

## Supported Models (via puter.js)

- `claude-sonnet-4-5` (default — excellent for code)
- `gpt-4o`
- `gemini-2.5-flash`
- `claude-opus-4-5`
- Full list: https://docs.puter.com/AI/chat/

## Loaders

Supports Forge, Fabric, and NeoForge across Minecraft versions 1.18–1.21.x.
