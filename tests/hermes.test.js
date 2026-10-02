import { executeTool, TOOLS } from "../src/llm/tools.js";
import { OWNER_PHONE } from "../src/db.js";
import test from "node:test";
import assert from "node:assert";
import http from "node:http";
import { queryHermesAgent, formatHermesResponse } from "../src/hermes.js";

test("Hermes: formatHermesResponse formats error and success messages", () => {
  const errOutput = formatHermesResponse({ success: false, error: "Network timeout" });
  assert.ok(errOutput.includes("*[HERMES ERROR]*"));
  assert.ok(errOutput.includes("Network timeout"));

  const successOutput = formatHermesResponse({ success: true, reply: "Container mc-paper-geyser restarted." });
  assert.ok(successOutput.includes("*[HERMES AGENT]*"));
  assert.ok(successOutput.includes("Container mc-paper-geyser restarted."));
});

test("Hermes: queryHermesAgent returns error when URL is missing", async () => {
  const originalEnv = process.env.HERMES_API_URL;
  delete process.env.HERMES_API_URL;

  const res = await queryHermesAgent("test instruction", { baseUrl: "" });
  assert.strictEqual(res.success, false);
  assert.ok(res.error.includes("HERMES_API_URL belum dikonfigurasi"));

  if (originalEnv) process.env.HERMES_API_URL = originalEnv;
});

test("Hermes: queryHermesAgent communicates with mock OpenAI-compatible server", async () => {
  let receivedAuth = "";
  let receivedBody = null;

  const server = http.createServer((req, res) => {
    receivedAuth = req.headers["authorization"] || "";
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      receivedBody = JSON.parse(body);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        choices: [
          {
            message: {
              role: "assistant",
              content: "Uptime: 14 days, Load: 0.12, Memory: 4.2GB/8GB"
            }
          }
        ]
      }));
    });
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const mockBaseUrl = `http://127.0.0.1:${port}/v1`;

  try {
    const result = await queryHermesAgent("cek status server", {
      baseUrl: mockBaseUrl,
      apiKey: "secret-token-123"
    });

    assert.strictEqual(result.success, true);
    assert.ok(result.reply.includes("Uptime: 14 days"));
    assert.strictEqual(receivedAuth, "Bearer secret-token-123");
    assert.strictEqual(receivedBody.messages[1].content, "cek status server");
  } finally {
    server.close();
  }
});

test("Hermes: queryHermesAgent handles 500 error from agent server", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Internal Agent Crash");
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  try {
    const result = await queryHermesAgent("cek log", {
      baseUrl: `http://127.0.0.1:${port}/v1`
    });

    assert.strictEqual(result.success, false);
    assert.ok(result.error.includes("Hermes HTTP error 500"));
    assert.ok(result.error.includes("Internal Agent Crash"));
  } finally {
    server.close();
  }
});

test("Hermes: queryHermesAgent handles abort/timeout", async () => {
  const server = http.createServer((req, res) => {
    // deliberately stall request
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  try {
    const result = await queryHermesAgent("cek log lambat", {
      baseUrl: `http://127.0.0.1:${port}/v1`,
      timeoutMs: 100
    });

    assert.strictEqual(result.success, false);
    assert.ok(result.error.includes("timeout"));
  } finally {
    server.close();
  }
});

test("Hermes: manageRemoteServer tool requires owner", async () => {
  const toolDef = TOOLS[0].functionDeclarations.find(f => f.name === "manageRemoteServer");
  assert.ok(toolDef, "manageRemoteServer declaration should exist");
  assert.ok(toolDef.description.includes("Hermes Agent"));

  // Non-owner should be rejected
  const nonOwnerRes = await executeTool("manageRemoteServer", { instruction: "restart mc" }, {
    chatId: "guest@c.us",
    senderNumber: "628999999999"
  });
  assert.strictEqual(nonOwnerRes.toolResult.error.includes("khusus untuk nomor owner"), true);
});

test("Hermes: manageRemoteServer tool executes for owner", async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "Docker service reloaded." } }]
    }));
  });

  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const originalUrl = process.env.HERMES_API_URL;
  process.env.HERMES_API_URL = `http://127.0.0.1:${port}/v1`;

  try {
    const ownerRes = await executeTool("manageRemoteServer", { instruction: "reload docker" }, {
      chatId: `${OWNER_PHONE}@c.us`,
      senderNumber: OWNER_PHONE
    });
    assert.strictEqual(ownerRes.toolResult.success, true);
    assert.ok(ownerRes.toolResult.output.includes("Docker service reloaded."));
  } finally {
    server.close();
    if (originalUrl) process.env.HERMES_API_URL = originalUrl;
    else delete process.env.HERMES_API_URL;
  }
});

test("Hermes: manageRemoteServer rejects when userText does not mention hermes or vps", async () => {
  const rejectedRes = await executeTool("manageRemoteServer", { instruction: "cek disk" }, {
    chatId: `${OWNER_PHONE}@c.us`,
    senderNumber: OWNER_PHONE,
    userText: "tolong bersihkan server dong"
  });
  assert.strictEqual(rejectedRes.toolResult.error.includes("HANYA boleh dipanggil jika pengguna secara eksplisit menyebut kata 'hermes' atau 'vps'"), true);
});

