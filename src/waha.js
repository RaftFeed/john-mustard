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

export function formatOutboundMentions(text) {
  if (!text || typeof text !== "string") return { text: "", mentions: [] };

  // Convert unmapped/raw LID mentions in text into phone number if resolvable
  const formattedText = text.replace(/@(\d{8,20})\b/g, (match, digits) => {
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

export function extractMediaFilename(msg) {
  if (!msg) return "file";
  if (msg.media?.filename || msg.media?.fileName) return String(msg.media.filename || msg.media.fileName).trim();
  if (msg.filename || msg.fileName) return String(msg.filename || msg.fileName).trim();
  if (msg._data?.filename || msg._data?.title) return String(msg._data.filename || msg._data.title).trim();
  const doc = msg._data?.Message?.documentMessage;
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

  // 1. Top-level replyTo
  if (msg.replyTo) {
    const text = String(msg.replyTo.body || msg.replyTo.caption || "").trim();
    const sender = String(msg.replyTo.participant || msg.replyTo.from || "").trim();
    if (text) return { text, sender, fromMe: isFromMe, id: replyId };
  }
  // 2. _data.quotedMsg
  const dataQuoted = msg._data?.quotedMsg || msg.quotedMsg;
  if (dataQuoted) {
    const text = String(dataQuoted.body || dataQuoted.caption || "").trim();
    const sender = String(msg._data?.quotedParticipant || dataQuoted.participant || "").trim();
    if (text) return { text, sender, fromMe: isFromMe, id: replyId };
  }
  // 3. Protobuf contextInfo (GOWS/NOWEB)
  const contextInfo =
    msg._data?.Message?.extendedTextMessage?.contextInfo ||
    msg._data?.contextInfo ||
    msg.contextInfo;
  if (contextInfo) {
    const qMsg = contextInfo.quotedMessage;
    const sender = String(contextInfo.participant || "").trim();
    let text = "";
    if (qMsg) {
      if (qMsg.conversation) text = String(qMsg.conversation).trim();
      else if (qMsg.extendedTextMessage?.text) text = String(qMsg.extendedTextMessage.text).trim();
      else if (qMsg.documentMessage?.fileName || qMsg.documentMessage?.title) {
        text = `[Dokumen: ${qMsg.documentMessage.fileName || qMsg.documentMessage.title}]`;
      } else if (qMsg.imageMessage?.caption) text = `[Foto: ${qMsg.imageMessage.caption}]`;
      else if (qMsg.imageMessage) text = `[Foto]`;
      else if (qMsg.audioMessage) text = `[Pesan Suara VN]`;
    }
    if (text) return { text, sender, fromMe: isFromMe, id: replyId };
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
      (currentBotLid && quoted?.sender && quoted.sender.includes(currentBotLid))
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

  const mediaUrl = msg.media?.url || msg.mediaUrl || (typeof msg.media === "string" ? msg.media : null);
  const mimetype = msg.media?.mimetype || msg.mimetype || "application/octet-stream";
  const filename = extractMediaFilename(msg);

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
    hasMedia: Boolean(msg.hasMedia || mediaUrl),
    mediaUrl,
    filename,
    mimetype,
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

  // Media filename test
  assert.strictEqual(extractMediaFilename({ _data: { Message: { documentMessage: { fileName: "dokumen_rahasia.pdf" } } } }), "dokumen_rahasia.pdf");
  assert.strictEqual(extractMediaFilename({ media: { fileName: "tabel.xlsx" } }), "tabel.xlsx");

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

  assert.strictEqual(typeof resolvePhoneToLid, "function");
  assert.strictEqual(typeof startTyping, "function");
  assert.strictEqual(typeof stopTyping, "function");
  assert.strictEqual(typeof sendImage, "function");
  console.log("WAHA parser self-test OK");
}
