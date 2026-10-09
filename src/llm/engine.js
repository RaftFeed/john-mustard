const THOUGHT_OPENER_REGEX = /^(?:Analyzing\b|Thinking Process|Chain of Thought|My Initial Approach|Understanding the User|Okay,\s*(?:here'?s|let'?s|let\s*me|i(?:'ll|\s+need|\s+should|\s+will|\s+can|\s+think|\s+see|\s+have|'m)|break\s*down)|Interpretation|Breakdown|Examining|Investigating|Process(?:ing)?:|Wait\b|Hmm+\b|Let\s*me\b|Let'?s\b|Aha!?\b|Look at\b|Now I\b|I (?:need|should|will|can|think|see|have)\b|The tool\b|The response\b|So the\b|Alright\b|First,\s|Debugging\b|Troubleshooting\b|Diagnostic\b)/i;

// Hard reasoning fingerprints: leaked tool-result dumps / raw tool-call notation.
// These never appear in a genuine user-facing reply, so they are never salvageable.
const THOUGHT_FINGERPRINT_REGEX = /(?:\bdefault_api:\s*\w|\bLet'?s re-?read\b|\bre-?read the (?:first|previous)\b|\btool (?:output|result|call)s?\b|"(?:deletedId|formattedList|remainingCount|toolResult|todoId|success)"|\btool_calls\b|\bchain[- ]of[- ]thought\b|\b(?:I\s+just\s+called|called|calling|I just tried to|tried calling)\s+\w+(?:Todo|Reminder|Detail)\b|\bwith todoId:\b|\bgetTodoDetail\b|\b(?:in the output of|output of)\s+\w+(?:Todos|Reminders)\b|\btodo:\s*\{[^}]*id:\s*\d+)/i;

// A real reply appended after a reasoning preamble (used to salvage mixed outputs).
const THOUGHT_TRAILING_REPLY_REGEX = /\n\n(?=(?:🤠|🌄|🌅|⏰|Siap|Beres|Halo|Woles|Waduh|Oke|Baik|Yuk|Untuk|Berikut|Daftar|Maaf|Tentu|Ada\b|Saya\b|Aku\b|Gue\b|Gw\b|Lord\b|Mami\b|Papi\b|\[(?:To-Do|Pengingat|\d+)[^\]]*\]|\*[A-Z])[^\n]*)/i;

// Header penanda output "daftar penuh" (to-do list / daftar acara). Kartu satuan (add/update) tidak termasuk.
const FULL_LIST_HEADER_REGEX = /\[To-Do List|\[Daftar Acara & Agenda\]|\[Daftar Acara & Pengingat\]|\[Jadwal Hari |Tidak ada tugas pending/i;

// Tool yang menerima nomor urut visual; dipakai untuk pra-resolve per batch.
const TODO_INDEX_ARG_BY_TOOL = { completeTodo: "todoId", deleteTodo: "todoId", updateTodo: "todoId", getTodoDetail: "todoId" };
const REMINDER_INDEX_ARG_BY_TOOL = { deleteReminder: "reminderId", updateReminder: "reminderId" };
// Nomor urut untuk batal-selesai diresolusi terhadap daftar yang menyertakan tugas selesai.
const UNCOMPLETE_INDEX_ARG_BY_TOOL = { uncompleteTodo: "todoId" };

export function isInternalThoughtText(text) {
  if (!text || typeof text !== "string") return false;
  const t = text.trim().replace(/^[\s#*_~`>]+/, "");
  return THOUGHT_OPENER_REGEX.test(t) || THOUGHT_FINGERPRINT_REGEX.test(t);
}

export function stripThoughtBlocks(text) {
  if (!text || typeof text !== "string") return "";
  const cleaned = text.replace(/<thought>[\s\S]*?<\/thought>/gi, "").trim();

  if (isInternalThoughtText(cleaned)) {
    // Check if there is an Indonesian/formatted response section after thought paragraphs
    const match = cleaned.match(THOUGHT_TRAILING_REPLY_REGEX);
    if (match && match.index !== undefined) {
      const trailing = cleaned.slice(match.index).trim();
      // Only salvage if trailing part is a clean user-facing reply (not containing leaked tool dumps)
      if (!THOUGHT_FINGERPRINT_REGEX.test(trailing) && !isInternalThoughtText(trailing)) {
        return trailing;
      }
    }
    // Tool-result dumps / raw tool-call notation without clean trailing reply: drop entirely
    if (THOUGHT_FINGERPRINT_REGEX.test(cleaned)) {
      return "";
    }
    // Entire text is internal thinking trace
    return "";
  }

  return cleaned;
}

export function extractCandidateText(content) {
  if (!content || !Array.isArray(content.parts)) return "";

  // 1. Prioritaskan parts yang bukan internal thought/reasoning (thought !== true)
  const nonThoughtParts = content.parts.filter((p) => p.text && !p.thought);
  if (nonThoughtParts.length > 0) {
    let combined = nonThoughtParts.map((p) => p.text).join("\n").trim();
    combined = stripThoughtBlocks(combined);
    if (isInternalThoughtText(combined)) {
      return "";
    }
    return combined;
  }

  // 2. Fallback jika seluruh part bertanda thought atau hanya 1 text part
  const anyTextPart = content.parts.find((p) => p.text);
  if (!anyTextPart) return "";
  let raw = anyTextPart.text;
  raw = stripThoughtBlocks(raw);
  if (isInternalThoughtText(raw)) {
    // Seluruh teks adalah CoT internal yang bocor, jangan kirim ke user
    return "";
  }
  return raw;
}

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
  getWhitelistPhones,
  resolveWhitelistRecipient
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
  isListRequest,
  isGreetingIntent,
  hasExplicitRescheduleIntent,
  isFollowUpReminderIntent,
  isQuotedEventReminder,
  isAmbiguousEventReply,
  isVagueCommandWithoutTarget
} from "./guards.js";
import {
  stripHallucinatedToolChips,
  sanitizeLatexForWhatsApp,
  formatForWhatsApp
} from "./formatters.js";
import { parseFastCommand } from "../commands.js";

export function injectMailboxSteering(mailbox, contents) {
  if (!mailbox || mailbox.length === 0) return false;
  const steered = mailbox.splice(0, mailbox.length);
  const texts = steered
    .filter((m) => {
      const clean = (m.body || "").replace(/^@\S+\s*/, "").trim();
      return !parseFastCommand(clean) && !parseFastCommand(m.body || "");
    })
    .map((m) => m.body)
    .filter(Boolean);
  if (texts.length === 0) return false;

  const directive = `[UPDATE INSTRUKSI PENGGUNA SAAT INI]:\n${texts.join("\n")}\nSesuaikan sisa tindakan dengan instruksi terbaru ini.`;
  if (contents.length > 0 && contents[contents.length - 1].role === "user") {
    contents[contents.length - 1].parts.push({ text: directive });
  } else {
    contents.push({ role: "user", parts: [{ text: directive }] });
  }
  return true;
}

export async function processChat(rotator, userText, { store, chatId, senderNumber = "", senderName = "", onToolCall, onTrajectory = null, audio = null, media = null, mailbox = null, cascade = null, quoted = null } = {}) {
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
  const isGroupChat = String(chatId).endsWith("@g.us");
  const isGreeting = isGreetingIntent(userText) && !isGroupChat;
  const historyDepth = (isGreeting || (isActionIntent(userText) && !isListRequest(userText))) ? 3 : 6;
  const history = store?.getRecentChatHistory ? store.getRecentChatHistory(chatId, historyDepth) : [];
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
- RELAY PESAN DI GRUP ("BILANGIN X" / "KASIH TAU X" / "TANYAIN X"):
  • TARGET KONTAK WHITELIST: HANYA berlaku untuk kontak yang terdaftar di whitelist keluarga (Rafid, Karimah, Razita, Papi, Mami).
  • JALUR PRIBADI (PC / JAPRI / WA / SALURAN PRIBADI): Jika anggota grup meminta mengirim pesan secara pribadi (contoh: "pc", "japri", "japriii", "wa rafid", "dm", "saluran pribadi", "jangan di grup", "bangunin lewat pc", "telp/bangunin"), WAJIB panggil tool sendDirectMessage ke target kontak yang dimaksud! Di balasan grup, konfirmasi santun 1 kalimat ke pengirim bahwa pesan pribadi sudah terkirim (contoh: "Siap Mami, udah aku japri ke Rafid lewat chat pribadi ya."). DILARANG KERAS berteriak/meneruskan isi pesan atau me-mention target di obrolan grup saat disuruh mengirim jalur pribadi!
  • RELAY SANTAI DI GRUP: HANYA jika anggota grup meminta menyampaikan pesan santai tanpa instruksi jalur pribadi (contoh: "bilangin mami itu cuma typo doang", "kasih tau razita jangan lupa makan"), DILARANG memanggil sendDirectMessage; cukup balas di grup dengan me-mention/men-tag orangnya (misal: "@Mami katanya itu cuma typo doang").
  • PIHAK LUAR / NON-WHITELIST (DILARANG KERAS SOK TAHU & JANJI PALSU): Jika anggota keluarga meminta menghubungi, menanyakan, atau mengirim pesan ke pihak luar, nomor asing, toko, customer service, atau pihak ketiga (contoh: "waLondon", pihak bank, olshop): DILARANG KERAS sok tahu atau mengumbar janji palsu (DILARANG berkata "coba aku tanyain pihak luar ya", "aku bantu hubungi sebentar ya", dsb). WAJIB tolak dengan jujur, hangat, dan santun bahwa bot adalah asisten internal keluarga yang hanya punya akses ke kontak whitelist, tidak punya akses menghubungi pihak luar, dan sarankan anggota keluarga menghubungi pihak tersebut secara langsung!
- MENTION / TAG ANGGOTA: Jika me-mention atau ngetag seseorang di obrolan grup, bisa gunakan '@Nama' (misal: @Mami, @Razita, @Rafid) atau format nomor telepon '@<nomor_telepon>' (misal: @6281234567890). DILARANG menggunakan ID LID internal atau nomor acak.`
    : "";

  // Active speaker resolution & dynamic memory context
  const callerPhone = normalizePhone(senderNumber || chatId);
  let speaker = null;
  if (store?.getPerson) {
    speaker =
      store.getPerson(callerPhone) ||
      store.getPerson(senderNumber) ||
      (senderName ? store.getPerson(senderName) : null) ||
      store.getPerson(chatId);
  }
  if (!speaker && senderName) {
    const resolved = resolveWhitelistRecipient(senderName, store);
    if (resolved?.targetPhone && store?.getPerson) {
      speaker = store.getPerson(resolved.targetPhone);
    }
  }
  if (!speaker && DEFAULT_CONTACT_PROFILES) {
    speaker =
      DEFAULT_CONTACT_PROFILES.find((p) => normalizePhone(p.phone) === callerPhone) ||
      (senderName ? DEFAULT_CONTACT_PROFILES.find((p) => p.name.toLowerCase() === senderName.toLowerCase()) : null);
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

    const isQuotedEvent = isQuotedEventReminder(quoted);
    let eventQuotedRule = "";
    if (isQuotedEvent) {
      eventQuotedRule = `\n- PERINGATAN KHUSUS PENGINGAT ACARA: Pesan yang di-reply adalah pengingat acara/agenda!
  1. Jika pengguna meminta "ingetin lagi [waktu/jam]" (contoh: "ingetin lagi nanti malem jam 19.00", "remind lagi jam 8"):
     • Ini adalah permintaan membuat pengingat terpisah di jam tersebut!
     • WAJIB panggil tool 'addReminder' (message: pesan pengingat acara tersebut, isEvent: false, taskType: 'reminder', remindAtIso: waktu yang diminta).
     • DILARANG KERAS memanggil 'updateReminder' atau menggeser/mengundur jam mulai acara aslinya!
     • Di jawaban teks, konfirmasikan bahwa pengingat telah diset pada jam tersebut DAN jam mulai acara tetap di jadwal aslinya.
  2. HANYA panggil 'updateReminder' untuk mengubah jam mulai acara jika pengguna EKSPLISIT menggunakan kata mutasi jadwal: 'undur', 'mundurin', 'geser', 'tunda', 'ganti jam'.
  3. Jika pengguna me-reply pesan acara HANYA menyebutkan waktu tanpa kata kerja jelas (contoh: "jam 19.00 aja", "nanti malem aja"):
     • DILARANG MENGARANG atau MENGASUMSIKAN mengundur acara! DILARANG memanggil tool mutasi.
     • WAJIB tanyakan konfirmasi singkat (1 kalimat): "Mau dibuatkan pengingat jam [waktu] atau jam acaranya mau diundur?".`;
    }

    // Bind balasan user ke tugas spesifik yang dirujuk pesan bot (mis. pengingat deadline
    // yang memuat "#done <id>"), supaya perintah singkat seperti "apus" tidak salah target.
    const quotedRawText = typeof quoted.content === "string"
      ? quoted.content
      : (quoted.content?.text || quoted.text || "");
    let taskQuotedRule = "";
    if (isBotQuoted && quotedRawText) {
      const doneIdMatch = quotedRawText.match(/#done\s+(\d+)/i);
      const quotedTodo = doneIdMatch && store?.getTodoRaw ? store.getTodoRaw(parseInt(doneIdMatch[1], 10)) : null;
      if (quotedTodo) {
        taskQuotedRule = `\n- TUGAS YANG DI-REPLY (SANGAT PENTING): Pesan yang di-reply adalah pengingat untuk tugas todo id ${quotedTodo.id} ("${quotedTodo.task}"). Jika pengguna membalas dengan perintah singkat tanpa target jelas (contoh: "apus", "hapus", "udah beres", "done", "selesai", "batalin"), WAJIB tujukan HANYA ke tugas id ${quotedTodo.id} ini (pakai todoId: ${quotedTodo.id}). DILARANG KERAS menghapus, menandai selesai, atau mengubah tugas lain!`;
      } else if (/\[(?:Pengingat Tugas|To-Do List)/i.test(quotedRawText)) {
        taskQuotedRule = `\n- BALASAN KE DAFTAR/PENGINGAT TUGAS: Jika pengguna memberi perintah tanpa nomor atau nama target (contoh: "apus", "hapus", "done"), DILARANG menebak salah satu tugas. WAJIB tanyakan tugas yang mana (contoh: "Mau hapus nomor berapa?").`;
      } else if (/\[Document Vault|file tersimpan di Vault/i.test(quotedRawText)) {
        taskQuotedRule = `\n- BALASAN KE DAFTAR VAULT: Pesan yang di-reply adalah daftar file Document Vault. Jika pengguna menyebut nomor (contoh: "1 apus aja", "hapus 2", "kirim nomor 1"), nomor tersebut adalah nomor urut visual file di daftar Vault. Panggil tool deleteVaultFile, sendVaultFile, atau updateVaultFile dengan fileId tersebut!`;
      }
    }

    const quotedSnippet = quotedRawText ? quotedRawText.slice(0, 500) : "";
    const snippetContext = quotedSnippet ? `\n- ISI PESAN YANG DI-REPLY (PENTING):\n"""${quotedSnippet}"""` : "";

    quotedContext = `\n\n[KONTEKS PESAN YANG DI-REPLY]:
- Pesan ini merupakan balasan (reply/quote) langsung ke pesan dari: ${qSender}.${snippetContext}
${isBotQuoted
  ? "- PENGGUNA ME-REPLY PESAN BOT: Sambungkan jawabanmu langsung dengan apa yang kamu sampaikan sebelumnya (pertanyaan, konfirmasi, atau daftar to-do/acara). Jika user menyebut nomor urut (contoh: 'nomor 2', 'yang ketiga') atau memberi jawaban singkat (contoh: 'jam 8 aja', 'udah beres'), rujuk ke konteks pesan bot tersebut!"
  : `- Pengguna me-reply pesan dari ${qSender}. Jadikan isi pesan yang di-reply sebagai dasar/rujukan tindakanmu.`}
- DILARANG mengabaikan isi pesan yang di-reply atau menganggapnya topik baru tanpa konteks!${eventQuotedRule}${taskQuotedRule}`;
  }

  const finalSystemPrompt = systemPrompt + activeSpeakerContext + groupContext + coupleContext + skillsContext + whitelistContext + greetingInstruction + quotedContext;

  const userParts = [];
  if (audio) {
    const base64Data = Buffer.isBuffer(audio.buffer)
      ? audio.buffer.toString("base64")
      : (audio.base64 || audio.data);
    const cleanMime = String(audio.mimetype || "audio/ogg").split(";")[0].trim();
    userParts.push({
      inlineData: {
        mimeType: cleanMime || "audio/ogg",
        data: base64Data
      }
    });
    userParts.push({
      text: "[INSTRUKSI AUDIO/PESAN SUARA]: Audio ini menggunakan Bahasa Indonesia (mungkin ada bahasa percakapan sehari-hari, slang/gaul, dialek, atau istilah teknis/campuran bahasa Inggris). Dengarkan dengan sangat teliti setiap pengucapan kata kunci, nama agenda, dan angka jam/waktu dalam bahasa Indonesia (contoh: 'jam 3 sore' = 15.00, 'jam 5 sore' = 17.00, 'jam 7 malam' = 19.00, 'balikin', 'undur', 'bukan').\n- Jika audio berisi perintah mengubah atau menambah to-do/acara/reminder, pastikan jam target dan nama tugas dipahami secara presisi sebelum memanggil tools.\n- Pada kalimat pertama responmu, sebutkan secara singkat apa yang kamu dengar (contoh: 'Mendengar VN: undur acara ke jam 15.00...') agar pengguna tahu audio ditangkap dengan benar.\n- PENTING: Jika audio tidak jelas, hening, atau instruksi gagal dipahami, JANGAN PERNAH berasumsi atau mengarang data/deadline/jam, dan JANGAN katakan beres. Katakan terus terang bahwa suaranya kurang jelas dan tanyakan konfirmasinya."
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
    const senderTag = speaker?.name ? `${speaker.name} (+${callerPhone})` : (senderName ? `${senderName} (+${callerPhone})` : `+${callerPhone}`);
    effectiveUserText = `[Pengirim: ${senderTag}]: ${userText}`;
  }

  if (effectiveUserText && effectiveUserText.trim()) {
    userParts.push({ text: effectiveUserText });
    if (isAmbiguousScheduleStatement(userText)) {
      userParts.push({
        text: "[PERINGATAN SISTEM ANTI-ASUMSI]: Pengguna hanya menyampaikan kabar/kendala waktu dan TIDAK memberikan jam target pengganti (contoh: 'jam 7 mah papi blm balik'). DILARANG KERAS MENGARANG JAM BARU (jangan nebak jam 19.00/21.00) dan DILARANG MEMANGGIL updateTodo/updateReminder! WAJIB tanyakan konfirmasi singkat (1 kalimat): 'Mau diundur ke jam berapa jadwalnya?'."
      });
    }
    if (isAmbiguousEventReply(userText, quoted)) {
      userParts.push({
        text: "[PERINGATAN SISTEM ANTI-ASUMSI]: Pengguna me-reply pengingat acara HANYA dengan waktu/jam tanpa kata kerja jelas. DILARANG MENGUNDUR ACARA dan DILARANG memanggil updateReminder! WAJIB tanyakan konfirmasi singkat (1 kalimat): 'Mau dibuatkan pengingat jam tersebut atau jam acaranya mau diundur?'."
      });
    }
    if (isFollowUpReminderIntent(userText) && isQuotedEventReminder(quoted)) {
      userParts.push({
        text: "[INSTRUKSI SISTEM PENGINGAT ACARA]: Pengguna meminta diingatkan lagi (bukan mengundur acara). WAJIB panggil 'addReminder' untuk waktu tersebut (isEvent: false, taskType: 'reminder'). DILARANG memanggil 'updateReminder' atau menggeser jam mulai acara! Beritahukan ke pengguna bahwa pengingat telah diset dan jam acara tetap sama."
      });
    }
    if (isVagueCommandWithoutTarget(userText) && !quoted) {
      userParts.push({
        text: "[PERINGATAN AMBIGU]: Pengguna memberikan perintah tindakan tanpa menyebut nomor atau nama item target dan tidak me-reply pesan spesifik. DILARANG menebak atau mengeksekusi sembarang item. WAJIB tanyakan konfirmasi singkat (1 kalimat): item nomor berapa atau mana yang dimaksud."
      });
    }
    const isListReq = isListRequest(userText);
    if (!isListReq && !isGreeting && userText) {
      userParts.push({
        text: "[PERINGATAN FORMAT RESPON]: Pengguna TIDAK meminta daftar. DILARANG menampilkan daftar To-Do penuh atau daftar Acara penuh. Cukup konfirmasi singkat 1-2 kalimat + kartu satuan item yang baru dibuat/diubah jika ada."
      });
    }

    const isDailyDigestReq = /\b(rekap\s*harian|daily\s*digest)\b/i.test(userText) ||
      (/\brekap\b/i.test(userText) && /\b(acara|agenda|pengingat)\b/i.test(userText) && /\b(to-?do|tugas)\b/i.test(userText));
    if (isDailyDigestReq) {
      userParts.push({
        text: "[INSTRUKSI REKAP HARIAN]: Permintaan rekap harian lengkap terdeteksi. Kamu WAJIB memanggil KEDUA tool: listReminders (untuk jadwal acara/agenda & pengingat hari ini) DAN listTodos (untuk to-do list aktif). Sajikan keduanya secara terstruktur dalam satu pesan: 1) Agenda & Acara Hari Ini, 2) To-Do List Aktif."
      });
    }

    const hasEventKeyword = /\b(rapat|meeting|tm\b|webinar|jadwal|acara|event|janji\s+temu)\b/i.test(userText);
    const hasTodoKeyword = /\b(tugas|pr\b|pekerjaan|belanja|beli|bayar|servis|cuci|bersih|koding|coding)\b/i.test(userText);
    if (!isDailyDigestReq) {
      if (hasEventKeyword && !hasTodoKeyword) {
        userParts.push({ text: "[STEERING]: Kata kunci acara/jadwal terdeteksi. Gunakan addReminder (isEvent: true) BUKAN addTodo." });
      } else if (hasTodoKeyword && !hasEventKeyword) {
        userParts.push({ text: "[STEERING]: Kata kunci tugas/pekerjaan terdeteksi. Gunakan addTodo BUKAN addReminder." });
      }
    }
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

  // LLM Autonomy: mode AUTO default, NONE jika ambigu/media santai, ANY jika niat aksi jelas
  const isAmbiguousSchedule = isAmbiguousScheduleStatement(userText);
  const isAmbiguousEvent = isAmbiguousEventReply(userText, quoted);
  const isVagueCommand = isVagueCommandWithoutTarget(userText) && !quoted;
  const isMediaWithoutAction = Boolean(media && !isActionIntent(userText));
  const hasActionIntent = isActionIntent(userText) && !isAmbiguousSchedule && !isAmbiguousEvent && !isVagueCommand;
  let toolConfig;
  if (isAmbiguousSchedule || isAmbiguousEvent || isVagueCommand || isMediaWithoutAction) {
    toolConfig = { functionCallingConfig: { mode: "NONE" } };
  } else if (hasActionIntent && !isGreeting) {
    toolConfig = { functionCallingConfig: { mode: "ANY" } };
  } else {
    toolConfig = { functionCallingConfig: { mode: "AUTO" } };
  }

  const toolsCalled = [];
  const successfulMutations = [];
  const executedTrajectory = [];
  let currentCandidate = null;
  let lastFormattedList = null;
  const collectedFormattedLists = [];
  const userWantsList = isListRequest(userText);
  // Daftar penuh (to-do/acara) hanya ditempel kalau user minta; kartu satuan (add/update) selalu tampil.
  const appendableList = () => {
    if (collectedFormattedLists.length > 1) {
      return userWantsList ? collectedFormattedLists.join("\n\n") : null;
    }
    return (lastFormattedList && (userWantsList || !FULL_LIST_HEADER_REGEX.test(lastFormattedList)))
      ? lastFormattedList
      : null;
  };
  const MAX_STEPS = isActionIntent(userText) && !userText.includes("?") ? 3 : 5;
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
      const candidateText = extractCandidateText(currentCandidate.content);
      if (detectUnexecutedMutationClaim(candidateText, successfulMutations)) {
        if (isAmbiguousSchedule) {
          return "Mau diundur ke jam berapa jadwalnya?";
        }
        if (isAmbiguousEvent) {
          return "Mau dibuatkan pengingat baru atau jam acaranya mau diundur?";
        }
        if (turns < MAX_STEPS - 1) {
          turns++;
          contents.push(currentCandidate.content);
          contents.push({
            role: "user",
            parts: [{
              text: "SYSTEM INTEGRITY FAULT: Kamu mengklaim telah melakukan tindakan/mutasi data atau berjanji menghubungi pihak luar, tapi BELUM memanggil functionCall ke tool terkait! Jika diminta menghubungi pihak luar yang tidak terdaftar di whitelist (misal: waLondon, orang asing, pihak ketiga), DILARANG KERAS mengumbar janji palsu; WAJIB jelaskan dengan jujur dan tolak secara santun bahwa kamu tidak punya akses menghubungi pihak luar!"
            }]
          });
          toolConfig = { functionCallingConfig: { mode: "ANY" } };
          continue;
        } else {
          return isGroupChat
            ? "Waduh, aku kan cuma asisten internal keluarga dan cuma bisa kirim pesan ke kontak whitelist yang terdaftar. Aku gak punya akses buat hubungi pihak luar, coba hubungi langsung ya!"
            : "Woles Lord, gw kan cuma asisten internal dan gak punya akses buat hubungi pihak luar. Coba kontak langsung aja ya!";
        }
      }
      break;
    }

    turns++;
    const userResponseParts = [];

    // Nomor urut visual dipetakan ke id asli SEKALI per batch memakai snapshot awal,
    // supaya beberapa item yang diubah dalam satu turn tidak saling menggeser urutan
    // (contoh: "1-4 done" tidak boleh jadi menandai item 1,3,5,7).
    const isNumeric = (v) => v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v));
    const execArgsList = fnCallParts.map((p) => ({ ...(p.functionCall.args || {}) }));
    let preResolvedIndexes = false;
    if (store && typeof store.resolveTodoIndexes === "function") {
      const queryChatId = isGroupChat ? chatId : (senderNumber || chatId);
      const quotedRawText = quoted
        ? (typeof quoted.content === "string" ? quoted.content : (quoted.content?.text || quoted.text || ""))
        : "";
      const todoNums = [];
      const remNums = [];
      const uncompleteNums = [];
      execArgsList.forEach((args, idx) => {
        const name = fnCallParts[idx].functionCall.name;
        const tArg = TODO_INDEX_ARG_BY_TOOL[name];
        if (tArg && isNumeric(args[tArg])) todoNums.push(Number(args[tArg]));
        const rArg = REMINDER_INDEX_ARG_BY_TOOL[name];
        if (rArg && isNumeric(args[rArg])) remNums.push(Number(args[rArg]));
        const uArg = UNCOMPLETE_INDEX_ARG_BY_TOOL[name];
        if (uArg && isNumeric(args[uArg])) uncompleteNums.push(Number(args[uArg]));
      });
      if (todoNums.length > 0) {
        const resolved = store.resolveTodoIndexes(todoNums, queryChatId, { quotedText: quotedRawText });
        let i = 0;
        execArgsList.forEach((args, idx) => {
          const tArg = TODO_INDEX_ARG_BY_TOOL[fnCallParts[idx].functionCall.name];
          if (tArg && isNumeric(args[tArg])) args[tArg] = resolved[i++];
        });
        preResolvedIndexes = true;
      }
      if (uncompleteNums.length > 0 && typeof store.resolveCompletedTodoIndexes === "function") {
        const resolved = store.resolveCompletedTodoIndexes(uncompleteNums, queryChatId);
        let i = 0;
        execArgsList.forEach((args, idx) => {
          const uArg = UNCOMPLETE_INDEX_ARG_BY_TOOL[fnCallParts[idx].functionCall.name];
          if (uArg && isNumeric(args[uArg])) args[uArg] = resolved[i++];
        });
        preResolvedIndexes = true;
      }
      if (remNums.length > 0 && typeof store.resolveReminderIndexes === "function") {
        const resolved = store.resolveReminderIndexes(remNums, queryChatId);
        let i = 0;
        execArgsList.forEach((args, idx) => {
          const rArg = REMINDER_INDEX_ARG_BY_TOOL[fnCallParts[idx].functionCall.name];
          if (rArg && isNumeric(args[rArg])) args[rArg] = resolved[i++];
        });
        preResolvedIndexes = true;
      }
    }

    for (let idx = 0; idx < fnCallParts.length; idx++) {
      const name = fnCallParts[idx].functionCall.name;
      const args = execArgsList[idx];
      toolsCalled.push(name);
      if (onToolCall) onToolCall(name);

      let resultObj = {};
      const isQuotedEvent = isQuotedEventReminder(quoted);
      const isReschedulingWithoutExplicitIntent = isQuotedEvent &&
        name === "updateReminder" &&
        (args.newEventAtIso || args.newRemindAtIso) &&
        !hasExplicitRescheduleIntent(userText);

      if (isAmbiguousScheduleStatement(userText) && ((name === "updateTodo" && args.deadlineIso) || (name === "updateReminder" && args.remindAtIso))) {
        resultObj = {
          toolResult: {
            error: "DILARANG mengarang jam baru saat pengguna hanya memberi kabar waktu tanpa menyebutkan jam pengganti. Tanyakan konfirmasi terlebih dahulu: Mau diundur ke jam berapa jadwalnya?"
          }
        };
      } else if (isReschedulingWithoutExplicitIntent) {
        resultObj = {
          toolResult: {
            error: "DILARANG mengundur jam acara jika pengguna tidak secara eksplisit meminta mengundur/menggeser jadwal (misal: 'ingetin lagi nanti jam 19.00' adalah permintaan pengingat/addReminder, BUKAN mengundur acara). Jika pengguna minta 'ingetin lagi', panggil addReminder dengan isEvent: false. Jika maksud pengguna ambigu, tanyakan konfirmasi terlebih dahulu: Mau dibuatkan pengingat jam tersebut atau jam acaranya mau diundur?"
          }
        };
      } else {
        try {
          resultObj = await executeTool(name, args, { store, chatId, senderNumber, rotator, userText, preResolvedIndexes });
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
        if (!collectedFormattedLists.includes(resultObj.formattedList)) {
          collectedFormattedLists.push(resultObj.formattedList);
        }
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
    const SHORT_CIRCUIT_TOOLS = new Set([
      "completeTodo", "uncompleteTodo", "deleteTodo", "clearCompletedTodos", "deleteReminder",
      "updateReminder", "updateTodo", "addTodo", "addReminder",
      "setDailyDigest", "saveNote", "deleteNote", "addPerson", "deletePerson",
      "addBacklog", "completeBacklog"
    ]);
    const isPureMutation = fnCallParts.every((p) => SHORT_CIRCUIT_TOOLS.has(p.functionCall.name));
    const allSucceeded = successfulMutations.length >= fnCallParts.length;
    const isPureAction = isActionIntent(userText) && !userText.includes("?") && !/\b(kenapa|gimana|bagaimana|apakah|menurut|saran|rekomendasi)\b/i.test(userText);

    if (turns === 1 && isPureMutation && allSucceeded && isPureAction && lastFormattedList) {
      const toolNames = new Set(fnCallParts.map((p) => p.functionCall.name));
      const onlyAdd = toolNames.size === 1 && (toolNames.has("addTodo") || toolNames.has("addReminder"));
      const onlyUpdate = toolNames.size === 1 && (toolNames.has("updateTodo") || toolNames.has("updateReminder"));
      let salute = isGroupChat ? "Beres!" : "Beres, Lord!";
      if (onlyAdd) {
        salute = isGroupChat ? "Udah dicatet ya!" : "Udah dicatet ya, Lord!";
      } else if (onlyUpdate) {
        salute = isGroupChat ? "Udah diupdate ya!" : "Udah diupdate ya, Lord!";
      }

      const cards = [];
      const actionLines = [];

      for (const entry of executedTrajectory) {
        const { name, result } = entry;
        if (!result) continue;

        if (name === "addTodo" || name === "updateTodo" || name === "addReminder" || name === "updateReminder") {
          const cardText = result.formatted || null;
          if (cardText && !FULL_LIST_HEADER_REGEX.test(cardText)) {
            cards.push(cardText);
          }
        } else if (name === "deleteTodo") {
          if (result.success) {
            const taskLabel = result.deletedTask ? ` ('${result.deletedTask}')` : "";
            actionLines.push(`🗑️ Tugas #${result.deletedId}${taskLabel} berhasil dihapus.`);
          }
        } else if (name === "deleteReminder") {
          if (result.success) {
            const titleLabel = result.deletedTitle ? ` '${result.deletedTitle}'` : (result.messageTitle ? ` '${result.messageTitle}'` : "");
            actionLines.push(`🗑️ Acara/pengingat${titleLabel} berhasil dihapus.`);
          }
        } else if (name === "completeTodo") {
          if (result.success) {
            actionLines.push(`✅ Tugas #${result.todoId} ditandai selesai.`);
          }
        } else if (name === "uncompleteTodo") {
          if (result.success) {
            actionLines.push(`↩️ Tugas #${result.todoId} dikembalikan ke status belum selesai.`);
          }
        } else if (name === "clearCompletedTodos") {
          if (result.success) {
            actionLines.push(`🗑️ ${result.deletedCount || "Semua"} tugas selesai berhasil dibersihkan.`);
          }
        }
      }

      if (cards.length > 0 || actionLines.length > 0) {
        const parts = [salute];
        if (cards.length > 0) parts.push(cards.join("\n\n"));
        if (actionLines.length > 0) parts.push(actionLines.join("\n"));
        if (userWantsList) {
          const fullList = collectedFormattedLists.find((l) => FULL_LIST_HEADER_REGEX.test(l)) ||
            (FULL_LIST_HEADER_REGEX.test(lastFormattedList) ? lastFormattedList : null);
          if (fullList) parts.push(fullList);
        }
        return parts.join("\n\n");
      }

      if (!onlyAdd && !onlyUpdate) {
        salute = `${salute} Data berhasil diperbarui di sistem.`;
      }
      const appended = appendableList();
      return appended ? `${salute}\n\n${appended}` : salute;
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

  const directText = extractCandidateText(currentCandidate?.content);
  const text = directText?.trim();
  const effectiveList = appendableList();
  let finalReply = "";

  if (text) {
    if (effectiveList && !text.includes(effectiveList)) {
      const isCorruptedList = text.includes("Pengingat Tugas") || text.includes("⏰") || /\[\d+\]/.test(text);
      if (isCorruptedList) {
        // Model tried to re-format list itself (often mimicking old chat history)
        const headerIdx = text.search(/🌄|🌅|\[Pengingat Tugas\]|\[1\]/);
        const preamble = headerIdx > 0 ? text.slice(0, headerIdx).trim() : "";
        finalReply = preamble ? `${preamble}\n\n${effectiveList}` : effectiveList;
      } else {
        finalReply = `${text}\n\n${effectiveList}`;
      }
    } else {
      finalReply = text;
    }
  } else {
    finalReply = effectiveList || (successfulMutations.length > 0 ? (isGroupChat ? "Beres." : "Beres, Lord.") : (isGroupChat ? "Gagal memproses aksi nih. Coba sebutkan lagi perintahnya." : "Gagal memproses aksi nih, Lord. Coba sebutkan lagi perintahnya."));
  }

  finalReply = stripHallucinatedToolChips(finalReply);
  finalReply = sanitizeLatexForWhatsApp(finalReply);
  finalReply = formatForWhatsApp(finalReply);

  if (detectUnexecutedMutationClaim(finalReply, successfulMutations)) {
    finalReply = isAmbiguousSchedule
      ? "Mau diundur ke jam berapa jadwalnya?"
      : (isGroupChat
          ? "Waduh, belum sempat ke-update di database nih. Coba sebutin perintahnya lagi lebih spesifik."
          : "Waduh, belum sempat ke-update di database nih. Coba sebutin perintahnya lagi lebih spesifik, Lord.");
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
