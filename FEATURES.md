# Peta Fitur & Kontrak Sistem (John Mustard)

Patuhi aturan: Fitur baru dilarang melanggar "Kontrak Tabu" fitur lama.

---

## 1. Zero-Dependency Core Architecture (ADR 001)
- Alur: Node.js 22+ native modules (`node:sqlite`, `node:http`, `node:crypto`, `node:assert`, native `fetch`).
- Kontrak Tabu:
  - Dilarang install npm packages baru di `package.json` tanpa izin eksplisit.
  - Image runtime harus tetap ringan (~80MB), startup < 150ms.

---

## 2. Fast Commands Engine (`#` Prefix)
- File: `src/commands.js`
- Alur: Pesan dengan prefix `#` (misal `#ping`, `#tugas`, `#add`, `#done`, `#health`) dieksekusi instan tanpa panggil LLM.
- Kontrak Tabu:
  - Dilarang lempar pesan `#` ke LLM (harus deterministic & hemat kuota).
  - Return string format teks WhatsApp yang kompatibel.

---

## 3. FIFO Burst Debouncer & Mailbox (`src/queue.js`)
- File: `src/queue.js`, `src/server.js`
- Alur: Pesan berturut-turut dalam window 1.0s digabung (coalesced) sebelum masuk ke ReAct.
- Kontrak Tabu:
  - Dilarang bypass antrean debounce untuk pesan teks biasa.
  - Urutan FIFO chat wajib terjaga.

---

## 4. ReAct Loop & Multi-Key Cascade
- File: `src/llm.js`, `src/rotator.js`, `src/llm/*`
- Alur: Loop ReAct dengan Gemini API, rotasi multi-key round-robin jika kena rate-limit (429/503), anti-hallucination guardrail.
- Kontrak Tabu:
  - Dilarang simpan API key hardcoded.
  - Output mutasi state (tugas/jadwal) wajib diverifikasi guardrail sebelum konfirmasi ke user.

---

## 5. Persistent SQLite WAL Storage
- File: `src/db.js`
- Alur: Simpan tasks, reminders, chat history, vault metadata, skills via native `node:sqlite` (`DatabaseSync`).
- Kontrak Tabu:
  - Wajib pakai Prepared Statements (anti SQL injection).
  - Mode WAL dilarang dimatikan (concurrency safe).
  - Kolom database baru wajib lewat migrasi aman tanpa drop table.

---

## 6. Proactive Scheduler & Reminders
- File: `src/scheduler.js`, `scheduler/crontab`
- Alur: Supercronic panggil tick tiap 1 menit via POST `/api/scheduler/tick` atau runner 15 detik.
- Kontrak Tabu:
  - Polling dilarang blocking event loop.
  - Pengingat terkirim wajib ditandai `is_completed = 1` agar tidak spam.

---

## 7. Compute Sandbox (`runner/`)
- File: `runner/server.py` (Python 3.12, PyMuPDF, OCR)
- Alur: Eksekusi kode berat, PDF parsing, OCR via HTTP sandbox terisolasi di port 8000.
- Kontrak Tabu:
  - Modul Node.js tidak boleh jalankan child_process berat langsung di container utama.
  - Akses runner wajib lolos sanitasi SSRF.

---

## 8. 2-Way Skills Sync & Crystallizer
- File: `src/skills_sync.js`, `src/crystallize.js`
- Alur: Sinkronisasi markdown file di folder `skills/` dengan tabel SQLite. Auto-crystallize skill baru setelah turn selesai.
- Kontrak Tabu:
  - Format skill harus markdown valid dengan frontmatter metadata.
