# CodexMC v3 — AI Minecraft Mod Generator

Completely rebuilt with OpenRouter and a ChatGPT-style UI.

## What changed from v2
| | v2 | v3 |
|---|---|---|
| AI Model | Mistral 7b (OpenRouter) | **Qwen 3 Coder Free (OpenRouter)** |
| AI Key | Paid OpenRouter | **OpenRouter API key** |
| Thinking | Custom prompting | **Multi-level quality prompting** |
| UI | Custom dark theme | **ChatGPT-style** |
| Backend | Complex multi-file | **Clean modular** |

## Why OpenRouter?
- **Strong Java coding model** — excellent at structured code generation tasks
- **OpenRouter flexibility** — swap to any other model by changing one env var
- **Simple API** — OpenAI-compatible REST API, no vendor-specific SDKs needed
- **Easy setup** — just an API key, no cloud project or service account required

## Setup

### 1. Get an OpenRouter API key
Go to [https://openrouter.ai/keys](https://openrouter.ai/keys) and create a free key.

### 2. Configure
```bash
cp .env.example .env
# Edit .env and set OPENROUTER_API_KEY=your_key_here
# Default free model: qwen/qwen3-coder:free
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
