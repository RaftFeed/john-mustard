# Rencana Implementasi: Format Kartu Konfirmasi To-Do dan Acara (Garis & Buletan)

## Goal Description
Menyeragamkan format balasan konfirmasi penambahan dan pembaruan (add/update) untuk **To-Do** dan **Acara (Agenda/Reminder)**.
Sebelumnya, to-do memakai format bullet list lama (`• Deadline:`, `• Tag:`), sedangkan acara belum memiliki kartu tunggal dan mengandalkan turn ke-2 LLM yang menghasilkan teks bebas atau membuang daftar lengkap.

Format baru akan menggunakan pola template harian yang sudah ada di sistem (`formatTodoList` dan `formatRemindersList`), yaitu:
- Salam pembuka: `Udah dicatet ya, Lord!` (personal) / `Udah dicatet ya!` (grup) untuk add, atau `Udah diupdate ya, Lord!` / `Udah diupdate ya!` untuk update.
- Kartu tunggal tanpa nomor urut daftar:
  ```text
  🔴 *[Judul Tugas / Acara]*
  ├── [Waktu / Deadline Relatif WIB]
  └── `#[Tag]`
  ```
- Eksekusi instan (1-turn short-circuit) di `src/llm/engine.js` untuk memotong latensi dan kuota LLM.

---

## User Review Required
> [!NOTE]
> Format bullet lama (`• Deadline:`, `• Tag:`) digantikan oleh format pohon/cabang (`├──`, `└──`) dengan indikator buletan warna (`🔴`/`🟠`/`🟡`/`🟢`/`⚪`) agar persis sama dengan gaya visual daftar tugas & acara harian.

Tidak ada breaking changes pada database schema maupun command engine `#`.

---

## Open Questions
Tidak ada pertanyaan terbuka. Seluruh keputusan desain telah dikonfirmasi 100% melalui sesi wawancara `/grill-me`.

---

## Proposed Changes

### Storage & Formatter Layer (`src/db.js`)
- [x] Perbarui `formatTodoCard(todo)` dengan pohon garis `├──`, `└──`, dan buletan warna.
- [x] Buat dan ekspor `formatReminderCard(reminder)` dengan pola visual yang sama.

---

### LLM Tools Layer (`src/llm/tools.js`)
- [x] Impor `formatReminderCard` di `src/llm/tools.js`.
- [x] Set `formattedList` pada `addReminder` menggunakan `formatReminderCard`.
- [x] Set `formattedList` pada `updateReminder` menggunakan `formatReminderCard`.

---

### LLM Engine Layer (`src/llm/engine.js`)
- [x] Tambahkan `addReminder` ke `onlyAdd` di short-circuit mutasi turn-1.
- [x] Tambahkan `updateReminder` ke `onlyUpdate` di short-circuit mutasi turn-1.
- [x] Tambahkan keyword reminder & acara ke `isActionIntent` di `src/llm/guards.js`.

---

### Test Suite (`tests/llm.test.js`)
- [x] Sesuaikan asersi tes `formatTodoCard` lama.
- [x] Tambahkan unit test untuk `formatReminderCard` & `updateReminder`.
- [x] Tambahkan test short-circuit `addReminder` kartu tunggal.

---

## Verification Plan

### Automated Tests
1. Jalankan unit test menyeluruh:
   ```bash
   npm test
   ```
2. Pastikan seluruh 75+ test suite berstatus PASS tanpa regresi.

### Manual Verification
1. Verifikasi output string kartu to-do:
   - Input: tugas deadline hari ini.
   - Hasil yang diharapkan:
     ```text
     Udah dicatet ya, Lord!

     🔴 *Lapor dosen Asah*
     ├── Hari ini (1 Okt 2026, 23.59 WIB)
     └── `#ASAH`
     ```
2. Verifikasi output string kartu acara:
   - Input: acara webinar besok jam 10.
   - Hasil yang diharapkan:
     ```text
     Udah dicatet ya, Lord!

     🟠 *Webinar AI*
     ├── Besok (2 Okt 2026, 10.00 WIB)
     └── `Sekali #acara`
     ```
