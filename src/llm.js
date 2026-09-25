import { formatTodoList, formatBacklogList, normalizePhone, OWNER_PHONE } from "./db.js";
import { sendFile, sendText } from "./waha.js";

const TOOLS = [
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
            tag: { type: "STRING", description: "Tag atau kode mata kuliah, contoh: #analgor [P2]" }
          },
          required: ["task"]
        }
      },
      {
        name: "listTodos",
        description: "Tampilkan daftar tugas / to-do list aktif beserta countdown deadline",
        parameters: {
          type: "OBJECT",
          properties: {}
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
            remindAtIso: { type: "STRING", description: "Waktu pengingat dalam ISO 8601 (contoh: 2026-09-25T17:00:00+07:00)" }
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
      }
    ]
  }
];

const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const FALLBACK_MODEL = "gemini-3-flash-preview";

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

async function generateContent(rotator, payload) {
  try {
    return await callGemini(rotator, DEFAULT_MODEL, payload);
  } catch (err) {
    console.warn(`[LLM] Model ${DEFAULT_MODEL} gagal (${err.message}). Fallback ke ${FALLBACK_MODEL}...`);
    return await callGemini(rotator, FALLBACK_MODEL, payload);
  }
}

export async function processChat(rotator, userText, { store, chatId, onToolCall, audio = null }) {
  const now = new Date();
  const systemPrompt = `Kamu adalah John Mustard, asisten pribadi eksekutif berbasis WhatsApp.
Waktu sekarang: ${now.toISOString()} (${now.toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB).

KARAKTER & GAYA BICARA:
- Santai, cerdas, ceplas-ceplos, solutif, tanpa basa-basi klise ("sat-set"). Paham konteks, lelucon, dan meme internet.
- DILARANG mengulang perkenalan diri (seperti "Halo! Saya John Mustard, asisten pribadi...") di setiap balasan! User sudah kenal kamu. Langsung jawab intinya.
- Referensi nama "John Mustard": meme internet viral TikTok "My name is John Mustard" (audio dramatis ala imthatguy3131), ditambah teriakan ikonik "MUSTARD!" Kendrick Lamar (track tv off / album GNX), dan sesekali pelesetan John Marston. Kalau user ungkit atau ngetes ini, tanggapi dengan nyambung, kocak, dan paham referensinya.
- Model AI: Jika ditanya, jawab jujur dan lugas bahwa kamu ditenagai model Google Gemini (Gemini 3.5 Flash).
- Wajib perhatikan konteks pesan-pesan sebelumnya. Jika user bilang "salah", "bukan", mengoreksi, atau memberi petunjuk, sambung dan lanjutkan topik sebelumnya!

INVARIAN AKSI (ANTI-PROMISSORY GUARDRAIL):
- DILARANG membuat janji verbal palsu di teks tanpa eksekusi tool (seperti "nanti aku ingatkan", "sudah kuubah" padahal belum panggil tool). Wajib langsung panggil tool di giliran ini!
- Jika user minta to-do list / daftar tugas, panggil listTodos dan kembalikan teks hasil fungsi listTodos secara persis tanpa mengubah layout pohon (tree branch) dan ikon badge.
- Jika user minta koreksi/ubah to-do (misal "ganti A jadi B", "ubah jam jadi 09.30"), WAJIB panggil updateTodo!
- Jika user minta hapus to-do, WAJIB panggil deleteTodo!
- Jika user bertanya info terkini, berita, cuaca, riset, pencarian Google, atau fakta yang butuh data internet/real-time, WAJIB panggil tool searchWeb!
- Kamu bisa memisahkan pesan panjang dengan '---' di baris baru untuk mengirim bubble WhatsApp terpisah jika diperlukan.`;

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

  // Multi-turn context: muat riwayat pesan terakhir
  const history = store ? store.getRecentChatHistory(chatId, 6) : [];
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

  const responseData = await generateContent(rotator, {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents,
    tools: TOOLS
  });

  const candidate = responseData.candidates?.[0];
  if (!candidate?.content) return "Tidak ada balasan dari model.";

  const fnCallPart = candidate.content.parts?.find((p) => p.functionCall);

  if (fnCallPart && fnCallPart.functionCall) {
    const { name, args } = fnCallPart.functionCall;
    if (onToolCall) onToolCall(name);

    let toolResult = {};
    try {
      if (name === "addTodo") {
        const deadline = args.deadlineIso ? new Date(args.deadlineIso).getTime() : null;
        const id = store.addTodo(chatId, args.task, deadline, args.tag);
        const allTodos = store.getTodos(chatId);
        toolResult = {
          success: true,
          id,
          task: args.task,
          formattedList: formatTodoList(allTodos)
        };
      } else if (name === "listTodos") {
        const todos = store.getTodos(chatId);
        toolResult = {
          raw: todos,
          formatted: formatTodoList(todos)
        };
      } else if (name === "completeTodo") {
        const changes = store.completeTodo(args.todoId, chatId);
        const allTodos = store.getTodos(chatId);
        toolResult = { success: changes > 0, formattedList: formatTodoList(allTodos) };
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
          toolResult = {
            success: changes > 0,
            todoId: targetId,
            formattedList: formatTodoList(allTodos)
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
          toolResult = {
            success: changes > 0,
            formattedList: formatTodoList(allTodos)
          };
        }
      } else if (name === "addReminder") {
        const timestamp = new Date(args.remindAtIso).getTime();
        if (isNaN(timestamp)) throw new Error("Format tanggal/jam ISO tidak valid");
        const id = store.addReminder(chatId, args.message, timestamp);
        toolResult = { success: true, id, message: args.message, remindAt: args.remindAtIso };
      } else if (name === "searchVault") {
        const files = store.searchVaultFiles(args.query || "", args.category || null, chatId);
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
          toolResult = { count: items.length, items, formatted: formatBacklogList(items) };
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
      } else {
        toolResult = { error: "Unknown function" };
      }
    } catch (toolErr) {
      toolResult = { error: toolErr.message };
    }

    if (name === "listTodos" && toolResult.formatted) {
      return toolResult.formatted;
    }
    if (name === "listBacklogs" && toolResult.formatted) {
      return toolResult.formatted;
    }

    contents.push(candidate.content);
    contents.push({
      role: "user",
      parts: [{ functionResponse: { name, response: { result: toolResult } } }]
    });

    const finalData = await generateContent(rotator, {
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents
    });

    const replyPart = finalData.candidates?.[0]?.content?.parts?.find((p) => p.text);
    const text = replyPart?.text?.trim();
    if (text) {
      if (toolResult.formattedList && !text.includes("─") && !text.includes("[")) {
        return `${text}\n\n${toolResult.formattedList}`;
      }
      return text;
    }
    return toolResult.formattedList || "Aksi berhasil diselesaikan.";
  }

  const directText = candidate.content.parts?.find((p) => p.text)?.text;
  return directText || "Siap.";
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("src/llm.js")) {
  import("node:assert").then(({ default: assert }) => {
    assert.strictEqual(typeof processChat, "function");
    const decls = TOOLS[0].functionDeclarations.map((d) => d.name);
    assert.ok(decls.includes("addBacklog"));
    assert.ok(decls.includes("listBacklogs"));
    assert.ok(decls.includes("completeBacklog"));
    console.log("LLM module self-test OK");
  });
}
