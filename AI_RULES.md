# Petunjuk AI Developer - Anti Konflik John Mustard

Anda bekerja di repo **john-mustard** (WhatsApp Autonomous Executive Assistant).
Wajib baca `FEATURES.md` sebelum menambah atau mengubah kode.

## 1. Pengecekan Wajib Sebelum Menulis Kode
1. **Cek ADR 001 (Zero-Dependency)**:
   - Dilarang `npm i` package baru. Pakai Node.js 22+ built-in (`node:sqlite`, `node:crypto`, `node:http`, dll).
   - Operasi berat Python delegasikan ke `runner/server.py`.
2. **Cek Jalur Eksekusi**:
   - Perintah awalan `#`: letakkan di `src/commands.js` (Bypass LLM).
   - Chat/reasoning: lewatkan `src/queue.js` -> `src/llm.js`.
3. **Cek Database (`src/db.js`)**:
   - Jangan ubah nama tabel/kolom eksisting.
   - Wajib prepared statements (`stmt.run()`, `stmt.get()`, `stmt.all()`).
   - Gunakan skema defensif (`IF NOT EXISTS` / migrasi aman).

## 2. Titik Rawan Konflik
- **`src/index.js` & `src/server.js`**: Orchestrator saja. Logic bisnis letakkan di modul deep (`db.js`, `commands.js`, `waha.js`).
- **`src/queue.js`**: Debounce window 1.0s. Jangan ubah tanpa test load chat beruntun.
- **`src/rotator.js`**: Key failover. Jangan bypass rotasi saat rate limit 429/503.

## 3. Protokol Verifikasi
Setelah ubah kode, wajib run:
```bash
npm test
```
Jika test lama gagal: perbaiki kode baru. Dilarang menghapus atau melemahkan test lama.
