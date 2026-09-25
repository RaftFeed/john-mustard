# John Mustard 🤖

> Personal AI Assistant WhatsApp Bot built with Node.js, WAHA, Gemini, and Python Sandbox.

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
