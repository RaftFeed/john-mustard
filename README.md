# John Mustard 🤖

> Autonomous AI Executive Assistant for WhatsApp powered by Node.js, WAHA, Gemini ReAct, and isolated Python Sandbox.

---

## 📖 About

**John Mustard** adalah asisten eksekutif pribadi otonom berbasis WhatsApp yang dibangun dengan arsitektur *zero-dependency deep modules*. Bot ini mengintegrasikan penalaran ReAct multi-step (Google Gemini API), eksekusi kode terisolasi (Python sandbox), manipulasi dokumen (PyMuPDF), manajemen task/catatan berbasis SQLite, serta fallback command offline deterministik.

### ✨ Fitur Utama
- **WhatsApp Bridge (WAHA)**: Webhook streaming, message debouncing (1.0s buffer), split bubble message (`---`), multi-contact aware.
- **ReAct Loop & Multi-Key Rotator**: Eksekusi multi-step agentik dengan rotasi otomatis API key Gemini saat rate-limit (429).
- **Sandboxed Python & Doc Engine**: Eksekusi script komputasi, visualisasi, OCR, dan operasi PDF (merge, split, compress, image rendering) via isolated container.
- **Deterministic Fast Commands**: Fallback cepat offline tanpa latency AI (`#todo`, `#today`, `#week`, `#done`, `#add`, `#skills`).
- **Memory & Storage**: SQLite WAL persistence untuk to-dos, reminders, chat history, document vault dengan access control list (ACL).
- **Procedural Skills (Voyager Pattern)**: Auto-kristalisasi kebiasaan dan alur kerja baru dari percakapan berulang.

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
