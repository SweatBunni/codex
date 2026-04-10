# CodexMC — AI Minecraft Mod Generator

AI-powered Minecraft mod generator. Describe your mod idea, pick a loader + version + thinking level, and CodexMC generates complete Java code, compiles it into a `.jar`, and packages the full source as a `.zip`.

## Features

- 🤖 **DeepSeek R1** — Best free reasoning model via OpenRouter (no paid API needed)
- 🧠 **3 Thinking Levels** — Low (fast), Medium (balanced), High (deep chain-of-thought)
- 📦 **Download Compiled JAR** — Real `.jar` ready to drop into your mods folder
- 🗜️ **Download Source ZIP** — Full Gradle project, open in any IDE
- 📡 **Live Console** — WebSocket-streamed build output in real time
- ⚙️ **Forge · Fabric · NeoForge** — All major loaders with correct configs per MC version
- 🔢 **50+ MC Versions** — Fetched live from official loader APIs

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Copy environment config
cp .env.example .env

# 3. Add your OpenRouter key (free at openrouter.ai)
# Edit .env: OPENROUTER_API_KEY=your_key_here

# 4. (Optional) Run setup to install JDKs for building
node scripts/setup.js

# 5. Start the server
npm start
```

## Environment

| Variable | Description |
|---|---|
| `OPENROUTER_API_KEY` | Your free OpenRouter key |
| `PORT` | Server port (default: 3000) |
| `WORKSPACE_DIR` | Where build projects are stored |
| `JDK_17_PATH` | Path to JDK 17 (needed for MC 1.17+) |

## AI Model

Uses `deepseek/deepseek-r1:free` via OpenRouter — completely free, no usage limits on the free tier for reasonable usage. This is DeepSeek's reasoning model with chain-of-thought capabilities.

## Thinking Levels

| Level | Tokens | Time | Best For |
|---|---|---|---|
| Low ⚡ | 4,000 | ~30s | Simple items/blocks |
| Medium 🧩 | 8,000 | ~60s | Complex mechanics |
| High 🧠 | 16,000 | ~120s | Full mod systems |
