# John Mustard

Autonomous Executive AI Assistant for WhatsApp built on Node.js, WAHA, Gemini ReAct, and an isolated Python compute sandbox.

---

## Overview

John Mustard is a private, self-hosted WhatsApp assistant engineered with a zero-dependency deep module architecture. It combines multi-step agentic reasoning, sandboxed code execution, document processing, and local database persistence to handle daily executive tasks, scheduling, and information retrieval.

## Core Capabilities

- **WhatsApp Integration (WAHA)**: Real-time webhook streaming, 1.0s burst debouncing, multi-bubble message splitting, and sender identity resolution.
- **ReAct Execution Engine**: Multi-step tool orchestration powered by Google Gemini, featuring automatic API key rotation on HTTP 429 rate limits.
- **Sandboxed Execution Environment**: Isolated Docker container for Python script evaluation, data analytics, OCR, and PyMuPDF-based document processing (merge, split, compress, and page rendering).
- **Deterministic Offline Commands**: Low-latency command shortcuts (`#todo`, `#today`, `#week`, `#done`, `#add`, `#skills`) that operate independently of LLM availability.
- **State and Memory Management**: SQLite WAL persistence for task management, reminders, audit logging, and an access-controlled document vault.
- **Procedural Skill Crystallization**: Autonomous synthesis of reusable procedural skills from recurring user interactions.

## Architecture

| Component | Technology | Role |
|---|---|---|
| Core Engine | Node.js (v20+) | Event routing, ReAct loop, SQLite persistence |
| WhatsApp Gateway | WAHA (WhatsApp HTTP API) | Session lifecycle, media decoding, webhook dispatch |
| Execution Sandbox | Python 3.12, PyMuPDF, Flask | Isolated code execution and document transformations |
| Scheduler | Supercronic | Autonomous cron evaluations and proactive reminders |

## Getting Started

### Prerequisites

- Node.js >= 20.x
- Docker and Docker Compose
- Python >= 3.12 (for local runner testing)

### Configuration

Create a local environment file from the provided template:

```bash
cp .env.example .env
```

Configure the required variables in `.env`:

- `GEMINI_KEYS`: Comma-separated Gemini API keys.
- `TAVILY_API_KEY`: API key for web search integration.
- `ALLOWED_PHONE`, `OWNER_PHONE`: Whitelisted WhatsApp phone numbers.
- `WAHA_*`: WAHA gateway credentials and endpoints.

### Deployment with Docker Compose

Deploy the complete stack (Core Bot, WAHA, Runner, and Scheduler):

```bash
docker compose up -d --build
```

### Local Development

Run the core application locally:

```bash
npm install
npm test
npm start
```

## Testing and Verification

Execute the test suite covering LLM tool routing, database operations, command parsing, and runner sandboxing:

```bash
npm test
```

Generate usage metrics and error audit reports:

```bash
npm run audit
```

## Documentation

Detailed architectural specifications and engineering decisions are available in the `docs/` directory:

- [System Topology and Domain Seams](docs/ARCHITECTURE.md)
- [Technical Documentation Index](docs/INDEX.md)
- [ADR 001: Zero-Dependency Deep Modules Pattern](docs/ADR/001-zero-dependency-deep-modules.md)
