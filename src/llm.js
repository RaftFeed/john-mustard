import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { formatTodoList, formatBacklogList, formatFeatureRequestsList, formatSkillList, formatNotesList, formatRemindersList, formatPersonList, normalizePhone, OWNER_PHONE, isOwner, DEFAULT_CONTACT_PROFILES } from "./db.js";
import { sendFile, sendText, getWhitelistPhones, resolveWhitelistRecipient, formatSenderDisplay } from "./waha.js";
import { scheduleNearHorizonReminder } from "./scheduler.js";
import { getMinecraftStatus, formatMinecraftStatus } from "./minecraft.js";
import { formatServerHealth } from "./commands.js";
import {
  proposeSkill,
  approveSkillProposal,
  rejectSkillProposal,
  listSkillProposals,
  listSkillVersions,
  rollbackSkill
} from "./skills_sync.js";

export const TOOLS = [
  {
    functionDeclarations: [
      {
        name: "addTodo",
        description: "Tambahkan tugas ke To-Do List dengan deadline, tag matkul/kategori, dan penanggung jawab",
        parameters: {
          type: "OBJECT",
          properties: {
            task: { type: "STRING", description: "Judul tugas, contoh: LKP 6 Analisis Algoritme" },
            deadlineIso: { type: "STRING", description: "Deadline dalam format ISO 8601 (contoh: 2026-09-27T23:59:00+07:00)" },
            tag: { type: "STRING", description: "Tag atau kode mata kuliah, contoh: #analgor [P2]" },
            category: { type: "STRING", description: "Kategori tugas opsional: work (default) atau routine (absen/kuliah)" },
            assignee: { type: "STRING", description: "Nama orang yang ditugaskan (contoh: Gilang, Bunga, atau anggota keluarga/tim)" }
          },
          required: ["task"]
        }
      },
      {
        name: "listTodos",
        description: "Tampilkan daftar tugas / to-do list aktif beserta countdown deadline",
        parameters: {
          type: "OBJECT",
          properties: {
            includeRoutine: { type: "BOOLEAN", description: "Set true untuk menyertakan tugas rutin/kuliah/absen (default false)" },
            assignee: { type: "STRING", description: "Filter to-do list berdasarkan orang yang ditugaskan (opsional)" }
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
        description: "Ubah atau koreksi judul tugas, deadline, atau tag di To-Do List",
        parameters: {
          type: "OBJECT",
          properties: {
            todoId: { type: "NUMBER", description: "ID tugas yang mau diubah (opsional jika taskQuery diisi)" },
            taskQuery: { type: "STRING", description: "Kata kunci nama tugas jika ID tidak disebutkan" },
            newTask: { type: "STRING", description: "Judul tugas baru" },
            deadlineIso: { type: "STRING", description: "Deadline baru dalam format ISO 8601 (contoh: 2026-09-25T09:30:00+07:00)" },
            tag: { type: "STRING", description: "Tag baru mata kuliah atau kategori" },
            assignee: { type: "STRING", description: "Ganti nama penanggung jawab tugas" }
          }
        }
      },
      {
        name: "deleteTodo",
        description: "Hapus tugas dari To-Do List",
        parameters: {
          type: "OBJECT",
          properties: {
            todoId: { type: "NUMBER", description: "ID tugas yang mau dihapus" },
            taskQuery: { type: "STRING", description: "Kata kunci nama tugas jika ID tidak disebutkan" }
          }
        }
      },
      {
        name: "addReminder",
        description: "Buat pengingat/reminder yang akan otomatis diping ke WhatsApp",
        parameters: {
          type: "OBJECT",
          properties: {
            message: { type: "STRING", description: "Pesan pengingat" },
            remindAtIso: { type: "STRING", description: "Waktu pengingat dalam ISO 8601 (contoh: 2026-09-25T17:00:00+07:00)" },
            recurrence: { type: "STRING", description: "Perulangan pengingat opsional: daily, weekly, every_6h, 6h, 12h, dsb." },
            taskType: { type: "STRING", description: "Tipe tugas: reminder (default) atau scheduled_action" }
          },
          required: ["message", "remindAtIso"]
        }
      },
      {
        name: "listReminders",
        description: "Lihat daftar semua pengingat/reminder aktif yang belum terkirim",
        parameters: {
          type: "OBJECT",
          properties: {}
        }
      },
      {
        name: "deleteReminder",
        description: "Hapus/batalkan pengingat/reminder berdasarkan ID reminder atau kata kunci pesan",
        parameters: {
          type: "OBJECT",
          properties: {
            reminderId: { type: "NUMBER", description: "ID reminder yang ingin dibatalkan/dihapus (opsional)" },
            query: { type: "STRING", description: "Pesan atau topik reminder yang ingin dicari untuk dihapus (opsional)" }
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
        description: "Kirim pesan teks pribadi (PC / DM / japri) atau tautan/link secara langsung ke nomor WhatsApp pengguna yang terdaftar di whitelist. Gunakan saat pengguna minta tolong PC/japri/DM/kirim link/pesan ke orang lain di whitelist (misal: 'tolong pc rafli link video tadi', 'japri karimah tolong beli beras', 'pc razita ndut ingetin pr'). Target penerima WAJIB terdaftar di whitelist bot.",
        parameters: {
          type: "OBJECT",
          properties: {
            recipient: {
              type: "STRING",
              description: "Nama kontak tujuan (misal: 'Karimah', 'Mami', 'Papi', 'Razita Ndut', 'Rafid') atau nomor telepon tujuan (format 628... / +628...)."
            },
            message: {
              type: "STRING",
              description: "Isi pesan lengkap, catatan, atau tautan/link yang ingin dikirimkan langsung ke nomor tujuan via chat pribadi (PC)."
            }
          },
          required: ["recipient", "message"]
        }
      }
    ]
  }
];

const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-flash-lite-latest";
const PRO_MODEL = process.env.GEMINI_PRO_MODEL || "gemini-3.5-flash-lite";

export const FAST_CASCADE = [
  DEFAULT_MODEL,
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-flash-latest"
];

export const SMART_CASCADE = [
  "gemini-3.5-flash-lite",
  DEFAULT_MODEL,
  "gemini-flash-latest"
];

export const DEFAULT_CASCADE = FAST_CASCADE;

export function selectModelCascade(text = "", options = {}) {
  const t = String(text || "").trim();
  // 1. Explicit override
  if (/(?:^|\s)[#!]pro\b|\b(?:mode\s+pro|pake\s+pro)\b/i.test(t)) {
    return SMART_CASCADE;
  }
  // 2. Heavy coding, scripting, regex, algorithms
  const isCodeOrLogic = /\b(koding|coding|script|skrip|python|javascript|golang|rust|regex|algoritma|debug|debugging|bikin\s+program|buatkan\s+program|refactor)\b/i.test(t);
  if (isCodeOrLogic) {
    return SMART_CASCADE;
  }
  // 3. Deep analysis & complex math
  const isDeepAnalysis = /\b(analisis\s+(mendalam|data|komparasi)|bandingkan\s+secara\s+detail|kalkulasi\s+rumit|probabilitas|persamaan\s+diferensial|integral|bedah\s+dokumen|analisis\s+jurnal)\b/i.test(t);
  if (isDeepAnalysis) {
    return SMART_CASCADE;
  }
  return FAST_CASCADE;
}

const modelCooldowns = new Map(); // model -> timestamp

// ponytail: demote overloaded/failed models for 120s instead of re-probing every ReAct step
export function markModelUnavailable(model, cooldownMs = 120_000) {
  modelCooldowns.set(model, Date.now() + cooldownMs);
}

export function clearModelCooldowns() {
  modelCooldowns.clear();
}

export function getActiveModels(baseModels = DEFAULT_CASCADE) {
  const models = process.env.GEMINI_MODELS
    ? process.env.GEMINI_MODELS.split(",").map((m) => m.trim()).filter(Boolean)
    : baseModels;
  const now = Date.now();
  const healthy = [];
  const cooling = [];

  for (const m of models) {
    const until = modelCooldowns.get(m) || 0;
    if (until <= now) {
      healthy.push(m);
    } else {
      cooling.push(m);
    }
  }
  return [...healthy, ...cooling];
}

export function isSafeUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false;
    if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host)) return false;
    const m172 = host.match(/^172\.(\d+)\./);
    if (m172) {
      const second = parseInt(m172[1], 10);
      if (second >= 16 && second <= 31) return false;
    }
    if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) return false;
    return true;
  } catch {
    return false;
  }
}

// ponytail: native regex table & csv parser for google sheets pubhtml & docs export, zero npm deps
export function formatRowsToMarkdown(rows, { maxRows = 100 } = {}) {
  if (!rows || rows.length === 0) return "[Tabel spreadsheet kosong]";

  // Filter baris nomor urut indeks (misal 1, 2, 3...) di kolom pertama
  const filtered = [];
  for (const r of rows) {
    if (r && /^\d+$/.test(r[0]) && r.length > 1) {
      filtered.push(r.slice(1));
    } else {
      filtered.push(r);
    }
  }

  if (filtered.length === 0) return "[Tabel spreadsheet kosong]";

  const header = filtered[0];
  const dataRows = filtered.slice(1);
  const displayed = dataRows.slice(0, maxRows);

  // Jika tabel sangat lebar (> 10 kolom), render format key-value list rapi
  if (header.length > 10) {
    const lines = [`> *Tabel Data Spreadsheet* (Total ${dataRows.length} baris)`];
    displayed.forEach((r, idx) => {
      lines.push(`\n--- Baris ${idx + 1} ---`);
      header.forEach((colName, cIdx) => {
        const val = r[cIdx] ? r[cIdx].trim() : "";
        if (val) lines.push(`• *${colName.trim()}*: ${val}`);
      });
    });
    if (dataRows.length > maxRows) {
      lines.push(`\n_... (Dipotong ${dataRows.length - maxRows} baris tambahan karena batasan panjang)_`);
    }
    return lines.join("\n");
  }

  // Standard Markdown pipe table
  const cleanHeader = header.map((h, i) => h.replace(/[\r\n|]+/g, " ").trim() || `Kolom_${i + 1}`);
  const lines = [];
  lines.push("| " + cleanHeader.join(" | ") + " |");
  lines.push("| " + cleanHeader.map(() => "---").join(" | ") + " |");

  for (const r of displayed) {
    const padded = cleanHeader.map((_, i) => (r[i] ? r[i].replace(/[\r\n|]+/g, " ").trim() : ""));
    lines.push("| " + padded.join(" | ") + " |");
  }

  if (dataRows.length > maxRows) {
    lines.push(`\n_Menampilkan ${maxRows} dari total ${dataRows.length} baris data._`);
  }

  return lines.join("\n");
}

export function parseHtmlTableToMarkdown(htmlText, { maxRows = 100 } = {}) {
  const trMatches = [...htmlText.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  if (trMatches.length === 0) return null;

  const rows = [];
  for (const tr of trMatches) {
    const rowHtml = tr[1];
    const cellMatches = [...rowHtml.matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)];
    const row = cellMatches.map((c) => {
      return c[1]
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/[\r\n\t]+/g, " ")
        .replace(/[ \t]+/g, " ")
        .trim();
    });
    while (row.length > 0 && !row[row.length - 1]) {
      row.pop();
    }
    if (row.length > 0 && row.some(Boolean)) {
      rows.push(row);
    }
  }

  if (rows.length === 0) return null;
  return formatRowsToMarkdown(rows, { maxRows });
}

export function parseCsvToMarkdown(csvText, { maxRows = 100 } = {}) {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return null;

  const rows = lines.map((line) => {
    const cells = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        cells.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    cells.push(current.trim());
    return cells;
  });

  return formatRowsToMarkdown(rows, { maxRows });
}

export async function fetchUrlContent(rawUrl) {
  if (!isSafeUrl(rawUrl)) {
    throw new Error("URL tidak aman atau mengarah ke alamat lokal/privat (SSRF Protection).");
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw new Error("Format URL tidak valid.");
  }

  const href = parsedUrl.href;
  const path = parsedUrl.pathname;
  const gid = parsedUrl.searchParams.get("gid") || (parsedUrl.hash.match(/gid=(\d+)/)?.[1]);

  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "*/*"
  };

  // 1. Published Google Sheets (/spreadsheets/d/e/.../pubhtml or /pub)
  if (href.includes("/spreadsheets/") && (path.includes("/d/e/") || href.includes("/pubhtml") || href.includes("/pub"))) {
    const pubMatch = href.match(/\/spreadsheets\/(?:u\/\d+\/)?d\/e\/([a-zA-Z0-9_-]+)/);
    const pubId = pubMatch ? pubMatch[1] : null;

    if (pubId) {
      const indexUrl = `https://docs.google.com/spreadsheets/d/e/${pubId}/pubhtml`;
      const res = await fetch(indexUrl, { headers, signal: AbortSignal.timeout(12000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}: Gagal memuat Google Sheet publik.`);
      const indexHtml = await res.text();

      if (res.url.includes("accounts.google.com/ServiceLogin") || indexHtml.includes("ServiceLogin")) {
        throw new Error("Dokumen Google Sheet ini masih berstatus privat. Tolong ubah akses sharing menjadi 'Siapa saja yang memiliki link' (Viewer).");
      }

      // Check for multi-tab Javascript metadata
      const tabMatches = [...indexHtml.matchAll(/\{\s*name:\s*"([^"]+)"[^}]*pageUrl:\s*"([^"]+)"/g)];
      const sections = [];

      if (tabMatches.length > 0) {
        for (const match of tabMatches) {
          const tabName = match[1].replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
          let pageUrl = match[2].replace(/\\\//g, "/").replace(/\\x3d/g, "=").replace(/\\x26/g, "&");

          if (gid && !pageUrl.includes(`gid=${gid}`) && tabMatches.length > 1) {
            continue;
          }

          try {
            const tabRes = await fetch(pageUrl, { headers, signal: AbortSignal.timeout(10000) });
            if (tabRes.ok) {
              const tabHtml = await tabRes.text();
              const md = parseHtmlTableToMarkdown(tabHtml);
              if (md) {
                sections.push(`### Sheet: ${tabName}\n\n${md}`);
              }
            }
          } catch {}
        }
      }

      // Fallback single sheet table
      if (sections.length === 0) {
        const directUrl = gid
          ? `https://docs.google.com/spreadsheets/d/e/${pubId}/pubhtml/sheet?headers=false&gid=${gid}`
          : `https://docs.google.com/spreadsheets/d/e/${pubId}/pubhtml/sheet?headers=false`;
        try {
          const sheetRes = await fetch(directUrl, { headers, signal: AbortSignal.timeout(10000) });
          if (sheetRes.ok) {
            const sheetHtml = await sheetRes.text();
            const md = parseHtmlTableToMarkdown(sheetHtml);
            if (md) sections.push(md);
          }
        } catch {}
      }

      if (sections.length > 0) {
        return sections.join("\n\n").slice(0, 15000);
      }
    }
  }

  // 2. Standard Google Sheets (/spreadsheets/d/{docId})
  if (href.includes("/spreadsheets/d/") && !path.includes("/d/e/")) {
    const docMatch = href.match(/\/spreadsheets\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]+)/);
    const docId = docMatch ? docMatch[1] : null;
    if (docId) {
      const gidParam = gid ? `&gid=${gid}` : "";
      const csvUrl = `https://docs.google.com/spreadsheets/d/${docId}/export?format=csv${gidParam}`;
      const res = await fetch(csvUrl, { headers, signal: AbortSignal.timeout(12000) });

      if (res.url.includes("accounts.google.com/ServiceLogin")) {
        throw new Error("Dokumen Google Sheet ini masih berstatus privat. Tolong ubah akses sharing menjadi 'Siapa saja yang memiliki link' (Viewer).");
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}: Gagal memuat Google Sheet.`);
      const csvText = await res.text();
      if (csvText.includes("<!DOCTYPE html>") || csvText.includes("<html")) {
        throw new Error("Dokumen Google Sheet tidak bisa diakses publik (perlu izin akses).");
      }
      const md = parseCsvToMarkdown(csvText);
      return (md || csvText).slice(0, 15000);
    }
  }

  // 3. Google Docs (/document/d/{docId})
  if (href.includes("/document/d/")) {
    const docMatch = href.match(/\/document\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]+)/);
    const docId = docMatch ? docMatch[1] : null;
    if (docId) {
      const txtUrl = `https://docs.google.com/document/d/${docId}/export?format=txt`;
      const res = await fetch(txtUrl, { headers, signal: AbortSignal.timeout(12000) });
      if (res.url.includes("accounts.google.com/ServiceLogin")) {
        throw new Error("Google Doc ini masih berstatus privat. Tolong ubah akses sharing menjadi 'Siapa saja yang memiliki link' (Viewer).");
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}: Gagal memuat Google Doc.`);
      const txt = await res.text();
      return txt.slice(0, 15000);
    }
  }

  // 4. Google Slides (/presentation/d/{docId})
  if (href.includes("/presentation/d/")) {
    const docMatch = href.match(/\/presentation\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]+)/);
    const docId = docMatch ? docMatch[1] : null;
    if (docId) {
      const pdfUrl = `https://docs.google.com/presentation/d/${docId}/export/pdf`;
      const res = await fetch(pdfUrl, { headers, signal: AbortSignal.timeout(15000) });
      if (res.url.includes("accounts.google.com/ServiceLogin")) {
        throw new Error("Google Slide ini masih berstatus privat. Tolong ubah akses sharing menjadi 'Siapa saja yang memiliki link' (Viewer).");
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}: Gagal memuat Google Slide.`);
      const pdfBuf = Buffer.from(await res.arrayBuffer());
      const runnerUrl = (process.env.PYTHON_RUNNER_URL || "http://localhost:8000/run").replace(/\/run$/, "/pdf");
      try {
        const pyRes = await fetch(runnerUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "extract_text",
            files: [{ data_base64: pdfBuf.toString("base64") }]
          }),
          signal: AbortSignal.timeout(15000)
        });
        if (pyRes.ok) {
          const pyData = await pyRes.json();
          if (pyData.status === "success" && pyData.text) {
            return `### Google Slides Presentation (${pyData.page_count} Slides)\n\n${pyData.text}`.slice(0, 15000);
          }
        }
      } catch {}
      return `[Berhasil mengunduh Google Slide (${pdfBuf.length} bytes), namun ekstraksi teks gagal.]`;
    }
  }

  // 5. Google Drive Files (/file/d/{fileId} or ?id={fileId})
  if (href.includes("drive.google.com") && (href.includes("/file/d/") || href.includes("id="))) {
    const fileMatch = href.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || href.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    const fileId = fileMatch ? fileMatch[1] : null;
    if (fileId) {
      const dlUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
      const res = await fetch(dlUrl, { headers, redirect: "follow", signal: AbortSignal.timeout(20000) });
      if (res.url.includes("accounts.google.com/ServiceLogin")) {
        throw new Error("File Google Drive ini masih berstatus privat. Tolong ubah akses sharing menjadi 'Siapa saja yang memiliki link' (Viewer).");
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}: Gagal mengunduh file Google Drive.`);
      const cType = res.headers.get("content-type") || "";
      if (cType.includes("pdf")) {
        const pdfBuf = Buffer.from(await res.arrayBuffer());
        const runnerUrl = (process.env.PYTHON_RUNNER_URL || "http://localhost:8000/run").replace(/\/run$/, "/pdf");
        try {
          const pyRes = await fetch(runnerUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "extract_text",
              files: [{ data_base64: pdfBuf.toString("base64") }]
            }),
            signal: AbortSignal.timeout(15000)
          });
          if (pyRes.ok) {
            const pyData = await pyRes.json();
            if (pyData.status === "success" && pyData.text) {
              return `### Dokumen PDF Google Drive (${pyData.page_count} Halaman)\n\n${pyData.text}`.slice(0, 15000);
            }
          }
        } catch {}
      } else {
        const text = await res.text();
        if (text.includes("<table") && text.includes("<tr")) {
          const tableMd = parseHtmlTableToMarkdown(text);
          if (tableMd) return tableMd.slice(0, 15000);
        }
        return text.slice(0, 15000);
      }
    }
  }

  // 6. Generic Web Page Scraper
  const res = await fetch(rawUrl, {
    headers,
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: Gagal memuat halaman web.`);
  const html = await res.text();

  if (html.includes("<table") && html.includes("<tr")) {
    const tableMd = parseHtmlTableToMarkdown(html);
    if (tableMd && tableMd.length > 50) {
      return tableMd.slice(0, 12000);
    }
  }

  const clean = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, "\n### $1\n")
    .replace(/<p[^>]*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
  return clean.slice(0, 8000);
}

const MUTATION_TOOLS = new Set([
  "addTodo", "completeTodo", "updateTodo", "deleteTodo", "undoLastTodo",
  "addReminder", "deleteReminder", "setDailyDigest", "grantFileAccess", "addBacklog", "completeBacklog",
  "submitFeatureRequest",
  "saveSkill", "deleteSkill", "updateSkill", "saveNote", "appendNote", "deleteNote",
  "processPdf", "mergePdf", "splitPdf", "compressPdf", "convertDocument",
  "proposeSkill", "approveSkill", "rejectSkill", "rollbackSkill",
  "addPerson", "deletePerson"
]);

export function detectUnexecutedMutationClaim(text = "", toolsCalled = []) {
  if (!text) return false;
  const hasMutationTool = toolsCalled.some((t) => MUTATION_TOOLS.has(t));
  if (hasMutationTool) return false;
  const claimRegex = /(sudah|berhasil|telah)\s+(di|ku|saya|telah|berhasil)?\s*(tambah|catat|buat|bikin|jadwal|ubah|ganti|koreksi|update|hapus|delete|selesai|simpan|kristalisasi|gabung|kompres)/i;
  return claimRegex.test(text);
}

const SUPERSCRIPTS = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "n": "ⁿ", "k": "ᵏ", "x": "ˣ", "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾"
};
const SUBSCRIPTS = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "a": "ₐ", "e": "ₑ", "i": "ᵢ", "j": "ⱼ", "k": "ₖ", "m": "ₘ", "n": "ₙ", "o": "ₒ", "p": "ₚ", "r": "ᵣ",
  "s": "ₛ", "t": "ₜ", "u": "ᵤ", "v": "ᵥ", "x": "ₓ"
};

export function isNoFluffRequest(text = "") {
  if (!text) return false;
  const clean = text.toLowerCase();
  return (
    clean.includes("no fluff") ||
    clean.includes("tanpa basa-basi") ||
    clean.includes("tanpa basa basi") ||
    clean.includes("gausah tool call") ||
    clean.includes("gausah footnote") ||
    clean.includes("biar bisa di copy") ||
    clean.includes("biar gampang di copy") ||
    clean.includes("buat di-copy")
  );
}

export function stripHallucinatedToolChips(text = "") {
  if (!text) return "";
  return text.replace(/\n*\s*[_*~`]*↳\s*[`\w\s,_]+[_*~`]*\s*$/g, "").trim();
}

export function sanitizeLatexForWhatsApp(text = "") {
  if (!text || !text.includes("$")) return text;

  const replaceMath = (_, expr) => {
    let clean = expr.trim();
    clean = clean.replace(/\\log_2/g, "log₂").replace(/\\log/g, "log").replace(/\\ln/g, "ln");
    clean = clean.replace(/\\cdot/g, "·").replace(/\\times/g, "×").replace(/\\approx/g, "≈");
    clean = clean.replace(/\\leq/g, "≤").replace(/\\geq/g, "≥").replace(/\\neq/g, "≠");
    clean = clean.replace(/\\sqrt/g, "√").replace(/\\pm/g, "±").replace(/\\infty/g, "∞");
    clean = clean.replace(/\\sum/g, "Σ").replace(/\\prod/g, "Π").replace(/\\int/g, "∫");
    clean = clean.replace(/\\theta/g, "θ").replace(/\\lambda/g, "λ").replace(/\\pi/g, "π");
    clean = clean.replace(/\\alpha/g, "α").replace(/\\beta/g, "β").replace(/\\gamma/g, "γ");
    clean = clean.replace(/\\Omega/g, "Ω").replace(/\\Theta/g, "Θ").replace(/\\mathcal\{O\}/g, "O");

    // Superscripts
    clean = clean.replace(/\^\{([^}]+)\}|\^([0-9a-zA-Z+\-]+)/g, (_, p1, p2) => {
      const val = p1 || p2;
      return [...val].map((c) => SUPERSCRIPTS[c] || c).join("");
    });

    // Subscripts
    clean = clean.replace(/_\{([^}]+)\}|_([0-9a-zA-Z])/g, (_, p1, p2) => {
      const val = p1 || p2;
      return [...val].map((c) => SUBSCRIPTS[c] || c).join("");
    });

    // Strip remaining lone braces and backslashes
    clean = clean.replace(/[{}]/g, "").replace(/\\/g, "");
    return clean;
  };

  return text
    .replace(/\$\$([^$]+)\$\$/g, replaceMath)
    .replace(/\$([^$]+)\$/g, replaceMath);
}

export function formatForWhatsApp(text = "") {
  if (!text) return "";

  // 1. Preserve code blocks and inline code
  const codeBlocks = [];
  let s = text.replace(/```[\s\S]*?```|`[^`\n]+`/g, (match) => {
    const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`;
    codeBlocks.push(match);
    return placeholder;
  });

  // 2. Convert markdown headers (### Header -> *Header*)
  s = s.replace(/^[ \t]*#{1,6}[ \t]+(.*)$/gm, "*$1*");

  // 3. Convert markdown bold (**text** or __text__ -> *text*)
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "*$1*");
  s = s.replace(/__([^_\n]+)__/g, "*$1*");

  // 4. Convert markdown links: [Title](url) -> Title (url)
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1 ($2)");

  // 5. Convert bullet points (* item, - item, + item -> • item)
  s = s.replace(/^[ \t]*[-*+][ \t]+/gm, "• ");

  // 6. Convert blockquotes (> quote -> _quote_)
  s = s.replace(/^[ \t]*>[ \t]+(.*)$/gm, "_$1_");

  // 7. Restore code blocks
  s = s.replace(/__CODE_BLOCK_(\d+)__/g, (_, idx) => codeBlocks[Number(idx)]);

  return s;
}

export function isActionIntent(text = "") {
  if (!text) return false;
  return /\b(tambah|catat|buat|bikin|ingat|remind|jadwal|ubah|ganti|koreksi|update|hapus|delete|batal|cancel|selesai|done|mark|undo|simpan|brankas|cari|kirim|bagi|pc|japri|pm|dm|chat|minta\s+akses|beri\s+akses|backlog|lihat|cek|tampil|hitung|python|script|plot|grafik|skill|macro|kristal|pelajari|baca|url|link|web|artikel|note|catatan|memo|health|server|mc|menkrep|minecraft|mabar|spek|spesifikasi|uptime|ram|cpu|disk|load|pdf|gabung|merge|split|pisah|render|kompres|compress|convert|konversi|docx|excel|xlsx|ocr|scan|digest|proposal|propose|approve|reject|rollback|versi|version|kontak|contact|orang|person|pasangan|direktori)/i.test(text);
}

export function isGreetingIntent(text = "") {
  if (!text) return false;
  const t = text.trim().replace(/^@\S+\s*/, "").trim();
  return (
    /^(p+|halo+|helo+|hello+|hai+|hi+|hey+|hei+|woi+|woy+|oi+|oy+|we+|euy+|uy+|alo+|yo+|wasap+|wassup+|what'?s\s*up|sup|howdy|hola|tes+|test|assalam\w*|salam\w*|samlekom|mikum|shalom|sampurasun|punten|permisi|kula\s*nuwun|pagi|siang|sore|malam|morning|afternoon|evening|selamat\s+(pagi|siang|sore|malam|datang)|met\s+(pagi|siang|sore|malam)|mustard|john|bot)\b/i.test(t) ||
    /^(bro|bang|kak|om|mas|mbak|pak|bu)\s+(john|mustard|bot|halo|hai|hey|hei|p|pagi|siang|sore|malam|yo|wasap|wassup)\b/i.test(t) ||
    /(siapa\s+(kamu|lu|anda)|nama\s+(kamu|lu|anda)|kamu\s+siapa|lu\s+siapa|perkenal|kenalan|dew\s*dew|john\s+mustard)/i.test(t)
  );
}

// ponytail: direct fetch with two-model fallback, no heavy sdk
async function callGemini(rotator, model, payload) {
  return rotator.execute(async (key) => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(12000)
    });
    if (!res.ok) {
      const err = new Error(await res.text());
      err.status = res.status;
      throw err;
    }
    return res.json();
  });
}

export async function generateContent(rotator, payload, baseCascade = null) {
  const models = getActiveModels(baseCascade || DEFAULT_CASCADE);
  let lastErr = null;

  for (const model of models) {
    try {
      return await callGemini(rotator, model, payload);
    } catch (err) {
      lastErr = err;
      const msg = err.message || "";
      const is503 = err.status === 503 || msg.includes("503") || msg.includes("UNAVAILABLE");
      const isTimeout = msg.includes("timeout") || msg.includes("aborted");
      const is404 = err.status === 404 || msg.includes("404") || msg.includes("NOT_FOUND");

      if (is503 || isTimeout || is404) {
        markModelUnavailable(model, 120_000);
      }
      console.warn(`[LLM] Model ${model} gagal (${err.message}). Demoted 120s. Mencoba model berikutnya...`);
    }
  }

  if (payload.toolConfig?.functionCallingConfig?.mode === "ANY") {
    console.warn(`[LLM] Mode ANY gagal pada semua model. Mencoba fallback ke mode AUTO...`);
    const autoPayload = { ...payload, toolConfig: { functionCallingConfig: { mode: "AUTO" } } };
    const autoModels = getActiveModels(baseCascade || DEFAULT_CASCADE);
    for (const model of autoModels) {
      try {
        return await callGemini(rotator, model, autoPayload);
      } catch {}
    }
  }

  throw lastErr || new Error("Semua model AI gagal merespons.");
}

export async function getEmbedding(rotator, text) {
  if (!text || typeof text !== "string" || !text.trim() || !rotator) return null;
  return rotator.execute(async (key) => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${key}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "models/gemini-embedding-001",
        content: { parts: [{ text: text.trim().slice(0, 2048) }] }
      }),
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) throw new Error(`Embedding API error (${res.status}): ${await res.text()}`);
    const data = await res.json();
    return data.embedding?.values || null;
  });
}

export async function executeTool(name, args, { store, chatId, senderNumber = "", rotator = null }) {
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
    const id = store.addTodo(chatId, args.task, deadline, args.tag, args.category, args.assignee);
    toolResult = {
      success: true,
      id,
      task: args.task,
      category: args.category || "auto",
      assignee: args.assignee || null
    };
  } else if (name === "listTodos") {
    const todos = store.getTodos(chatId, Boolean(args.includeRoutine), args.assignee || null);
    formattedList = formatTodoList(todos);
    toolResult = { raw: todos, formatted: formattedList, count: todos.length, assignee: args.assignee || null };
  } else if (name === "getTodosDue") {
    const days = args.daysAhead !== undefined ? Number(args.daysAhead) : 0;
    const todos = store.getTodosDue(chatId, days);
    formattedList = formatTodoList(todos);
    toolResult = { count: todos.length, daysAhead: days, todos, formattedList };
  } else if (name === "completeTodo") {
    const changes = store.completeTodo(args.todoId, chatId);
    toolResult = { success: changes > 0, todoId: args.todoId };
  } else if (name === "undoLastTodo") {
    const undone = store.undoLastDone(chatId);
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
        assignee: args.assignee
      });
      toolResult = {
        success: changes > 0,
        todoId: targetId
      };
    }
  } else if (name === "deleteTodo") {
    let targetId = args.todoId;
    if (!targetId && args.taskQuery) {
      const found = store.findTodo(chatId, args.taskQuery);
      if (found) targetId = found.id;
    }
    if (!targetId) {
      toolResult = { error: "Tugas tidak ditemukan untuk dihapus." };
    } else {
      const changes = store.deleteTodo(targetId, chatId);
      toolResult = {
        success: changes > 0,
        deletedId: targetId
      };
    }
  } else if (name === "addReminder") {
    const timestamp = new Date(args.remindAtIso).getTime();
    if (isNaN(timestamp)) throw new Error("Format tanggal/jam ISO tidak valid");
    const id = store.addReminder(chatId, args.message, timestamp, args.recurrence || null, args.taskType || "reminder");
    scheduleNearHorizonReminder(store, {
      id,
      chat_id: chatId,
      message: args.message,
      remind_at: timestamp,
      recurrence: args.recurrence || null,
      task_type: args.taskType || "reminder"
    }, { rotator });
    toolResult = { success: true, id, message: args.message, remindAt: args.remindAtIso, recurrence: args.recurrence || null };
  } else if (name === "listReminders") {
    const reminders = store.listReminders(chatId);
    formattedList = formatRemindersList(reminders);
    toolResult = { success: true, count: reminders.length, reminders, formattedList };
  } else if (name === "deleteReminder") {
    const target = args.reminderId || args.query;
    if (!target) {
      toolResult = { error: "ID reminder atau teks query wajib diisi untuk menghapus pengingat." };
    } else {
      const changes = store.deleteReminder(chatId, target);
      const remaining = store.listReminders(chatId);
      formattedList = formatRemindersList(remaining);
      toolResult = { success: changes > 0, deletedCount: changes, formattedList };
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

// ponytail: inject mid-turn steering from user into active ReAct contents
export function injectMailboxSteering(mailbox, contents) {
  if (!mailbox || mailbox.length === 0) return false;
  const steered = mailbox.splice(0, mailbox.length);
  const texts = steered.map((m) => m.body).filter(Boolean);
  if (texts.length === 0) return false;

  const directive = `[UPDATE INSTRUKSI PENGGUNA SAAT INI]:\n${texts.join("\n")}\nSesuaikan sisa tindakan dengan instruksi terbaru ini.`;
  if (contents.length > 0 && contents[contents.length - 1].role === "user") {
    contents[contents.length - 1].parts.push({ text: directive });
  } else {
    contents.push({ role: "user", parts: [{ text: directive }] });
  }
  return true;
}

export async function processChat(rotator, userText, { store, chatId, senderNumber = "", onToolCall, onTrajectory = null, audio = null, media = null, mailbox = null, cascade = null } = {}) {
  const now = new Date();
  let basePrompt = "";
  const promptPaths = [path.resolve("config/system-prompt.md"), path.resolve("system-prompt.md")];
  for (const p of promptPaths) {
    if (fs.existsSync(p)) {
      try {
        basePrompt = fs.readFileSync(p, "utf-8");
        if (basePrompt) break;
      } catch {}
    }
  }
  if (!basePrompt) {
    basePrompt = `Kamu adalah John Mustard, asisten pribadi eksekutif berbasis WhatsApp.\nWaktu sekarang: {{CURRENT_TIME}}.`;
  }
  const timeStr = `${now.toISOString()} (${now.toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB)`;
  const systemPrompt = basePrompt.replace("{{CURRENT_TIME}}", timeStr);

  const customSkills = store?.getSkills ? store.getSkills() : [];
  const skillsContext = customSkills.length > 0
    ? `\n\nCUSTOM SKILLS TERDAFTAR (Panggil tool loadSkill untuk memuat SOP lengkap jika relevan):\n` +
      customSkills.map((s) => `- [${s.name}]: ${s.description}${s.prompt_template.length <= 150 ? ` -> Instruksi: ${s.prompt_template}` : ` (Gunakan tool loadSkill untuk membaca playbook lengkap)`}`).join("\n")
    : "";

  const contactsList = store?.listPersons ? store.listPersons() : [];
  const coupleContext = contactsList.length > 0
    ? `\n\nDIREKTORI KOORDINASI PASANGAN & KONTAK KELUARGA:\n` +
      contactsList.map((p) => `- ${p.name}${p.relationship ? ` (${p.relationship})` : ""}${p.role ? ` [${p.role}]` : ""}${p.notes ? `: ${p.notes}` : ""}`).join("\n")
    : "";

  const whitelistPhones = getWhitelistPhones();
  const whitelistContext = whitelistPhones.length > 0
    ? `\n\n[DAFTAR WHITELIST AKSES BOT]:
Bot ini dikonfigurasi dengan ${whitelistPhones.length} nomor WhatsApp yang memiliki izin akses (whitelist):
` +
      whitelistPhones.map((p, idx) => {
        let label = "";
        const matchedContact = contactsList.find((c) => normalizePhone(c.phone) === p);
        if (matchedContact) {
          label = ` (${matchedContact.name}${matchedContact.relationship ? ` - ${matchedContact.relationship}` : ""})`;
        } else if (p === normalizePhone(process.env.PRIMARY_USER_PHONE || process.env.OWNER_PHONE || "6285236467838")) {
          label = ` (${process.env.PRIMARY_USER_NAME || "Rafid"} - Master/Owner)`;
        } else if (p === normalizePhone(process.env.SECONDARY_USER_PHONE || "6289514718700")) {
          label = ` (${process.env.SECONDARY_USER_NAME || "Karimah"})`;
        }
        return `${idx + 1}. +${p}${label}`;
      }).join("\n") +
      `\nATURAN RESPON WHITELIST: Jika pengguna menanyakan siapa saja yang masuk whitelist atau siapa saja yang memiliki izin akses bot, sebutkan secara lengkap dan jelas ${whitelistPhones.length} nomor di atas (beserta nama/labelnya jika ada). JANGAN mengatakan hanya nomor master/owner yang di-whitelist.`
    : "";

  // Multi-turn context: muat riwayat pesan terakhir
  const history = store?.getRecentChatHistory ? store.getRecentChatHistory(chatId, 6) : [];
  const isGroupChat = String(chatId).endsWith("@g.us");
  const isGreeting = isGreetingIntent(userText) && !isGroupChat;
  const greetingInstruction = isGreeting
    ? `\n\n[INSTRUKSI AWAL CHAT]: Ini adalah awal obrolan atau sapaan. Kamu WAJIB mengawali balasan persis dengan: "🤠 MY NAME IS JOHN MUSTARDDD DEW DEW DEW 🥀" sebelum lanjut ke kalimat berikutnya. DILARANG menggunakan emoji selain 🤠 dan 🥀 pada catchphrase tersebut.`
    : "";

  const groupContext = isGroupChat
    ? `\n\n[OBROLAN GRUP KELUARGA]:
- TONE & BAHASA: Kamu saat ini berbicara di obrolan grup keluarga. Gunakan gaya bahasa yang sopan, ramah, hangat, dan santun (pakai kata 'aku/kamu' atau netral santun). DILARANG KERAS menggunakan kata 'gw/gua', 'lu/lo', atau slang kasar di grup ini.
- TANPA CATCHPHRASE MEME: JANGAN PERNAH menyertakan catchphrase meme koboi ("MY NAME IS JOHN MUSTARDDD...") di grup keluarga.
- STRAIGHTFORWARD & NO-YAPPING: Jawab langsung pada intinya (1-2 kalimat). Jangan berpanjang lebar atau mendikte di obrolan grup; jika butuh elaborasi, biarkan user reply.
- TUGAS BERSAMA & PENANGGUNG JAWAB: To-do list di obrolan ini adalah daftar tugas bersama keluarga. Jika ada nama penanggung jawab yang disebut (contoh: "Mas", "Mama", "Kakak", "Ayah"), WAJIB sertakan pada parameter 'assignee' di tool addTodo/updateTodo.
- PENGINGAT (REMINDER): Setiap pengingat/reminder yang dibuat di grup ini akan dikirimkan langsung ke obrolan grup saat jatuh tempo.
- DOKUMEN & PDF: Jika menerima dokumen/file, berikan jawaban atau ringkasan 3-5 poin penting yang jelas dan mudah dipahami seluruh keluarga.
- PRIVASI & KEAMANAN: DILARANG membuka, mencari, atau menyebutkan file brankas/vault pribadi pemilik di obrolan grup.
- MENTION / TAG ANGGOTA: Jika me-mention atau ngetag seseorang di obrolan grup, WAJIB gunakan format nomor telepon '@<nomor_telepon>' (misal: @6281234567890). DILARANG menggunakan ID LID internal atau nomor acak.`
    : "";

  // Active speaker resolution & dynamic memory context
  const callerPhone = normalizePhone(senderNumber || chatId);
  let speaker = null;
  if (store?.getPerson) {
    speaker = store.getPerson(callerPhone) || store.getPerson(senderNumber) || store.getPerson(chatId);
  }
  if (!speaker && DEFAULT_CONTACT_PROFILES) {
    speaker = DEFAULT_CONTACT_PROFILES.find((p) => normalizePhone(p.phone) === callerPhone);
  }

  const customTone = store?.getUserTonePreference ? store.getUserTonePreference(callerPhone || chatId) : null;

  let activeSpeakerContext = "";
  if (speaker) {
    const isOwnerUser = isOwner(chatId, senderNumber);
    const speakerName = speaker.name;
    const speakerRel = speaker.relationship || speaker.role || "Anggota Keluarga";

    let defaultToneDesc = "";
    let callNameDesc = "";
    let ownershipGuidance = "";

    if (/^mami$/i.test(speakerName)) {
      callNameDesc = `Panggil "Mami". DILARANG KERAS memanggil Mami dengan sebutan "Lord", "Sir", atau "cuy"!`;
      defaultToneDesc = `Gaya bahasa santai, ramah, hangat, dan akrab (gunakan kata 'aku/kamu', DILARANG KERAS menggunakan kata 'gw/lu'). Tetap santai dan luwes, jangan kaku seperti robot/customer service.`;
      ownershipGuidance = `Catatan, nomor rekening, agenda, to-do, atau pengingat yang berlabel "Mami", "mami", atau berkaitan dengan Mami adalah MILIK DIA SENDIRI! Jika Mami bertanya "norek aku berapa" atau "catatan punyaku", itu merujuk langsung ke rekening/catatan berlabel Mami (misal rekening_bca_mami). Berikan langsung datanya dan jangan katakan bahwa rekening itu milik orang lain!`;
    } else if (/^papi$/i.test(speakerName)) {
      callNameDesc = `Panggil "Papi". DILARANG KERAS memanggil Papi dengan sebutan "Lord", "Sir", atau "cuy"!`;
      defaultToneDesc = `Gaya bahasa santai, ramah, hangat, dan bersahabat (gunakan kata 'aku/kamu', DILARANG KERAS menggunakan kata 'gw/lu').`;
      ownershipGuidance = `Catatan, nomor rekening, to-do, atau data berlabel "Papi" adalah MILIK DIA SENDIRI. Jika Papi bertanya "norek aku berapa" atau mencari datanya, berikan langsung data milik Papi!`;
    } else if (/^karimah$/i.test(speakerName)) {
      callNameDesc = `Panggil "Karimah".`;
      defaultToneDesc = `Gaya bahasa Gen Z santai, ramah, akrab (luwes pakai gw/lu, santuy, wkwk).`;
      ownershipGuidance = `Karimah adalah pacar / pasangan Rafid. Catatan atau agenda berlabel Karimah adalah miliknya.`;
    } else if (/^razita/i.test(speakerName)) {
      callNameDesc = `Panggil "Razita" atau "Lord" santai.`;
      defaultToneDesc = `Gaya bahasa Gen Z santai dan luwes (gw/lu, wkwk, sat-set, santuy).`;
      ownershipGuidance = `Razita adalah adik Rafid. Catatan, jadwal pelajaran sekolah, PR, NISN, atau data sekolah yang tersimpan adalah miliknya.`;
    } else if (isOwnerUser || /rafid|simas/i.test(speakerName)) {
      callNameDesc = `Panggil "Lord" atau "Mas".`;
      defaultToneDesc = `Gaya bahasa Gen Z santai, akrab, sat-set (gw/lu, wkwk, santuy).`;
      ownershipGuidance = `Rafid adalah Master / Owner Bot. Data pribadi/umum tanpa penanda khusus adalah miliknya.`;
    } else {
      callNameDesc = `Panggil "${speakerName}".`;
      defaultToneDesc = `Gaya bahasa ramah dan santai.`;
      ownershipGuidance = `Data berlabel nama user adalah miliknya.`;
    }

    activeSpeakerContext = `\n\n[IDENTITAS LAWAN BICARA SAAT INI (ACTIVE SPEAKER)]:
- Nama: ${speakerName}
- Hubungan/Peran: ${speakerRel}
- Nomor WhatsApp: +${callerPhone}
- Aturan Panggilan: ${callNameDesc}
- Aturan Tone & Bahasa: ${defaultToneDesc}
- Aturan Kepemilikan Data ("aku" / "punyaku"): ${ownershipGuidance}`;
  } else if (!isGroupChat) {
    activeSpeakerContext = `\n\n[IDENTITAS LAWAN BICARA SAAT INI]:
- Nomor WhatsApp: +${callerPhone}
- Catatan: Nomor ini terdaftar di whitelist. Jawab secara ramah dan to the point.`;
  }

  if (customTone) {
    activeSpeakerContext += `\n- PREFERENSI GAYA BICARA KUSTOM (OVERRIDE AKTIF):
Pengguna ini telah mengatur preferensi gaya bicara/panggilan kustom:
"${customTone}"
PERINGATAN: Preferensi kustom ini WAJIB MENG-OVERRIDE aturan panggilan dan tone default di atas! Patuhi instruksi ini secara konsisten.`;
  }

  const finalSystemPrompt = systemPrompt + activeSpeakerContext + groupContext + coupleContext + skillsContext + whitelistContext + greetingInstruction;

  const userParts = [];
  if (audio) {
    const base64Data = Buffer.isBuffer(audio.buffer)
      ? audio.buffer.toString("base64")
      : (audio.base64 || audio.data);
    userParts.push({
      inlineData: {
        mimeType: audio.mimetype || "audio/ogg",
        data: base64Data
      }
    });
  }
  if (media) {
    const base64Data = Buffer.isBuffer(media.buffer)
      ? media.buffer.toString("base64")
      : (media.base64 || media.data);
    userParts.push({
      inlineData: {
        mimeType: media.mimetype || "application/pdf",
        data: base64Data
      }
    });
    if (!userText || !userText.trim()) {
      userParts.push({
        text: "Tolong baca dokumen/file '" + (media.filename || "ini") + "' dan berikan ringkasan singkat serta poin-poin pentingnya (3-5 poin) yang jelas dan mudah dipahami."
      });
    }
  }
  if (userText && userText.trim()) {
    userParts.push({ text: userText });
  } else if (audio && !media) {
    userParts.push({ text: "Dengarkan pesan suara ini dan respon langsung instruksi atau pertanyaannya." });
  }

  const contents = [];
  let lastRole = null;

  for (const h of history) {
    const r = h.role === "model" ? "model" : "user";
    if (r === lastRole && contents.length > 0) {
      contents[contents.length - 1].parts.push({ text: h.content });
    } else {
      contents.push({ role: r, parts: [{ text: h.content }] });
      lastRole = r;
    }
  }

  // Gemini mewajibkan konten pertama adalah 'user'
  while (contents.length > 0 && contents[0].role !== "user") {
    contents.shift();
  }

  if (contents.length > 0 && contents[contents.length - 1].role === "user") {
    contents[contents.length - 1].parts.push(...userParts);
  } else {
    contents.push({ role: "user", parts: userParts });
  }

  // LLM Autonomy: biarkan Gemini menentukan sendiri secara native (mode AUTO) apakah perlu eksekusi tool atau cukup teks
  let toolConfig = { functionCallingConfig: { mode: "AUTO" } };

  const toolsCalled = [];
  const executedTrajectory = [];
  let currentCandidate = null;
  let lastFormattedList = null;
  const MAX_STEPS = 5;
  let turns = 0;

  const activeCascade = cascade || selectModelCascade(userText, { media, audio });

  while (turns < MAX_STEPS) {
    const payload = {
      systemInstruction: { parts: [{ text: finalSystemPrompt }] },
      contents,
      tools: TOOLS,
      ...(toolConfig ? { toolConfig } : {})
    };

    const responseData = await generateContent(rotator, payload, activeCascade);
    currentCandidate = responseData.candidates?.[0];
    if (!currentCandidate?.content) break;

    const fnCallParts = currentCandidate.content.parts?.filter((p) => p.functionCall) || [];
    if (fnCallParts.length === 0) {
      // Anti-Hallucination & Mutation Guardrail Check
      const candidateText = currentCandidate.content.parts?.find((p) => p.text)?.text || "";
      if (detectUnexecutedMutationClaim(candidateText, toolsCalled)) {
        if (turns < MAX_STEPS - 1) {
          turns++;
          contents.push(currentCandidate.content);
          contents.push({
            role: "user",
            parts: [{
              text: "SYSTEM INTEGRITY FAULT: Kamu mengklaim telah melakukan tindakan/mutasi data pada sistem, tapi BELUM memanggil functionCall ke tool terkait! Eksekusi functionCall ke tool sekarang."
            }]
          });
          toolConfig = { functionCallingConfig: { mode: "ANY" } };
          continue;
        } else {
          return isGroupChat
            ? "Waduh, belum ke-update di database nih. Coba sebutin perintahnya lagi lebih spesifik."
            : "Waduh, belum ke-update di database nih. Coba sebutin perintahnya lagi lebih spesifik, Lord.";
        }
      }
      break;
    }

    turns++;
    const userResponseParts = [];
    for (const part of fnCallParts) {
      const { name, args } = part.functionCall;
      toolsCalled.push(name);
      if (onToolCall) onToolCall(name);

      let resultObj = {};
      try {
        resultObj = await executeTool(name, args, { store, chatId, senderNumber, rotator });
      } catch (toolErr) {
        resultObj = { toolResult: { error: toolErr.message } };
      }

      executedTrajectory.push({
        name,
        args,
        result: resultObj.toolResult
      });

      if (resultObj.formattedList) {
        lastFormattedList = resultObj.formattedList;
      }

      userResponseParts.push({
        functionResponse: { name, response: { result: resultObj.toolResult } }
      });
    }

    contents.push(currentCandidate.content);
    contents.push({
      role: "user",
      parts: userResponseParts
    });

    // Revert toolConfig to AUTO for subsequent steps in the ReAct loop
    toolConfig = { functionCallingConfig: { mode: "AUTO" } };

    // Helmis pattern: Mid-Turn Steering via Mailbox Injection
    if (injectMailboxSteering(mailbox, contents)) {
      if (turns >= MAX_STEPS - 1) turns = MAX_STEPS - 2;
    }
  }

  const directText = currentCandidate?.content?.parts?.find((p) => p.text)?.text;
  const text = directText?.trim();
  let finalReply = "";

  if (text) {
    if (lastFormattedList && !text.includes(lastFormattedList) && !text.includes("⏰") && !text.includes("[")) {
      finalReply = `${text}\n\n${lastFormattedList}`;
    } else {
      finalReply = text;
    }
  } else {
    finalReply = lastFormattedList || (isGroupChat ? "Beres." : "Beres, Lord.");
  }

  finalReply = stripHallucinatedToolChips(finalReply);
  finalReply = sanitizeLatexForWhatsApp(finalReply);
  finalReply = formatForWhatsApp(finalReply);

  const noFluff = isNoFluffRequest(userText);

  // Footnote Chips for transparent engine calls (suppressed by default; enabled only with SHOW_TOOL_CHIPS=true)
  if (process.env.SHOW_TOOL_CHIPS === "true" && toolsCalled.length > 0 && finalReply !== "[NO_REPLY]" && !noFluff) {
    const chips = [...new Set(toolsCalled)].map((t) => `↳ ${t}`).join("  ");
    finalReply = `${finalReply}\n\n_${chips}_`;
  }

  // Anti-slop: strip decorative AI slop emojis while preserving functional UI emojis
  finalReply = finalReply.replace(/(?!🤠|🥀|🌄|🟠|🟡|🟢|🔴|⚪|💪|👤|✅|❌|⚠️|📌)[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, "").trim();

  // Hook meme awal chat: 🤠 MY NAME IS JOHN MUSTARDDD DEW DEW DEW 🥀
  if (isGreeting && !isGroupChat && finalReply && finalReply !== "[NO_REPLY]") {
    if (!finalReply.includes("JOHN MUSTARDDD")) {
      finalReply = `🤠 MY NAME IS JOHN MUSTARDDD DEW DEW DEW 🥀\n\n${finalReply}`;
    } else if (!finalReply.includes("🤠") && !finalReply.includes("🥀")) {
      finalReply = finalReply.replace(/MY NAME IS JOHN MUSTARDDD DEW DEW DEW/i, "🤠 MY NAME IS JOHN MUSTARDDD DEW DEW DEW 🥀");
    }
  }

  if (onTrajectory && executedTrajectory.length > 0) {
    try {
      onTrajectory(executedTrajectory);
    } catch {}
  }

  return finalReply;
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("src/llm.js")) {
  import("node:assert").then(async ({ default: assert }) => {
    assert.strictEqual(typeof processChat, "function");
    assert.strictEqual(typeof executeTool, "function");
    assert.strictEqual(isActionIntent("tambahkan tugas"), true);
    assert.strictEqual(isActionIntent("ingatkan besok jam 7"), true);
    assert.strictEqual(isActionIntent("hitung 25 * 40 pake python"), true);
    assert.strictEqual(isActionIntent("halo bro"), false);
    assert.strictEqual(isGreetingIntent("halo"), true);
    assert.strictEqual(isGreetingIntent("p"), true);
    assert.strictEqual(isGreetingIntent("yo wasap"), true);
    assert.strictEqual(isGreetingIntent("@john halo"), true);
    assert.strictEqual(isGreetingIntent("selamat pagi"), true);
    assert.strictEqual(isGreetingIntent("samlekom"), true);
    assert.strictEqual(isGreetingIntent("sup"), true);
    assert.strictEqual(isGreetingIntent("bang john"), true);
    assert.strictEqual(isGreetingIntent("haloooo"), true);
    assert.strictEqual(isGreetingIntent("morning bro"), true);
    assert.strictEqual(isGreetingIntent("tambahkan tugas"), false);
    const decls = TOOLS[0].functionDeclarations.map((d) => d.name);
    assert.ok(decls.includes("addBacklog"));
    assert.ok(decls.includes("listBacklogs"));
    assert.ok(decls.includes("completeBacklog"));
    assert.ok(decls.includes("submitFeatureRequest"));
    assert.ok(decls.includes("listFeatureRequests"));
    assert.ok(decls.includes("executePython"));
    assert.ok(decls.includes("saveSkill"));
    assert.ok(decls.includes("listSkills"));
    assert.ok(decls.includes("deleteSkill"));
    assert.ok(decls.includes("loadSkill"));
    assert.ok(decls.includes("updateSkill"));
    assert.ok(decls.includes("processPdf"));
    assert.ok(decls.includes("mergePdf"));
    assert.ok(decls.includes("splitPdf"));
    assert.ok(decls.includes("compressPdf"));
    assert.ok(decls.includes("convertDocument"));
    assert.ok(decls.includes("ocrDocument"));
    assert.ok(decls.includes("getTodosDue"));
    assert.ok(decls.includes("undoLastTodo"));
    assert.ok(decls.includes("setDailyDigest"));
    assert.ok(decls.includes("proposeSkill"));
    assert.ok(decls.includes("approveSkill"));
    assert.ok(decls.includes("rejectSkill"));
    assert.ok(decls.includes("listSkillVersions"));
    assert.ok(decls.includes("rollbackSkill"));
    assert.ok(decls.includes("addPerson"));
    assert.ok(decls.includes("getPerson"));
    assert.ok(decls.includes("listPersons"));
    assert.ok(decls.includes("deletePerson"));
    assert.ok(decls.includes("addReminder"));
    assert.ok(decls.includes("listReminders"));
    assert.ok(decls.includes("deleteReminder"));
    assert.ok(decls.includes("saveNote"));
    assert.ok(decls.includes("appendNote"));
    assert.ok(decls.includes("getNote"));
    assert.ok(decls.includes("listNotes"));
    assert.ok(decls.includes("deleteNote"));
    assert.ok(decls.includes("readUrl"));
    assert.strictEqual(isActionIntent("pelajari skill rekap tugas"), true);
    assert.strictEqual(isActionIntent("gabung file pdf #1 dan #2"), true);
    assert.strictEqual(isActionIntent("kompres pdf dokumen ini"), true);
    assert.strictEqual(isActionIntent("konversi file laporan.docx ke pdf"), true);
    assert.strictEqual(isActionIntent("scan ocr foto ktp"), true);
    assert.strictEqual(isActionIntent("undo tugas terakhir"), true);
    assert.strictEqual(isActionIntent("buat proposal skill export json"), true);
    assert.strictEqual(isActionIntent("rollback skill rekap_malam"), true);
    assert.strictEqual(isActionIntent("tambahkan kontak Bunga istri"), true);
    assert.strictEqual(isActionIntent("baca url https://id.wikipedia.org"), true);
    assert.strictEqual(isActionIntent("catat nomor rekening bca 12345"), true);
    assert.strictEqual(isActionIntent("lihat catatan pribadi"), true);
    assert.strictEqual(isActionIntent("gimana kondisi server bot"), true);
    assert.strictEqual(isActionIntent("cek server menkrep"), true);
    assert.strictEqual(isActionIntent("ada yang online mc gak"), true);
    assert.strictEqual(isActionIntent("tolong pc karimah link video ini"), true);
    assert.strictEqual(isActionIntent("japri razita tugas tadi"), true);
    assert.ok(decls.includes("checkServerHealth"));
    assert.ok(decls.includes("checkMinecraftServer"));
    assert.ok(decls.includes("sendDirectMessage"));

    // SSRF Safety Tests
    assert.strictEqual(isSafeUrl("http://localhost:3000/api"), false);
    assert.strictEqual(isSafeUrl("http://127.0.0.1:8080"), false);
    assert.strictEqual(isSafeUrl("http://192.168.1.1/router"), false);
    assert.strictEqual(isSafeUrl("http://10.0.0.5/secret"), false);
    assert.strictEqual(isSafeUrl("http://172.20.0.2/meta"), false);
    assert.strictEqual(isSafeUrl("http://169.254.169.254/latest/meta-data"), false);
    assert.strictEqual(isSafeUrl("https://en.wikipedia.org/wiki/Node.js"), true);

    // Mutation Claim Detection Tests
    assert.strictEqual(detectUnexecutedMutationClaim("Sudah kutambahkan tugasnya bro!", []), true);
    assert.strictEqual(detectUnexecutedMutationClaim("Berhasil dihapus dari to-do list.", []), true);
    assert.strictEqual(detectUnexecutedMutationClaim("Sudah kutambahkan tugasnya bro!", ["addTodo"]), false);
    assert.strictEqual(detectUnexecutedMutationClaim("Halo ada yang bisa kubantu?", []), false);

    // HTML Table & CSV Parser Tests
    const sampleHtml = `
      <table>
        <tr><th>Nama Matkul</th><th>Hari</th><th>Jam</th></tr>
        <tr><td>Analisis Algoritme</td><td>Senin</td><td>08:00</td></tr>
        <tr><td>Basis Data</td><td>Selasa</td><td>10:00</td></tr>
      </table>
    `;
    const parsedMd = parseHtmlTableToMarkdown(sampleHtml);
    assert.ok(parsedMd.includes("| Nama Matkul | Hari | Jam |"));
    assert.ok(parsedMd.includes("| Analisis Algoritme | Senin | 08:00 |"));

    const sampleCsv = `Mata Kuliah,Hari,Ruang\n"Kalkulus",Rabu,"Lab A"\n"Fisika",Kamis,"Lab B"`;
    const csvMd = parseCsvToMarkdown(sampleCsv);
    assert.ok(csvMd.includes("| Mata Kuliah | Hari | Ruang |"));
    assert.ok(csvMd.includes("| Kalkulus | Rabu | Lab A |"));

    const wideRows = [
      ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10", "C11"],
      ["V1", "V2", "V3", "V4", "V5", "V6", "V7", "V8", "V9", "V10", "V11"]
    ];
    const wideMd = formatRowsToMarkdown(wideRows);
    assert.ok(wideMd.includes("• *C1*: V1"));
    assert.ok(wideMd.includes("• *C11*: V11"));

    // Model Cooldown & Cascade Ordering Tests
    clearModelCooldowns();
    const testModels = ["modelA", "modelB", "modelC"];
    assert.deepStrictEqual(getActiveModels(testModels), ["modelA", "modelB", "modelC"]);
    markModelUnavailable("modelA", 60_000);
    assert.deepStrictEqual(getActiveModels(testModels), ["modelB", "modelC", "modelA"]); // modelA demoted to end
    clearModelCooldowns();
    assert.deepStrictEqual(getActiveModels(testModels), ["modelA", "modelB", "modelC"]);

    // Dynamic Model Tier Selection Tests
    assert.strictEqual(selectModelCascade("tambah to-do beli susu")[0], "gemini-flash-lite-latest");
    assert.strictEqual(selectModelCascade("halo john apa kabar")[0], "gemini-flash-lite-latest");
    assert.strictEqual(selectModelCascade("#pro tolong buatkan arsitektur backend")[0], "gemini-3.5-flash-lite");
    assert.strictEqual(selectModelCascade("tolong debug script python ini")[0], "gemini-3.5-flash-lite");
    assert.strictEqual(selectModelCascade("lakukan analisis mendalam data ini")[0], "gemini-3.5-flash-lite");

    // Mid-Turn Mailbox Steering Tests
    const testMailbox = [{ body: "eh koreksi: ganti jam 14.00" }];
    const testContents = [{ role: "user", parts: [{ text: "ingatkan rapat" }] }];
    const injected = injectMailboxSteering(testMailbox, testContents);
    assert.strictEqual(injected, true);
    assert.strictEqual(testMailbox.length, 0);
    assert.ok(testContents[0].parts[1].text.includes("eh koreksi: ganti jam 14.00"));

    // Guardrail, LaTeX Sanitizer, & No-Fluff Tests
    assert.strictEqual(isNoFluffRequest("Tolong buatkan teks ini, no fluff ya"), true);
    assert.strictEqual(isNoFluffRequest("buatkan rangkuman materi tanpa basa-basi"), true);
    assert.strictEqual(isNoFluffRequest("halo john apa kabar"), false);

    const rawChipsText = "Ini hasil analisis data.\n\n_↳ readUrl  executePython_";
    assert.strictEqual(stripHallucinatedToolChips(rawChipsText), "Ini hasil analisis data.");

    const rawLatex = "Kompleksitasnya adalah $\\mathcal{O}(n \\log_2 n)$ dan nilainya $x^2 + y_1 \\leq 10$.";
    const cleanMath = sanitizeLatexForWhatsApp(rawLatex);
    assert.ok(cleanMath.includes("O(n log₂ n)"));
    assert.ok(cleanMath.includes("x² + y₁ ≤ 10"));
    assert.ok(!cleanMath.includes("$"));

    // WhatsApp Markdown Converter Tests
    const rawMarkdown = "### Heading Judul\nBerikut list:\n* Item 1\n* Item 2\n**Teks tebal** dan [Link Web](https://example.com)\n> ini kutipan";
    const waFormatted = formatForWhatsApp(rawMarkdown);
    assert.ok(waFormatted.includes("*Heading Judul*"));
    assert.ok(waFormatted.includes("• Item 1"));
    assert.ok(waFormatted.includes("• Item 2"));
    assert.ok(waFormatted.includes("*Teks tebal*"));
    assert.ok(waFormatted.includes("Link Web (https://example.com)"));
    assert.ok(waFormatted.includes("_ini kutipan_"));
    assert.ok(!waFormatted.includes("###"));
    assert.ok(!waFormatted.includes("**"));

    // Tool permission tests
    executeTool("checkServerHealth", {}, { store: null, chatId: "628999999999" }).then((res) => {
      assert.ok(res.toolResult.error?.includes("khusus untuk nomor owner"));
    });
    executeTool("checkServerHealth", {}, { store: null, chatId: OWNER_PHONE }).then((res) => {
      assert.strictEqual(res.toolResult.success, true);
    });
    // Group Vault Isolation test
    executeTool("searchVault", { query: "KTP" }, { store: null, chatId: "1203630234567890@g.us" }).then((res) => {
      assert.ok(res.toolResult.error?.includes("dinonaktifkan di obrolan grup"));
    });

    // sendDirectMessage Whitelist barrier tests
    process.env.WHITELIST_PHONE = "+6285236467838,+6289514718700";
    process.env.SECONDARY_USER_NAME = "Karimah";
    process.env.SECONDARY_USER_PHONE = "6289514718700";

    executeTool("sendDirectMessage", { recipient: "628999999999", message: "halo" }, { store: null, chatId: OWNER_PHONE }).then((res) => {
      assert.ok(res.toolResult.error?.includes("tidak terdaftar dalam whitelist"));
    });
    executeTool("sendDirectMessage", { recipient: "karimah", message: "halo" }, { store: null, chatId: OWNER_PHONE }).then((res) => {
      assert.strictEqual(res.toolResult.success, true);
      assert.ok(res.toolResult.message?.includes("Karimah"));
    });

    // processChat sanity & TDZ regression tests
    const mockRotator = {
      execute: async () => ({
        candidates: [{ content: { parts: [{ text: "Halo juga!" }] } }]
      })
    };
    await processChat(mockRotator, "halo", { chatId: "628123456789@c.us" });
    await processChat(mockRotator, "halo", { chatId: "1203630234567890@g.us" });

    // Multi-function call in single turn test
    let multiToolsCalled = [];
    const multiFnMockRotator = {
      turn: 0,
      execute: async () => {
        multiFnMockRotator.turn++;
        if (multiFnMockRotator.turn === 1) {
          return {
            candidates: [{
              content: {
                parts: [
                  { functionCall: { name: "addTodo", args: { task: "Tugas 1" } } },
                  { functionCall: { name: "addTodo", args: { task: "Tugas 2" } } }
                ]
              }
            }]
          };
        }
        return {
          candidates: [{ content: { parts: [{ text: "Dua tugas berhasil dicatat." }] } }]
        };
      }
    };
    const mockStore = {
      addTodo: () => 1,
      getTodos: () => []
    };
    const multiRes = await processChat(multiFnMockRotator, "catat 2 tugas", {
      store: mockStore,
      chatId: "628123456789@c.us",
      onToolCall: (name) => multiToolsCalled.push(name)
    });
    assert.strictEqual(multiToolsCalled.length, 2);
    assert.strictEqual(multiToolsCalled[0], "addTodo");
    assert.strictEqual(multiToolsCalled[1], "addTodo");
    assert.ok(multiRes.includes("Dua tugas berhasil dicatat."));

    console.log("LLM module self-test OK");
  });
}
