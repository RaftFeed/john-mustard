import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

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

export async function sendFile(chatId, filepath, filename, caption = "") {
  const wahaUrl = process.env.WAHA_URL || "http://localhost:3000";
  const buffer = fs.readFileSync(filepath);
  const base64Data = buffer.toString("base64");
  
  let mimetype = "application/octet-stream";
  const ext = filename.split(".").pop().toLowerCase();
  if (ext === "pdf") mimetype = "application/pdf";
  else if (ext === "jpg" || ext === "jpeg") mimetype = "image/jpeg";
  else if (ext === "png") mimetype = "image/png";

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
  const res = await fetch(`${wahaUrl}/api/sendFile`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(apiKey ? { "x-api-key": apiKey } : {}) },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`WAHA sendFile failed (${res.status}): ${errText}`);
  }
  return res.json();
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

export function parseIncoming(body, allowedPhone) {
  if (body.event !== "message") return null;

  const msg = body.payload;
  if (!msg || msg.fromMe) return null;

  const allowedList = (allowedPhone || "")
    .split(",")
    .map((p) => p.replace(/\D/g, "").trim())
    .filter(Boolean);

  const rawSender = msg.from || msg.participant || msg.author || "";
  const senderNumber = rawSender.split("@")[0].replace(/\D/g, "");

  const altJid = msg._data?.key?.remoteJidAlt || msg._data?.key?.participantAlt;
  const altNumber = altJid ? altJid.split("@")[0].replace(/\D/g, "") : null;
  const resolvedPhone = resolveLidToPhone(senderNumber);

  const isAllowed =
    allowedList.length === 0 ||
    allowedList.includes(senderNumber) ||
    (altNumber && allowedList.includes(altNumber)) ||
    (resolvedPhone && allowedList.includes(resolvedPhone));

  if (!isAllowed) {
    console.log(`[Whitelist] Pesan dari ${rawSender} (${senderNumber}) diabaikan (Bukan whitelist: ${allowedList.join(", ")})`);
    return null;
  }

  const mediaUrl = msg.media?.url || msg.mediaUrl || (typeof msg.media === "string" ? msg.media : null);
  const mimetype = msg.media?.mimetype || msg.mimetype || "application/octet-stream";
  const filename = msg.media?.filename || msg.filename || "file";

  return {
    id: msg.id,
    from: msg.from,
    senderNumber: resolvedPhone || altNumber || senderNumber,
    body: msg.body || "",
    hasMedia: Boolean(msg.hasMedia || mediaUrl),
    mediaUrl,
    filename,
    mimetype,
    timestamp: msg.timestamp
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
  console.log("WAHA parser self-test OK");
}
