import { createServer } from "./server.js";
import { KeyRotator } from "./rotator.js";
import { Storage, logInteraction, normalizePhone, formatBacklogList, OWNER_PHONE } from "./db.js";
import { startScheduler } from "./scheduler.js";
import { processChat } from "./llm.js";
import { sendText, sendFile, downloadMedia, startTyping, stopTyping } from "./waha.js";
import { ingestVaultFile } from "./vault.js";

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
startScheduler(store);

const HELP_TEXT = `📋 *[JOHN MUSTARD — EXECUTIVE ASSISTANT]* 🕶️
Halo! Saya John Mustard, asisten pribadi eksekutif berbasis WhatsApp yang siap bantu kebutuhan harianmu ("sat-set").

✨ *KEMAMPUAN UTAMA:*

1️⃣ *To-Do List & Deadline Tracker* 📝
• Tambah tugas: _"Tambahkan tugas LKP 6 Analgor deadline besok jam 23.59 #analgor"_
• Lihat daftar: _"Lihat to do"_ / _"Cek tugas"_
• Koreksi/Ubah: _"Ubah tugas pitching game sheet jadi pitching gameseed jam 09.30"_
• Selesai: _"Tandai tugas ID 1 selesai"_
• Hapus: _"Hapus tugas pitching gameseed"_

2️⃣ *Pesan Suara (Voice Note / VN)* 🎙️
• Bicara langsung via voice note WhatsApp! John Mustard bisa langsung dengerin dan eksekusi to-do, reminder, atau jawab pertanyaan.

3️⃣ *Pengingat Otomatis (Reminder)* ⏰
• _"Ingatkan aku ada seminar besok jam 10 pagi"_
• Otomatis ping WhatsApp kamu saat waktunya tiba!

4️⃣ *Document Vault & Hak Akses File* 📁
• Kirim file dokumen, PDF, struk transfer, nota, atau KTP langsung ke sini.
• Otomatis disimpan ke brankas pribadi dan dibuat ringkasan OCR.
• Cari dokumen: _"Carikan struk transfer kemarin"_
• Minta kirim file: _"Kirim file KTP aku"_
• Bagikan file ke teman: _"Beri akses file ID 3 ke 08123456789"_
• Minta izin file orang: _"Minta akses file ID 5"_
• Persetujuan akses: Balas _"SETUJU <ID>"_ atau _"TOLAK <ID>"_

5️⃣ *Browsing & Web Search Real-Time* 🌐
• Cari berita/info terkini: _"Cari berita terbaru soal teknologi AI minggu ini"_
• Riset & cek fakta: _"Siapa rektor UI sekarang?"_, _"Berapa kurs dollar hari ini?"_
• Riset topik/tugas kuliah langsung dari internet!

6️⃣ *Tanya Jawab & Brainstorming* 💡
• Tanya topik apa saja, cari ide/judul skripsi, draft pesan penting, dsb.

7️⃣ *Ide & Feature Backlog (Khusus Owner)* 🛠️
• Simpan ide: _"#backlog Tambah fitur export database"_
• Cek ide: _"#backlog"_ atau _"#backlog list"_
• Tandai selesai: _"#backlog done 1"_

Ketik *?help* kapan saja untuk membuka menu bantuan ini!`;

async function handleIncomingMessage(msg) {
  console.log(">> Processing message from:", msg.from, "text:", msg.body);
  const toolsCalled = [];
  startTyping(msg.from);
  const typingTimer = setInterval(() => startTyping(msg.from), 6000);

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

      const reply = `📁 *[Document Vault]*\nDokumen berhasil disimpan ke server!\n\n📌 *ID File:* ${saved.id}\n📄 *Nama:* ${saved.filename}\n🏷️ *Kategori:* #${saved.category}\n\n📝 *Ringkasan:*\n${saved.summary}`;
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
        await sendText(msg.from, `⚠️ Permintaan akses ID #${reqId} tidak ditemukan.`);
        return;
      }

      if (req.status !== "pending") {
        await sendText(msg.from, `ℹ️ Permintaan akses ID #${reqId} sudah diproses sebelumnya (${req.status}).`);
        return;
      }

      if (normalizePhone(msg.from) !== normalizePhone(req.owner_id)) {
        await sendText(msg.from, `⛔ Anda bukan pemilik file dari permintaan ini.`);
        return;
      }

      const file = store.getVaultFileById(req.file_id);

      if (action === "setuju") {
        store.respondFileRequest(reqId, "approved");
        store.grantFileAccess(req.file_id, req.requester_id);

        await sendText(msg.from, `✅ Akses file *${file?.filename || req.file_id}* berhasil disetujui untuk +${req.requester_id}.`);

        if (file) {
          await sendText(req.requester_id, `🎉 Permintaan akses file *${file.filename}* telah disetujui oleh pemilik! Dokumen dikirim:`);
          await sendFile(req.requester_id, file.filepath, file.filename, file.summary || file.filename);
        }
      } else {
        store.respondFileRequest(reqId, "rejected");
        await sendText(msg.from, `❌ Permintaan akses file *${file?.filename || req.file_id}* telah ditolak.`);
        await sendText(req.requester_id, `⚠️ Permintaan akses Anda untuk file *${file?.filename || req.file_id}* ditolak oleh pemilik.`);
      }

      logInteraction(store.db, {
        prompt: trimmed,
        tools: [`fileRequestDecision:${action}`],
        status: "success"
      });
      return;
    }

    // Fast-path command #backlog (khusus owner)
    const backlogMatch = trimmed.match(/^#backlog(\s+(.*))?$/is);
    if (backlogMatch) {
      if (normalizePhone(msg.from) !== OWNER_PHONE) {
        await sendText(msg.from, "⛔ Fitur #backlog hanya khusus untuk nomor owner.");
        return;
      }

      const sub = (backlogMatch[2] || "").trim();
      const doneMatch = sub.match(/^done\s+(\d+)$/i);

      if (!sub || sub.toLowerCase() === "list") {
        const list = store.getBacklogs(msg.from);
        await sendText(msg.from, formatBacklogList(list));
      } else if (doneMatch) {
        const bId = parseInt(doneMatch[1], 10);
        const changed = store.completeBacklog(bId, msg.from);
        if (changed > 0) {
          await sendText(msg.from, `✅ Ide improvement *[#${bId}]* berhasil ditandai selesai!`);
        } else {
          await sendText(msg.from, `⚠️ Ide improvement *[#${bId}]* tidak ditemukan.`);
        }
      } else {
        const bId = store.addBacklog(msg.from, sub);
        await sendText(msg.from, `💡 *[Backlog Improvement]*\nBerhasil dicatat!\n📌 *ID:* #${bId}\n📝 *Ide:* ${sub}`);
      }

      logInteraction(store.db, {
        prompt: trimmed,
        tools: ["backlog"],
        status: "success"
      });
      return;
    }

    // Fast-path command ?help
    if (
      trimmed === "?help" ||
      trimmed === "/help" ||
      trimmed === "!help" ||
      trimmed.toLowerCase() === "help" ||
      trimmed.toLowerCase() === "? help"
    ) {
      console.log(`>> Direct ?help command from ${msg.from}`);
      await sendText(msg.from, HELP_TEXT);
      console.log(`>> Sent reply to ${msg.from}: [HELP_TEXT]`);
      logInteraction(store.db, {
        prompt: trimmed,
        tools: ["helpMenu"],
        status: "success"
      });
      return;
    }

    const reply = await processChat(rotator, msg.body, {
      store,
      chatId: msg.from,
      onToolCall: (name) => toolsCalled.push(name)
    });

    await sendText(msg.from, reply);
    console.log(`>> Sent reply to ${msg.from}: ${reply.slice(0, 80).replace(/\n/g, " ")}...`);
    store.saveChatMessage(msg.from, "user", msg.body);
    store.saveChatMessage(msg.from, "model", reply);

    logInteraction(store.db, {
      prompt: msg.body,
      tools: toolsCalled,
      status: "success"
    });
  } catch (err) {
    console.error("Gagal proses chat:", err.message);
    await sendText(msg.from, "⚠️ Terjadi kendala saat memproses permintaan.");

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

const app = createServer(handleIncomingMessage);
app.listen(PORT, () => {
  console.log(`🚀 John Mustard Bot Server aktif di port ${PORT}`);
  console.log(`🔑 Terpasang ${keys.length} Gemini API Key`);
  console.log(`📱 Whitelist nomor WA: ${process.env.WHITELIST_PHONE || process.env.ALLOWED_PHONE || "SEMUA"}`);
  console.log(`📦 Document Vault storage siap di folder ./vault`);
});
