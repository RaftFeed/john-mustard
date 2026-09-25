import { createServer } from "./server.js";
import { KeyRotator } from "./rotator.js";
import { Storage, logInteraction, normalizePhone, formatBacklogList, OWNER_PHONE } from "./db.js";
import { startScheduler } from "./scheduler.js";
import { processChat } from "./llm.js";
import { sendText, sendFile, downloadMedia, startTyping, stopTyping } from "./waha.js";
import { ingestVaultFile } from "./vault.js";
import { parseFastCommand, executeFastCommand } from "./commands.js";
import { autoCrystallizeTurn } from "./crystallize.js";
import { initSkillsWatcher } from "./skills_sync.js";

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

// 2-Way Skills Sync Engine (Disk Markdown <-> SQLite DB)
const SKILLS_DIR = process.env.SKILLS_DIR || "skills";
initSkillsWatcher(store, SKILLS_DIR);

const HELP_TEXT = `*[Halow aku Maarbot 👋]*
_Ilkomerz61's Memory Augmented Academic Recollection BOT_

*USER GUIDE (TUTOR SETUP MARBOT)*
https://ipb.link/marbot

*Perintah Umum:*
- #ping — cek bot hidup & latency
- #tugas — lihat semua tugas (global)
- #today — tugas deadline hari ini
- #week — tugas 7 hari ke depan
- #help — bantuan

*Perintah Personal:*
- #todo — lihat tugas pribadi kamu
- #<id> — lihat detail tugas dari #todo
- #done <id> — tandai selesai
- #undo — batalkan #done terakhir

*Perintah Pengaturan:*
- #setkelas paket<1-5> — atur kelas otomatis sesuai paket KRS (1-5)
- #setkelas paket — lihat daftar detail isi paket 1-5
- #setkelas <matkul> <kode1> <kode2> — atur kode pararel untuk matkul
- #setkelas asah <track> — atur track Asah 2026 Dicoding (AI / FS / DS / NONE)
- #mykelas — lihat settings kode parallel kamu
- #daily <1/0> — aktifkan/matikan reminder #todo harian

*Perintah Developer (Umum):*
- #apikey new <nama> — buat API key baru
- #apikey remove <nama> — hapus API key tertentu
- #apikey list — lihat daftar nama API key
- #apikey check <nama> — cek detail API key
- #apidocs — dokumentasi REST API Marbot

*Perintah Admin:*
- #delete <id> — hapus tugas (id dari #tugas)
- #update <id> <pesan> — update tugas dengan AI
- #announcement <pesan> — simpan pengumuman dengan deadline (grup akademik)

*Penting:* #<id> dan #done selalu pakai nomor dari *#todo*. _Info tugas akan otomatis tersimpan via grup info akademik, tidak dari chat lain._

*Want to Contribute?*
github.com/gimigkk/marbot-academic-bot`;

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
        const audioTrajectory = [];
        const reply = await processChat(rotator, msg.body, {
          store,
          chatId: msg.from,
          onToolCall: (name) => toolsCalled.push(name),
          onTrajectory: (traj) => audioTrajectory.push(...traj),
          audio: { buffer, mimetype: msg.mimetype, filename: msg.filename }
        });
        await sendText(msg.from, reply);
        console.log(`>> Sent audio reply to ${msg.from}: ${reply.slice(0, 80).replace(/\n/g, " ")}...`);
        store.saveChatMessage(msg.from, "user", msg.body ? `[Voice Note] ${msg.body}` : "[Pesan Suara VN]");
        store.saveChatMessage(msg.from, "model", reply);

        // Voyager pattern: autonomous background crystallization (zero added latency)
        queueMicrotask(() => {
          autoCrystallizeTurn({
            senderName: msg.from,
            userMessage: msg.body ? `[Voice Note] ${msg.body}` : "[Voice Note]",
            executedTools: audioTrajectory,
            finalReply: reply,
            store,
            rotator
          }).catch((err) => console.warn("[Crystallize] Background reflection error:", err.message));
        });
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

    const textTrajectory = [];
    const reply = await processChat(rotator, msg.body, {
      store,
      chatId: msg.from,
      onToolCall: (name) => toolsCalled.push(name),
      onTrajectory: (traj) => textTrajectory.push(...traj)
    });

    if (reply && reply.trim() !== "[NO_REPLY]" && !reply.trim().startsWith("[NO_REPLY]")) {
      await sendText(msg.from, reply);
      console.log(`>> Sent reply to ${msg.from}: ${reply.slice(0, 80).replace(/\n/g, " ")}...`);
      store.saveChatMessage(msg.from, "user", msg.body);
      store.saveChatMessage(msg.from, "model", reply);

      // Voyager pattern: autonomous background crystallization (zero added latency)
      queueMicrotask(() => {
        autoCrystallizeTurn({
          senderName: msg.from,
          userMessage: msg.body || "",
          executedTools: textTrajectory,
          finalReply: reply,
          store,
          rotator
        }).catch((err) => console.warn("[Crystallize] Background reflection error:", err.message));
      });
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
  console.log(`🧠 2-Way Skills Sync aktif di folder ./${SKILLS_DIR}`);
  console.log(`⚡ FastMCP SSE Endpoint: http://localhost:${PORT}/mcp/sse`);
});
