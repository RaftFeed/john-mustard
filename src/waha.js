import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

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

const lidMemoryCache = new Map();
// Pre-seed known mappings from environment or defaults
lidMemoryCache.set("228140156772422", "6285236467838");
lidMemoryCache.set("51934979461357", "6289514718700");

let activeWahaStore = null;
export function setWahaStore(store) {
  activeWahaStore = store;
}
export function getWahaStore() {
  return activeWahaStore;
}

export function registerLidMapping(lid, phone, name = "", store = null) {
  const cleanLid = String(lid || "").replace(/\D/g, "");
  let cleanPhone = String(phone || "").replace(/\D/g, "");
  if (cleanPhone.startsWith("0")) cleanPhone = "62" + cleanPhone.slice(1);
  if (!cleanLid || !cleanPhone || cleanLid === cleanPhone) return;
  lidMemoryCache.set(cleanLid, cleanPhone);
  const s = store || activeWahaStore;
  if (s && typeof s.saveLidMapping === "function") {
    s.saveLidMapping(cleanLid, cleanPhone, name);
  }
}

export function resolveLidToPhone(lid, store = null) {
  try {
    const cleanLid = String(lid).replace(/\D/g, "");
    if (!cleanLid) return null;

    if (lidMemoryCache.has(cleanLid)) {
      return lidMemoryCache.get(cleanLid);
    }
    if (cleanLid === "228140156772422" || cleanLid.endsWith("7838")) {
      const p = (process.env.PRIMARY_USER_PHONE || process.env.OWNER_PHONE || "6285236467838").replace(/\D/g, "");
      lidMemoryCache.set(cleanLid, p);
      return p;
    }
    if (cleanLid === "51934979461357") {
      const p = (process.env.SECONDARY_USER_PHONE || "6289514718700").replace(/\D/g, "");
      lidMemoryCache.set(cleanLid, p);
      return p;
    }

    const s = store || activeWahaStore;
    if (s && typeof s.getLidMapping === "function") {
      const row = s.getLidMapping(cleanLid);
      if (row?.phone) {
        lidMemoryCache.set(cleanLid, row.phone);
        return row.phone;
      }
    }

    const sessionDir = process.env.WAHA_SESSIONS_DIR || "/app/waha_sessions/noweb/default";
    const mappingFile = path.join(sessionDir, `lid-mapping-${cleanLid}_reverse.json`);
    if (fs.existsSync(mappingFile)) {
      const data = fs.readFileSync(mappingFile, "utf8");
      const p = JSON.parse(data).replace(/\D/g, "");
      if (p) {
        lidMemoryCache.set(cleanLid, p);
        return p;
      }
    }
  } catch {}
  return null;
}

export function resolvePhoneToLid(phone, store = null) {
  try {
    let cleanPhone = String(phone).replace(/\D/g, "");
    if (cleanPhone.startsWith("0")) cleanPhone = "62" + cleanPhone.slice(1);
    if (!cleanPhone) return null;

    for (const [l, p] of lidMemoryCache.entries()) {
      if (p === cleanPhone) return l;
    }
    if (cleanPhone === "6285236467838") return "228140156772422";
    if (cleanPhone === "6289514718700") return "51934979461357";

    const s = store || activeWahaStore;
    if (s && typeof s.getLidForPhone === "function") {
      const l = s.getLidForPhone(cleanPhone);
      if (l) return l;
    }

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
    const fromLid = resolveLidToPhone(digits, store);
    if (fromLid) targetPhone = fromLid;
  }

  // 2. Alias nama pengguna utama / sekunder dari environment & nama keluarga
  if (!targetPhone) {
    const cleanName = targetStr.replace(/[\p{Emoji}\p{Extended_Pictographic}]/gu, "").trim().toLowerCase();
    const primaryName = (process.env.PRIMARY_USER_NAME || "rafid").toLowerCase();
    const secondaryName = (process.env.SECONDARY_USER_NAME || "karimah").toLowerCase();

    if (
      cleanName.includes(primaryName) ||
      /\b(owner|master|simas|si mas|mas|mas rafid|m3-083|lord)\b/i.test(cleanName)
    ) {
      targetPhone = (process.env.PRIMARY_USER_PHONE || process.env.OWNER_PHONE || "6285236467838").replace(/\D/g, "");
      recipientDisplayName = process.env.PRIMARY_USER_NAME || "Rafid";
    } else if (cleanName.includes(secondaryName) || /\b(istri|pasangan|karimah)\b/i.test(cleanName)) {
      targetPhone = (process.env.SECONDARY_USER_PHONE || "6289514718700").replace(/\D/g, "");
      recipientDisplayName = process.env.SECONDARY_USER_NAME || "Karimah";
    } else if (/\b(mami|mama|ibu|bunda|umi|sabariyah)\b/i.test(cleanName) || cleanName.includes("mami") || cleanName.includes("sabariyah")) {
      targetPhone = "6282297432850";
      recipientDisplayName = "Mami";
    } else if (/\b(papi|papa|ayah|abi)\b/i.test(cleanName) || cleanName.includes("papi") || cleanName.includes("papa")) {
      targetPhone = "62819703133";
      recipientDisplayName = "Papi";
    } else if (cleanName.includes("razita") || /\b(zita|ndut)\b/i.test(cleanName)) {
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
  let senderClean = String(senderNumber || "").replace(/\D/g, "");
  const resolved = resolveLidToPhone(senderClean, store);
  if (resolved) senderClean = resolved;

  if (senderClean === (process.env.PRIMARY_USER_PHONE || process.env.OWNER_PHONE || "6285236467838").replace(/\D/g, "")) {
    return process.env.PRIMARY_USER_NAME || "Rafid";
  }
  if (senderClean === (process.env.SECONDARY_USER_PHONE || "6289514718700").replace(/\D/g, "")) {
    return process.env.SECONDARY_USER_NAME || "Karimah";
  }
  if (store?.getPerson) {
    const p = store.getPerson(senderClean) || (senderName ? store.getPerson(senderName) : null);
    if (p?.name) return p.name;
  }
  if (store?.listPersons && senderClean) {
    const p = store.listPersons().find((c) => String(c.phone).replace(/\D/g, "") === senderClean);
    if (p?.name) return p.name;
  }
  if (senderName && senderName.trim()) {
    const resolvedContact = resolveWhitelistRecipient(senderName, store);
    if (resolvedContact?.recipientDisplayName) return resolvedContact.recipientDisplayName;
    return senderName.trim();
  }
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

export function formatOutboundMentions(text, store = null, chatId = null) {
  if (!text || typeof text !== "string") return { text: "", mentions: [] };

  const activeStore = store || activeWahaStore;
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
    const res = resolveWhitelistRecipient(name, activeStore);
    if (res && res.targetPhone) {
      return `@${res.targetPhone}`;
    }
    return match;
  });

  const isGroup = Boolean(chatId && String(chatId).endsWith("@g.us"));
  const mentionsSet = new Set();

  if (isGroup) {
    // In WhatsApp group chats with LID addressing mode:
    // Mentions in body MUST use @<LID> matching <LID>@lid in the mentions array.
    // Putting @phone with phone@c.us makes the WhatsApp client render "@Pengguna tidak dikenal" (Unknown user).
    formattedText = formattedText.replace(/@(\d{8,20})\b/g, (match, digits) => {
      const lid = resolvePhoneToLid(digits, activeStore);
      if (lid) {
        mentionsSet.add(`${lid}@lid`);
        return `@${lid}`;
      }
      const phone = resolveLidToPhone(digits, activeStore);
      if (phone) {
        // digits is already a LID
        mentionsSet.add(`${digits}@lid`);
        return `@${digits}`;
      }
      mentionsSet.add(`${digits}@c.us`);
      return match;
    });
  } else {
    // 3. Convert unmapped/raw LID mentions in text into phone number if resolvable (DM)
    formattedText = formattedText.replace(/@(\d{8,20})\b/g, (match, digits) => {
      const phone = resolveLidToPhone(digits, activeStore);
      return phone ? `@${phone}` : match;
    });

    const matches = formattedText.match(/@(\d{8,20})\b/g);
    if (matches) {
      for (const m of matches) {
        const num = m.slice(1);
        mentionsSet.add(`${num}@c.us`);

        const lid = resolvePhoneToLid(num, activeStore);
        if (lid) {
          mentionsSet.add(`${lid}@lid`);
        }
        const phone = resolveLidToPhone(num, activeStore);
        if (phone) {
          mentionsSet.add(`${phone}@c.us`);
          mentionsSet.add(`${num}@lid`);
        }
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
  const { text: formattedText, mentions } = formatOutboundMentions(text, activeWahaStore, chatId);
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

  const { text: formattedCaption, mentions } = formatOutboundMentions(caption, activeWahaStore, chatId);

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

// ponytail: zero-dependency web image search via Bing Images with Wikimedia Commons fallback
export async function searchBingImages(query, limit = 5) {
  try {
    const url = "https://www.bing.com/images/search?q=" + encodeURIComponent(query) + "&form=HDRSC2&first=1";
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8"
      },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return [];
    const html = await res.text();
    const urls = [];
    const regex = /murl&quot;:&quot;(https?:[^&"]+)&quot;/g;
    let match;
    while ((match = regex.exec(html)) !== null) {
      const u = match[1];
      if (u && !urls.includes(u)) {
        urls.push(u);
        if (urls.length >= limit) break;
      }
    }
    return urls;
  } catch {
    return [];
  }
}

export async function searchWikimediaImages(query, limit = 5) {
  try {
    const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrsearch=${encodeURIComponent(query)}&gsrlimit=${limit}&prop=imageinfo&iiprop=url|mime&format=json`;
    const res = await fetch(url, {
      headers: { "User-Agent": "JohnMustardBot/1.0 (contact: admin@johnmustard.local)" },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return [];
    const data = await res.json();
    const pages = data.query?.pages || {};
    const urls = [];
    for (const p of Object.values(pages)) {
      const info = p.imageinfo?.[0];
      if (info?.url && info.mime?.startsWith("image/")) {
        urls.push(info.url);
      }
    }
    return urls;
  } catch {
    return [];
  }
}

export async function searchWebImages(query, limit = 5) {
  const bingUrls = await searchBingImages(query, limit);
  if (bingUrls.length > 0) return bingUrls;
  return searchWikimediaImages(query, limit);
}

export async function downloadWebImage(imageUrl, maxBytes = 10 * 1024 * 1024) {
  const { isSafeUrl } = await import("./llm/guards.js");
  if (!(await isSafeUrl(imageUrl))) {
    throw new Error("URL gambar tidak aman (SSRF Protection)");
  }

  const res = await fetch(imageUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "image/*,*/*;q=0.8"
    },
    signal: AbortSignal.timeout(10000)
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const contentType = (res.headers.get("content-type") || "").toLowerCase();
  let ext = "jpg";
  if (contentType.includes("png")) ext = "png";
  else if (contentType.includes("webp")) ext = "webp";
  else if (contentType.includes("gif")) ext = "gif";
  else if (!contentType.startsWith("image/") && !contentType.includes("octet-stream")) {
    throw new Error(`Bukan file gambar (Content-Type: ${contentType})`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > maxBytes) {
    throw new Error(`Ukuran gambar terlalu besar (${Math.round(buffer.length / 1024)} KB)`);
  }
  if (buffer.length < 500) {
    throw new Error("File gambar terlalu kecil atau korup");
  }

  const tempFilename = `img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`;
  const tempPath = path.join(os.tmpdir(), tempFilename);
  fs.writeFileSync(tempPath, buffer);
  return { tempPath, tempFilename, ext, size: buffer.length };
}

export async function searchAndSendWebImage(chatId, query, caption = "") {
  const candidates = await searchWebImages(query);
  if (!candidates || candidates.length === 0) {
    return { success: false, error: `Tidak ditemukan gambar untuk "${query}".` };
  }

  let lastError = null;
  for (const url of candidates) {
    try {
      const { tempPath, tempFilename } = await downloadWebImage(url);
      try {
        const finalCaption = caption || `📷 *${query}*`;
        await sendFile(chatId, tempPath, tempFilename, finalCaption, false);
        return { success: true, url, query };
      } finally {
        try { fs.unlinkSync(tempPath); } catch {}
      }
    } catch (err) {
      lastError = err.message;
    }
  }

  return { success: false, error: `Gagal mengunduh gambar untuk "${query}": ${lastError || "semua tautan gagal"}` };
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
  let senderName = String(
    msg.replyTo?.pushName ||
    msg.replyTo?.senderName ||
    msg.replyTo?._data?.pushName ||
    msg._data?.quotedMsg?.pushName ||
    msg._data?.quotedMsg?.notifyName ||
    msg._data?.Message?.extendedTextMessage?.contextInfo?.pushName ||
    ""
  ).trim();
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
      senderName,
      fromMe: isFromMe,
      id: replyId,
      hasMedia,
      media
    };
  }

  return null;
}

export function parseIncoming(body, allowedPhone, store = null) {
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

  const pushName = String(
    msg.pushName ||
    msg._data?.pushName ||
    msg._data?.notifyName ||
    msg._data?.verifiedName ||
    msg._data?.key?.pushName ||
    msg._data?.key?.notifyName ||
    ""
  ).trim();

  const altJid =
    msg._data?.key?.participantPn ||
    msg._data?.participantPn ||
    msg.participantPn ||
    msg._data?.key?.remoteJidAlt ||
    msg._data?.key?.participantAlt ||
    msg._data?.participantAlt ||
    msg._data?.remoteJidAlt ||
    msg.participantAlt ||
    msg._data?.key?.senderPn ||
    msg._data?.senderPn ||
    msg.senderPn ||
    msg.pn ||
    msg._data?.pn ||
    "";
  const altNumber = altJid ? String(altJid).split("@")[0].split(":")[0].replace(/\D/g, "") : null;
  let resolvedPhone = resolveLidToPhone(senderNumber, store);

  // Jika altNumber tersedia dan senderNumber adalah LID, daftarkan mapping
  if (altNumber && altNumber.length >= 9 && altNumber.length <= 15) {
    if (senderNumber && senderNumber !== altNumber) {
      registerLidMapping(senderNumber, altNumber, pushName, store);
    }
    resolvedPhone = altNumber;
  }

  // Jika pushName cocok dengan kontak terdaftar / alias (misal Mami, Papi, Razita)
  let resolvedSenderName = pushName;
  if (!resolvedPhone && pushName) {
    const contactFromPush = resolveWhitelistRecipient(pushName, store);
    if (contactFromPush?.targetPhone) {
      resolvedPhone = contactFromPush.targetPhone;
      resolvedSenderName = contactFromPush.recipientDisplayName || pushName;
      if (senderNumber && senderNumber !== resolvedPhone) {
        registerLidMapping(senderNumber, resolvedPhone, resolvedSenderName, store);
      }
    }
  }

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
  let resolvedQuotedNum = null;
  let resolvedQuotedName = quoted?.senderName || "";
  if (quoted && (quoted.text || quoted.hasMedia)) {
    const rawQuotedNum = (quoted.sender || "").split("@")[0].split(":")[0].replace(/\D/g, "");
    resolvedQuotedNum = resolveLidToPhone(rawQuotedNum, store) || rawQuotedNum;
    if (!resolvedQuotedName && rawQuotedNum) {
      const qPerson = store?.getPerson ? store.getPerson(resolvedQuotedNum) : null;
      if (qPerson?.name) resolvedQuotedName = qPerson.name;
    }
    const senderTag = quoted.fromMe
      ? "BOT (John Mustard)"
      : resolvedQuotedName ? `${resolvedQuotedName} (+${resolvedQuotedNum})` : (resolvedQuotedNum ? `+${resolvedQuotedNum}` : "");
    const fromSuffix = senderTag ? ` DARI ${senderTag}` : "";

    let mediaTag = "";
    if (quoted.hasMedia) {
      const mime = (quoted.media?.mimetype || "").toLowerCase();
      const mType = mime.startsWith("image/") ? "FOTO" : mime.startsWith("video/") ? "VIDEO" : mime.startsWith("audio/") ? "AUDIO/VN" : "DOKUMEN";
      const fName = quoted.media?.filename && quoted.media.filename !== "file" ? ` '${quoted.media.filename}'` : "";
      mediaTag = ` [MEDIA ${mType}${fName}]`;
    }

    const normQuoted = quoted.text ? normalizeMentionsInText(quoted.text) : "";
    const quoteContent = normQuoted ? `"${normQuoted}"` : (mediaTag ? "(file terlampir)" : "");

    const replyHeader = senderTag ? `[REPLY KE PESAN${fromSuffix}${mediaTag}]:\n` : (mediaTag ? `[REPLY KE MEDIA${mediaTag}]:\n` : "");
    bodyText = `${bodyText}\n\n${replyHeader}[MEMBALAS PESAN]: ${quoteContent}`.trim();
  }

  return {
    id: msg.id,
    from: msg.from,
    senderNumber: resolvedPhone || altNumber || senderNumber,
    senderName: resolvedSenderName || pushName || "",
    rawSender,
    pushName,
    body: bodyText,
    hasMedia: Boolean(msg.hasMedia || mediaUrl || quotedMedia),
    mediaUrl,
    filename,
    mimetype,
    isSticker,
    isQuotedMedia,
    quotedMessageId: quoted?.id || null,
    timestamp: msg.timestamp,
    quoted: quoted ? {
      ...quoted,
      senderNumber: resolvedQuotedNum,
      senderName: resolvedQuotedName
    } : null,
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
  assert.ok(parsedQuotedDoc.body.includes("[REPLY KE PESAN DARI +6281234567890 [MEDIA DOKUMEN 'HasilPTSkelas7s1Revisi.pdf']]"));

  // Quoted bot message test
  const quotedBotPayload = {
    event: "message",
    payload: {
      id: "MSG_REPLY_BOT",
      from: "6281234567890@c.us",
      fromMe: false,
      body: "jam 20:00 aja",
      replyTo: {
        id: "true_ABC123",
        body: "Mau diundur ke jam berapa jadwalnya?",
        fromMe: true
      },
      timestamp: 1700000030
    }
  };
  const parsedQuotedBot = parseIncoming(quotedBotPayload, "6281234567890");
  assert.ok(parsedQuotedBot.body.includes("[REPLY KE PESAN DARI BOT (John Mustard)]"));
  assert.ok(parsedQuotedBot.body.includes('[MEMBALAS PESAN]: "Mau diundur ke jam berapa jadwalnya?"'));
  assert.strictEqual(parsedQuotedBot.quoted.fromMe, true);

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
