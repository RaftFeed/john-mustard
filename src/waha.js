import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

let currentBotNumber = (process.env.BOT_PHONE || "").replace(/\D/g, "") || null;
let currentBotLid = null;
const botSentMessageIds = new Set();
const lastBotMessageTimePerChat = new Map(); // chatId -> timestamp ms

export function recordBotActivity(chatId) {
  if (!chatId) return;
  const now = Date.now();
  const strId = String(chatId);
  lastBotMessageTimePerChat.set(strId, now);
  const clean = strId.split("@")[0];
  lastBotMessageTimePerChat.set(clean, now);
}

export function isRecentBotThread(chatId, windowMs = 120_000) {
  if (!chatId) return false;
  const now = Date.now();
  const strId = String(chatId);
  const t1 = lastBotMessageTimePerChat.get(strId) || 0;
  const t2 = lastBotMessageTimePerChat.get(strId.split("@")[0]) || 0;
  const lastTime = Math.max(t1, t2);
  return (now - lastTime) <= windowMs;
}

export function setLastBotMessageTime(chatId, timestamp) {
  if (!chatId) return;
  const strId = String(chatId);
  lastBotMessageTimePerChat.set(strId, timestamp);
  lastBotMessageTimePerChat.set(strId.split("@")[0], timestamp);
}

export function recordBotSentMessage(msgId) {
  if (!msgId) return;
  const strId = String(msgId);
  botSentMessageIds.add(strId);
  for (const part of strId.split("_")) {
    if (part) botSentMessageIds.add(part);
  }
  if (botSentMessageIds.size > 2000) {
    const first = botSentMessageIds.values().next().value;
    botSentMessageIds.delete(first);
  }
}

export function isBotSentMessage(msgId) {
  if (!msgId) return false;
  const strId = String(msgId);
  if (botSentMessageIds.has(strId)) return true;
  const parts = strId.split("_");
  for (const part of parts) {
    if (part && botSentMessageIds.has(part)) return true;
  }
  return false;
}

export function getBotNumber() {
  return currentBotNumber;
}

export function getBotLid() {
  return currentBotLid;
}

export function setBotNumber(num) {
  currentBotNumber = num ? String(num).replace(/\D/g, "") : null;
}

export async function fetchBotNumber() {
  if (currentBotNumber && currentBotLid) return currentBotNumber;
  try {
    const wahaUrl = process.env.WAHA_URL || "http://localhost:3000";
    const apiKey = process.env.WAHA_API_KEY || "";
    const headers = apiKey ? { "x-api-key": apiKey } : {};

    const res = await fetch(`${wahaUrl}/api/me?session=default`, {
      headers,
      signal: AbortSignal.timeout(3000)
    });
    if (res.ok) {
      const data = await res.json();
      const meId = data.id || data.me?.id || "";
      const num = meId.split("@")[0].split(":")[0].replace(/\D/g, "");
      if (num && !currentBotNumber) {
        currentBotNumber = num;
      }
      if (data.me?.lid || data.lid) {
        currentBotLid = String(data.me?.lid || data.lid).replace(/\D/g, "");
      }
    }

    if (!currentBotNumber || !currentBotLid) {
      const sRes = await fetch(`${wahaUrl}/api/sessions/default`, {
        headers,
        signal: AbortSignal.timeout(3000)
      });
      if (sRes.ok) {
        const sData = await sRes.json();
        const me = sData.me || {};
        const meId = me.id || "";
        const num = meId.split("@")[0].split(":")[0].replace(/\D/g, "");
        if (num && !currentBotNumber) currentBotNumber = num;
        if (me.lid && !currentBotLid) currentBotLid = String(me.lid).replace(/\D/g, "");
      }
    }

    if (currentBotNumber && !currentBotLid) {
      const diskLid = resolvePhoneToLid(currentBotNumber);
      if (diskLid) currentBotLid = diskLid;
    }
  } catch {}
  return currentBotNumber;
}

export function resolveLidToPhone(lid) {
  try {
    const cleanLid = String(lid).replace(/\D/g, "");
    if (!cleanLid) return null;
    const sessionDir = process.env.WAHA_SESSIONS_DIR || "/app/waha_sessions/noweb/default";
    const mappingFile = path.join(sessionDir, `lid-mapping-${cleanLid}_reverse.json`);
    if (fs.existsSync(mappingFile)) {
      const data = fs.readFileSync(mappingFile, "utf8");
      return JSON.parse(data).replace(/\D/g, "");
    }
  } catch {}
  return null;
}

export function resolvePhoneToLid(phone) {
  try {
    const cleanPhone = String(phone).replace(/\D/g, "");
    if (!cleanPhone) return null;
    const sessionDir = process.env.WAHA_SESSIONS_DIR || "/app/waha_sessions/noweb/default";
    const mappingFile = path.join(sessionDir, `lid-mapping-${cleanPhone}.json`);
    if (fs.existsSync(mappingFile)) {
      const data = fs.readFileSync(mappingFile, "utf8");
      return JSON.parse(data).replace(/\D/g, "");
    }
  } catch {}
  return null;
}

export function getWhitelistPhones(rawList) {
  const source = rawList !== undefined ? rawList : (process.env.WHITELIST_PHONE || process.env.ALLOWED_PHONE || "");
  if (!source) return [];

  const items = String(source)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const phones = new Set();
  for (const item of items) {
    const digits = item.replace(/\D/g, "");
    if (!digits) continue;

    // Resolusi LID ke nomor HP jika mapping tersedia di disk
    let resolved = resolveLidToPhone(digits);
    if (!resolved && (digits === "228140156772422" || digits.endsWith("7838"))) {
      resolved = (process.env.PRIMARY_USER_PHONE || process.env.OWNER_PHONE || "6285236467838").replace(/\D/g, "");
    } else if (!resolved && digits === "51934979461357") {
      resolved = (process.env.SECONDARY_USER_PHONE || "6289514718700").replace(/\D/g, "");
    }

    let finalPhone = resolved || digits;
    if (finalPhone.startsWith("0")) finalPhone = "62" + finalPhone.slice(1);

    if (finalPhone.length >= 9 && finalPhone.length <= 15) {
      phones.add(finalPhone);
    }
  }
  return Array.from(phones);
}

export function resolveWhitelistRecipient(rawTarget, store = null) {
  if (!rawTarget) return null;
  const targetStr = String(rawTarget).trim().replace(/^@/, "");
  const whitelist = getWhitelistPhones();
  let targetPhone = "";
  let recipientDisplayName = targetStr;

  // 1. Nomor telepon langsung / digit / LID
  const digits = targetStr.replace(/\D/g, "");
  if (digits.length >= 9 && digits.length <= 15) {
    targetPhone = digits.startsWith("0") ? "62" + digits.slice(1) : digits;
  } else if (digits.length > 15) {
    const fromLid = resolveLidToPhone(digits);
    if (fromLid) targetPhone = fromLid;
  }

  // 2. Alias nama pengguna utama / sekunder dari environment
  if (!targetPhone) {
    const lower = targetStr.toLowerCase();
    const primaryName = (process.env.PRIMARY_USER_NAME || "rafid").toLowerCase();
    const secondaryName = (process.env.SECONDARY_USER_NAME || "karimah").toLowerCase();

    if (
      lower.includes(primaryName) ||
      lower === "owner" ||
      lower === "master" ||
      lower === "simas" ||
      lower === "si mas" ||
      lower === "mas" ||
      lower === "mas rafid" ||
      lower.includes("m3-083")
    ) {
      targetPhone = (process.env.PRIMARY_USER_PHONE || process.env.OWNER_PHONE || "6285236467838").replace(/\D/g, "");
      recipientDisplayName = process.env.PRIMARY_USER_NAME || "Rafid";
    } else if (lower.includes(secondaryName) || lower === "istri" || lower === "pasangan") {
      targetPhone = (process.env.SECONDARY_USER_PHONE || "6289514718700").replace(/\D/g, "");
      recipientDisplayName = process.env.SECONDARY_USER_NAME || "Karimah";
    } else if (lower === "mami" || lower === "mama" || lower === "ibu") {
      targetPhone = "6282297432850";
      recipientDisplayName = "Mami";
    } else if (lower === "papi" || lower === "papa" || lower === "ayah") {
      targetPhone = "62819703133";
      recipientDisplayName = "Papi";
    } else if (lower.includes("razita") || lower === "zita") {
      targetPhone = "6282217584569";
      recipientDisplayName = "Razita Ndut";
    }
  }

  // 3. Direktori kontak SQLite (getPerson)
  if (!targetPhone && store?.getPerson) {
    const p = store.getPerson(targetStr);
    if (p?.phone) {
      targetPhone = String(p.phone).replace(/\D/g, "");
      recipientDisplayName = p.name;
    }
  }

  // 4. Pencarian fleksibel pada listPersons SQLite
  if (!targetPhone && store?.listPersons) {
    const allP = store.listPersons();
    const found = allP.find((c) =>
      c.name.toLowerCase().includes(targetStr.toLowerCase()) ||
      targetStr.toLowerCase().includes(c.name.toLowerCase())
    );
    if (found?.phone) {
      targetPhone = String(found.phone).replace(/\D/g, "");
      recipientDisplayName = found.name;
    }
  }

  if (!targetPhone) {
    return {
      error: `Kontak atau nomor '${targetStr}' tidak ditemukan di direktori kontak maupun whitelist.`
    };
  }

  if (targetPhone.startsWith("0")) targetPhone = "62" + targetPhone.slice(1);

  if (!whitelist.includes(targetPhone)) {
    return {
      error: `Nomor +${targetPhone} (${recipientDisplayName}) tidak terdaftar dalam whitelist akses bot. Bot hanya diizinkan mengirim pesan pribadi ke nomor yang ada di whitelist.`,
      targetPhone,
      recipientDisplayName,
      isWhitelisted: false
    };
  }

  return {
    targetPhone,
    recipientDisplayName,
    isWhitelisted: true
  };
}

export function formatSenderDisplay(senderNumber, senderName = "", store = null) {
  const senderClean = String(senderNumber || "").replace(/\D/g, "");
  if (senderClean === (process.env.PRIMARY_USER_PHONE || process.env.OWNER_PHONE || "6285236467838").replace(/\D/g, "")) {
    return process.env.PRIMARY_USER_NAME || "Rafid";
  }
  if (senderClean === (process.env.SECONDARY_USER_PHONE || "6289514718700").replace(/\D/g, "")) {
    return process.env.SECONDARY_USER_NAME || "Karimah";
  }
  if (store?.listPersons && senderClean) {
    const p = store.listPersons().find((c) => String(c.phone).replace(/\D/g, "") === senderClean);
    if (p?.name) return p.name;
  }
  if (senderName && senderName.trim()) return senderName.trim();
  return senderClean ? `+${senderClean}` : "Pengguna";
}

export function normalizeMentionsInText(text) {
  if (!text || typeof text !== "string") return text;
  return text.replace(/@(\d{8,20})\b/g, (match, digits) => {
    if ((currentBotLid && digits === currentBotLid) || (currentBotNumber && digits === currentBotNumber)) {
      return "@bot";
    }
    const phone = resolveLidToPhone(digits);
    if (phone) {
      if (currentBotNumber && phone === currentBotNumber) {
        return "@bot";
      }
      return `@${phone}`;
    }
    return match;
  });
}

export function formatOutboundMentions(text, store = null) {
  if (!text || typeof text !== "string") return { text: "", mentions: [] };

  let formattedText = text;

  // 1. Convert known multi-word contact mention aliases
  const KNOWN_MENTION_ALIASES = [
    { regex: /@M3-083_Rafid\s+Harsyah\b/gi, phone: "6285236467838" },
    { regex: /@Rafid\s+Harsyah\b/gi, phone: "6285236467838" },
    { regex: /@Razita\s+Ndut\b/gi, phone: "6282217584569" },
    { regex: /@si\s+mas\b/gi, phone: "6285236467838" },
    { regex: /@mas\s+rafid\b/gi, phone: "6285236467838" }
  ];
  for (const item of KNOWN_MENTION_ALIASES) {
    formattedText = formattedText.replace(item.regex, `@${item.phone}`);
  }

  // 2. Convert single-word named mentions (e.g. @simas, @rafid, @karimah)
  formattedText = formattedText.replace(/@([a-zA-Z][a-zA-Z0-9_-]*)\b/g, (match, name) => {
    if (/^(com|net|org|id|us|lid|c\.us|g\.us)$/i.test(name)) return match;
    const res = resolveWhitelistRecipient(name, store);
    if (res && res.targetPhone) {
      return `@${res.targetPhone}`;
    }
    return match;
  });

  // 3. Convert unmapped/raw LID mentions in text into phone number if resolvable
  formattedText = formattedText.replace(/@(\d{8,20})\b/g, (match, digits) => {
    const phone = resolveLidToPhone(digits);
    return phone ? `@${phone}` : match;
  });

  const mentionsSet = new Set();
  const matches = formattedText.match(/@(\d{8,20})\b/g);
  if (matches) {
    for (const m of matches) {
      const num = m.slice(1);
      mentionsSet.add(`${num}@c.us`);

      const lid = resolvePhoneToLid(num);
      if (lid) {
        mentionsSet.add(`${lid}@lid`);
      }
      const phone = resolveLidToPhone(num);
      if (phone) {
        mentionsSet.add(`${phone}@c.us`);
        mentionsSet.add(`${num}@lid`);
      }
    }
  }

  return {
    text: formattedText,
    mentions: Array.from(mentionsSet)
  };
}

export async function startTyping(chatId) {
  try {
    const wahaUrl = process.env.WAHA_URL || "http://localhost:3000";
    const apiKey = process.env.WAHA_API_KEY || "";
    await fetch(`${wahaUrl}/api/startTyping`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(apiKey ? { "x-api-key": apiKey } : {}) },
      body: JSON.stringify({
        chatId: chatId.includes("@") ? chatId : `${chatId}@c.us`,
        session: "default"
      })
    });
  } catch {}
}

export async function stopTyping(chatId) {
  try {
    const wahaUrl = process.env.WAHA_URL || "http://localhost:3000";
    const apiKey = process.env.WAHA_API_KEY || "";
    await fetch(`${wahaUrl}/api/stopTyping`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(apiKey ? { "x-api-key": apiKey } : {}) },
      body: JSON.stringify({
        chatId: chatId.includes("@") ? chatId : `${chatId}@c.us`,
        session: "default"
      })
    });
  } catch {}
}

export async function sendSingleText(chatId, text, replyTo = null) {
  const wahaUrl = process.env.WAHA_URL || "http://localhost:3000";
  const { text: formattedText, mentions } = formatOutboundMentions(text);
  const payload = {
    chatId: chatId.includes("@") ? chatId : `${chatId}@c.us`,
    text: formattedText,
    session: "default"
  };
  if (replyTo) payload.reply_to = replyTo;
  if (mentions.length > 0) payload.mentions = mentions;

  const apiKey = process.env.WAHA_API_KEY || "";
  const res = await fetch(`${wahaUrl}/api/sendText`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(apiKey ? { "x-api-key": apiKey } : {}) },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`WAHA sendText failed (${res.status}): ${errText}`);
  }
  const resData = await res.json();
  if (resData?.id) {
    recordBotSentMessage(resData.id);
  }
  recordBotActivity(chatId);
  return resData;
}

// Multi-Bubble Splitting (Helmis pattern)
export async function sendText(chatId, text, replyTo = null) {
  if (!text || text.trim() === "[NO_REPLY]" || text.trim().startsWith("[NO_REPLY]")) {
    return null;
  }
  const bubbles = text.split(/\n\s*---\s*\n/).map((b) => b.trim()).filter(Boolean);
  let lastRes = null;
  for (let i = 0; i < bubbles.length; i++) {
    lastRes = await sendSingleText(chatId, bubbles[i], i === 0 ? replyTo : null);
    if (bubbles.length > 1 && i < bubbles.length - 1) {
      await new Promise((r) => setTimeout(r, 600)); // jeda halus antar bubble
    }
  }
  return lastRes;
}

export async function sendFile(chatId, filepath, filename, caption = "", asDocument = false) {
  const wahaUrl = process.env.WAHA_URL || "http://localhost:3000";
  const buffer = fs.readFileSync(filepath);
  const base64Data = buffer.toString("base64");
  
  let mimetype = "application/octet-stream";
  const ext = filename.split(".").pop().toLowerCase();
  if (ext === "pdf") mimetype = "application/pdf";
  else if (ext === "jpg" || ext === "jpeg") mimetype = "image/jpeg";
  else if (ext === "png") mimetype = "image/png";
  else if (ext === "webp") mimetype = "image/webp";

  // Native media routing: images default to /api/sendImage unless asDocument is true
  const isImage = mimetype.startsWith("image/");
  const endpoint = (!asDocument && isImage) ? "/api/sendImage" : "/api/sendFile";

  const { text: formattedCaption, mentions } = formatOutboundMentions(caption);

  const payload = {
    chatId: chatId.includes("@") ? chatId : `${chatId}@c.us`,
    file: {
      mimetype,
      filename,
      url: `data:${mimetype};base64,${base64Data}`
    },
    caption: formattedCaption,
    session: "default"
  };
  if (mentions.length > 0) payload.mentions = mentions;

  const apiKey = process.env.WAHA_API_KEY || "";
  const res = await fetch(`${wahaUrl}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(apiKey ? { "x-api-key": apiKey } : {}) },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    if (endpoint === "/api/sendImage") {
      try {
        const fallbackRes = await fetch(`${wahaUrl}/api/sendFile`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(apiKey ? { "x-api-key": apiKey } : {}) },
          body: JSON.stringify(payload)
        });
        if (fallbackRes.ok) {
          const fallbackData = await fallbackRes.json();
          if (fallbackData?.id) recordBotSentMessage(fallbackData.id);
          recordBotActivity(chatId);
          return fallbackData;
        }
      } catch {}
    }
    const errText = await res.text();
    throw new Error(`WAHA ${endpoint} failed (${res.status}): ${errText}`);
  }
  const fileResData = await res.json();
  if (fileResData?.id) recordBotSentMessage(fileResData.id);
  recordBotActivity(chatId);
  return fileResData;
}

export async function sendImage(chatId, filepath, filename, caption = "") {
  return sendFile(chatId, filepath, filename, caption, false);
}

export async function downloadMedia(mediaUrl) {
  const apiKey = process.env.WAHA_API_KEY || "";
  const wahaUrl = process.env.WAHA_URL || "http://localhost:3000";

  let resolvedUrl = mediaUrl;
  try {
    const parsed = new URL(mediaUrl);
    const target = new URL(wahaUrl);
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
      parsed.hostname = target.hostname;
      parsed.port = target.port;
      parsed.protocol = target.protocol;
      resolvedUrl = parsed.toString();
    }
  } catch {}

  const res = await fetch(resolvedUrl, {
    headers: apiKey ? { "x-api-key": apiKey } : {}
  });
  if (!res.ok) throw new Error(`Gagal download media dari WAHA (${res.status}): ${res.statusText}`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export async function fetchQuotedMediaUrl(chatId, messageId) {
  if (!chatId || !messageId) return null;
  try {
    const headers = {};
    const apiKey = getWahaApiKey();
    if (apiKey) headers["x-api-key"] = apiKey;
    const cleanId = String(messageId).replace(/^true_|^false_/, "");
    const res = await fetch(`${wahaUrl}/api/default/chats/${encodeURIComponent(chatId)}/messages?limit=25&downloadMedia=true`, {
      headers
    });
    if (!res.ok) return null;
    const msgs = await res.json();
    if (!Array.isArray(msgs)) return null;
    const match = msgs.find((m) => m.id === messageId || m.id?.includes(cleanId) || (cleanId.length > 8 && m.id?.includes(cleanId.slice(0, 16))));
    if (match && match.media?.url) {
      return match.media.url;
    }
  } catch (err) {
    console.warn(`[WAHA] fetchQuotedMediaUrl error: ${err.message}`);
  }
  return null;
}

export function extractMediaFilename(msg) {
  if (!msg) return "file";
  if (msg.media?.filename || msg.media?.fileName) return String(msg.media.filename || msg.media.fileName).trim();
  if (msg.filename || msg.fileName) return String(msg.filename || msg.fileName).trim();
  if (msg._data?.filename || msg._data?.title) return String(msg._data.filename || msg._data.title).trim();
  const doc = msg._data?.Message?.documentMessage || msg.documentMessage;
  if (doc?.fileName || doc?.title) return String(doc.fileName || doc.title).trim();
  return "file";
}

export function extractQuotedInfo(msg) {
  if (!msg) return null;
  const replyId =
    msg.replyTo?.id ||
    msg._data?.quotedMsg?.id ||
    msg._data?.quotedMsg?.key?.id ||
    msg._data?.Message?.extendedTextMessage?.contextInfo?.stanzaId;

  const isFromMe = Boolean(
    msg.replyTo?.fromMe ||
    msg._data?.quotedMsg?.fromMe ||
    msg._data?.quotedMsg?.key?.fromMe ||
    msg._data?.Message?.extendedTextMessage?.contextInfo?.isFromMe ||
    (typeof replyId === "string" && replyId.startsWith("true_")) ||
    (replyId && isBotSentMessage(replyId))
  );

  let text = "";
  let sender = "";
  let hasMedia = false;
  let media = null;

  // 1. Top-level replyTo
  if (msg.replyTo) {
    text = String(msg.replyTo.body || msg.replyTo.caption || "").trim();
    sender = String(msg.replyTo.participant || msg.replyTo.from || "").trim();
    if (msg.replyTo.hasMedia || msg.replyTo.media) {
      hasMedia = true;
      media = {
        url: msg.replyTo.media?.url || (typeof msg.replyTo.media === "string" ? msg.replyTo.media : null),
        mimetype: msg.replyTo.media?.mimetype || msg.replyTo.mimetype || "application/octet-stream",
        filename: msg.replyTo.media?.filename || extractMediaFilename(msg.replyTo)
      };
    }
  }

  // 2. _data.quotedMsg
  const dataQuoted = msg._data?.quotedMsg || msg.quotedMsg;
  if (dataQuoted) {
    if (!text) text = String(dataQuoted.body || dataQuoted.caption || "").trim();
    if (!sender) sender = String(msg._data?.quotedParticipant || dataQuoted.participant || "").trim();
    if (!hasMedia && (dataQuoted.hasMedia || dataQuoted.media)) {
      hasMedia = true;
      media = {
        url: dataQuoted.media?.url || (typeof dataQuoted.media === "string" ? dataQuoted.media : null),
        mimetype: dataQuoted.media?.mimetype || dataQuoted.mimetype || "application/octet-stream",
        filename: dataQuoted.media?.filename || extractMediaFilename(dataQuoted)
      };
    }
  }

  // 3. Protobuf contextInfo (GOWS/NOWEB)
  const contextInfo =
    msg._data?.Message?.extendedTextMessage?.contextInfo ||
    msg._data?.Message?.imageMessage?.contextInfo ||
    msg._data?.Message?.videoMessage?.contextInfo ||
    msg._data?.Message?.documentMessage?.contextInfo ||
    msg._data?.contextInfo ||
    msg.contextInfo;

  if (contextInfo) {
    const qMsg = contextInfo.quotedMessage;
    if (!sender) sender = String(contextInfo.participant || "").trim();
    if (qMsg) {
      if (!text) {
        if (qMsg.conversation) text = String(qMsg.conversation).trim();
        else if (qMsg.extendedTextMessage?.text) text = String(qMsg.extendedTextMessage.text).trim();
        else if (qMsg.documentMessage?.fileName || qMsg.documentMessage?.title) {
          text = `[Dokumen: ${qMsg.documentMessage.fileName || qMsg.documentMessage.title}]`;
        } else if (qMsg.imageMessage?.caption) text = `[Foto: ${qMsg.imageMessage.caption}]`;
        else if (qMsg.imageMessage) text = `[Foto]`;
        else if (qMsg.videoMessage?.caption) text = `[Video: ${qMsg.videoMessage.caption}]`;
        else if (qMsg.videoMessage) text = `[Video]`;
        else if (qMsg.audioMessage) text = `[Pesan Suara VN]`;
      }

      if (!hasMedia) {
        if (qMsg.documentMessage) {
          hasMedia = true;
          media = {
            url: media?.url || null,
            mimetype: qMsg.documentMessage.mimetype || "application/pdf",
            filename: qMsg.documentMessage.fileName || qMsg.documentMessage.title || "document.pdf"
          };
        } else if (qMsg.imageMessage) {
          hasMedia = true;
          media = {
            url: media?.url || null,
            mimetype: qMsg.imageMessage.mimetype || "image/jpeg",
            filename: "image.jpeg"
          };
        } else if (qMsg.videoMessage) {
          hasMedia = true;
          media = {
            url: media?.url || null,
            mimetype: qMsg.videoMessage.mimetype || "video/mp4",
            filename: "video.mp4"
          };
        } else if (qMsg.audioMessage) {
          hasMedia = true;
          media = {
            url: media?.url || null,
            mimetype: qMsg.audioMessage.mimetype || "audio/ogg",
            filename: "audio.ogg"
          };
        }
      }
    }
  }

  if (text || hasMedia || sender || replyId) {
    return {
      text,
      sender,
      fromMe: isFromMe,
      id: replyId,
      hasMedia,
      media
    };
  }

  return null;
}

export function parseIncoming(body, allowedPhone) {
  if (body.event !== "message") return null;

  const msg = body.payload;
  if (!msg || msg.fromMe) return null;

  // Auto-detect bot phone number from payload destination if available (DM only, ignore group JID @g.us)
  const toRaw = msg.to || body.payload?.to || msg._data?.to || "";
  const isToGroup = toRaw.includes("@g.us");
  const botTo = !isToGroup ? toRaw.split("@")[0].split(":")[0].replace(/\D/g, "") : "";
  if (botTo && !currentBotNumber) {
    currentBotNumber = botTo;
  }

  const isGroup = Boolean(msg.from && String(msg.from).endsWith("@g.us"));
  const rawSender = isGroup
    ? (msg.participant || msg.author || msg._data?.participant || msg._data?.key?.participant || "")
    : (msg.from || "");
  const senderNumber = rawSender.split("@")[0].split(":")[0].replace(/\D/g, "");

  const altJid = msg._data?.key?.remoteJidAlt || msg._data?.key?.participantAlt;
  const altNumber = altJid ? altJid.split("@")[0].replace(/\D/g, "") : null;
  const resolvedPhone = resolveLidToPhone(senderNumber);

  const quoted = extractQuotedInfo(msg);
  const botNumber = currentBotNumber || (process.env.BOT_PHONE || "").replace(/\D/g, "") || botTo;
  if (!currentBotLid && botNumber) {
    const diskLid = resolvePhoneToLid(botNumber);
    if (diskLid) currentBotLid = diskLid;
  }

  let isFollowUpThread = false;
  // Grup WA: Strictly hanya jika di-mention (@) atau reply ke pesan bot
  if (isGroup) {
    const contextInfo =
      msg._data?.Message?.extendedTextMessage?.contextInfo ||
      msg._data?.Message?.imageMessage?.contextInfo ||
      msg._data?.Message?.videoMessage?.contextInfo ||
      msg._data?.Message?.documentMessage?.contextInfo ||
      msg._data?.contextInfo ||
      msg.contextInfo;

    const mentionedList = [
      ...(Array.isArray(msg.mentionedIds) ? msg.mentionedIds : []),
      ...(Array.isArray(msg._data?.mentionedJidList) ? msg._data.mentionedJidList : []),
      ...(Array.isArray(contextInfo?.mentionedJid) ? contextInfo.mentionedJid : [])
    ];

    const bodyTextRaw = String(msg.body || msg.caption || "");

    // 1. WhatsApp @ mention matching bot number, LID, or @bot / @john
    let isMentioned = false;
    if (botNumber) {
      isMentioned =
        mentionedList.some((id) => {
          const digits = String(id).replace(/\D/g, "");
          return digits && (digits === botNumber || digits.includes(botNumber) || botNumber.includes(digits));
        }) ||
        bodyTextRaw.includes(`@${botNumber}`);
    }
    if (!isMentioned && currentBotLid) {
      isMentioned =
        mentionedList.some((id) => String(id).includes(currentBotLid)) ||
        bodyTextRaw.includes(`@${currentBotLid}`);
    }
    if (!isMentioned) {
      isMentioned = /@(?:bot|john|mustard)\b/i.test(bodyTextRaw);
    }
    if (!isMentioned && botNumber) {
      isMentioned =
        mentionedList.some((id) => {
          const digits = String(id).replace(/\D/g, "");
          return resolveLidToPhone(digits) === botNumber;
        }) ||
        Array.from(bodyTextRaw.matchAll(/@(\d{8,20})\b/g)).some((m) => resolveLidToPhone(m[1]) === botNumber);
    }

    // 2. Reply to bot check
    const quotedParticipant = (quoted?.sender || "").replace(/\D/g, "");

    const isReplyToBot = Boolean(
      quoted?.fromMe ||
      (quoted?.id && isBotSentMessage(quoted.id)) ||
      (msg.replyTo?.id && isBotSentMessage(msg.replyTo.id)) ||
      (botNumber && quotedParticipant && (quotedParticipant === botNumber || quotedParticipant.includes(botNumber) || botNumber.includes(quotedParticipant))) ||
      (currentBotLid && quoted?.sender && quoted.sender.includes(currentBotLid)) ||
      (botNumber && quotedParticipant && resolveLidToPhone(quotedParticipant) === botNumber) ||
      (botNumber && quotedParticipant && resolvePhoneToLid(botNumber) === quotedParticipant) ||
      (currentBotLid && quotedParticipant && resolvePhoneToLid(quotedParticipant) === currentBotLid)
    );

    if (!isMentioned && !isReplyToBot) {
      return null;
    }
  }

  // Whitelist check:
  // - Direct Message (DM): Whitelist ketat (hanya nomor terdaftar yg boleh chat).
  // - Grup WhatsApp: Jika bot di-tag atau di-reply di grup, respon ke anggota grup tersebut.
  const allowedList = (allowedPhone || "")
    .split(",")
    .map((p) => p.replace(/\D/g, "").trim())
    .filter(Boolean);

  const isAllowed =
    allowedList.length === 0 ||
    isGroup ||
    allowedList.includes(senderNumber) ||
    (altNumber && allowedList.includes(altNumber)) ||
    (resolvedPhone && allowedList.includes(resolvedPhone));

  if (!isAllowed) {
    console.log(`[Whitelist] Pesan dari ${rawSender} (${senderNumber}) diabaikan (Bukan whitelist: ${allowedList.join(", ")})`);
    return null;
  }

  const quotedMedia = quoted?.hasMedia ? quoted.media : null;
  const isQuotedMedia = Boolean(!msg.hasMedia && !msg.media && quotedMedia);

  const mediaUrl = msg.media?.url || msg.mediaUrl || (typeof msg.media === "string" ? msg.media : null) || quotedMedia?.url || null;
  const mimetype = msg.media?.mimetype || msg.mimetype || quotedMedia?.mimetype || "application/octet-stream";
  const filename = extractMediaFilename(msg) !== "file" ? extractMediaFilename(msg) : (quotedMedia?.filename || "file");

  const isSticker = Boolean(
    msg.type === "sticker" ||
    msg._data?.type === "sticker" ||
    msg._data?.Message?.stickerMessage ||
    (!isQuotedMedia && mimetype.includes("image/webp") && (!filename || filename === "file" || filename.endsWith(".webp")))
  );

  let bodyText = normalizeMentionsInText(msg.body || "");
  if (quoted?.text) {
    const normQuoted = normalizeMentionsInText(quoted.text);
    bodyText = `${bodyText}\n\n[MEMBALAS PESAN]: "${normQuoted}"`.trim();
  }

  return {
    id: msg.id,
    from: msg.from,
    senderNumber: resolvedPhone || altNumber || senderNumber,
    body: bodyText,
    hasMedia: Boolean(msg.hasMedia || mediaUrl || quotedMedia),
    mediaUrl,
    filename,
    mimetype,
    isSticker,
    isQuotedMedia,
    quotedMessageId: quoted?.id || null,
    timestamp: msg.timestamp,
    quoted,
    isGroup,
    isFollowUpThread
  };
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("src/waha.js")) {
  const samplePayload = {
    event: "message",
    payload: {
      id: "ABC123XYZ",
      from: "6281234567890@c.us",
      fromMe: false,
      body: "halo bot",
      timestamp: 1700000000
    }
  };
  const parsed = parseIncoming(samplePayload, "6281234567890");
  assert.strictEqual(parsed.body, "halo bot");
  assert.strictEqual(parsed.senderNumber, "6281234567890");
  assert.strictEqual(parseIncoming(samplePayload, "628999999999"), null);

  // Quoted message test
  const quotedPayload = {
    event: "message",
    payload: {
      id: "MSG_REPLY",
      from: "6281234567890@c.us",
      fromMe: false,
      body: "kerjakan ini",
      replyTo: {
        body: "Tugas Kalkulus bab 4 dikumpulkan besok",
        participant: "6281234567890@c.us"
      },
      timestamp: 1700000010
    }
  };
  const parsedQuoted = parseIncoming(quotedPayload, "6281234567890");
  assert.ok(parsedQuoted.body.includes("kerjakan ini"));
  assert.ok(parsedQuoted.body.includes('[MEMBALAS PESAN]: "Tugas Kalkulus bab 4 dikumpulkan besok"'));
  assert.strictEqual(parsedQuoted.quoted.text, "Tugas Kalkulus bab 4 dikumpulkan besok");

  // Quoted media test (reply to document without resending)
  const quotedDocPayload = {
    event: "message",
    payload: {
      id: "MSG_REPLY_DOC",
      from: "6281234567890@c.us",
      fromMe: false,
      body: "file apani",
      replyTo: {
        hasMedia: true,
        media: {
          url: "http://waha:3000/api/files/default/PTS1.pdf",
          mimetype: "application/pdf",
          filename: "HasilPTSkelas7s1Revisi.pdf"
        },
        participant: "6281234567890@c.us"
      },
      timestamp: 1700000020
    }
  };
  const parsedQuotedDoc = parseIncoming(quotedDocPayload, "6281234567890");
  assert.strictEqual(parsedQuotedDoc.hasMedia, true);
  assert.strictEqual(parsedQuotedDoc.isQuotedMedia, true);
  assert.strictEqual(parsedQuotedDoc.mediaUrl, "http://waha:3000/api/files/default/PTS1.pdf");
  assert.strictEqual(parsedQuotedDoc.mimetype, "application/pdf");
  assert.strictEqual(parsedQuotedDoc.filename, "HasilPTSkelas7s1Revisi.pdf");
  assert.ok(parsedQuotedDoc.body.includes("file apani"));

  // Media filename test
  assert.strictEqual(extractMediaFilename({ _data: { Message: { documentMessage: { fileName: "dokumen_rahasia.pdf" } } } }), "dokumen_rahasia.pdf");
  assert.strictEqual(extractMediaFilename({ media: { fileName: "tabel.xlsx" } }), "tabel.xlsx");

  // Sticker detection test
  const stickerPayload = {
    event: "message",
    payload: {
      id: "STK_123",
      from: "6281234567890@c.us",
      mediaUrl: "http://waha:3000/media/stk.webp",
      media: { mimetype: "image/webp" },
      _data: { Message: { stickerMessage: {} } }
    }
  };
  const parsedSticker = parseIncoming(stickerPayload, "6281234567890");
  assert.strictEqual(parsedSticker.isSticker, true);
  assert.strictEqual(parsedSticker.hasMedia, true);

  // Group message tests
  const groupChatId = "1203630234567890@g.us";
  const groupUser = "6281234567890@c.us";

  // 1. Group message without mention/reply -> dropped
  const groupIgnored = parseIncoming({
    event: "message",
    payload: {
      id: "GRP_IGN",
      from: groupChatId,
      participant: groupUser,
      fromMe: false,
      body: "nasi sudah matang belum ya?",
      timestamp: 1700000020
    }
  }, "6281234567890");
  assert.strictEqual(groupIgnored, null, "Pesan obrolan biasa di grup wajib diabaikan");

  // 2. Group message with @john mention -> processed
  const groupMentioned = parseIncoming({
    event: "message",
    payload: {
      id: "GRP_MENTION",
      from: groupChatId,
      participant: groupUser,
      fromMe: false,
      body: "@john tolong rekap belanjaan",
      timestamp: 1700000021
    }
  }, "6281234567890");
  assert.ok(groupMentioned !== null, "Pesan mention @john wajib diproses");
  assert.strictEqual(groupMentioned.isGroup, true);
  assert.strictEqual(groupMentioned.senderNumber, "6281234567890");
  assert.strictEqual(groupMentioned.from, groupChatId);

  // 3. Group message replying to bot -> processed
  const groupReply = parseIncoming({
    event: "message",
    payload: {
      id: "GRP_REPLY",
      from: groupChatId,
      participant: groupUser,
      fromMe: false,
      body: "sudah beres",
      replyTo: {
        id: "true_1203630234567890@g.us_BOTMSG",
        fromMe: true,
        body: "List tugas belanja"
      },
      timestamp: 1700000022
    }
  }, "6281234567890");
  assert.ok(groupReply !== null, "Reply ke pesan bot di grup wajib diproses");
  assert.strictEqual(groupReply.isGroup, true);

  // 3b. Group message replying to bot with participant matching botNumber -> processed
  setBotNumber("6281234567890");
  const groupReplyParticipant = parseIncoming({
    event: "message",
    payload: {
      id: "GRP_REPLY_PARTICIPANT",
      from: groupChatId,
      participant: "628999999999@c.us",
      fromMe: false,
      body: "ini lanjutan tugasnya",
      replyTo: {
        id: "false_1203630234567890@g.us_ANY_OLD_ID",
        participant: "6281234567890@c.us",
        body: "List tugas belanja"
      },
      timestamp: 1700000022
    }
  }, "6281234567890");
  assert.ok(groupReplyParticipant !== null, "Reply ke pesan bot via participant matching botNumber wajib diproses");

  // 4. Group message with @bot mention from group member -> processed
  const groupMemberMention = parseIncoming({
    event: "message",
    payload: {
      id: "GRP_MEMBER",
      from: groupChatId,
      participant: "628999999999@c.us",
      fromMe: false,
      body: "@bot tolong bantu",
      timestamp: 1700000023
    }
  }, "6281234567890");
  assert.ok(groupMemberMention !== null, "Pesan mention @bot dari member grup wajib diproses");
  assert.strictEqual(groupMemberMention.isGroup, true);

  // 5. DM message from non-whitelisted sender -> dropped
  const dmStranger = parseIncoming({
    event: "message",
    payload: {
      id: "DM_STRANGER",
      from: "628999999999@c.us",
      fromMe: false,
      body: "halo bot",
      timestamp: 1700000024
    }
  }, "6281234567890");
  assert.strictEqual(dmStranger, null, "Pesan DM dari non-whitelist wajib diabaikan");

  // 6. Reply to bot tracked message ID -> processed
  recordBotSentMessage("BOT_MSG_TRACKED_123");
  const replyTracked = parseIncoming({
    event: "message",
    payload: {
      id: "GRP_REPLY_TRACKED",
      from: groupChatId,
      participant: "628999999999@c.us",
      fromMe: false,
      body: "oke siap",
      replyTo: {
        id: "false_1203630234567890@g.us_BOT_MSG_TRACKED_123",
        participant: "6281234567890@c.us",
        body: "List tugas"
      },
      timestamp: 1700000025
    }
  }, "6281234567890");
  assert.ok(replyTracked !== null, "Reply ke pesan bot dengan ID terlacak wajib diproses");

  // 7. Group message without mention or reply -> ignored (strictly mention/reply only)
  recordBotActivity(groupChatId);
  const followUpMessage = parseIncoming({
    event: "message",
    payload: {
      id: "GRP_FOLLOWUP",
      from: groupChatId,
      participant: "628999999999@c.us",
      fromMe: false,
      body: "yang besok apa aja?",
      timestamp: 1700000026
    }
  }, "6281234567890");
  assert.strictEqual(followUpMessage, null, "Pesan tanpa tag/reply di grup wajib diabaikan meskipun ada riwayat bot");

  // 8. Fast command without mention in group -> ignored
  const groupFastCmd = parseIncoming({
    event: "message",
    payload: {
      id: "GRP_FASTCMD",
      from: groupChatId,
      participant: groupUser,
      fromMe: false,
      body: "#ping",
      timestamp: 1700000028
    }
  }, "6281234567890");
  assert.strictEqual(groupFastCmd, null, "Fast command tanpa tag/reply di grup wajib diabaikan");

  // Fast command WITH tag in group -> processed
  const groupFastCmdTagged = parseIncoming({
    event: "message",
    payload: {
      id: "GRP_FASTCMD_TAGGED",
      from: groupChatId,
      participant: groupUser,
      fromMe: false,
      body: "@bot #ping",
      timestamp: 1700000028
    }
  }, "6281234567890");
  assert.ok(groupFastCmdTagged !== null, "Fast command dengan @bot di grup wajib diproses");

  // 9. Name calling in group without @ -> ignored
  const groupNameCall = parseIncoming({
    event: "message",
    payload: {
      id: "GRP_NAMECALL",
      from: groupChatId,
      participant: groupUser,
      fromMe: false,
      body: "bot tolong cek jadwal",
      timestamp: 1700000029
    }
  }, "6281234567890");
  assert.strictEqual(groupNameCall, null, "Panggil nama 'bot' tanpa @ di grup wajib diabaikan");

  // 10. Native WA mention in contextInfo.mentionedJid (Pattern A) -> processed
  setBotNumber("628111111111");
  const groupNativeMention = parseIncoming({
    event: "message",
    payload: {
      id: "GRP_NATIVE_MENTION",
      from: groupChatId,
      participant: groupUser,
      fromMe: false,
      body: "@628111111111 apa kabar",
      _data: {
        Message: {
          extendedTextMessage: {
            contextInfo: {
              mentionedJid: ["628111111111@s.whatsapp.net"]
            }
          }
        }
      },
      timestamp: 1700000030
    }
  }, "6281234567890");
  assert.ok(groupNativeMention !== null, "Native WA mention @nomor bot di grup wajib diproses");

  // 11. Group payload msg.to should not poison currentBotNumber
  assert.notStrictEqual(getBotNumber(), groupChatId.replace(/\D/g, ""), "currentBotNumber tidak boleh keracunan ID grup");

  // 12. Mention resolution & formatting tests
  const outFormatted = formatOutboundMentions("Halo @6281234567890 dan @628999999999 tolong cek");
  assert.strictEqual(outFormatted.text, "Halo @6281234567890 dan @628999999999 tolong cek");
  assert.ok(outFormatted.mentions.includes("6281234567890@c.us"));
  assert.ok(outFormatted.mentions.includes("628999999999@c.us"));

  const normalized = normalizeMentionsInText("@628111111111 halo apa kabar");
  assert.strictEqual(normalized, "@bot halo apa kabar");

  // 13. Whitelist extraction and deduplication test
  const testWl = getWhitelistPhones("+6285236467838,+6289514718700,228140156772422,51934979461357,+6282297432850,+6282217584569,+62819703133");
  assert.strictEqual(testWl.length, 5, "Whitelist harus berisi tepat 5 nomor unik");
  assert.ok(testWl.includes("6285236467838"));
  assert.ok(testWl.includes("6289514718700"));
  assert.ok(testWl.includes("6282297432850"));
  assert.ok(testWl.includes("6282217584569"));
  assert.ok(testWl.includes("62819703133"));

  // 14. Whitelist recipient resolver tests
  const prevWlEnv = process.env.WHITELIST_PHONE;
  process.env.WHITELIST_PHONE = "+6285236467838,+6289514718700,+6282297432850";
  process.env.PRIMARY_USER_PHONE = "6285236467838";
  process.env.PRIMARY_USER_NAME = "Rafid";
  process.env.SECONDARY_USER_PHONE = "6289514718700";
  process.env.SECONDARY_USER_NAME = "Karimah";

  const resolvedAlias = resolveWhitelistRecipient("karimah");
  assert.strictEqual(resolvedAlias.targetPhone, "6289514718700");
  assert.strictEqual(resolvedAlias.isWhitelisted, true);

  const mockStore = {
    getPerson: (name) => (name.toLowerCase() === "mami" ? { name: "Mami", phone: "6282297432850" } : null),
    listPersons: () => [{ name: "Mami", phone: "6282297432850" }]
  };
  const resolvedContact = resolveWhitelistRecipient("mami", mockStore);
  assert.strictEqual(resolvedContact.targetPhone, "6282297432850");
  assert.strictEqual(resolvedContact.isWhitelisted, true);

  const blockedStranger = resolveWhitelistRecipient("628999999999");
  assert.strictEqual(blockedStranger.isWhitelisted, false);
  assert.ok(blockedStranger.error.includes("tidak terdaftar dalam whitelist"));

  const senderNameOwner = formatSenderDisplay("6285236467838");
  assert.strictEqual(senderNameOwner, "Rafid");
  process.env.WHITELIST_PHONE = prevWlEnv || "";

  assert.strictEqual(typeof resolvePhoneToLid, "function");
  assert.strictEqual(typeof startTyping, "function");
  assert.strictEqual(typeof stopTyping, "function");
  assert.strictEqual(typeof sendImage, "function");
  console.log("WAHA parser self-test OK");
}
