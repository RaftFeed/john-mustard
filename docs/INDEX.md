# John Mustard — Documentation Index

Selamat datang di **Dokumentasi Teknis & Enterprise Architecture John Mustard**. Direktori ini menyajikan panduan arsitektur sistem level enterprise, modularitas domain, spesifikasi seam, dan pedoman operasional untuk asisten pribadi eksekutif cerdas berbasis WhatsApp.

---

## 🗺️ Roadmap Dokumentasi

```
docs/
├── INDEX.md                         # Master Documentation Hub (Halaman ini)
├── ARCHITECTURE.md                  # Enterprise System Topology, Domain Seams & Container Network
└── ADR/
    └── 001-zero-dependency-deep-modules.md # Arsitektur Zero-Dependency & Deep Modules Pattern
```

---

## 🏛️ Matriks Domain & Deep Modules

| Domain | Seam / Interface Utama | Tanggung Jawab & Fitur Utama | Dokumen Rujukan |
|---|---|---|---|
| **Agent Core** | `processChat(rotator, text, opts)` | ReAct Multi-Step Loop, Anti-Hallucination Guardrail, Multi-Key Cascade, Transparent Footnotes | [ARCHITECTURE.md §3](ARCHITECTURE.md#3-deep-module-seams--interface-contracts) |
| **Communication** | `parseIncoming(payload)`, `sendText(chatId, text)` | WAHA Webhook, 1.0s Debounce FIFO Queue, Multi-Bubble (`---`), Liveness Watchdog, `[NO_REPLY]` | [ARCHITECTURE.md §3](ARCHITECTURE.md#3-deep-module-seams--interface-contracts) |
| **Memory & Storage** | `Storage(dbPath)` | SQLite WAL, Task Repository (Routine vs Work), Document Vault ACL, Vector Cosine Search | [ARCHITECTURE.md §3](ARCHITECTURE.md#3-deep-module-seams--interface-contracts) |
| **Tools & Sandboxing** | `executeTool(name, args, ctx)` | SSRF-Safe Web Reader, Python 3 Sandbox (`server.py`), Vault Manager, Auto-Crystallization | [ARCHITECTURE.md §3](ARCHITECTURE.md#3-deep-module-seams--interface-contracts) |
| **Fast Commands** | `parseFastCommand(text)`, `executeFastCommand(cmd, ctx)` | Deterministic Offline Fallback (`#ping`, `#todo`, `#today`, `#week`, `#<id>`, `#done`, `#undo`, `#del`, `#add`, `#daily`), Zero-Latency AI Bypass | [ARCHITECTURE.md §3](ARCHITECTURE.md#3-deep-module-seams--interface-contracts) |
| **Proactive Engine** | `tickScheduler(store, opts)` | Near-Horizon Recurrence (daily/weekly), Autonomous Scheduled Actions, External Supercronic | [ARCHITECTURE.md §3](ARCHITECTURE.md#3-deep-module-seams--interface-contracts) |
