import http from "node:http";
import crypto from "node:crypto";
import { parseIncoming } from "./waha.js";
import { createDebounceQueue } from "./queue.js";
import { TOOLS, executeTool } from "./llm.js";
import { OWNER_PHONE } from "./db.js";
import { tickScheduler } from "./scheduler.js";

const seenMessages = new Map();
const DEDUP_TTL_MS = 60_000;
const mcpSessions = new Map();

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

export function createServer(handler, { store = null, rotator = null } = {}) {
  const debouncedHandler = createDebounceQueue(handler, 1000);

  return http.createServer(async (req, res) => {
    const urlObj = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const pathname = urlObj.pathname;

    // WAHA Webhook
    if (req.method === "POST" && pathname === "/webhook") {
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
          debouncedHandler(incoming);
        }
      } catch (err) {
        console.error("Webhook parse error:", err.message);
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ status: "ok" }));
    }

    // Health Check
    if (req.method === "GET" && pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ status: "healthy", timestamp: Date.now() }));
    }

    // External Scheduler Container (Supercronic) Trigger
    if (req.method === "POST" && pathname === "/api/scheduler/tick") {
      try {
        const result = await tickScheduler(store, { rotator });
        res.writeHead(200, { "Content-Type": "application/json" });
        return res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: err.message }));
      }
    }

    // FastMCP SSE Transport Endpoint
    if (req.method === "GET" && pathname === "/mcp/sse") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive"
      });
      const sessionId = crypto.randomUUID();
      mcpSessions.set(sessionId, res);
      res.write(`event: endpoint\ndata: /mcp/message?sessionId=${sessionId}\n\n`);
      req.on("close", () => {
        mcpSessions.delete(sessionId);
      });
      return;
    }

    // FastMCP Message Handler (JSON-RPC 2.0)
    if (req.method === "POST" && pathname === "/mcp/message") {
      let data = "";
      for await (const chunk of req) data += chunk;

      let rpc;
      try {
        rpc = JSON.parse(data);
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }));
      }

      const { method, params, id } = rpc;
      let responsePayload = null;

      if (method === "initialize") {
        responsePayload = {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "john-mustard-fastmcp", version: "1.0.0" }
          }
        };
      } else if (method === "notifications/initialized") {
        res.writeHead(202);
        return res.end();
      } else if (method === "tools/list") {
        const mcpTools = (TOOLS[0]?.functionDeclarations || []).map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: {
            type: "object",
            properties: t.parameters?.properties || {},
            required: t.parameters?.required || []
          }
        }));
        responsePayload = {
          jsonrpc: "2.0",
          id,
          result: { tools: mcpTools }
        };
      } else if (method === "tools/call") {
        try {
          const toolResult = await executeTool(params?.name, params?.arguments || {}, {
            store,
            chatId: OWNER_PHONE,
            rotator
          });
          const textOut = toolResult.formattedList || JSON.stringify(toolResult.toolResult || toolResult);
          responsePayload = {
            jsonrpc: "2.0",
            id,
            result: {
              content: [{ type: "text", text: textOut }]
            }
          };
        } catch (callErr) {
          responsePayload = {
            jsonrpc: "2.0",
            id,
            error: { code: -32000, message: callErr.message }
          };
        }
      } else if (method === "ping") {
        responsePayload = { jsonrpc: "2.0", id, result: {} };
      } else {
        responsePayload = {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Method '${method}' not found` }
        };
      }

      const sessionId = urlObj.searchParams.get("sessionId");
      if (sessionId && mcpSessions.has(sessionId)) {
        const sseStream = mcpSessions.get(sessionId);
        sseStream.write(`event: message\ndata: ${JSON.stringify(responsePayload)}\n\n`);
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(responsePayload));
    }

    res.writeHead(404);
    res.end();
  });
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("src/server.js")) {
  import("node:assert").then(async ({ default: assert }) => {
    const storeMock = {
      getPendingReminders: () => [],
      markReminderDone: () => {}
    };
    const server = createServer(() => {}, { store: storeMock });
    await new Promise((resolve) => server.listen(0, resolve));
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    // 1. Health check
    const hRes = await fetch(`${base}/health`);
    assert.strictEqual(hRes.status, 200);
    const hData = await hRes.json();
    assert.strictEqual(hData.status, "healthy");

    // 2. Scheduler tick
    const tickRes = await fetch(`${base}/api/scheduler/tick`, { method: "POST" });
    assert.strictEqual(tickRes.status, 200);
    const tickData = await tickRes.json();
    assert.strictEqual(tickData.ticked, true);

    // 3. FastMCP initialization
    const initRes = await fetch(`${base}/mcp/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {}
      })
    });
    assert.strictEqual(initRes.status, 200);
    const initData = await initRes.json();
    assert.strictEqual(initData.result.serverInfo.name, "john-mustard-fastmcp");

    // 4. FastMCP Tools list
    const toolsRes = await fetch(`${base}/mcp/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
        params: {}
      })
    });
    assert.strictEqual(toolsRes.status, 200);
    const toolsData = await toolsRes.json();
    assert.ok(toolsData.result.tools.some((t) => t.name === "executePython"));
    assert.ok(toolsData.result.tools.some((t) => t.name === "saveSkill"));

    server.close();
    console.log("Server & FastMCP self-test OK");
  });
}
