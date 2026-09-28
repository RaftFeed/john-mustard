import fs from "node:fs";
import path from "node:path";
import {
  normalizePhone,
  OWNER_PHONE,
  isOwner,
  DEFAULT_CONTACT_PROFILES
} from "../db.js";
import {
  sendText,
  getWhitelistPhones
} from "../waha.js";
import {
  TOOLS,
  executeTool
} from "./tools.js";
import {
  generateContent,
  selectModelCascade
} from "./cascade.js";
import {
  detectUnexecutedMutationClaim,
  isAmbiguousScheduleStatement,
  isActionIntent,
  isNoFluffRequest,
  isGreetingIntent
} from "./guards.js";
import {
  stripHallucinatedToolChips,
  sanitizeLatexForWhatsApp,
  formatForWhatsApp
} from "./formatters.js";

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

export async function processChat(rotator, userText, { store, chatId, senderNumber = "", onToolCall, onTrajectory = null, audio = null, media = null, mailbox = null, cascade = null, quoted = null } = {}) {
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
- IDENTIFIKASI PENGIRIM (SANGAT PENTING): Di obrolan grup ini, setiap pesan masuk berasal dari anggota keluarga yang berbeda. Selalu periksa tag [Pengirim: ...] atau informasi ACTIVE SPEAKER di bawah! JANGAN PERNAH menyamakan atau mengira pengirim sekarang adalah orang yang sama dengan pesan sebelumnya. Jika pengirim adalah Mami, respon secara khusus ke Mami dan panggil "Mami". DILARANG KERAS memanggil nama anggota lain (seperti Razita/Rafid) jika pesan dikirim oleh Mami!
- TONE & BAHASA: Kamu saat ini berbicara di obrolan grup keluarga. Gunakan gaya bahasa yang sopan, ramah, hangat, dan santun (pakai kata 'aku/kamu' atau netral santun). DILARANG KERAS menggunakan kata 'gw/gua', 'lu/lo', atau slang kasar di grup ini.
- TANPA CATCHPHRASE MEME: JANGAN PERNAH menyertakan catchphrase meme koboi ("MY NAME IS JOHN MUSTARDDD...") di grup keluarga.
- STRAIGHTFORWARD & NO-YAPPING: Jawab langsung pada intinya (1-2 kalimat). Jangan berpanjang lebar atau mendikte di obrolan grup; jika butuh elaborasi, biarkan user reply.
- TUGAS BERSAMA & PENANGGUNG JAWAB: To-do list di obrolan ini adalah daftar tugas bersama keluarga. Jika ada nama penanggung jawab yang disebut (contoh: "Mas", "Mama", "Kakak", "Ayah"), WAJIB sertakan pada parameter 'assignee' di tool addTodo/updateTodo.
- PENGINGAT (REMINDER): Setiap pengingat/reminder yang dibuat di grup ini akan dikirimkan langsung ke obrolan grup saat jatuh tempo.
- DOKUMEN & PDF: Jika menerima dokumen/file, berikan jawaban atau ringkasan 3-5 poin penting yang jelas dan mudah dipahami seluruh keluarga.
- PRIVASI & KEAMANAN: DILARANG membuka, mencari, atau menyebutkan file brankas/vault pribadi pemilik di obrolan grup.
- DILARANG MENGARANG JAM / TUGAS (ANTI-ASUMSI WAKTU & TUGAS): Jika ada anggota keluarga yang memberi kabar, mengeluh, atau berkomentar waktu (contoh: "Jam 17 blom pulang", "masih di jalan", "belum kelar"), DILARANG KERAS mengarang jam baru (seperti menebak jam 19.00) dan DILARANG langsung memanggil updateTodo/updateReminder! WAJIB tanyakan konfirmasi singkat (1 kalimat): "Mau diundur ke jam berapa jadwalnya?".
- RELAY PESAN DI GRUP ("BILANGIN X" / "KASIH TAU X"): Jika anggota grup menyuruh bilangin atau menyampaikan pesan ke orang lain (contoh: "bilangin mami itu cuma typo", "kasih tau razita..."), DILARANG KERAS memanggil tool sendDirectMessage (JANGAN PC / CHAT PRIBADI)! Cukup sampaikan langsung di balasan grup dengan me-mention/men-tag orangnya (misal: "@Mami katanya itu cuma typo doang"). HANYA kirim chat pribadi jika user secara eksplisit menyuruh "pc" atau "japri".
- MENTION / TAG ANGGOTA: Jika me-mention atau ngetag seseorang di obrolan grup, bisa gunakan '@Nama' (misal: @Mami, @Razita, @Rafid) atau format nomor telepon '@<nomor_telepon>' (misal: @6281234567890). DILARANG menggunakan ID LID internal atau nomor acak.`
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
      defaultToneDesc = isGroupChat
        ? `Gaya bahasa ramah, santun, hangat (gunakan kata 'aku/kamu', DILARANG KERAS menggunakan kata 'gw/lu' di grup keluarga).`
        : `Gaya bahasa Gen Z santai, ramah, akrab (luwes pakai gw/lu, santuy, wkwk).`;
      ownershipGuidance = `Karimah adalah pacar / pasangan Rafid. Catatan atau agenda berlabel Karimah adalah miliknya.`;
    } else if (/^razita/i.test(speakerName)) {
      callNameDesc = `Panggil "Razita" atau "Lord" santai.`;
      defaultToneDesc = isGroupChat
        ? `Gaya bahasa ramah, santun, hangat (gunakan kata 'aku/kamu', DILARANG KERAS menggunakan kata 'gw/lu' di grup keluarga).`
        : `Gaya bahasa Gen Z santai dan luwes (gw/lu, wkwk, sat-set, santuy).`;
      ownershipGuidance = `Razita adalah adik kandung Rafid. Sering memanggil Rafid dengan sebutan 'simas' atau 'Mas'. Catatan, jadwal pelajaran sekolah, PR, NISN, atau data sekolah yang tersimpan adalah miliknya.`;
    } else if (isOwnerUser || /rafid|simas/i.test(speakerName)) {
      callNameDesc = isGroupChat
        ? `Panggil "Rafid", "Mas", atau "Lord".`
        : `Panggil "Lord" atau "Mas".`;
      defaultToneDesc = isGroupChat
        ? `Gaya bahasa ramah, santun, hangat (gunakan kata 'aku/kamu', DILARANG KERAS menggunakan kata 'gw/lu' di grup keluarga).`
        : `Gaya bahasa Gen Z santai, akrab, sat-set (gw/lu, wkwk, santuy).`;
      ownershipGuidance = `Rafid adalah Master / Owner Bot. Anggota keluarga dan Razita sering memanggilnya 'simas' (si mas) atau 'Mas'. Data pribadi/umum tanpa penanda khusus adalah miliknya.`;
    } else {
      callNameDesc = `Panggil "${speakerName}".`;
      defaultToneDesc = isGroupChat
        ? `Gaya bahasa ramah, santun, hangat (gunakan kata 'aku/kamu', DILARANG KERAS menggunakan kata 'gw/lu' di grup keluarga).`
        : `Gaya bahasa ramah dan santai.`;
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

  let quotedContext = "";
  if (quoted) {
    const isBotQuoted = Boolean(quoted.fromMe);
    const qPerson = (quoted.senderNumber && store?.getPerson) ? store.getPerson(quoted.senderNumber) : null;
    const qSender = isBotQuoted
      ? "Bot (kamu sendiri)"
      : quoted.senderName || (qPerson?.name ? `${qPerson.name} (+${quoted.senderNumber})` : (quoted.senderNumber ? `+${quoted.senderNumber}` : "lawan bicara"));

    quotedContext = `\n\n[KONTEKS PESAN YANG DI-REPLY]:
- Pesan ini merupakan balasan (reply/quote) langsung ke pesan dari: ${qSender}.
${isBotQuoted
  ? "- PENGGUNA ME-REPLY PESAN BOT: Sambungkan jawabanmu langsung dengan apa yang kamu sampaikan sebelumnya (pertanyaan, konfirmasi, atau daftar to-do/acara). Jika user menyebut nomor urut (contoh: 'nomor 2', 'yang ketiga') atau memberi jawaban singkat (contoh: 'jam 8 aja', 'udah beres'), rujuk ke konteks pesan bot tersebut!"
  : `- Pengguna me-reply pesan dari ${qSender}. Jadikan isi pesan yang di-reply sebagai dasar/rujukan tindakanmu.`}
- DILARANG mengabaikan isi pesan yang di-reply atau menganggapnya topik baru tanpa konteks!`;
  }

  const finalSystemPrompt = systemPrompt + activeSpeakerContext + groupContext + coupleContext + skillsContext + whitelistContext + greetingInstruction + quotedContext;

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
  let effectiveUserText = userText;
  if (isGroupChat && userText && !userText.startsWith(`[Pengirim:`)) {
    const senderTag = speaker?.name ? `${speaker.name} (+${callerPhone})` : `+${callerPhone}`;
    effectiveUserText = `[Pengirim: ${senderTag}]: ${userText}`;
  }

  if (effectiveUserText && effectiveUserText.trim()) {
    userParts.push({ text: effectiveUserText });
    if (isAmbiguousScheduleStatement(userText)) {
      userParts.push({
        text: "[PERINGATAN SISTEM ANTI-ASUMSI]: Pengguna hanya menyampaikan kabar/kendala waktu dan TIDAK memberikan jam target pengganti (contoh: 'jam 7 mah papi blm balik'). DILARANG KERAS MENGARANG JAM BARU (jangan nebak jam 19.00/21.00) dan DILARANG MEMANGGIL updateTodo/updateReminder! WAJIB tanyakan konfirmasi singkat (1 kalimat): 'Mau diundur ke jam berapa jadwalnya?'."
      });
    }
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

  // LLM Autonomy: mode AUTO default, tapi NONE jika jadwal ambigu atau kirim media santai
  const isAmbiguousSchedule = isAmbiguousScheduleStatement(userText);
  const isMediaWithoutAction = Boolean(media && !isActionIntent(userText));
  let toolConfig = (isAmbiguousSchedule || isMediaWithoutAction)
    ? { functionCallingConfig: { mode: "NONE" } }
    : { functionCallingConfig: { mode: "AUTO" } };

  const toolsCalled = [];
  const successfulMutations = [];
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
      if (detectUnexecutedMutationClaim(candidateText, successfulMutations)) {
        if (isAmbiguousSchedule) {
          return "Mau diundur ke jam berapa jadwalnya?";
        }
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
      if (isAmbiguousScheduleStatement(userText) && ((name === "updateTodo" && args.deadlineIso) || (name === "updateReminder" && args.remindAtIso))) {
        resultObj = {
          toolResult: {
            error: "DILARANG mengarang jam baru saat pengguna hanya memberi kabar waktu tanpa menyebutkan jam pengganti. Tanyakan konfirmasi terlebih dahulu: Mau diundur ke jam berapa jadwalnya?"
          }
        };
      } else {
        try {
          resultObj = await executeTool(name, args, { store, chatId, senderNumber, rotator, userText });
        } catch (toolErr) {
          resultObj = { toolResult: { error: toolErr.message } };
        }
      }

      executedTrajectory.push({
        name,
        args,
        result: resultObj.toolResult
      });

      if (resultObj.toolResult && !resultObj.toolResult.error) {
        successfulMutations.push(name);
      }

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

    // Single-turn tool mutation short-circuit: potong latensi 50% untuk mutasi data murni
    const isPureMutation = fnCallParts.every((p) =>
      ["completeTodo", "deleteTodo", "deleteReminder", "updateReminder", "updateTodo", "addTodo", "addReminder"].includes(p.functionCall.name)
    );
    const allSucceeded = successfulMutations.length >= fnCallParts.length;
    const isPureAction = isActionIntent(userText) && !userText.includes("?") && !/\b(kenapa|gimana|bagaimana|apakah|menurut|saran|rekomendasi)\b/i.test(userText);

    if (turns === 1 && isPureMutation && allSucceeded && isPureAction && lastFormattedList) {
      const salute = isGroupChat ? "Beres!" : "Beres, Lord!";
      return `${salute} Data berhasil diperbarui di sistem.\n\n${lastFormattedList}`;
    }

    // Revert toolConfig for subsequent steps
    toolConfig = (isAmbiguousSchedule || isMediaWithoutAction)
      ? { functionCallingConfig: { mode: "NONE" } }
      : { functionCallingConfig: { mode: "AUTO" } };

    // Helmis pattern: Mid-Turn Steering via Mailbox Injection
    if (injectMailboxSteering(mailbox, contents)) {
      if (turns >= MAX_STEPS - 1) turns = MAX_STEPS - 2;
    }
  }

  const directText = currentCandidate?.content?.parts?.find((p) => p.text)?.text;
  const text = directText?.trim();
  let finalReply = "";

  if (text) {
    if (lastFormattedList && !text.includes(lastFormattedList)) {
      const isCorruptedList = text.includes("Pengingat Tugas") || text.includes("⏰") || /\[\d+\]/.test(text);
      if (isCorruptedList) {
        // Model tried to re-format list itself (often mimicking old chat history)
        const headerIdx = text.search(/🌄|🌅|\[Pengingat Tugas\]|\[1\]/);
        const preamble = headerIdx > 0 ? text.slice(0, headerIdx).trim() : "";
        finalReply = preamble ? `${preamble}\n\n${lastFormattedList}` : lastFormattedList;
      } else {
        finalReply = `${text}\n\n${lastFormattedList}`;
      }
    } else {
      finalReply = text;
    }
  } else {
    finalReply = lastFormattedList || (isGroupChat ? "Beres." : "Beres, Lord.");
  }

  finalReply = stripHallucinatedToolChips(finalReply);
  finalReply = sanitizeLatexForWhatsApp(finalReply);
  finalReply = formatForWhatsApp(finalReply);

  if (isAmbiguousSchedule && detectUnexecutedMutationClaim(finalReply, successfulMutations)) {
    finalReply = "Mau diundur ke jam berapa jadwalnya?";
  }

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
