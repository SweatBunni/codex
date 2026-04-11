# CodexMC v3 - AI Minecraft Mod Generator

This version now uses a staged ChatGPT-style backend pipeline instead of a single prompt dump.

## Backend flow
- Tokenization: the request is split into prompt chunks and an approximate token budget.
- Vectorization: the backend extracts semantic anchors and intent signals from the request.
- Architecture prediction: a model pass designs the mod structure before code generation starts.
- Next-step generation: the main model produces the project files from the planned architecture.
- Validation and repair: invalid JSON or incomplete output triggers a repair pass automatically.

## Model routing
- Primary free model: `qwen/qwen3.6-plus-preview:free`
- Fallback free coding model: `qwen/qwen3-coder:free`
- Both are configured through OpenRouter and can be swapped with environment variables.

## Setup

### 1. Get an OpenRouter API key
Create a free key at `https://openrouter.ai/keys`.

### 2. Configure
```bash
cp .env.example .env
```

Set `OPENROUTER_API_KEY` and adjust models if you want different routing.

### 3. Install and run
```bash
npm install
npm start
```

Open `http://localhost:3000`

## Features
- Forge, Fabric, and NeoForge support
- Source ZIP output for every generation
- Optional Gradle build and JAR output when compatible JDKs are available
- Live WebSocket progress updates
- Chat history persisted on disk
- Pipeline metadata returned with each generation result

## Java / Compilation
Set these env vars to enable server-side compilation:

```bash
JAVA_8_HOME=/usr/lib/jvm/java-8-openjdk-amd64
JAVA_17_HOME=/usr/lib/jvm/java-17-openjdk-amd64
JAVA_21_HOME=/usr/lib/jvm/java-21-openjdk-amd64
```

Without them, the source ZIP still works and can be built locally with `./gradlew build`.
