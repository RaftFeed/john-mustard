# John Mustard 🤖

> Autonomous AI Executive Assistant for WhatsApp powered by Node.js, WAHA, Gemini ReAct, and isolated Python Sandbox.

---

## 📖 About

**John Mustard** is an autonomous personal AI executive assistant for WhatsApp designed with a *zero-dependency deep modules* architecture. It integrates multi-step ReAct reasoning (Google Gemini API), isolated code execution (Python sandbox), document manipulation (PyMuPDF), SQLite-backed task and memory persistence, and deterministic offline fallback commands.

### ✨ Key Features
- **WhatsApp Bridge (WAHA)**: Webhook streaming, 1.0s burst debouncing, multi-bubble replies (`---`), and multi-contact context awareness.
- **ReAct Loop & Multi-Key Rotator**: Multi-step agentic tool orchestration with automatic Gemini API key rotation on rate-limits (HTTP 429).
- **Sandboxed Python & Document Engine**: Isolated script execution, data visualization, OCR, and PDF operations (merge, split, compress, render images) inside a dedicated container.
- **Deterministic Fast Commands**: Zero-latency offline fallback shortcuts (`#todo`, `#today`, `#week`, `#done`, `#add`, `#skills`).
- **Memory & Storage**: SQLite WAL persistence for to-dos, reminders, chat history, and a document vault with access control lists (ACL).
- **Procedural Skills (Voyager Pattern)**: Autonomous crystallization of new skills and workflows from recurring interactions.

---

## ⚡ Quick Start

### 1. Prerequisites
- **Node.js** >= 20.x
- **Docker & Docker Compose**
- **Python** >= 3.12 (with `pymupdf` and `flask` for runner)

### 2. Environment Setup
Copy the example environment file and configure your credentials:
```bash
cp .env.example .env
```
Fill in the following key variables in `.env`:
- `GEMINI_KEYS`: Comma-separated Gemini API keys
- `TAVILY_API_KEY`: API key for web search
- `ALLOWED_PHONE`, `OWNER_PHONE`: Whitelisted phone numbers
- `WAHA_*`: WhatsApp HTTP API credentials

### 3. Run with Docker Compose
Start all services (WAHA, Bot, Runner, Scheduler):
```bash
docker compose up -d --build
```

### 4. Local Development
Run without Docker container for bot:
```bash
npm install
npm test
npm start
```

---

## 🧪 Testing

Run test suite across all modules (LLM, DB, Queue, Rotator, PyMuPDF Runner):
```bash
npm test
```

Audit feature usage and error rates:
```bash
npm run audit
```

---

## 📚 Documentation

Deep-dive architecture and design specifications:
- [Architecture & Domain Seams](docs/ARCHITECTURE.md)
- [Documentation Index](docs/INDEX.md)
- [ADR 001: Zero-Dependency Deep Modules](docs/ADR/001-zero-dependency-deep-modules.md)
