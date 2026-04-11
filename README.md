# CodexMC v3 — AI Minecraft Mod Generator

Completely rebuilt with Google Gemini 2.5 Flash and a ChatGPT-style UI.

## What changed from v2
| | v2 | v3 |
|---|---|---|
| AI Model | Mistral 7b (OpenRouter) | **Google Gemini 2.5 Flash** |
| AI Key | Paid OpenRouter | **Free (Google AI Studio)** |
| Thinking | Custom prompting | **Native Gemini thinking tokens** |
| UI | Custom dark theme | **ChatGPT-style** |
| Backend | Complex multi-file | **Clean modular** |

## Why Gemini 2.5 Flash?
- **Best free Java coding model** — outperforms Mistral, Llama, and older Gemini models on code tasks
- **Native extended thinking** — up to 24K thinking tokens for deeper reasoning
- **1M token context** — can handle large codebases
- **Genuinely free** — Google AI Studio free tier, no credit card needed

## Setup

### 1. Get a free Gemini API key
Go to [https://aistudio.google.com](https://aistudio.google.com) and click "Get API key". It's free.

### 2. Configure
```bash
cp .env.example .env
# Edit .env and set GEMINI_API_KEY=your_key_here
```

### 3. Install & run
```bash
npm install
npm start
```

Open `http://localhost:3000`

## Features
- **Forge, Fabric, NeoForge** support
- **Compiled JAR** download (when JDK available on server)
- **Source ZIP** always available
- **Live build console** via WebSocket
- **Three thinking levels**: Low (2K), Medium (8K), High (24K tokens)
- **Mod history** sidebar
- **ChatGPT-style** UI

## Java / Compilation
Set these env vars to enable server-side compilation:
```
JAVA_8_HOME=/usr/lib/jvm/java-8-openjdk-amd64
JAVA_17_HOME=/usr/lib/jvm/java-17-openjdk-amd64
JAVA_21_HOME=/usr/lib/jvm/java-21-openjdk-amd64
```

Without them, the source ZIP still works — just compile locally with IntelliJ or `./gradlew build`.
