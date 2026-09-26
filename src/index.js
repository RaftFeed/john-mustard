import { createServer } from "./server.js";
import { KeyRotator } from "./rotator.js";
import { Storage, logInteraction, normalizePhone, formatBacklogList, OWNER_PHONE, isOwner } from "./db.js";
import { startScheduler } from "./scheduler.js";
import { processChat } from "./llm.js";
import { sendText, sendFile, downloadMedia, startTyping, stopTyping, fetchBotNumber, getBotLid } from "./waha.js";
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

const HELP_TEXT = `*[🤠 MY NAME IS JOHN MUSTARDDD DEW DEW DEW 🥀]*
_Autonomous WhatsApp AI & Fast Command Engine_

*Perintah Umum (Bypass AI):*
- #ping — Cek status, latency, RAM & uptime
- #dew — MY NAME IS JOHN MUSTARDDD 🤠
- #help — Tampilkan menu panduan ini

*Perintah To-Do & Tugas (Manual):*
- #tugas / #todo — Lihat to-do list pending
- #today — Tugas deadline hari ini
- #week — Tugas 7 hari ke depan
- #<id> — Cek detail tugas (misal: #1)
- #add <tugas> — Tambah tugas (opsi: dl:YYYY-MM-DD #tag)
- #update <id> <pesan> — Edit tugas (misal: #update 1 Pitching gameseed dl:2026-09-27)
- #done <id> — Tandai tugas selesai
- #undo — Batalkan #done terakhir
- #del <id> — Hapus tugas (misal: #del 1)

*Perintah Otomasi & Pengaturan:*
- #daily <1/0> — Aktifkan/matikan rekap to-do jam 07:00 WIB
- #skills — Lihat daftar skill & macro otomatis

*Perintah Owner / Admin:*
- #health / #server — Cek kesehatan server, CPU, RAM, disk & DB
- #mc / #minecraft — Cek status server Minecraft & player aktif
- #backlog <ide> — Catat ide fitur/perbaikan
- #backlog list — Lihat daftar backlog ide
- #backlog done <id> — Tandai backlog selesai

*Fitur Otomatis (Langsung Chat / VN):*
- Voice Note: Kirim rekaman suara apa pun, langsung diproses sat-set.
- Document Vault: Kirim foto/PDF/struk/KTP -> auto OCR & disimpan.
- Web Search: Tanya info terkini, berita, cuaca, harga, atau skor bola.
- Chat Bebas: Diskusi, riset, coding, kalkulasi matematika, dsb.

*Catatan:* Perintah dengan awalan *#* dieksekusi instan tanpa LLM (cepat, akurat, anti-halu).`;

async function handleIncomingMessage(msg) {
  console.log(">> Processing message from:", msg.from, "text:", msg.body);
  const toolsCalled = [];
  startTyping(msg.from);
  const typingTimer = setInterval(() => startTyping(msg.from), 6000);

  const isGroup = Boolean(msg.isGroup || String(msg.from).endsWith("@g.us"));
  const person = store.getPerson ? (store.getPerson(msg.senderNumber) || store.getPerson(msg.from)) : null;
  const senderDisplayName = person?.name || (msg.senderNumber ? `+${msg.senderNumber}` : "");
  const senderLabel = isGroup && senderDisplayName ? `[${senderDisplayName}]: ` : "";

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
          senderNumber: msg.senderNumber,
          onToolCall: (name) => toolsCalled.push(name),
          onTrajectory: (traj) => audioTrajectory.push(...traj),
          audio: { buffer, mimetype: msg.mimetype, filename: msg.filename },
          mailbox: msg.mailbox
        });
        await sendText(msg.from, reply);
        console.log(`>> Sent audio reply to ${msg.from}: ${reply.slice(0, 80).replace(/\n/g, " ")}...`);
        store.saveChatMessage(msg.from, "user", msg.body ? `${senderLabel}[Voice Note] ${msg.body}` : `${senderLabel}[Pesan Suara VN]`);
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

      // 2. Stiker WhatsApp -> DILARANG simpan ke Document Vault! Respon ledekan / komentar santai via Vision
      if (msg.isSticker) {
        console.log(`>> Memproses stiker WhatsApp dari ${msg.from}`);
        let reply = "";
        try {
          const buffer = await downloadMedia(msg.mediaUrl);
          const prompt = [
            "[Stiker WhatsApp diterima].",
            msg.body ? `Teks pengiring: "${msg.body}".` : "",
            "Perhatikan stiker ini baik-baik. Karakter sedang melakukan apa dan bagaimana ekspresinya?",
            "Beri respon ledekin santai, celetukan kocak, atau reaksi akrab khas John Mustard sesuai konteks stikernya (1-2 kalimat pendek, santai, anti-slop, tanpa basa-basi)."
          ].filter(Boolean).join(" ");

          reply = await processChat(rotator, prompt, {
            store,
            chatId: msg.from,
            senderNumber: msg.senderNumber,
            onToolCall: (name) => toolsCalled.push(name),
            media: { buffer, mimetype: msg.mimetype || "image/webp", filename: "sticker.webp" },
            mailbox: msg.mailbox
          });
        } catch (err) {
          console.warn("[Sticker] Vision chat error, fallback used:", err.message);
        }

        if (!reply || reply.trim() === "[NO_REPLY]") {
          const fallbacks = [
            "Wkwk stiker apa tuh, lemes bener kayanya 🗿",
            "Napa tuh ekspresinya begitu amat wkwk 😂",
            "Muka stikernya mewakili batin banget ya wkwk 🥀",
            "Wkwk pasrah amat itu stiker 😭"
          ];
          reply = fallbacks[Math.floor(Math.random() * fallbacks.length)];
        }

        await sendText(msg.from, reply);
        console.log(`>> Sent sticker reply to ${msg.from}: ${reply.slice(0, 80).replace(/\n/g, " ")}...`);
        store.saveChatMessage(msg.from, "user", msg.body ? `${senderLabel}[Stiker] ${msg.body}` : `${senderLabel}[Stiker WhatsApp]`);
        store.saveChatMessage(msg.from, "model", reply);
        logInteraction(store.db, {
          prompt: `[STICKER] ${msg.body || ""}`.trim(),
          tools: toolsCalled,
          status: "success"
        });
        return;
      }

      // 2. Di Grup Keluarga: Dokumen/Foto/PDF langsung dianalisis & diringkas lewat LLM
      if (isGroup) {
        console.log(`>> Memproses dokumen/media grup dari ${msg.from}: ${msg.filename} (${msg.mimetype})`);
        const buffer = await downloadMedia(msg.mediaUrl);
        const mediaTrajectory = [];
        const reply = await processChat(rotator, msg.body, {
          store,
          chatId: msg.from,
          senderNumber: msg.senderNumber,
          onToolCall: (name) => toolsCalled.push(name),
          onTrajectory: (traj) => mediaTrajectory.push(...traj),
          media: { buffer, mimetype: msg.mimetype, filename: msg.filename },
          mailbox: msg.mailbox
        });

        if (reply && reply.trim() !== "[NO_REPLY]") {
          await sendText(msg.from, reply);
          console.log(`>> Sent group media reply to ${msg.from}: ${reply.slice(0, 80).replace(/\n/g, " ")}...`);
          store.saveChatMessage(msg.from, "user", msg.body ? `${senderLabel}[Dokumen: ${msg.filename}] ${msg.body}` : `${senderLabel}[Dokumen: ${msg.filename}]`);
          store.saveChatMessage(msg.from, "model", reply);
        }

        logInteraction(store.db, {
          prompt: `[MEDIA: ${msg.filename}] ${msg.body || ""}`.trim(),
          tools: toolsCalled,
          status: "success"
        });
        return;
      }

      // 3. Di DM Pribadi: Jika user menyertakan teks pertanyaan/diskusi (dan bukan perintah simpan ke vault), proses langsung via LLM
      const isExplicitVaultSave = msg.body && /\b(simpan|save|arsip|#vault|masukkan\s+ke\s+vault|catat\s+ke\s+vault)\b/i.test(msg.body);
      const hasUserCaption = Boolean(msg.body && msg.body.trim());

      if (hasUserCaption && !isExplicitVaultSave) {
        console.log(`>> Memproses dokumen/media DM untuk analisis langsung: ${msg.filename} (${msg.mimetype})`);
        const buffer = await downloadMedia(msg.mediaUrl);
        const mediaTrajectory = [];
        const reply = await processChat(rotator, msg.body, {
          store,
          chatId: msg.from,
          senderNumber: msg.senderNumber,
          onToolCall: (name) => toolsCalled.push(name),
          onTrajectory: (traj) => mediaTrajectory.push(...traj),
          media: { buffer, mimetype: msg.mimetype, filename: msg.filename },
          mailbox: msg.mailbox
        });

        if (reply && reply.trim() !== "[NO_REPLY]") {
          await sendText(msg.from, reply);
          console.log(`>> Sent DM media analysis reply to ${msg.from}: ${reply.slice(0, 80).replace(/\n/g, " ")}...`);
          store.saveChatMessage(msg.from, "user", `${senderLabel}[Media: ${msg.filename}] ${msg.body}`);
          store.saveChatMessage(msg.from, "model", reply);
        }

        logInteraction(store.db, {
          prompt: `[MEDIA: ${msg.filename}] ${msg.body || ""}`.trim(),
          tools: toolsCalled,
          status: "success"
        });
        return;
      }

      // 4. Default DM: Ingest ke Document Vault
      if (msg.isSticker || msg.mimetype === "image/webp") {
        console.log(`>> Mengabaikan media webp/stiker dari vault ingest`);
        return;
      }

      console.log(`>> Mengunduh media vault: ${msg.filename} (${msg.mimetype})`);
      const buffer = await downloadMedia(msg.mediaUrl);
      
      const saved = await ingestVaultFile(store, rotator, {
        buffer,
        filename: msg.filename,
        mimetype: msg.mimetype,
        caption: msg.body,
        ownerId: msg.senderNumber || msg.from
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
    const cmdText = trimmed.replace(/^@\S+\s*/, "").trim();
    const fastCmd = parseFastCommand(cmdText) || parseFastCommand(trimmed);
    if (fastCmd) {
      console.log(`>> Fast command [${fastCmd.type}] from ${msg.from}`);
      const isOwnerUser = isOwner(msg.from, msg.senderNumber);
      const cmdReply = await executeFastCommand(fastCmd, {
        store,
        chatId: msg.from,
        isOwner: isOwnerUser,
        senderNumber: msg.senderNumber,
        senderName: person?.name || ""
      });
      if (cmdReply) {
        await sendText(msg.from, cmdReply);
        console.log(`>> Sent fast command reply to ${msg.from}: ${cmdReply.slice(0, 60).replace(/\n/g, " ")}`);
        store.saveChatMessage(msg.from, "user", `${senderLabel}${msg.body}`);
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
      senderNumber: msg.senderNumber,
      onToolCall: (name) => toolsCalled.push(name),
      onTrajectory: (traj) => textTrajectory.push(...traj),
      mailbox: msg.mailbox
    });

    if (reply && reply.trim() !== "[NO_REPLY]" && !reply.trim().startsWith("[NO_REPLY]")) {
      await sendText(msg.from, reply);
      console.log(`>> Sent reply to ${msg.from}: ${reply.slice(0, 80).replace(/\n/g, " ")}...`);
      store.saveChatMessage(msg.from, "user", `${senderLabel}${msg.body}`);
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
    await sendText(msg.from, "[!] Waduh, gagal proses nih. Coba lagi bentar ya.");

    logInteraction(store.db, {
      prompt: msg.body || "[No Body]",
      tools: toolsCalled,
      status: "error",
      error: err.message
    });
  } finally {
    clearInterval(typingTimer);
    stopTyping(msg.from);
  }
}

const app = createServer(handleIncomingMessage, { store, rotator });
app.listen(PORT, () => {
  console.log(`[Server] John Mustard Bot aktif di port ${PORT}`);
  console.log(`[Auth] Terpasang ${keys.length} Gemini API Key`);
  console.log(`[Whitelist] Nomor WA: ${process.env.WHITELIST_PHONE || process.env.ALLOWED_PHONE || "SEMUA"}`);
  console.log(`[Vault] Document Vault siap di folder ./vault`);
  console.log(`[Skills] 2-Way Skills Sync aktif di folder ./${SKILLS_DIR}`);
  console.log(`[MCP] FastMCP SSE Endpoint: http://localhost:${PORT}/mcp/sse`);
  function pollBotNumber() {
    fetchBotNumber().then((num) => {
      const lid = getBotLid();
      if (num && lid) {
        console.log(`[WAHA] Bot identity nomor WA terdeteksi: +${num} (LID: ${lid})`);
      } else if (num && !lid) {
        console.log(`[WAHA] Bot identity nomor WA terdeteksi: +${num}, menunggu sync LID...`);
        setTimeout(pollBotNumber, 5000);
      } else {
        setTimeout(pollBotNumber, 5000);
      }
    }).catch(() => {
      setTimeout(pollBotNumber, 5000);
    });
  }
  pollBotNumber();
});
