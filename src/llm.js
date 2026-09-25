import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { formatTodoList, formatBacklogList, formatSkillList, normalizePhone, OWNER_PHONE } from "./db.js";
import { sendFile, sendText } from "./waha.js";

export const TOOLS = [
  {
    functionDeclarations: [
      {
        name: "addTodo",
        description: "Tambahkan tugas ke To-Do List dengan deadline dan tag matkul/kategori",
        parameters: {
          type: "OBJECT",
          properties: {
            task: { type: "STRING", description: "Judul tugas, contoh: LKP 6 Analisis Algoritme" },
            deadlineIso: { type: "STRING", description: "Deadline dalam format ISO 8601 (contoh: 2026-09-27T23:59:00+07:00)" },
            tag: { type: "STRING", description: "Tag atau kode mata kuliah, contoh: #analgor [P2]" },
            category: { type: "STRING", description: "Kategori tugas opsional: work (default) atau routine (absen/kuliah)" }
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
            includeRoutine: { type: "BOOLEAN", description: "Set true untuk menyertakan tugas rutin/kuliah/absen (default false)" }
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
        name: "updateTodo",
        description: "Ubah atau koreksi judul tugas, deadline, atau tag di To-Do List",
        parameters: {
          type: "OBJECT",
          properties: {
            todoId: { type: "NUMBER", description: "ID tugas yang mau diubah (opsional jika taskQuery diisi)" },
            taskQuery: { type: "STRING", description: "Kata kunci nama tugas jika ID tidak disebutkan" },
            newTask: { type: "STRING", description: "Judul tugas baru" },
            deadlineIso: { type: "STRING", description: "Deadline baru dalam format ISO 8601 (contoh: 2026-09-25T09:30:00+07:00)" },
            tag: { type: "STRING", description: "Tag baru mata kuliah atau kategori" }
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
        description: "Kirim file dokumen dari Vault langsung ke chat WhatsApp pengguna",
        parameters: {
          type: "OBJECT",
          properties: {
            fileId: { type: "NUMBER", description: "ID file di Document Vault" },
            caption: { type: "STRING", description: "Keterangan/caption file" }
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
        description: "Baca dan ekstrak teks konten dari URL / tautan web publik atau artikel (dengan proteksi SSRF)",
        parameters: {
          type: "OBJECT",
          properties: {
            url: { type: "STRING", description: "URL lengkap website atau artikel online (contoh: https://...)" }
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
      }
    ]
  }
];

const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const FALLBACK_MODEL = "gemini-3-flash-preview";

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

export async function fetchUrlContent(rawUrl) {
  if (!isSafeUrl(rawUrl)) {
    throw new Error("URL tidak aman atau mengarah ke alamat lokal/privat (SSRF Protection).");
  }
  const res = await fetch(rawUrl, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)" },
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: Gagal memuat halaman web.`);
  const html = await res.text();
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
  "addTodo", "completeTodo", "updateTodo", "deleteTodo",
  "addReminder", "grantFileAccess", "addBacklog", "completeBacklog",
  "saveSkill", "deleteSkill"
]);

export function detectUnexecutedMutationClaim(text = "", toolsCalled = []) {
  if (!text) return false;
  const hasMutationTool = toolsCalled.some((t) => MUTATION_TOOLS.has(t));
  if (hasMutationTool) return false;
  const claimRegex = /(sudah|berhasil|telah)\s+(di|ku|saya|telah|berhasil)?\s*(tambah|catat|buat|bikin|jadwal|ubah|ganti|koreksi|update|hapus|delete|selesai|simpan|kristalisasi)/i;
  return claimRegex.test(text);
}

export function isActionIntent(text = "") {
  if (!text) return false;
  return /\b(tambah|catat|buat|bikin|ingat|remind|jadwal|ubah|ganti|koreksi|update|hapus|delete|selesai|done|mark|simpan|brankas|cari|kirim|bagi|minta\s+akses|beri\s+akses|backlog|lihat|cek|tampil|hitung|python|script|plot|grafik|skill|macro|kristal|pelajari|baca|url|link|web|artikel)/i.test(text);
}

export function isGreetingIntent(text = "") {
  if (!text) return false;
  const t = text.trim();
  return (
    /^(p|halo|hai|hey|hei|woi|oi|tes|test|assalamualaikum|pagi|siang|sore|malam|mustard|john)\b/i.test(t) ||
    /(siapa\s+(kamu|lu)|nama\s+(kamu|lu)|kamu\s+siapa|lu\s+siapa|perkenal|kenalan|dew\s*dew|john\s+mustard)/i.test(t)
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

export async function generateContent(rotator, payload) {
  try {
    return await callGemini(rotator, DEFAULT_MODEL, payload);
  } catch (err) {
    console.warn(`[LLM] Model ${DEFAULT_MODEL} gagal (${err.message}). Fallback ke ${FALLBACK_MODEL}...`);
    try {
      return await callGemini(rotator, FALLBACK_MODEL, payload);
    } catch (fallbackErr) {
      if (payload.toolConfig?.functionCallingConfig?.mode === "ANY") {
        console.warn(`[LLM] Mode ANY gagal (${fallbackErr.message}). Fallback ke mode AUTO...`);
        const autoPayload = { ...payload, toolConfig: { functionCallingConfig: { mode: "AUTO" } } };
        return await callGemini(rotator, DEFAULT_MODEL, autoPayload);
      }
      throw fallbackErr;
    }
  }
}

export async function getEmbedding(rotator, text) {
  if (!text || typeof text !== "string" || !text.trim() || !rotator) return null;
  return rotator.execute(async (key) => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${key}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "models/text-embedding-004",
        content: { parts: [{ text: text.trim().slice(0, 2048) }] }
      }),
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) throw new Error(`Embedding API error (${res.status}): ${await res.text()}`);
    const data = await res.json();
    return data.embedding?.values || null;
  });
}

export async function executeTool(name, args, { store, chatId, rotator = null }) {
  let toolResult = {};
  let formattedList = null;

  if (name === "addTodo") {
    const deadline = args.deadlineIso ? new Date(args.deadlineIso).getTime() : null;
    const id = store.addTodo(chatId, args.task, deadline, args.tag, args.category);
    const allTodos = store.getTodos(chatId, args.category === "routine");
    formattedList = formatTodoList(allTodos);
    toolResult = {
      success: true,
      id,
      task: args.task,
      category: args.category || "auto",
      formattedList
    };
  } else if (name === "listTodos") {
    const todos = store.getTodos(chatId, Boolean(args.includeRoutine));
    formattedList = formatTodoList(todos);
    toolResult = { raw: todos, formatted: formattedList, count: todos.length };
  } else if (name === "completeTodo") {
    const changes = store.completeTodo(args.todoId, chatId);
    const allTodos = store.getTodos(chatId);
    formattedList = formatTodoList(allTodos);
    toolResult = { success: changes > 0, formattedList };
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
        tag: args.tag
      });
      const allTodos = store.getTodos(chatId);
      formattedList = formatTodoList(allTodos);
      toolResult = {
        success: changes > 0,
        todoId: targetId,
        formattedList
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
      const allTodos = store.getTodos(chatId);
      formattedList = formatTodoList(allTodos);
      toolResult = {
        success: changes > 0,
        formattedList
      };
    }
  } else if (name === "addReminder") {
    const timestamp = new Date(args.remindAtIso).getTime();
    if (isNaN(timestamp)) throw new Error("Format tanggal/jam ISO tidak valid");
    const id = store.addReminder(chatId, args.message, timestamp, args.recurrence || null, args.taskType || "reminder");
    toolResult = { success: true, id, message: args.message, remindAt: args.remindAtIso, recurrence: args.recurrence || null };
  } else if (name === "searchVault") {
    let queryEmbedding = null;
    if (rotator && args.query) {
      try {
        queryEmbedding = await getEmbedding(rotator, args.query);
      } catch (embErr) {
        console.warn("[Vault] Semantic embedding search failed, fallback to keyword:", embErr.message);
      }
    }
    const files = store.searchVaultFiles(args.query || "", args.category || null, chatId, queryEmbedding);
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
    } else if (!store.hasFileAccess(file.id, chatId)) {
      toolResult = {
        error: "Akses ditolak",
        message: `Anda tidak memiliki izin mengakses file ini (Pemilik: +${normalizePhone(file.owner_id)}). Minta izin dengan perintah: 'Minta akses file ID ${file.id}'.`
      };
    } else {
      await sendFile(chatId, file.filepath, file.filename, args.caption || file.summary);
      toolResult = { success: true, filename: file.filename };
    }
  } else if (name === "requestFileAccess") {
    const file = store.getVaultFileById(args.fileId);
    if (!file) {
      toolResult = { error: "File tidak ditemukan di vault" };
    } else if (store.hasFileAccess(file.id, chatId)) {
      toolResult = { success: true, message: "Anda sudah memiliki izin akses ke file ini." };
    } else if (!file.owner_id) {
      toolResult = { error: "File ini tidak memiliki pemilik terdaftar." };
    } else {
      const reqId = store.createFileRequest(file.id, chatId, file.owner_id);
      const reqNum = normalizePhone(chatId);
      await sendText(
        file.owner_id,
        `🔔 *[Permintaan Akses Dokumen]*\nPengguna *+${reqNum}* meminta akses ke file:\n📄 *${file.filename}* (ID: #${file.id})${args.reason ? `\n💬 *Alasan:* ${args.reason}` : ""}\n\nBalas:\n👉 *SETUJU ${reqId}*\n👉 *TOLAK ${reqId}*`
      );
      toolResult = {
        success: true,
        requestId: reqId,
        message: `Permintaan akses file #${file.id} (${file.filename}) sudah dikirimkan ke pemilik (+${normalizePhone(file.owner_id)}). Menunggu persetujuan.`
      };
    }
  } else if (name === "grantFileAccess") {
    const file = store.getVaultFileById(args.fileId);
    const callerNorm = normalizePhone(chatId);
    if (!file) {
      toolResult = { error: "File tidak ditemukan di vault" };
    } else if (file.owner_id && normalizePhone(file.owner_id) !== callerNorm) {
      toolResult = { error: "Hanya pemilik dokumen yang dapat memberikan izin akses kepada pengguna lain." };
    } else {
      const targetNorm = normalizePhone(args.targetPhone);
      store.grantFileAccess(file.id, targetNorm);
      await sendText(
        targetNorm,
        `🎉 Anda telah diberikan izin akses ke dokumen:\n📄 *${file.filename}* (ID: #${file.id})\nOleh pemilik: +${callerNorm}`
      );
      toolResult = {
        success: true,
        message: `Izin akses file #${file.id} (${file.filename}) berhasil diberikan kepada +${targetNorm}.`
      };
    }
  } else if (name === "addBacklog") {
    if (normalizePhone(chatId) !== OWNER_PHONE) {
      toolResult = { error: "Fitur backlog hanya khusus untuk nomor admin/owner (+6281234567890)." };
    } else {
      const id = store.addBacklog(chatId, args.idea);
      toolResult = { success: true, id, idea: args.idea, message: `Ide improvement #${id} disimpan ke backlog.` };
    }
  } else if (name === "listBacklogs") {
    if (normalizePhone(chatId) !== OWNER_PHONE) {
      toolResult = { error: "Fitur backlog hanya khusus untuk nomor admin/owner (+6281234567890)." };
    } else {
      const items = store.getBacklogs(chatId);
      formattedList = formatBacklogList(items);
      toolResult = { count: items.length, items, formatted: formattedList };
    }
  } else if (name === "completeBacklog") {
    if (normalizePhone(chatId) !== OWNER_PHONE) {
      toolResult = { error: "Fitur backlog hanya khusus untuk nomor admin/owner (+6281234567890)." };
    } else {
      const changes = store.completeBacklog(args.backlogId, chatId);
      toolResult = { success: changes > 0, backlogId: args.backlogId };
    }
  } else if (name === "searchWeb") {
    const apiKey = process.env.TAVILY_API_KEY || "tvly-dummy-placeholder-key";
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
  } else {
    toolResult = { error: "Unknown function" };
  }

  return { toolResult, formattedList };
}

export async function processChat(rotator, userText, { store, chatId, onToolCall, onTrajectory = null, audio = null }) {
  const now = new Date();
  let basePrompt = "";
  const promptPath = path.resolve("config/system-prompt.md");
  if (fs.existsSync(promptPath)) {
    try {
      basePrompt = fs.readFileSync(promptPath, "utf-8");
    } catch {}
  }
  if (!basePrompt) {
    basePrompt = `Kamu adalah John Mustard, asisten pribadi eksekutif berbasis WhatsApp.\nWaktu sekarang: {{CURRENT_TIME}}.`;
  }
  const timeStr = `${now.toISOString()} (${now.toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB)`;
  const systemPrompt = basePrompt.replace("{{CURRENT_TIME}}", timeStr);

  const customSkills = store?.getSkills ? store.getSkills() : [];
  const skillsContext = customSkills.length > 0
    ? `\n\nCUSTOM SKILLS TERDAFTAR (Gunakan instruksi ini jika user memanggil skill):\n` +
      customSkills.map((s) => `- [${s.name}]: ${s.description} -> Instruksi: ${s.prompt_template}`).join("\n")
    : "";

  // Multi-turn context: muat riwayat pesan terakhir
  const history = store ? store.getRecentChatHistory(chatId, 6) : [];
  const isGreeting = isGreetingIntent(userText) || history.length === 0;
  const greetingInstruction = isGreeting
    ? `\n\n[INSTRUKSI AWAL CHAT]: Ini adalah awal obrolan atau sapaan. Kamu WAJIB mengawali balasan persis dengan: "🤠 MY NAME IS JOHN MUSTARDDD DEW DEW DEW 🥀" sebelum lanjut ke kalimat berikutnya.`
    : "";

  const finalSystemPrompt = systemPrompt + skillsContext + greetingInstruction;

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
  if (userText && userText.trim()) {
    userParts.push({ text: userText });
  } else if (audio) {
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

  const isAction = isActionIntent(userText);
  let toolConfig = isAction ? { functionCallingConfig: { mode: "ANY" } } : undefined;

  const toolsCalled = [];
  const executedTrajectory = [];
  let currentCandidate = null;
  let lastFormattedList = null;
  const MAX_STEPS = 5;
  let turns = 0;

  while (turns < MAX_STEPS) {
    const payload = {
      systemInstruction: { parts: [{ text: finalSystemPrompt }] },
      contents,
      tools: TOOLS,
      ...(toolConfig ? { toolConfig } : {})
    };

    const responseData = await generateContent(rotator, payload);
    currentCandidate = responseData.candidates?.[0];
    if (!currentCandidate?.content) break;

    const fnCallPart = currentCandidate.content.parts?.find((p) => p.functionCall);
    if (!fnCallPart?.functionCall) {
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
          return "Mohon maaf, tindakan tersebut belum berhasil diproses di sistem database. Silakan ulangi perintah secara spesifik.";
        }
      }
      break;
    }

    turns++;
    const { name, args } = fnCallPart.functionCall;
    toolsCalled.push(name);
    if (onToolCall) onToolCall(name);

    let resultObj = {};
    try {
      resultObj = await executeTool(name, args, { store, chatId, rotator });
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

    contents.push(currentCandidate.content);
    contents.push({
      role: "user",
      parts: [{ functionResponse: { name, response: { result: resultObj.toolResult } } }]
    });

    // Revert toolConfig to AUTO for subsequent steps in the ReAct loop
    toolConfig = { functionCallingConfig: { mode: "AUTO" } };
  }

  const directText = currentCandidate?.content?.parts?.find((p) => p.text)?.text;
  const text = directText?.trim();
  let finalReply = "";

  if (text) {
    if (lastFormattedList && !text.includes("─") && !text.includes("[")) {
      finalReply = `${text}\n\n${lastFormattedList}`;
    } else {
      finalReply = text;
    }
  } else {
    finalReply = lastFormattedList || "Aksi berhasil diselesaikan.";
  }

  // Footnote Chips for transparent engine calls
  if (toolsCalled.length > 0 && finalReply !== "[NO_REPLY]" && !finalReply.includes("↳")) {
    const chips = [...new Set(toolsCalled)].map((t) => `↳ ${t}`).join("  ");
    finalReply = `${finalReply}\n\n_${chips}_`;
  }

  // Hook meme awal chat: 🤠 MY NAME IS JOHN MUSTARDDD DEW DEW DEW 🥀
  if (isGreeting && finalReply && finalReply !== "[NO_REPLY]") {
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
  import("node:assert").then(({ default: assert }) => {
    assert.strictEqual(typeof processChat, "function");
    assert.strictEqual(typeof executeTool, "function");
    assert.strictEqual(isActionIntent("tambahkan tugas"), true);
    assert.strictEqual(isActionIntent("ingatkan besok jam 7"), true);
    assert.strictEqual(isActionIntent("hitung 25 * 40 pake python"), true);
    assert.strictEqual(isActionIntent("halo bro"), false);
    assert.strictEqual(isGreetingIntent("halo"), true);
    assert.strictEqual(isGreetingIntent("p"), true);
    assert.strictEqual(isGreetingIntent("tambahkan tugas"), false);
    const decls = TOOLS[0].functionDeclarations.map((d) => d.name);
    assert.ok(decls.includes("addBacklog"));
    assert.ok(decls.includes("listBacklogs"));
    assert.ok(decls.includes("completeBacklog"));
    assert.ok(decls.includes("executePython"));
    assert.ok(decls.includes("saveSkill"));
    assert.ok(decls.includes("listSkills"));
    assert.ok(decls.includes("deleteSkill"));
    assert.ok(decls.includes("readUrl"));
    assert.strictEqual(isActionIntent("pelajari skill rekap tugas"), true);
    assert.strictEqual(isActionIntent("baca url https://id.wikipedia.org"), true);

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

    console.log("LLM module self-test OK");
  });
}
