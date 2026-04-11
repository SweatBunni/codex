# CodexMC — AI Minecraft Mod Generator (LM Studio Edition)

Generate Minecraft mods locally using [LM Studio](https://lmstudio.ai) — no cloud API keys required.

## Backend pipeline
- **Tokenization** — the request is split into prompt chunks and an approximate token budget.
- **Vectorization** — semantic anchors and intent signals are extracted from the request.
- **Architecture prediction** — a model pass designs the mod structure before code generation.
- **Code generation** — the main model produces the project files from the planned architecture.
- **Validation & repair** — invalid JSON or incomplete output triggers an automatic repair pass.

## Setup

### 1. Install & start LM Studio

```bash
# macOS / Linux
curl -fsSL https://lmstudio.ai/install.sh | bash

# Windows (PowerShell)
irm https://lmstudio.ai/install.ps1 | iex
```

Then start the local server:
```bash
lms server start          # starts on http://localhost:1234 by default
```

### 2. Download a model

```bash
lms get openai/gpt-oss-20b    # good general-purpose choice
# or pick any model from https://lmstudio.ai/models
```

You can also load a model from the LM Studio GUI.

### 3. Configure

```bash
cp .env.example .env
```

Edit `.env` and set `LM_STUDIO_MODEL` to the model identifier you loaded.  
Leave it as `local-model` to use whatever is currently active in LM Studio.

### 4. Install & run

```bash
npm install
npm start
```

Open `http://localhost:3000`

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `LM_STUDIO_URL` | `http://localhost:1234` | LM Studio server URL |
| `LM_STUDIO_MODEL` | `local-model` | Model for architecture + generation passes |
| `LM_STUDIO_FAST_MODEL` | same as above | Smaller/faster model for repair passes (optional) |
| `LM_API_TOKEN` | _(empty)_ | Bearer token if you enabled auth in LM Studio |

## Features
- Forge, Fabric, and NeoForge support
- Source ZIP output for every generation
- Optional Gradle build and JAR output when compatible JDKs are available
- Live WebSocket progress updates
- Chat history persisted on disk
- Pipeline metadata returned with each generation result
- **Fully local** — no internet connection needed after model download

## Java / Compilation

Set these env vars to enable server-side compilation:

```bash
JAVA_8_HOME=/usr/lib/jvm/java-8-openjdk-amd64
JAVA_17_HOME=/usr/lib/jvm/java-17-openjdk-amd64
JAVA_21_HOME=/usr/lib/jvm/java-21-openjdk-amd64
```

Without them, the source ZIP still works and can be built locally with `./gradlew build`.
