# ADR 001: Zero-Dependency Architecture & Deep Modules Pattern

## Status
**Accepted**

## Konteks
Asisten pribadi WhatsApp John Mustard memerlukan runtime yang andal, cepat menyala (low-latency cold start), tidak mudah rapuh akibat *dependency supply-chain attack*, dan dapat dijalankan di lingkungan VPS minim resource tanpa overhead ratusan megabyte `node_modules`.

## Keputusan
1. **Adopsi Node.js Built-In Libraries**:
   - Database: menggunakan `node:sqlite` (`DatabaseSync`) bawaan Node.js 22+, meniadakan kebutuhan library pihak ketiga seperti `better-sqlite3` atau ORM besar.
   - HTTP Server & Client: menggunakan `node:http` dan global `fetch` native.
   - Security & Hashes: menggunakan `node:crypto`.
   - Quality Gates: menggunakan `node:assert`.
2. **Pola Deep Modules (Ousterhout & Seam Discipline)**:
   - Modul `llm.js`, `db.js`, `waha.js`, dan `scheduler.js` mengekspos fungsi interface yang ramping, sementara seluruh kompleksitas internal (SSRF filtering, multi-key rotation, vector cosine calculation, anti-promissory validation) tersembunyi rapat di balik interface.
3. **Pemisahan Sandboxing Python**:
   - Perhitungan matematis tingkat tinggi, analisis data, dan visualisasi grafik dipisahkan ke container mandiri `runner/` berbasis Python 3, menjaga container utama tetap ramping dan aman.

## Konsekuensi
- **Positif**:
  - Ukuran image Docker sangat kecil (~80MB).
  - Waktu start-up instan (< 150ms).
  - Risiko celah keamanan dependensi eksternal (CVE) mendekati nol.
  - Setiap modul memiliki unit test runnable bawaan tanpa instalasi framework test tambahan.
- **Mitigasi**:
  - Penulisan query SQL dilakukan secara eksplisit menggunakan prepared statements untuk mencegah SQL injection.
