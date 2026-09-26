import test from "node:test";
import assert from "node:assert";
import { parseFastCommand, executeFastCommand } from "../src/commands.js";
import { Storage } from "../src/db.js";

test("Commands: parseFastCommand parses keywords and prefix commands", () => {
  assert.strictEqual(parseFastCommand("#ping").type, "ping");
  assert.strictEqual(parseFastCommand("#todo").type, "listTodos");
  assert.strictEqual(parseFastCommand("todo").type, "listTodos");
  assert.strictEqual(parseFastCommand("#today").type, "today");
  assert.strictEqual(parseFastCommand("#week").type, "week");
  assert.strictEqual(parseFastCommand("#agenda").type, "reminders");
  assert.strictEqual(parseFastCommand("#done 5").id, 5);
  assert.strictEqual(parseFastCommand("#undo").type, "undo");
  assert.strictEqual(parseFastCommand("#del 3").id, 3);
  assert.strictEqual(parseFastCommand("#add Kerjakan PR #kuliah").raw, "Kerjakan PR #kuliah");
  assert.strictEqual(parseFastCommand("#dew").type, "dew");
  assert.strictEqual(parseFastCommand("halo john"), null);
});

test("Commands: executeFastCommand executes ping, dew, and task commands", async () => {
  const store = new Storage(":memory:");
  const ctx = { store, chatId: "user1", isOwner: true, senderNumber: "user1", senderName: "Tester" };

  const pingRes = await executeFastCommand({ type: "ping" }, ctx);
  assert.ok(pingRes.includes("PONG!"));

  const dewRes = await executeFastCommand({ type: "dew" }, ctx);
  assert.ok(dewRes.includes("DEW DEW DEW"));

  const addRes = await executeFastCommand({ type: "add", raw: "Belajar matematika" }, ctx);
  assert.ok(addRes.includes("Tugas #1 dicatat"));

  const listRes = await executeFastCommand({ type: "listTodos" }, ctx);
  assert.ok(listRes.includes("Belajar matematika"));
});
