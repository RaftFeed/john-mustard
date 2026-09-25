import { createServer } from "./server.js";
import { KeyRotator } from "./rotator.js";
import { Storage, logInteraction, normalizePhone, formatBacklogList, OWNER_PHONE } from "./db.js";
import { startScheduler } from "./scheduler.js";
import { processChat } from "./llm.js";
import { sendText, sendFile, downloadMedia, startTyping, stopTyping } from "./waha.js";
import { ingestVaultFile } from "./vault.js";
import { parseFastCommand, executeFastCommand } from "./commands.js";

const PORT = process.env.PORT || 4000;
const rawKeys = process.env.GEMINI_KEYS || "";
const keys = rawKeys.split(",").map((k) => k.trim()).filter(Boolean);

if (keys.length === 0) {
  console.warn("PERINGATAN: GEMINI_KEYS di .env masih kosong.");
}

const rotator = new KeyRotator(keys.length > 0 ? keys : ["dummy_key"]);
const dbPath = process.env.DB_PATH || "bot.db";
const store = new Storage(dbPath);

// Jalankan runner pengingat (cek tiap 15 detik)
startScheduler(store, { rotator });

const HELP_TEXT = `*[JOHN MUSTARD]*
Asisten WA sat-set. Kirim chat, VN, atau file langsung.

*PERINTAH CEPAT (BYPASS AI):*
• #ping — Cek status & latency bot
• #todo / #tugas — List tugas pending
• #today — Deadline hari ini
• #week — Deadline 7 hari ke depan
• #<id> — Cek detail tugas (misal: #1)
• #done <id> — Tandai selesai (misal: #done 1)
• #undo — Batalin selesai terakhir
• #del <id> — Hapus tugas (misal: #del 1)
• #add <tugas> — Tambah tugas manual (opsi dl:YYYY-MM-DD #tag)
• #daily <1/0> — On/off rekap harian jam 07:00 WIB
• #help — Tampilkan menu ini

*FITUR LAIN:*
• VN: Dengerin & proses rekaman suara langsung.
• File: Simpan dokumen ke vault + auto OCR.
• Web: Riset info terkini & baca isi URL.
• Python: Hitung presisi & generate chart.`;

async function handleIncomingMessage(msg) {
  console.log(">> Processing message from:", msg.from, "text:", msg.body);
  const toolsCalled = [];
  startTyping(msg.from);
  const typingTimer = setInterval(() => startTyping(msg.from), 6000);
  const watchdogTimer = setTimeout(async () => {
    try {
      await sendText(msg.from, "_Sedang memproses permintaanmu... (mohon tunggu sebentar)_");
    } catch {}
  }, 12000);

  try {
    // 1. Tangani Incoming Media
    if (msg.hasMedia && msg.mediaUrl) {
      // Voice note / Audio -> Proses langsung dengan LLM
      if (msg.mimetype && msg.mimetype.startsWith("audio/")) {
        console.log(`>> Memproses audio: ${msg.filename} (${msg.mimetype})`);
        const buffer = await downloadMedia(msg.mediaUrl);
        const reply = await processChat(rotator, msg.body, {
          store,
          chatId: msg.from,
          onToolCall: (name) => toolsCalled.push(name),
          audio: { buffer, mimetype: msg.mimetype, filename: msg.filename }
        });
        await sendText(msg.from, reply);
        console.log(`>> Sent audio reply to ${msg.from}: ${reply.slice(0, 80).replace(/\n/g, " ")}...`);
        store.saveChatMessage(msg.from, "user", msg.body ? `[Voice Note] ${msg.body}` : "[Pesan Suara VN]");
        store.saveChatMessage(msg.from, "model", reply);
        logInteraction(store.db, {
          prompt: `[AUDIO: ${msg.filename}] ${msg.body || ""}`.trim(),
          tools: toolsCalled,
          status: "success"
        });
        return;
      }

      // Dokumen / Foto / PDF -> Ingest ke Document Vault
      console.log(`>> Mengunduh media vault: ${msg.filename} (${msg.mimetype})`);
      const buffer = await downloadMedia(msg.mediaUrl);
      
      const saved = await ingestVaultFile(store, rotator, {
        buffer,
        filename: msg.filename,
        mimetype: msg.mimetype,
        caption: msg.body,
        ownerId: msg.from
      });

      const reply = `*[Document Vault]*\nFile tersimpan di server.\n\n• ID: ${saved.id}\n• Nama: ${saved.filename}\n• Kategori: #${saved.category}\n\n*Ringkasan:*\n${saved.summary}`;
      await sendText(msg.from, reply);
      console.log(`>> Sent vault reply to ${msg.from}: ID ${saved.id}`);

      logInteraction(store.db, {
        prompt: `[MEDIA: ${msg.filename}] ${msg.body}`,
        tools: ["ingestVaultFile"],
        status: "success"
      });
      return;
    }

    // 2. Tangani Pesan Teks
    const trimmed = (msg.body || "").trim();
    if (!trimmed) return;

    // Fast-path persetujuan hak akses file (SETUJU <id> / TOLAK <id>)
    const decisionMatch = trimmed.match(/^(setuju|tolak)\s+(\d+)$/i);
    if (decisionMatch) {
      const action = decisionMatch[1].toLowerCase();
      const reqId = parseInt(decisionMatch[2], 10);
      const req = store.getFileRequest(reqId);

      if (!req) {
        await sendText(msg.from, `[!] Permintaan akses ID #${reqId} gak ketemu.`);
        return;
      }

      if (req.status !== "pending") {
        await sendText(msg.from, `[i] Permintaan akses ID #${reqId} udah diproses (${req.status}).`);
        return;
      }

      if (normalizePhone(msg.from) !== normalizePhone(req.owner_id)) {
        await sendText(msg.from, `[!] Lu bukan owner dari file ini.`);
        return;
      }

      const file = store.getVaultFileById(req.file_id);

      if (action === "setuju") {
        store.respondFileRequest(reqId, "approved");
        store.grantFileAccess(req.file_id, req.requester_id);

        await sendText(msg.from, `[OK] Akses file *${file?.filename || req.file_id}* disetujui buat +${req.requester_id}.`);

        if (file) {
          await sendText(req.requester_id, `[OK] Permintaan akses file *${file.filename}* udah disetujui owner. Ini filenya:`);
          await sendFile(req.requester_id, file.filepath, file.filename, file.summary || file.filename);
        }
      } else {
        store.respondFileRequest(reqId, "rejected");
        await sendText(msg.from, `[x] Permintaan akses file *${file?.filename || req.file_id}* ditolak.`);
        await sendText(req.requester_id, `[!] Permintaan akses lu buat file *${file?.filename || req.file_id}* ditolak owner.`);
      }

      logInteraction(store.db, {
        prompt: trimmed,
        tools: [`fileRequestDecision:${action}`],
        status: "success"
      });
      return;
    }

    // Fast-path deterministic commands (bypass LLM fallback saat AI dunguk/down)
    const fastCmd = parseFastCommand(trimmed);
    if (fastCmd) {
      console.log(`>> Fast command [${fastCmd.type}] from ${msg.from}`);
      const isOwner = normalizePhone(msg.from) === OWNER_PHONE;
      const cmdReply = executeFastCommand(fastCmd, { store, chatId: msg.from, isOwner });
      if (cmdReply) {
        await sendText(msg.from, cmdReply);
        console.log(`>> Sent fast command reply to ${msg.from}: ${cmdReply.slice(0, 60).replace(/\n/g, " ")}`);
        store.saveChatMessage(msg.from, "user", msg.body);
        store.saveChatMessage(msg.from, "model", cmdReply);
        logInteraction(store.db, {
          prompt: trimmed,
          tools: [`fastCommand:${fastCmd.type}`],
          status: "success"
        });
        return;
      }
    }

    const reply = await processChat(rotator, msg.body, {
      store,
      chatId: msg.from,
      onToolCall: (name) => toolsCalled.push(name)
    });

    if (reply && reply.trim() !== "[NO_REPLY]" && !reply.trim().startsWith("[NO_REPLY]")) {
      await sendText(msg.from, reply);
      console.log(`>> Sent reply to ${msg.from}: ${reply.slice(0, 80).replace(/\n/g, " ")}...`);
      store.saveChatMessage(msg.from, "user", msg.body);
      store.saveChatMessage(msg.from, "model", reply);
    } else {
      console.log(`>> Suppressed reply [NO_REPLY] for ${msg.from}`);
    }

    logInteraction(store.db, {
      prompt: msg.body,
      tools: toolsCalled,
      status: "success"
    });
  } catch (err) {
    console.error("Gagal proses chat:", err.message);
    await sendText(msg.from, "[!] Gagal memproses permintaan.");

    logInteraction(store.db, {
      prompt: msg.body || "[No Body]",
      tools: toolsCalled,
      status: "error",
      error: err.message
    });
  } finally {
    clearTimeout(watchdogTimer);
    clearInterval(typingTimer);
    stopTyping(msg.from);
  }
}

const app = createServer(handleIncomingMessage, { store, rotator });
app.listen(PORT, () => {
  console.log(`🚀 John Mustard Bot Server aktif di port ${PORT}`);
  console.log(`🔑 Terpasang ${keys.length} Gemini API Key`);
  console.log(`📱 Whitelist nomor WA: ${process.env.WHITELIST_PHONE || process.env.ALLOWED_PHONE || "SEMUA"}`);
  console.log(`📦 Document Vault storage siap di folder ./vault`);
  console.log(`⚡ FastMCP SSE Endpoint: http://localhost:${PORT}/mcp/sse`);
});
