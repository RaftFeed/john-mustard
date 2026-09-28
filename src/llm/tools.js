import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  formatTodoList,
  formatTodoDetail,
  formatBacklogList,
  formatFeatureRequestsList,
  formatSkillList,
  formatNotesList,
  formatRemindersList,
  formatPersonList,
  normalizePhone,
  OWNER_PHONE,
  isOwner,
  DEFAULT_CONTACT_PROFILES
} from "../db.js";
import { sendFile, sendText, getWhitelistPhones, resolveWhitelistRecipient, formatSenderDisplay } from "../waha.js";
import { scheduleNearHorizonReminder } from "../scheduler.js";
import { getMinecraftStatus, formatMinecraftStatus } from "../minecraft.js";
import { formatServerHealth } from "../commands.js";
import {
  proposeSkill,
  approveSkillProposal,
  rejectSkillProposal,
  listSkillProposals,
  listSkillVersions,
  rollbackSkill
} from "../skills_sync.js";
import { getEmbedding } from "./cascade.js";
import { fetchUrlContent } from "./guards.js";
import { formatRowsToMarkdown } from "./formatters.js";

export const TOOLS = [
  {
    functionDeclarations: [
      {
        name: "addTodo",
        description: "Tambahkan tugas ke To-Do List dengan deadline, tag matkul/kategori, penanggung jawab, dan deskripsi/prompt rincian tugas",
        parameters: {
          type: "OBJECT",
          properties: {
            task: { type: "STRING", description: "Judul tugas singkat, contoh: LKP 6 Analisis Algoritme" },
            deadlineIso: { type: "STRING", description: "Deadline dalam format ISO 8601 (contoh: 2026-09-27T23:59:00+07:00)" },
            tag: { type: "STRING", description: "Tag atau kode mata kuliah, contoh: #analgor [P2]" },
            category: { type: "STRING", description: "Kategori tugas opsional: work (default) atau routine (absen/kuliah)" },
            assignee: { type: "STRING", description: "Nama orang yang ditugaskan (contoh: Gilang, Bunga, atau anggota keluarga/tim)" },
            description: { type: "STRING", description: "Deskripsi lengkap tugas atau kalimat instruksi/prompt asli dari user saat meminta tugas ini dibuat" }
          },
          required: ["task"]
        }
      },
      {
        name: "listTodos",
        description: "Tampilkan daftar tugas / to-do list aktif secara ringkas beserta countdown deadline. Bisa difilter per tanggal jika pengguna menanyakan tugas/deadline hari tertentu (misal: 'tugas senin', 'deadline besok').",
        parameters: {
          type: "OBJECT",
          properties: {
            includeRoutine: { type: "BOOLEAN", description: "Set true untuk menyertakan tugas rutin/kuliah/absen (default false)" },
            assignee: { type: "STRING", description: "Filter to-do list berdasarkan orang yang ditugaskan (opsional)" },
            includeDone: { type: "BOOLEAN", description: "Set true jika user minta melihat tugas yang sudah selesai atau meminta semua tugas termasuk yang sudah dikerjakan (default false)" },
            targetDateIso: { type: "STRING", description: "Filter tugas yang jatuh tempo/deadline pada tanggal spesifik dalam format YYYY-MM-DD (contoh: '2026-09-28'). Wajib hitung dari konteks waktu saat ini jika user menyebutkan hari ('senin', 'besok', dsb). Kosongkan jika ingin melihat semua tugas." }
          }
        }
      },
      {
        name: "getTodoDetail",
        description: "Lihat rincian lengkap tugas tertentu di To-Do List termasuk prompt/deskripsi asli saat tugas dibuat, deadline, tag, dan status. Panggil tool ini saat user minta detail/rincian tugas (contoh: 'detail tugas 1', 'isi tugas 2 apa', 'tunjukin deskripsi nomor 3').",
        parameters: {
          type: "OBJECT",
          properties: {
            todoId: { type: "NUMBER", description: "Nomor urut visual (1..N) atau ID tugas yang ingin dilihat detailnya" },
            taskQuery: { type: "STRING", description: "Kata kunci nama tugas jika nomor urut/ID tidak disebutkan" }
          }
        }
      },
      {
        name: "getTodosDue",
        description: "Tampilkan tugas yang deadline/jatuh tempo hari ini atau beberapa hari ke depan",
        parameters: {
          type: "OBJECT",
          properties: {
            daysAhead: { type: "NUMBER", description: "Jumlah hari ke depan (0 = hari ini, 7 = minggu ini). Default 0" }
          }
        }
      },
      {
        name: "completeTodo",
        description: "Tandai tugas di To-Do List sebagai selesai",
        parameters: {
          type: "OBJECT",
          properties: {
            todoId: { type: "NUMBER", description: "ID tugas yang mau ditandai selesai" }
          },
          required: ["todoId"]
        }
      },
      {
        name: "undoLastTodo",
        description: "Batalkan penandaan selesai pada tugas to-do list terakhir yang baru saja di-done",
        parameters: {
          type: "OBJECT",
          properties: {}
        }
      },
      {
        name: "updateTodo",
        description: "Ubah atau koreksi judul tugas, deadline, tag, atau deskripsi di To-Do List",
        parameters: {
          type: "OBJECT",
          properties: {
            todoId: { type: "NUMBER", description: "ID tugas yang mau diubah (opsional jika taskQuery diisi)" },
            taskQuery: { type: "STRING", description: "Kata kunci nama tugas jika ID tidak disebutkan" },
            newTask: { type: "STRING", description: "Judul tugas baru" },
            deadlineIso: { type: "STRING", description: "Deadline baru dalam format ISO 8601 (contoh: 2026-09-25T09:30:00+07:00)" },
            tag: { type: "STRING", description: "Tag baru mata kuliah atau kategori" },
            assignee: { type: "STRING", description: "Ganti nama penanggung jawab tugas" },
            description: { type: "STRING", description: "Deskripsi atau instruksi baru untuk tugas" }
          }
        }
      },
      {
        name: "deleteTodo",
        description: "Hapus tugas dari To-Do List. Panggil tool ini saat user minta menghapus tugas atau menyebut nomor tugas dari daftar To-Do List yang baru saja ditampilkan (contoh: 'no 2 apus', 'hapus 1', 'hapus tugas ini').",
        parameters: {
          type: "OBJECT",
          properties: {
            todoId: { type: "NUMBER", description: "Nomor urut visual (1..N) atau ID tugas yang mau dihapus" },
            taskQuery: { type: "STRING", description: "Kata kunci nama tugas jika ID tidak disebutkan" }
          }
        }
      },
      {
        name: "addReminder",
        description: "Buat pengingat/reminder atau jadwal acara/agenda yang akan otomatis diping ke WhatsApp",
        parameters: {
          type: "OBJECT",
          properties: {
            message: { type: "STRING", description: "Nama agenda/acara atau pesan pengingat" },
            isEvent: { type: "BOOLEAN", description: "Set true jika ini adalah acara, agenda, rapat, kuliah, jadwal kegiatan. Set false jika hanya pengingat langsung (misal minum obat, matikan kompor)" },
            eventAtIso: { type: "STRING", description: "Waktu mulai acara/agenda dalam ISO 8601 (contoh: 2026-09-25T17:00:00+07:00). Wajib jika isEvent=true" },
            remindAtIso: { type: "STRING", description: "Waktu pengingat dalam ISO 8601. Untuk acara, isi HANYA jika user meminta waktu pengingat khusus/custom (jika user tidak meminta waktu pengingat khusus, kosongkan/abaikan parameter ini agar sistem otomatis mengingatkan 1 jam sebelum acara). Untuk pengingat biasa non-acara, wajib diisi" },
            recurrence: { type: "STRING", description: "Perulangan pengingat opsional: daily, weekly, every_6h, 6h, 12h, dsb." },
            taskType: { type: "STRING", description: "Tipe tugas: reminder (default) atau scheduled_action" }
          },
          required: ["message"]
        }
      },
      {
        name: "listReminders",
        description: "Lihat daftar semua pengingat/reminder/acara aktif yang belum terkirim. Jika pengguna menanyakan jadwal/acara untuk hari atau tanggal tertentu saja (misal: 'jadwal senin', 'acara besok', 'ada agenda apa hari ini'), WAJIB isi parameter targetDateIso dengan tanggal tersebut (YYYY-MM-DD).",
        parameters: {
          type: "OBJECT",
          properties: {
            targetDateIso: {
              type: "STRING",
              description: "Filter tanggal spesifik dalam format YYYY-MM-DD (contoh: '2026-09-28' untuk hari Senin). Wajib hitung tanggal dari konteks waktu saat ini jika user menyebutkan hari ('senin', 'selasa', 'besok', 'hari ini'). Kosongkan jika pengguna ingin melihat semua pengingat/acara tanpa batasan hari."
            }
          }
        }
      },
      {
        name: "deleteReminder",
        description: "Hapus/batalkan pengingat/acara dari Daftar Acara & Pengingat. Panggil tool ini HANYA jika yang ingin dihapus adalah agenda/acara/reminder. DILARANG memanggil tool ini jika pengguna merujuk nomor dari To-Do List!",
        parameters: {
          type: "OBJECT",
          properties: {
            reminderId: { type: "NUMBER", description: "Nomor urut visual (1..N) atau ID reminder yang ingin dibatalkan/dihapus (opsional)" },
            query: { type: "STRING", description: "Pesan atau topik reminder yang ingin dicari untuk dihapus (opsional)" }
          }
        }
      },
      {
        name: "updateReminder",
        description: "Ubah/edit nama agenda, tanggal/jam, atau jadwal acara pengingat yang sudah ada",
        parameters: {
          type: "OBJECT",
          properties: {
            reminderId: { type: "NUMBER", description: "Nomor urut visual atau ID agenda yang mau diubah (opsional jika query diisi)" },
            query: { type: "STRING", description: "Kata kunci nama agenda lama yang mau diubah" },
            newMessage: { type: "STRING", description: "Nama atau pesan agenda yang baru" },
            newEventAtIso: { type: "STRING", description: "Jadwal/jam baru pelaksanaan acara dalam format ISO 8601 (opsional)" },
            newRemindAtIso: { type: "STRING", description: "Jadwal/jam baru waktu pengingat dalam format ISO 8601 (opsional)" },
            recurrence: { type: "STRING", description: "Perulangan baru: daily, weekly, atau null jika sekali" }
          }
        }
      },
      {
        name: "setDailyDigest",
        description: "Aktifkan atau nonaktifkan pengiriman rekap to-do harian otomatis setiap pukul 07:00 WIB",
        parameters: {
          type: "OBJECT",
          properties: {
            enable: { type: "BOOLEAN", description: "Set true untuk aktifkan, false untuk nonaktifkan" }
          },
          required: ["enable"]
        }
      },
      {
        name: "searchVault",
        description: "Cari dokumen, file, struk, atau KTP yang tersimpan di Document Vault",
        parameters: {
          type: "OBJECT",
          properties: {
            query: { type: "STRING", description: "Kata kunci pencarian (nama file atau isi ringkasan)" },
            category: {
              type: "STRING",
              description: "Kategori opsional: id_cards, receipts, documents, media"
            }
          }
        }
      },
      {
        name: "sendVaultFile",
        description: "Kirim file dokumen atau foto dari Vault langsung ke chat WhatsApp pengguna",
        parameters: {
          type: "OBJECT",
          properties: {
            fileId: { type: "NUMBER", description: "ID file di Document Vault" },
            caption: { type: "STRING", description: "Keterangan/caption file" },
            asDocument: { type: "BOOLEAN", description: "Set true jika ingin dikirim sebagai file dokumen utuh tanpa kompresi gambar (default false untuk gambar)" }
          },
          required: ["fileId"]
        }
      },
      {
        name: "requestFileAccess",
        description: "Minta izin akses dokumen ke pemilik file jika file bukan milik pengguna",
        parameters: {
          type: "OBJECT",
          properties: {
            fileId: { type: "NUMBER", description: "ID file di Document Vault yang ingin diminta aksesnya" },
            reason: { type: "STRING", description: "Alasan meminta akses dokumen (opsional)" }
          },
          required: ["fileId"]
        }
      },
      {
        name: "grantFileAccess",
        description: "Berikan izin akses file dokumen milik pengguna kepada nomor WhatsApp pengguna lain",
        parameters: {
          type: "OBJECT",
          properties: {
            fileId: { type: "NUMBER", description: "ID file milik pengguna yang akan dibagikan" },
            targetPhone: { type: "STRING", description: "Nomor WhatsApp pengguna yang akan diberi akses (contoh: 08123456789 atau 628123456789)" }
          },
          required: ["fileId", "targetPhone"]
        }
      },
      {
        name: "addBacklog",
        description: "Simpan ide improvement fitur bot ke backlog (khusus owner)",
        parameters: {
          type: "OBJECT",
          properties: {
            idea: { type: "STRING", description: "Ide improvement atau fitur yang ingin dicatat" }
          },
          required: ["idea"]
        }
      },
      {
        name: "listBacklogs",
        description: "Lihat daftar ide improvement fitur bot di backlog (khusus owner)",
        parameters: {
          type: "OBJECT",
          properties: {}
        }
      },
      {
        name: "completeBacklog",
        description: "Tandai ide backlog sebagai selesai/sudah dieksekusi (khusus owner)",
        parameters: {
          type: "OBJECT",
          properties: {
            backlogId: { type: "NUMBER", description: "ID backlog yang selesai" }
          },
          required: ["backlogId"]
        }
      },
      {
        name: "submitFeatureRequest",
        description: "Catat dan laporkan usulan / request fitur baru dari pengguna (bisa dipanggil oleh siapa saja). Otomatis mengirimkan notifikasi ke master/owner.",
        parameters: {
          type: "OBJECT",
          properties: {
            requestText: { type: "STRING", description: "Rincian fitur atau saran perbaikan yang diminta oleh pengguna" }
          },
          required: ["requestText"]
        }
      },
      {
        name: "listFeatureRequests",
        description: "Lihat daftar request fitur yang masuk dari para pengguna (khusus owner/master)",
        parameters: {
          type: "OBJECT",
          properties: {
            status: { type: "STRING", description: "Filter status: 'pending', 'done', atau 'all'. Default 'pending'." }
          }
        }
      },
      {
        name: "searchWeb",
        description: "Cari info terbaru, berita, riset, fakta, cuaca, atau informasi real-time di internet",
        parameters: {
          type: "OBJECT",
          properties: {
            query: { type: "STRING", description: "Kata kunci pencarian yang spesifik dan efektif" }
          },
          required: ["query"]
        }
      },
      {
        name: "readUrl",
        description: "Baca dan ekstrak konten dari tautan publik: Google Sheets (pubhtml multi-tab / CSV), Google Docs, tabel data, artikel online, atau URL web (dengan proteksi SSRF)",
        parameters: {
          type: "OBJECT",
          properties: {
            url: { type: "STRING", description: "URL lengkap website, artikel online, atau Google Docs/Sheets (contoh: https://...)" }
          },
          required: ["url"]
        }
      },
      {
        name: "executePython",
        description: "Jalankan script Python untuk kalkulasi presisi, analisis data, manipulasi string/data, atau plotting grafik chart (simpan chart ke os.environ['CHART_PATH'] atau /tmp/chart.png)",
        parameters: {
          type: "OBJECT",
          properties: {
            code: { type: "STRING", description: "Script Python lengkap yang siap dieksekusi" }
          },
          required: ["code"]
        }
      },
      {
        name: "saveSkill",
        description: "Simpan skill atau macro kustom baru (auto-crystallization) yang diajarkan oleh pengguna untuk dipakai kembali nanti",
        parameters: {
          type: "OBJECT",
          properties: {
            name: { type: "STRING", description: "Nama skill singkat tanpa spasi (contoh: rekap_malam, cek_jadwal_ujian)" },
            description: { type: "STRING", description: "Deskripsi singkat fungsi dan tujuan skill ini" },
            promptTemplate: { type: "STRING", description: "Instruksi dan langkah kerja detail yang harus dijalankan saat skill ini dipanggil" }
          },
          required: ["name", "description", "promptTemplate"]
        }
      },
      {
        name: "listSkills",
        description: "Tampilkan semua custom skills / macro yang sudah dipelajari dan tersimpan",
        parameters: {
          type: "OBJECT",
          properties: {}
        }
      },
      {
        name: "deleteSkill",
        description: "Hapus skill atau macro kustom dari memori bot",
        parameters: {
          type: "OBJECT",
          properties: {
            name: { type: "STRING", description: "Nama skill yang ingin dihapus" }
          },
          required: ["name"]
        }
      },
      {
        name: "loadSkill",
        description: "Muat playbook operasional lengkap dari sebuah skill khusus ke konteks percakapan untuk dieksekusi",
        parameters: {
          type: "OBJECT",
          properties: {
            name: { type: "STRING", description: "Nama skill yang ingin dimuat" }
          },
          required: ["name"]
        }
      },
      {
        name: "updateSkill",
        description: "Perbarui atau tambahkan instruksi operasional baru ke playbook skill yang sudah ada",
        parameters: {
          type: "OBJECT",
          properties: {
            name: { type: "STRING", description: "Nama skill" },
            content: { type: "STRING", description: "Instruksi/konten baru" },
            append: { type: "BOOLEAN", description: "Set true jika ingin menambahkan ke akhir teks playbook, false untuk menimpa" }
          },
          required: ["name", "content"]
        }
      },
      {
        name: "processPdf",
        description: "Manipulasi PDF di Vault: merge (gabung), split (ekstrak halaman), render_image (render ke gambar/foto WhatsApp), images_to_pdf (kumpulan foto jadi PDF), compress (kecilkan ukuran)",
        parameters: {
          type: "OBJECT",
          properties: {
            action: {
              type: "STRING",
              description: "Aksi PDF: merge, split, render_image, images_to_pdf, compress",
              enum: ["merge", "split", "render_image", "images_to_pdf", "compress"]
            },
            targetFiles: {
              type: "ARRAY",
              items: { type: "STRING" },
              description: "Daftar ID (#1, #2) atau nama file di Vault"
            },
            pages: {
              type: "STRING",
              description: "Rentang halaman untuk aksi split (contoh: '1-3', '1,3,5', 'last')"
            },
            pageNumber: {
              type: "NUMBER",
              description: "Nomor halaman untuk render_image (1-based, default 1)"
            },
            outputFilename: {
              type: "STRING",
              description: "Nama file baru hasil proses untuk disimpan di Vault (opsional)"
            },
            caption: {
              type: "STRING",
              description: "Keterangan caption saat file/gambar dikirim ke WhatsApp"
            },
            sendDirectly: {
              type: "BOOLEAN",
              description: "Set true jika ingin hasil langsung dikirim ke WhatsApp (default true untuk render_image)"
            }
          },
          required: ["action", "targetFiles"]
        }
      },
      {
        name: "mergePdf",
        description: "Gabungkan (merge) dua atau lebih file PDF di Vault menjadi satu file PDF utuh",
        parameters: {
          type: "OBJECT",
          properties: {
            targetFiles: {
              type: "ARRAY",
              items: { type: "STRING" },
              description: "Daftar ID (#1, #2) atau nama file PDF di Vault yang mau digabung"
            },
            outputFilename: { type: "STRING", description: "Nama file hasil gabungan (opsional)" },
            caption: { type: "STRING", description: "Keterangan saat file dikirim ke WhatsApp" },
            sendDirectly: { type: "BOOLEAN", description: "Set true jika ingin file hasil langsung dikirim ke WhatsApp" }
          },
          required: ["targetFiles"]
        }
      },
      {
        name: "splitPdf",
        description: "Ekstrak rentang halaman tertentu dari file PDF di Vault",
        parameters: {
          type: "OBJECT",
          properties: {
            targetFile: { type: "STRING", description: "ID (#1) atau nama file PDF di Vault" },
            pages: { type: "STRING", description: "Rentang halaman yang diekstrak (contoh: '1-3', '1,3,5', 'last')" },
            outputFilename: { type: "STRING", description: "Nama file hasil ekstrak (opsional)" },
            caption: { type: "STRING", description: "Keterangan saat file dikirim ke WhatsApp" },
            sendDirectly: { type: "BOOLEAN", description: "Set true jika ingin file hasil langsung dikirim ke WhatsApp" }
          },
          required: ["targetFile"]
        }
      },
      {
        name: "compressPdf",
        description: "Kompres dan optimasi ukuran file PDF di Vault",
        parameters: {
          type: "OBJECT",
          properties: {
            targetFile: { type: "STRING", description: "ID (#1) atau nama file PDF di Vault" },
            outputFilename: { type: "STRING", description: "Nama file hasil kompresi (opsional)" },
            caption: { type: "STRING", description: "Keterangan saat file dikirim ke WhatsApp" },
            sendDirectly: { type: "BOOLEAN", description: "Set true jika ingin file hasil langsung dikirim ke WhatsApp" }
          },
          required: ["targetFile"]
        }
      },
      {
        name: "convertDocument",
        description: "Konversi atau ekstrak isi file office (DOCX, XLSX, TXT) di Vault ke format PDF atau teks (didukung headless LibreOffice & python runner)",
        parameters: {
          type: "OBJECT",
          properties: {
            targetFile: { type: "STRING", description: "ID (#1) atau nama file di Vault" },
            targetFormat: { type: "STRING", description: "Format target: 'pdf' atau 'text' (default 'pdf')" },
            outputFilename: { type: "STRING", description: "Nama file baru hasil konversi (opsional)" },
            caption: { type: "STRING", description: "Keterangan saat file dikirim ke WhatsApp" },
            sendDirectly: { type: "BOOLEAN", description: "Set true jika ingin file hasil langsung dikirim ke WhatsApp" }
          },
          required: ["targetFile"]
        }
      },
      {
        name: "ocrDocument",
        description: "Ekstrak teks dari file gambar atau scan PDF di Vault menggunakan OCR (Tesseract / PyMuPDF OCR engine)",
        parameters: {
          type: "OBJECT",
          properties: {
            targetFile: { type: "STRING", description: "ID (#1) atau nama file gambar/PDF di Vault" },
            lang: { type: "STRING", description: "Bahasa OCR opsional (contoh: ind+eng)" }
          },
          required: ["targetFile"]
        }
      },
      {
        name: "proposeSkill",
        description: "Buat proposal skill/macro baru yang akan direview sebelum menjadi aktif",
        parameters: {
          type: "OBJECT",
          properties: {
            name: { type: "STRING", description: "Nama skill (slug alfanumerik tanpa spasi, contoh: format_laporan)" },
            description: { type: "STRING", description: "Deskripsi singkat fungsi skill" },
            content: { type: "STRING", description: "Langkah dan instruksi detail skill" }
          },
          required: ["name", "content"]
        }
      },
      {
        name: "approveSkill",
        description: "Setujui proposal skill menjadi aktif, tercatat di registry dengan audit versioning",
        parameters: {
          type: "OBJECT",
          properties: {
            name: { type: "STRING", description: "Nama atau path file proposal skill yang disetujui" }
          },
          required: ["name"]
        }
      },
      {
        name: "rejectSkill",
        description: "Tolak proposal skill agar tidak diaktifkan",
        parameters: {
          type: "OBJECT",
          properties: {
            name: { type: "STRING", description: "Nama atau path file proposal skill" },
            reason: { type: "STRING", description: "Alasan penolakan" }
          },
          required: ["name"]
        }
      },
      {
        name: "listSkillVersions",
        description: "Lihat riwayat versi skill dan arsip versinya (.versions/vNNN.md)",
        parameters: {
          type: "OBJECT",
          properties: {
            name: { type: "STRING", description: "Nama skill yang ingin dicek riwayat versinya" }
          },
          required: ["name"]
        }
      },
      {
        name: "rollbackSkill",
        description: "Kembalikan skill ke versi sebelumnya (audit rollback)",
        parameters: {
          type: "OBJECT",
          properties: {
            name: { type: "STRING", description: "Nama skill yang ingin di-rollback" },
            toVersion: { type: "NUMBER", description: "Nomor versi target (opsional, default ke versi tepat sebelum aktif)" }
          },
          required: ["name"]
        }
      },
      {
        name: "addPerson",
        description: "Simpan atau perbarui kontak keluarga, pasangan, atau partner ke direktori koordinasi pasangan",
        parameters: {
          type: "OBJECT",
          properties: {
            name: { type: "STRING", description: "Nama kontak atau anggota keluarga (contoh: Gilang, Bunga, Ibu, Dosen A)" },
            phone: { type: "STRING", description: "Nomor telepon WhatsApp (contoh: 08123456789 atau 628123456789)" },
            role: { type: "STRING", description: "Peran atau jabatan (contoh: Principal, Co-Principal, Pasangan, Rekan Lab)" },
            relationship: { type: "STRING", description: "Hubungan (contoh: Suami, Istri, Pasangan, Keluarga, Teman)" },
            notes: { type: "STRING", description: "Catatan khusus, preferensi, atau info tambahan" }
          },
          required: ["name"]
        }
      },
      {
        name: "getPerson",
        description: "Cari kontak atau detail profil anggota keluarga/partner dari direktori",
        parameters: {
          type: "OBJECT",
          properties: {
            name: { type: "STRING", description: "Nama atau nomor telepon kontak yang dicari" }
          },
          required: ["name"]
        }
      },
      {
        name: "listPersons",
        description: "Tampilkan semua kontak dan anggota keluarga di direktori koordinasi pasangan",
        parameters: {
          type: "OBJECT",
          properties: {}
        }
      },
      {
        name: "deletePerson",
        description: "Hapus kontak dari direktori koordinasi pasangan",
        parameters: {
          type: "OBJECT",
          properties: {
            name: { type: "STRING", description: "Nama kontak yang ingin dihapus" }
          },
          required: ["name"]
        }
      },
      {
        name: "saveNote",
        description: "Simpan catatan penting, memori personal, atau info permanen pengguna (contoh: nomor rekening, NIM, alamat, preferensi)",
        parameters: {
          type: "OBJECT",
          properties: {
            key: { type: "STRING", description: "Topik atau kata kunci catatan (contoh: rekening_bca, nim, alamat_kost)" },
            content: { type: "STRING", description: "Isi catatan lengkap" }
          },
          required: ["key", "content"]
        }
      },
      {
        name: "appendNote",
        description: "Tambahkan poin atau informasi baru ke dalam catatan/daftar yang sudah ada (Living List / shared note), tanpa menghapus catatan lama",
        parameters: {
          type: "OBJECT",
          properties: {
            key: { type: "STRING", description: "Topik atau nama catatan (contoh: belanja, ide, toefl)" },
            addition: { type: "STRING", description: "Teks atau item baru yang ingin ditambahkan" }
          },
          required: ["key", "addition"]
        }
      },
      {
        name: "getNote",
        description: "Cari atau ambil catatan/memori personal pengguna berdasarkan kata kunci atau query",
        parameters: {
          type: "OBJECT",
          properties: {
            key: { type: "STRING", description: "Kata kunci atau topik catatan yang ingin dicari/diambil" }
          },
          required: ["key"]
        }
      },
      {
        name: "listNotes",
        description: "Tampilkan seluruh daftar catatan/memori personal pengguna yang tersimpan",
        parameters: {
          type: "OBJECT",
          properties: {}
        }
      },
      {
        name: "deleteNote",
        description: "Hapus catatan/memori personal pengguna berdasarkan kata kunci",
        parameters: {
          type: "OBJECT",
          properties: {
            key: { type: "STRING", description: "Kata kunci catatan yang mau dihapus" }
          },
          required: ["key"]
        }
      },
      {
        name: "checkServerHealth",
        description: "Cek kesehatan & performa server bot Oracle / VPS (CPU, RAM, Disk, Uptime, load avg, database). Panggil saat user tanya kesehatan/kondisi server bot atau sistem. Khusus owner.",
        parameters: {
          type: "OBJECT",
          properties: {}
        }
      },
      {
        name: "checkMinecraftServer",
        description: "Cek status server Minecraft / menkrep / mc mabar (Java & Bedrock port 25565/19132), MOTD, versi, dan daftar player yang sedang online. Panggil saat user tanya server Minecraft, mc, menkrep, mabar, atau player online. Khusus owner.",
        parameters: {
          type: "OBJECT",
          properties: {}
        }
      },
      {
        name: "sendDirectMessage",
        description: "Kirim pesan teks pribadi (PC / DM / japri) atau tautan/link secara langsung ke nomor WhatsApp pengguna yang terdaftar di whitelist. Gunakan saat pengguna minta tolong PC/japri/DM/kirim link/pesan ke orang lain di whitelist, ATAU minta tolong semangatin, titip pesan, sampaikan ucapan selamat/semangat, atau bilangin ke orang lain di whitelist (misal: 'tolong semangatin Rafid ya, semangat pitchingnya', 'bilangin Mami...', 'pc karimah link ini', 'japri rafid tolong...', 'pc razita ndut ingetin pr'). Target penerima WAJIB terdaftar di whitelist bot.",
        parameters: {
          type: "OBJECT",
          properties: {
            recipient: {
              type: "STRING",
              description: "Nama kontak tujuan (misal: 'Karimah', 'Mami', 'Papi', 'Razita Ndut', 'Rafid') atau nomor telepon tujuan (format 628... / +628...)."
            },
            message: {
              type: "STRING",
              description: "Isi pesan lengkap, catatan, ucapan semangat, atau tautan/link yang ingin dikirimkan langsung ke nomor tujuan via chat pribadi (PC)."
            }
          },
          required: ["recipient", "message"]
        }
      }
    ]
  }
];

export async function executeTool(name, args, { store, chatId, senderNumber = "", rotator = null, userText = "" }) {
  let toolResult = {};
  let formattedList = null;
  const callerId = senderNumber || chatId;

  const isGroup = String(chatId).endsWith("@g.us");
  if (isGroup && (name === "searchVault" || name === "sendVaultFile" || name === "requestFileAccess" || name === "grantFileAccess")) {
    return {
      toolResult: { error: "Fitur vault dokumen pribadi dinonaktifkan di obrolan grup demi menjaga privasi data pemilik." },
      formattedList: null
    };
  }

  if (name === "addTodo") {
    const deadline = args.deadlineIso ? new Date(args.deadlineIso).getTime() : null;
    const desc = (args.description && String(args.description).trim()) || userText || "";
    const id = store.addTodo(chatId, args.task, deadline, args.tag, args.category, args.assignee, desc);
    toolResult = {
      success: true,
      id,
      task: args.task,
      category: args.category || "auto",
      assignee: args.assignee || null,
      description: desc
    };
  } else if (name === "listTodos") {
    const queryChatId = isGroup ? chatId : (callerId || chatId);
    const todos = store.getTodos(queryChatId, Boolean(args.includeRoutine), args.assignee || null, Boolean(args.includeDone), args.targetDateIso);
    formattedList = formatTodoList(todos, isGroup, { targetDate: args.targetDateIso });
    toolResult = {
      count: todos.length,
      targetDate: args.targetDateIso || null,
      formatted: formattedList,
      instruction: "WAJIB kembalikan persis teks di field 'formatted' apa adanya. DILARANG memformat ulang, DILARANG mengubah emoji, dan DILARANG menambahkan kalimat basa-basi/penawaran bantuan di akhir (seperti 'ada yang mau dibantu?', 'mau diapain list ini?')."
    };
  } else if (name === "getTodoDetail") {
    const queryChatId = isGroup ? chatId : (callerId || chatId);
    let targetId = args.todoId;
    if (!targetId && args.taskQuery) {
      const found = store.findTodo(queryChatId, args.taskQuery);
      if (found) targetId = found.id;
    }
    const todo = targetId ? store.getTodoById(targetId, queryChatId) : null;
    if (!todo) {
      toolResult = { error: `Tugas ${args.todoId || args.taskQuery || ""} tidak ditemukan.` };
    } else {
      const formattedDetail = formatTodoDetail(todo);
      toolResult = {
        success: true,
        todo: {
          id: todo.id,
          task: todo.task,
          deadline: todo.deadline,
          tag: todo.tag,
          category: todo.category,
          assignee: todo.assignee,
          done: Boolean(todo.done),
          description: todo.description || ""
        },
        formatted: formattedDetail,
        instruction: "Kembalikan rincian tugas berdasarkan field 'formatted' kepada pengguna dengan rapi dan jelas."
      };
    }
  } else if (name === "getTodosDue") {
    const days = args.daysAhead !== undefined ? Number(args.daysAhead) : 0;
    const queryChatId = isGroup ? chatId : (callerId || chatId);
    const todos = store.getTodosDue(queryChatId, days, args.assignee || null);
    formattedList = formatTodoList(todos, isGroup);
    toolResult = {
      count: todos.length,
      daysAhead: days,
      formatted: formattedList,
      instruction: "WAJIB kembalikan persis teks di field 'formatted' apa adanya. DILARANG memformat ulang, DILARANG mengubah emoji, dan DILARANG menambahkan kalimat basa-basi/penawaran bantuan di akhir."
    };
  } else if (name === "completeTodo") {
    const queryChatId = isGroup ? chatId : (callerId || chatId);
    const changes = store.completeTodo(args.todoId, queryChatId);
    const remaining = store.getTodos(queryChatId, false);
    formattedList = formatTodoList(remaining, isGroup);
    toolResult = { success: changes > 0, todoId: args.todoId, formattedList };
  } else if (name === "undoLastTodo") {
    const queryChatId = isGroup ? chatId : (callerId || chatId);
    const undone = store.undoLastDone(queryChatId);
    if (!undone) {
      toolResult = { error: "Tidak ada tugas selesai yang bisa dibatalkan (undo)." };
    } else {
      toolResult = {
        success: true,
        undoneTodo: undone,
        message: `Tugas #${undone.id} ('${undone.task}') berhasil dikembalikan ke status belum selesai.`
      };
    }
  } else if (name === "updateTodo") {
    let targetId = args.todoId;
    if (!targetId && args.taskQuery) {
      const found = store.findTodo(chatId, args.taskQuery);
      if (found) targetId = found.id;
    }
    if (!targetId) {
      toolResult = { error: "Tugas tidak ditemukan untuk diubah." };
    } else {
      const deadline = args.deadlineIso ? new Date(args.deadlineIso).getTime() : undefined;
      const changes = store.updateTodo(targetId, chatId, {
        task: args.newTask,
        deadline,
        tag: args.tag,
        assignee: args.assignee,
        description: args.description
      });
      toolResult = {
        success: changes > 0,
        todoId: targetId
      };
    }
  } else if (name === "deleteTodo") {
    const queryChatId = isGroup ? chatId : (callerId || chatId);
    let targetId = args.todoId;
    if (!targetId && args.taskQuery) {
      const found = store.findTodo(queryChatId, args.taskQuery);
      if (found) targetId = found.id;
    }
    if (!targetId) {
      toolResult = { error: "Tugas tidak ditemukan untuk dihapus." };
    } else {
      const changes = store.deleteTodo(targetId, queryChatId);
      const remaining = store.getTodos(queryChatId, false);
      formattedList = formatTodoList(remaining, isGroup);
      toolResult = {
        success: changes > 0,
        deletedId: targetId,
        remainingCount: remaining.length,
        formattedList,
        instruction: "Jika menampilkan sisa tugas, WAJIB gunakan persis teks di field 'formattedList'. DILARANG menampilkan atau mencantumkan tugas yang sudah dihapus."
      };
    }
  } else if (name === "addReminder") {
    let eventAt = args.eventAtIso ? new Date(args.eventAtIso).getTime() : null;
    let remindAt = args.remindAtIso ? new Date(args.remindAtIso).getTime() : null;
    if (isNaN(eventAt)) eventAt = null;
    if (isNaN(remindAt)) remindAt = null;

    if ((args.isEvent || args.eventAtIso) && !eventAt && remindAt) {
      eventAt = remindAt;
      remindAt = null;
    }

    if (!eventAt && !remindAt) {
      throw new Error("Format tanggal/jam ISO tidak valid atau waktu pengingat belum ditentukan.");
    }

    const id = store.addReminder(
      chatId,
      args.message,
      remindAt,
      args.recurrence || null,
      args.taskType || "reminder",
      eventAt
    );

    const createdReminder = store.getReminderById ? store.getReminderById(id) : null;
    const finalRemindAt = createdReminder ? createdReminder.remind_at : (remindAt || Date.now());

    scheduleNearHorizonReminder(store, {
      id,
      chat_id: chatId,
      message: args.message,
      remind_at: finalRemindAt,
      recurrence: args.recurrence || null,
      task_type: args.taskType || "reminder",
      event_at: eventAt
    }, { rotator });

    toolResult = {
      success: true,
      id,
      message: args.message,
      eventAt: eventAt ? new Date(eventAt).toISOString() : null,
      remindAt: new Date(finalRemindAt).toISOString(),
      recurrence: args.recurrence || null
    };
  } else if (name === "listReminders") {
    const queryChatId = isGroup ? chatId : (callerId || chatId);
    const reminders = store.listReminders(queryChatId, args.targetDateIso);
    formattedList = formatRemindersList(reminders, { targetDate: args.targetDateIso });
    toolResult = {
      success: true,
      count: reminders.length,
      targetDate: args.targetDateIso || null,
      formatted: formattedList,
      instruction: "WAJIB kembalikan persis isi teks di field 'formatted' apa adanya. DILARANG memformat ulang dan DILARANG menambahkan kalimat basa-basi/penawaran bantuan di akhir."
    };
  } else if (name === "deleteReminder") {
    const queryChatId = isGroup ? chatId : (callerId || chatId);
    const target = args.reminderId || args.query;
    if (!target) {
      toolResult = { error: "ID reminder atau teks query wajib diisi untuk menghapus pengingat." };
    } else {
      const changes = store.deleteReminder(queryChatId, target);
      const remaining = store.listReminders(queryChatId);
      formattedList = formatRemindersList(remaining);
      toolResult = {
        success: changes > 0,
        deletedCount: changes,
        remainingCount: remaining.length,
        formattedList,
        instruction: "Jika menampilkan sisa pengingat/agenda, WAJIB gunakan persis teks di field 'formattedList'. DILARANG menampilkan agenda yang sudah dihapus.",
        message: changes > 0 ? "Pengingat/agenda berhasil dihapus." : "Pengingat tidak ditemukan."
      };
    }
  } else if (name === "updateReminder") {
    const queryChatId = isGroup ? chatId : (callerId || chatId);
    const target = args.reminderId || args.query;
    if (!target) {
      toolResult = { error: "reminderId atau query wajib diisi untuk mengubah agenda/pengingat." };
    } else {
      const remindAt = args.newRemindAtIso ? new Date(args.newRemindAtIso).getTime() : undefined;
      const eventAt = args.newEventAtIso ? new Date(args.newEventAtIso).getTime() : undefined;
      const updated = store.updateReminder(queryChatId, target, {
        message: args.newMessage,
        remindAt: isNaN(remindAt) ? undefined : remindAt,
        eventAt: isNaN(eventAt) ? undefined : eventAt,
        recurrence: args.recurrence
      });
      if (!updated) {
        toolResult = { error: `Agenda/pengingat '${target}' tidak ditemukan.` };
      } else {
        const remaining = store.listReminders(queryChatId);
        formattedList = formatRemindersList(remaining);
        toolResult = {
          success: true,
          updated,
          message: `Agenda berhasil diubah menjadi '${updated.message}'.`,
          formattedList
        };
      }
    }
  } else if (name === "setDailyDigest") {
    const enable = Boolean(args.enable);
    store.setDailyDigest(chatId, enable);
    toolResult = {
      success: true,
      enabled: enable,
      message: enable
        ? "Rekap harian to-do list jam 07:00 WIB berhasil diaktifkan."
        : "Rekap harian to-do list jam 07:00 WIB berhasil dinonaktifkan."
    };
  } else if (name === "searchVault") {
    let queryEmbedding = null;
    if (rotator && args.query) {
      try {
        queryEmbedding = await getEmbedding(rotator, args.query);
      } catch (embErr) {
        console.warn("[Vault] Semantic embedding search failed, fallback to keyword:", embErr.message);
      }
    }
    const files = store.searchVaultFiles(args.query || "", args.category || null, callerId, queryEmbedding);
    toolResult = {
      count: files.length,
      files: files.map((f) => ({
        id: f.id,
        filename: f.filename,
        category: f.category,
        summary: f.summary
      }))
    };
  } else if (name === "sendVaultFile") {
    const file = store.getVaultFileById(args.fileId);
    if (!file) {
      toolResult = { error: "File tidak ditemukan di vault" };
    } else if (!store.hasFileAccess(file.id, callerId)) {
      toolResult = {
        error: "Akses ditolak",
        message: `Anda tidak memiliki izin mengakses file ini (Pemilik: +${normalizePhone(file.owner_id)}). Minta izin dengan perintah: 'Minta akses file ID ${file.id}'.`
      };
    } else {
      await sendFile(chatId, file.filepath, file.filename, args.caption || file.summary, Boolean(args.asDocument));
      toolResult = { success: true, filename: file.filename };
    }
  } else if (name === "requestFileAccess") {
    const file = store.getVaultFileById(args.fileId);
    if (!file) {
      toolResult = { error: "File tidak ditemukan di vault" };
    } else if (store.hasFileAccess(file.id, callerId)) {
      toolResult = { success: true, message: "Anda sudah memiliki izin akses ke file ini." };
    } else if (!file.owner_id) {
      toolResult = { error: "File ini tidak memiliki pemilik terdaftar." };
    } else {
      const reqId = store.createFileRequest(file.id, callerId, file.owner_id);
      const reqNum = normalizePhone(callerId);
      await sendText(
        file.owner_id,
        `*[Permintaan Akses Dokumen]*\nPengguna *+${reqNum}* meminta akses ke file:\n*${file.filename}* (ID: #${file.id})${args.reason ? `\nAlasan: ${args.reason}` : ""}\n\nBalas:\n*SETUJU ${reqId}*\n*TOLAK ${reqId}*`
      );
      toolResult = {
        success: true,
        requestId: reqId,
        message: `Permintaan akses file #${file.id} (${file.filename}) sudah dikirimkan ke pemilik (+${normalizePhone(file.owner_id)}). Menunggu persetujuan.`
      };
    }
  } else if (name === "grantFileAccess") {
    const file = store.getVaultFileById(args.fileId);
    const callerNorm = normalizePhone(callerId);
    if (!file) {
      toolResult = { error: "File tidak ditemukan di vault" };
    } else if (file.owner_id && normalizePhone(file.owner_id) !== callerNorm) {
      toolResult = { error: "Hanya pemilik dokumen yang dapat memberikan izin akses kepada pengguna lain." };
    } else {
      const targetNorm = normalizePhone(args.targetPhone);
      store.grantFileAccess(file.id, targetNorm);
      await sendText(
        targetNorm,
        `*[Akses Dokumen Diberikan]*\nAnda telah diberikan izin akses ke dokumen:\n*${file.filename}* (ID: #${file.id})\nOleh pemilik: +${callerNorm}`
      );
      toolResult = {
        success: true,
        message: `Izin akses file #${file.id} (${file.filename}) berhasil diberikan kepada +${targetNorm}.`
      };
    }
  } else if (name === "addBacklog") {
    if (!isOwner(chatId, senderNumber)) {
      toolResult = { error: `Fitur backlog hanya khusus untuk nomor admin/owner (+${OWNER_PHONE}).` };
    } else {
      const id = store.addBacklog(chatId, args.idea);
      toolResult = { success: true, id, idea: args.idea, message: `Ide improvement #${id} disimpan ke backlog.` };
    }
  } else if (name === "listBacklogs") {
    if (!isOwner(chatId, senderNumber)) {
      toolResult = { error: `Fitur backlog hanya khusus untuk nomor admin/owner (+${OWNER_PHONE}).` };
    } else {
      const items = store.getBacklogs(chatId);
      formattedList = formatBacklogList(items);
      toolResult = { count: items.length, items, formatted: formattedList };
    }
  } else if (name === "completeBacklog") {
    if (!isOwner(chatId, senderNumber)) {
      toolResult = { error: `Fitur backlog hanya khusus untuk nomor admin/owner (+${OWNER_PHONE}).` };
    } else {
      const changes = store.completeBacklog(args.backlogId, chatId);
      toolResult = { success: changes > 0, backlogId: args.backlogId };
    }
  } else if (name === "submitFeatureRequest") {
    const senderPhone = senderNumber || chatId;
    const person = store?.getPerson ? store.getPerson(senderPhone) : null;
    const senderName = person?.name || "";
    const id = store.addFeatureRequest(senderPhone, senderName, args.requestText);
    try {
      const normSender = normalizePhone(senderPhone);
      const who = senderName ? `${senderName} (+${normSender})` : `+${normSender}`;
      await sendText(
        `${OWNER_PHONE}@c.us`,
        `💡 *[Feature Request Baru]*\n• ID: #${id}\n• Dari: ${who}\n• Request:\n"${args.requestText}"`
      );
    } catch {}
    toolResult = {
      success: true,
      requestId: id,
      message: `Request fitur #${id} berhasil dicatat di sistem dan dilaporkan ke master.`
    };
  } else if (name === "listFeatureRequests") {
    if (!isOwner(chatId, senderNumber)) {
      toolResult = { error: `Daftar request fitur hanya bisa diakses oleh master (+${OWNER_PHONE}).` };
    } else {
      const list = store.getFeatureRequests(args.status || "pending");
      formattedList = formatFeatureRequestsList(list);
      toolResult = { count: list.length, requests: list, formatted: formattedList };
    }
  } else if (name === "searchWeb") {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
      toolResult = { error: "Pencarian web gagal: TAVILY_API_KEY belum dikonfigurasi di environment." };
      return { toolResult, formattedList };
    }
    const searchRes = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query: args.query,
        max_results: 5,
        search_depth: "basic"
      }),
      signal: AbortSignal.timeout(10000)
    });
    if (!searchRes.ok) {
      throw new Error(`Tavily search gagal (${searchRes.status}): ${await searchRes.text()}`);
    }
    const searchData = await searchRes.json();
    toolResult = {
      query: args.query,
      results: (searchData.results || []).map((r) => ({
        title: r.title,
        url: r.url,
        content: r.content
      }))
    };
  } else if (name === "readUrl") {
    try {
      const content = await fetchUrlContent(args.url);
      toolResult = {
        url: args.url,
        content,
        length: content.length
      };
    } catch (err) {
      toolResult = { error: `Gagal membaca URL: ${err.message}` };
    }
  } else if (name === "executePython") {
    const runnerUrl = process.env.PYTHON_RUNNER_URL || "http://localhost:8000/run";
    try {
      const resp = await fetch(runnerUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: args.code }),
        signal: AbortSignal.timeout(15000)
      });
      if (!resp.ok) {
        throw new Error(`Runner error (${resp.status}): ${await resp.text()}`);
      }
      const data = await resp.json();

      if (data.image_base64) {
        const tmpImg = path.join(os.tmpdir(), `chart_${Date.now()}.png`);
        fs.writeFileSync(tmpImg, Buffer.from(data.image_base64, "base64"));
        try {
          await sendFile(chatId, tmpImg, "chart.png", "Hasil plot chart Python");
        } finally {
          try { fs.unlinkSync(tmpImg); } catch {}
        }
      }

      toolResult = {
        stdout: data.stdout || null,
        stderr: data.stderr || null,
        exitCode: data.exit_code
      };
    } catch (err) {
      toolResult = { error: `Python runner error: ${err.message}` };
    }
  } else if (name === "saveSkill") {
    const saved = store.saveSkill(args.name, args.description, args.promptTemplate);
    toolResult = {
      success: true,
      name: saved.name,
      description: saved.description,
      message: `Skill '${saved.name}' berhasil disimpan dan dikristalisasi.`
    };
  } else if (name === "listSkills") {
    const skills = store.getSkills();
    formattedList = formatSkillList(skills);
    toolResult = { count: skills.length, skills, formatted: formattedList };
  } else if (name === "deleteSkill") {
    const changes = store.deleteSkill(args.name);
    toolResult = {
      success: changes > 0,
      name: args.name,
      message: changes > 0 ? `Skill '${args.name}' berhasil dihapus.` : `Skill '${args.name}' tidak ditemukan.`
    };
  } else if (name === "loadSkill") {
    const cleanName = (args.name || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
    const skill = store.getSkill(cleanName);
    if (!skill) {
      const available = store.getSkills().map((s) => s.name);
      toolResult = {
        error: `Skill '${args.name}' tidak ditemukan.`,
        availableSkills: available
      };
    } else {
      toolResult = {
        success: true,
        skill: skill.name,
        description: skill.description,
        playbook: skill.prompt_template,
        message: `Playbook untuk skill *${skill.name}* berhasil dimuat ke konteks.`
      };
    }
  } else if (name === "updateSkill") {
    const cleanName = (args.name || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
    const existing = store.getSkill(cleanName);
    let newTemplate = (args.content || "").trim();
    let desc = existing ? existing.description : "Updated skill playbook.";
    if (existing && args.append) {
      newTemplate = `${existing.prompt_template}\n\n${newTemplate}`;
    }
    const saved = store.saveSkill(cleanName, desc, newTemplate);
    toolResult = {
      success: true,
      name: saved.name,
      message: `Skill '${saved.name}' berhasil diperbarui.`
    };
  } else if (name === "processPdf" || name === "mergePdf" || name === "splitPdf" || name === "compressPdf") {
    let action = String(args.action || "").trim().toLowerCase();
    let rawTargets = [];
    if (name === "mergePdf") {
      action = "merge";
      rawTargets = Array.isArray(args.targetFiles) ? args.targetFiles : [args.targetFiles].filter(Boolean);
    } else if (name === "splitPdf") {
      action = "split";
      rawTargets = [args.targetFile].filter(Boolean);
    } else if (name === "compressPdf") {
      action = "compress";
      rawTargets = [args.targetFile].filter(Boolean);
    } else {
      rawTargets = Array.isArray(args.targetFiles) ? args.targetFiles : [args.targetFiles].filter(Boolean);
    }
    if (rawTargets.length === 0) {
      toolResult = { error: "Daftar targetFiles tidak boleh kosong." };
    } else {
      const resolvedFiles = [];
      for (const target of rawTargets) {
        const fileRec = store.resolveVaultFile(target, callerId);
        if (!fileRec) {
          toolResult = { error: `File '${target}' tidak ditemukan di Vault dokumen.` };
          break;
        }
        if (!store.hasFileAccess(fileRec.id, callerId)) {
          toolResult = { error: `Anda tidak memiliki izin mengakses file ID #${fileRec.id} (${fileRec.filename}).` };
          break;
        }
        if (!fs.existsSync(fileRec.filepath)) {
          toolResult = { error: `File fisik '${fileRec.filename}' tidak ditemukan di disk server.` };
          break;
        }
        const b = fs.readFileSync(fileRec.filepath);
        resolvedFiles.push({
          id: fileRec.id,
          filename: fileRec.filename,
          data_base64: b.toString("base64")
        });
      }

      if (!toolResult.error) {
        const runnerUrl = (process.env.PYTHON_RUNNER_URL || "http://localhost:8000/run").replace(/\/run$/, "/pdf");
        try {
          const resp = await fetch(runnerUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action,
              files: resolvedFiles.map((f) => ({ filename: f.filename, data_base64: f.data_base64 })),
              pages: args.pages || "1",
              page_number: args.pageNumber || 1,
              dpi: args.dpi || 150,
              format: args.format || "png",
              rotate_deg: args.rotateDeg || 0
            }),
            signal: AbortSignal.timeout(30000)
          });
          if (!resp.ok) {
            throw new Error(`Runner PDF error (${resp.status}): ${await resp.text()}`);
          }
          const data = await resp.json();
          if (data.status !== "success") {
            toolResult = { error: data.error || "Gagal memproses file PDF." };
          } else {
            const outBuf = Buffer.from(data.data_base64, "base64");
            const isImg = data.mimetype.startsWith("image/");
            let outName = args.outputFilename || "";
            if (!outName) {
              const baseName = resolvedFiles[0].filename.replace(/\.[^.]+$/, "");
              if (action === "merge") outName = `${baseName}_merged.pdf`;
              else if (action === "split") outName = `${baseName}_split.pdf`;
              else if (action === "render_image") outName = `${baseName}_hal${data.page_rendered || 1}.${data.mimetype === "image/jpeg" ? "jpg" : "png"}`;
              else if (action === "images_to_pdf") outName = `${baseName}_compiled.pdf`;
              else if (action === "compress") outName = `${baseName}_compressed.pdf`;
              else outName = `${baseName}_processed.pdf`;
            }

            const category = isImg ? "media" : "documents";
            const dir = path.join("vault", category);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            const savedPath = path.join(dir, `${Date.now()}_${outName}`);
            fs.writeFileSync(savedPath, outBuf);

            const fileId = store.saveVaultFile({
              ownerId: chatId,
              filename: outName,
              category,
              filepath: savedPath,
              mimetype: data.mimetype,
              filesize: outBuf.length,
              summary: data.message || `File ${action} dari ${resolvedFiles.map((f) => f.filename).join(", ")}`
            });

            // Kirim langsung ke WhatsApp jika sendDirectly true atau untuk render_image
            const shouldSend = args.sendDirectly !== undefined ? Boolean(args.sendDirectly) : (action === "render_image");
            if (shouldSend) {
              const caption = args.caption || data.message || `Hasil ${action} file`;
              if (isImg) {
                await sendFile(chatId, savedPath, outName, caption, false);
              } else {
                await sendFile(chatId, savedPath, outName, caption, true);
              }
            }

            toolResult = {
              success: true,
              action,
              fileId,
              filename: outName,
              category,
              message: data.message,
              stats: {
                pageCount: data.page_count,
                originalSize: data.original_size,
                compressedSize: data.compressed_size,
                savedPercent: data.saved_percent
              }
            };
          }
        } catch (err) {
          toolResult = { error: `Gagal menjalankan runner PDF: ${err.message}` };
        }
      }
    }
  } else if (name === "convertDocument") {
    const target = args.targetFile;
    if (!target) {
      toolResult = { error: "Parameter targetFile wajib diisi." };
    } else {
      const fileRec = store.resolveVaultFile(target, callerId);
      if (!fileRec) {
        toolResult = { error: `File '${target}' tidak ditemukan di Vault dokumen.` };
      } else if (!store.hasFileAccess(fileRec.id, callerId)) {
        toolResult = { error: `Anda tidak memiliki izin mengakses file ID #${fileRec.id} (${fileRec.filename}).` };
      } else if (!fs.existsSync(fileRec.filepath)) {
        toolResult = { error: `File fisik '${fileRec.filename}' tidak ditemukan di disk server.` };
      } else {
        const b = fs.readFileSync(fileRec.filepath);
        const runnerUrl = (process.env.PYTHON_RUNNER_URL || "http://localhost:8000/run").replace(/\/run$/, "/convert");
        try {
          const resp = await fetch(runnerUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              files: [{ filename: fileRec.filename, data_base64: b.toString("base64") }],
              target_format: args.targetFormat || "pdf"
            }),
            signal: AbortSignal.timeout(30000)
          });
          if (!resp.ok) {
            throw new Error(`Runner convert error (${resp.status}): ${await resp.text()}`);
          }
          const data = await resp.json();
          if (data.status !== "success") {
            toolResult = { error: data.error || "Gagal mengonversi dokumen." };
          } else {
            let outName = args.outputFilename || data.filename || `converted_${fileRec.filename}.pdf`;
            const isPdf = data.mimetype === "application/pdf";
            const category = "documents";
            const dir = path.join("vault", category);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            const savedPath = path.join(dir, `${Date.now()}_${outName}`);
            const outBuf = Buffer.from(data.data_base64, "base64");
            fs.writeFileSync(savedPath, outBuf);

            const fileId = store.saveVaultFile({
              ownerId: chatId,
              filename: outName,
              category,
              filepath: savedPath,
              mimetype: data.mimetype,
              filesize: outBuf.length,
              summary: data.text ? data.text.slice(0, 300) : `Hasil konversi dari ${fileRec.filename}`
            });

            if (args.sendDirectly) {
              const caption = args.caption || data.message || `Hasil konversi dokumen ${outName}`;
              await sendFile(chatId, savedPath, outName, caption, isPdf);
            }

            toolResult = {
              success: true,
              fileId,
              filename: outName,
              engine: data.engine,
              extractedText: (data.text || "").slice(0, 5000),
              message: data.message
            };
          }
        } catch (err) {
          toolResult = { error: `Gagal menjalankan konversi dokumen: ${err.message}` };
        }
      }
    }
  } else if (name === "ocrDocument") {
    const target = args.targetFile;
    if (!target) {
      toolResult = { error: "Parameter targetFile wajib diisi." };
    } else {
      const fileRec = store.resolveVaultFile(target, callerId);
      if (!fileRec) {
        toolResult = { error: `File '${target}' tidak ditemukan di Vault dokumen.` };
      } else if (!store.hasFileAccess(fileRec.id, callerId)) {
        toolResult = { error: `Anda tidak memiliki izin mengakses file ID #${fileRec.id} (${fileRec.filename}).` };
      } else if (!fs.existsSync(fileRec.filepath)) {
        toolResult = { error: `File fisik '${fileRec.filename}' tidak ditemukan di disk server.` };
      } else {
        const b = fs.readFileSync(fileRec.filepath);
        const runnerUrl = (process.env.PYTHON_RUNNER_URL || "http://localhost:8000/run").replace(/\/run$/, "/ocr");
        try {
          const resp = await fetch(runnerUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              files: [{ filename: fileRec.filename, data_base64: b.toString("base64") }],
              lang: args.lang || "ind+eng"
            }),
            signal: AbortSignal.timeout(30000)
          });
          if (!resp.ok) {
            throw new Error(`Runner OCR error (${resp.status}): ${await resp.text()}`);
          }
          const data = await resp.json();
          if (data.status !== "success") {
            toolResult = { error: data.error || "Gagal OCR dokumen." };
          } else {
            toolResult = {
              success: true,
              filename: fileRec.filename,
              ocrEngine: data.ocr_engine,
              pageCount: data.page_count,
              text: data.text,
              message: data.message
            };
          }
        } catch (err) {
          toolResult = { error: `Gagal menjalankan runner OCR: ${err.message}` };
        }
      }
    }
  } else if (name === "saveNote") {
    const saved = store.saveNote(callerId, args.key, args.content);
    const cleanKey = String(args.key || "").trim().toLowerCase();
    if (cleanKey === "preferensi_komunikasi" || cleanKey === "preferensi_tone" || cleanKey === "tone" || cleanKey === "gaya_bicara") {
      store.saveNote(chatId, args.key, args.content);
      const callerNorm = normalizePhone(callerId);
      if (callerNorm) store.saveNote(callerNorm, args.key, args.content);
    }
    toolResult = {
      success: true,
      key: saved.key,
      content: saved.content,
      message: `Catatan '${saved.key}' berhasil disimpan.`
    };
  } else if (name === "appendNote") {
    const note = store.appendNote(chatId, args.key, args.addition);
    toolResult = {
      success: true,
      key: note.key,
      content: note.content,
      message: `Poin baru berhasil ditambahkan ke catatan '${note.key}'.`
    };
  } else if (name === "getNote") {
    const note = store.getNote(chatId, args.key);
    if (!note) {
      toolResult = { error: `Catatan dengan kata kunci '${args.key}' tidak ditemukan.` };
    } else {
      toolResult = {
        success: true,
        key: note.key,
        content: note.content,
        updatedAt: note.updated_at
      };
    }
  } else if (name === "listNotes") {
    const notes = store.listNotes(chatId);
    formattedList = formatNotesList(notes);
    toolResult = { count: notes.length, notes, formatted: formattedList };
  } else if (name === "deleteNote") {
    const changes = store.deleteNote(chatId, args.key);
    toolResult = {
      success: changes > 0,
      key: args.key,
      message: changes > 0 ? `Catatan '${args.key}' berhasil dihapus.` : `Catatan '${args.key}' tidak ditemukan.`
    };
  } else if (name === "proposeSkill") {
    try {
      const res = proposeSkill(args.name, args.description, args.content, { requestedBy: senderNumber || chatId });
      toolResult = {
        success: true,
        name: res.name,
        proposalPath: res.proposalPath,
        message: `Proposal skill '${res.name}' berhasil dibuat dan menunggu persetujuan.`
      };
    } catch (err) {
      toolResult = { error: err.message };
    }
  } else if (name === "approveSkill") {
    const res = approveSkillProposal(args.name, { store });
    if (res.status !== "success") {
      toolResult = { error: res.error || "Gagal menyetujui proposal skill." };
    } else {
      toolResult = {
        success: true,
        skill: res.skill,
        version: res.version,
        message: `Proposal skill '${res.skill}' berhasil disetujui sebagai v${res.version}.`
      };
    }
  } else if (name === "rejectSkill") {
    const res = rejectSkillProposal(args.name, { reason: args.reason || "" });
    if (res.status !== "success") {
      toolResult = { error: res.error || "Gagal menolak proposal skill." };
    } else {
      toolResult = {
        success: true,
        proposal: res.proposal,
        message: `Proposal skill '${args.name}' berhasil ditolak.`
      };
    }
  } else if (name === "listSkillVersions") {
    const res = listSkillVersions(args.name);
    if (res.status !== "success") {
      toolResult = { error: res.error || `Tidak ada riwayat versi untuk '${args.name}'.` };
    } else {
      toolResult = res;
    }
  } else if (name === "rollbackSkill") {
    const res = rollbackSkill(args.name, { toVersion: args.toVersion || null, store, rolledBackBy: senderNumber || chatId });
    if (res.status !== "success") {
      toolResult = { error: res.error || `Gagal me-rollback skill '${args.name}'.` };
    } else {
      toolResult = {
        success: true,
        skill: res.skill,
        activeVersion: res.active_version,
        message: res.message
      };
    }
  } else if (name === "addPerson") {
    try {
      const p = store.addPerson({
        name: args.name,
        phone: args.phone || "",
        role: args.role || "",
        notes: args.notes || "",
        relationship: args.relationship || ""
      });
      toolResult = {
        success: true,
        person: p,
        message: `Kontak '${p.name}' berhasil disimpan ke direktori koordinasi pasangan.`
      };
    } catch (err) {
      toolResult = { error: err.message };
    }
  } else if (name === "getPerson") {
    const p = store.getPerson(args.name);
    if (!p) {
      toolResult = { error: `Kontak '${args.name}' belum ada di direktori.` };
    } else {
      toolResult = { success: true, person: p };
    }
  } else if (name === "listPersons") {
    const list = store.listPersons();
    formattedList = formatPersonList(list);
    toolResult = { count: list.length, persons: list, formatted: formattedList };
  } else if (name === "deletePerson") {
    const changes = store.deletePerson(args.name);
    toolResult = {
      success: changes > 0,
      name: args.name,
      message: changes > 0 ? `Kontak '${args.name}' berhasil dihapus dari direktori.` : `Kontak '${args.name}' tidak ditemukan.`
    };
  } else if (name === "checkServerHealth") {
    if (!isOwner(chatId, senderNumber)) {
      toolResult = { error: `Fitur checkServerHealth hanya khusus untuk nomor owner (+${OWNER_PHONE}).` };
    } else {
      const report = formatServerHealth(store);
      formattedList = report;
      toolResult = { success: true, formatted: report };
    }
  } else if (name === "checkMinecraftServer") {
    if (!isOwner(chatId, senderNumber)) {
      toolResult = { error: `Fitur checkMinecraftServer hanya khusus untuk nomor owner (+${OWNER_PHONE}).` };
    } else {
      const status = await getMinecraftStatus();
      const formatted = formatMinecraftStatus(status);
      formattedList = formatted;
      toolResult = { success: true, status, formatted };
    }
  } else if (name === "sendDirectMessage") {
    const rawTarget = String(args.recipient || "").trim();
    const rawMsg = String(args.message || "").trim();
    if (!rawTarget || !rawMsg) {
      toolResult = { error: "Penerima (recipient) dan isi pesan (message) wajib diisi." };
      return { toolResult, formattedList };
    }

    const res = resolveWhitelistRecipient(rawTarget, store);
    if (!res) {
      toolResult = { error: `Kontak atau nomor '${rawTarget}' tidak valid.` };
      return { toolResult, formattedList };
    }
    if (res.error) {
      toolResult = { error: res.error };
      return { toolResult, formattedList };
    }

    const senderDisplay = formatSenderDisplay(senderNumber || chatId, "", store);
    const outboundText = `📩 *[Pesan dari ${senderDisplay}]*\n\n${rawMsg}`;
    try {
      await sendText(`${res.targetPhone}@c.us`, outboundText);
    } catch (err) {
      if (err.cause?.code === "ECONNREFUSED" || err.message?.includes("ECONNREFUSED")) {
        console.warn(`[WAHA] Offline dev/test mode - message not dispatched: ${err.message}`);
      } else {
        toolResult = { error: `Gagal mengirimkan pesan ke WhatsApp: ${err.message}` };
        return { toolResult, formattedList };
      }
    }

    toolResult = {
      success: true,
      recipient: res.recipientDisplayName,
      phone: `+${res.targetPhone}`,
      message: `Pesan berhasil dikirimkan ke ${res.recipientDisplayName} (+${res.targetPhone}) via chat pribadi (PC).`
    };
  } else {
    toolResult = { error: "Unknown function" };
  }

  return { toolResult, formattedList };
}
