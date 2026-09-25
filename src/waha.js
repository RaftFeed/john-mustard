import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

let currentBotNumber = (process.env.BOT_PHONE || "").replace(/\D/g, "") || null;

export function getBotNumber() {
  return currentBotNumber;
}

export function setBotNumber(num) {
  currentBotNumber = num ? String(num).replace(/\D/g, "") : null;
}

export async function fetchBotNumber() {
  if (currentBotNumber) return currentBotNumber;
  try {
    const wahaUrl = process.env.WAHA_URL || "http://localhost:3000";
    const apiKey = process.env.WAHA_API_KEY || "";
    const res = await fetch(`${wahaUrl}/api/me?session=default`, {
      headers: apiKey ? { "x-api-key": apiKey } : {},
      signal: AbortSignal.timeout(3000)
    });
    if (res.ok) {
      const data = await res.json();
      const meId = data.id || data.me?.id || "";
      const num = meId.split("@")[0].split(":")[0].replace(/\D/g, "");
      if (num) {
        currentBotNumber = num;
        return num;
      }
    }
  } catch {}
  return null;
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
  const payload = {
    chatId: chatId.includes("@") ? chatId : `${chatId}@c.us`,
    text,
    session: "default"
  };
  if (replyTo) payload.reply_to = replyTo;

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
  return res.json();
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

  const payload = {
    chatId: chatId.includes("@") ? chatId : `${chatId}@c.us`,
    file: {
      mimetype,
      filename,
      url: `data:${mimetype};base64,${base64Data}`
    },
    caption,
    session: "default"
  };

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
        if (fallbackRes.ok) return fallbackRes.json();
      } catch {}
    }
    const errText = await res.text();
    throw new Error(`WAHA ${endpoint} failed (${res.status}): ${errText}`);
  }
  return res.json();
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
  const isFromMe = Boolean(
    msg.replyTo?.fromMe ||
    msg._data?.quotedMsg?.fromMe ||
    msg._data?.quotedMsg?.key?.fromMe ||
    msg._data?.Message?.extendedTextMessage?.contextInfo?.isFromMe ||
    (typeof msg.replyTo?.id === "string" && msg.replyTo.id.startsWith("true_")) ||
    (typeof msg._data?.quotedMsg?.id === "string" && msg._data.quotedMsg.id.startsWith("true_"))
  );

  // 1. Top-level replyTo
  if (msg.replyTo) {
    const text = String(msg.replyTo.body || msg.replyTo.caption || "").trim();
    const sender = String(msg.replyTo.participant || msg.replyTo.from || "").trim();
    if (text) return { text, sender, fromMe: isFromMe };
  }
  // 2. _data.quotedMsg
  const dataQuoted = msg._data?.quotedMsg || msg.quotedMsg;
  if (dataQuoted) {
    const text = String(dataQuoted.body || dataQuoted.caption || "").trim();
    const sender = String(msg._data?.quotedParticipant || dataQuoted.participant || "").trim();
    if (text) return { text, sender, fromMe: isFromMe };
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
    if (text) return { text, sender, fromMe: isFromMe };
  }
  return null;
}

export function parseIncoming(body, allowedPhone) {
  if (body.event !== "message") return null;

  const msg = body.payload;
  if (!msg || msg.fromMe) return null;

  const isGroup = Boolean(msg.from && String(msg.from).endsWith("@g.us"));
  const rawSender = isGroup
    ? (msg.participant || msg.author || msg._data?.participant || msg._data?.key?.participant || "")
    : (msg.from || "");
  const senderNumber = rawSender.split("@")[0].split(":")[0].replace(/\D/g, "");

  const altJid = msg._data?.key?.remoteJidAlt || msg._data?.key?.participantAlt;
  const altNumber = altJid ? altJid.split("@")[0].replace(/\D/g, "") : null;
  const resolvedPhone = resolveLidToPhone(senderNumber);

  const allowedList = (allowedPhone || "")
    .split(",")
    .map((p) => p.replace(/\D/g, "").trim())
    .filter(Boolean);

  const isAllowed =
    allowedList.length === 0 ||
    allowedList.includes(senderNumber) ||
    (altNumber && allowedList.includes(altNumber)) ||
    (resolvedPhone && allowedList.includes(resolvedPhone));

  if (!isAllowed) {
    console.log(`[Whitelist] Pesan dari ${rawSender} (${senderNumber}) diabaikan (Bukan whitelist: ${allowedList.join(", ")})`);
    return null;
  }

  const quoted = extractQuotedInfo(msg);
  const botNumber = currentBotNumber || (process.env.BOT_PHONE || "").replace(/\D/g, "");

  // Grup WA: HANYA proses jika di-mention (@) atau reply ke bot
  if (isGroup) {
    const mentionedList = [
      ...(Array.isArray(msg.mentionedIds) ? msg.mentionedIds : []),
      ...(Array.isArray(msg._data?.mentionedJidList) ? msg._data.mentionedJidList : []),
      ...(Array.isArray(msg._data?.Message?.extendedTextMessage?.contextInfo?.mentionedJid)
        ? msg._data.Message.extendedTextMessage.contextInfo.mentionedJid
        : [])
    ];

    const bodyTextRaw = String(msg.body || "");
    const isMentioned =
      (botNumber && (
        mentionedList.some((id) => String(id).replace(/\D/g, "").includes(botNumber)) ||
        bodyTextRaw.includes(`@${botNumber}`)
      )) ||
      /@(?:john|mustard|bot)\b/i.test(bodyTextRaw);

    const isReplyToBot = Boolean(
      quoted?.fromMe ||
      (botNumber && quoted?.sender && quoted.sender.replace(/\D/g, "").includes(botNumber))
    );

    if (!isMentioned && !isReplyToBot) {
      return null;
    }
  }

  const mediaUrl = msg.media?.url || msg.mediaUrl || (typeof msg.media === "string" ? msg.media : null);
  const mimetype = msg.media?.mimetype || msg.mimetype || "application/octet-stream";
  const filename = extractMediaFilename(msg);

  let bodyText = msg.body || "";
  if (quoted?.text) {
    bodyText = `${bodyText}\n\n[MEMBALAS PESAN]: "${quoted.text}"`.trim();
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
    isGroup
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

  // 4. Group message from non-whitelisted sender -> dropped
  const groupStranger = parseIncoming({
    event: "message",
    payload: {
      id: "GRP_STRANGER",
      from: groupChatId,
      participant: "628999999999@c.us",
      fromMe: false,
      body: "@bot tolong bantu",
      timestamp: 1700000023
    }
  }, "6281234567890");
  assert.strictEqual(groupStranger, null, "Sender non-whitelist di grup wajib diabaikan");

  assert.strictEqual(typeof startTyping, "function");
  assert.strictEqual(typeof stopTyping, "function");
  assert.strictEqual(typeof sendImage, "function");
  console.log("WAHA parser self-test OK");
}
