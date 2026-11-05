import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../src/server.js";

test("Internal routes fail closed and reject incorrect bearer tokens", async () => {
  const previous = process.env.BOT_API_TOKEN;
  const server = createServer(() => {}, { store: { getPendingReminders: () => [] } });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const configured of ["", "test-secret"]) {
      process.env.BOT_API_TOKEN = configured;
      for (const [path, method] of [["/api/scheduler/tick", "POST"], ["/mcp/message", "POST"], ["/mcp/sse", "GET"]]) {
        for (const token of ["", "wrong-token", "test-secrex"]) {
          const res = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}` } });
          assert.equal(res.status, 401);
          await res.text();
        }
      }
    }
    const res = await fetch(base + "/api/scheduler/tick", {
      method: "POST", headers: { Authorization: "Bearer test-secret" }
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).ticked, true);
  } finally {
    if (previous === undefined) delete process.env.BOT_API_TOKEN;
    else process.env.BOT_API_TOKEN = previous;
    await new Promise((resolve) => server.close(resolve));
  }
});
