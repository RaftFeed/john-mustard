import http from "node:http";
import { parseIncoming } from "./waha.js";

const seenMessages = new Map();
const DEDUP_TTL_MS = 60_000;

function isDuplicate(messageId) {
  if (!messageId) return false;
  const now = Date.now();
  if (seenMessages.size > 500) {
    for (const [id, time] of seenMessages.entries()) {
      if (now - time > DEDUP_TTL_MS) seenMessages.delete(id);
    }
  }
  if (seenMessages.has(messageId)) return true;
  seenMessages.set(messageId, now);
  return false;
}

export function createServer(handler) {
  return http.createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/webhook") {
      let data = "";
      for await (const chunk of req) data += chunk;

      try {
        const body = JSON.parse(data);
        if (body.event !== "message") {
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ status: "ignored" }));
        }

        const msgId = body.payload?.id;
        if (msgId && isDuplicate(msgId)) {
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ status: "duplicate" }));
        }

        console.log(">> Webhook Event:", body.event, "from:", body.payload?.from, "body:", body.payload?.body);
        const incoming = parseIncoming(body, process.env.WHITELIST_PHONE || process.env.ALLOWED_PHONE);
        if (incoming) {
          handler(incoming).catch((err) => console.error("Handler error:", err));
        }
      } catch (err) {
        console.error("Webhook parse error:", err.message);
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ status: "ok" }));
    }

    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ status: "healthy", timestamp: Date.now() }));
    }

    res.writeHead(404);
    res.end();
  });
}
