import test from "node:test";
import assert from "node:assert/strict";
import { startProgress, formatProgress } from "../src/llm/progress.js";
import { processChat } from "../src/llm/engine.js";

test("Progress: waits 45 seconds, reports current work and caps at two messages", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sent = [];
  const context = { speakerName: "Rafid" };
  const stop = startProgress(async (text) => sent.push(text), () => context);
  t.mock.timers.tick(44999);
  await Promise.resolve();
  assert.deepEqual(sent, []);
  t.mock.timers.tick(1);
  await Promise.resolve();
  assert.deepEqual(sent, ["Bentar, Lord, lagi diproses."]);
  context.tool = "listTodos";
  t.mock.timers.tick(44999);
  await new Promise(setImmediate);
  assert.equal(sent.length, 1);
  t.mock.timers.tick(1);
  await new Promise(setImmediate);
  assert.equal(sent[1], "Lagi cek tugasnya, Lord.");
  t.mock.timers.tick(120000);
  await stop();
  assert.equal(sent.length, 2);
});

test("Progress: finishing early cancels pending notifications", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const sent = [];
  const stop = startProgress(async (text) => sent.push(text), () => ({}));
  t.mock.timers.tick(44999);
  await stop();
  t.mock.timers.tick(120000);
  await Promise.resolve();
  assert.deepEqual(sent, []);
});

test("Progress: failed sends are isolated and cleanup drains in-flight delivery", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let release;
  let calls = 0;
  const stop = startProgress(async () => {
    calls++;
    await new Promise((resolve) => { release = resolve; });
    throw new Error("WhatsApp unavailable");
  }, () => ({}));
  t.mock.timers.tick(45000);
  await Promise.resolve();
  let finished = false;
  const stopping = stop().then(() => { finished = true; });
  await Promise.resolve();
  assert.equal(finished, false);
  release();
  await stopping;
  t.mock.timers.tick(60000);
  assert.equal(calls, 1);
});

test("Progress: family, group and custom preferences avoid inappropriate nicknames", () => {
  assert.equal(formatProgress({ speakerName: "Mami" }), "Bentar, Mami, lagi diproses.");
  assert.equal(formatProgress({ speakerName: "Papi" }), "Bentar, Papi, lagi diproses.");
  assert.equal(formatProgress({ speakerName: "Rafid", isGroup: true }), "Bentar, lagi diproses.");
  assert.equal(formatProgress({ speakerName: "Rafid", customTone: "formal, panggil saya Pak" }), "Pesannya sedang diproses.");
  assert.equal(formatProgress({ speakerName: "Rafid", customTone: "jangan panggil Lord" }), "Bentar, lagi diproses.");
  assert.equal(formatProgress({ tool: "deleteTodo" }), "Bentar, lagi diproses.");
});

for (const fails of [false, true]) {
  test(`Progress: engine cleans up after provider ${fails ? "failure" : "success"}`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const sent = [];
    const result = processChat({ execute: async () => {
      await gate;
      if (fails) throw new Error("provider failed");
      return { candidates: [{ content: { parts: [{ text: "Pending artinya belum selesai." }] } }] };
    } }, "Apa arti pending?", {
      chatId: "progress-test", cascade: ["progress-test-model"],
      onProgress: async (text) => { sent.push(text); }
    });
    // Attach rejection handling before unblocking the provider.
    const checked = fails ? assert.rejects(result, /provider failed/) : result;
    t.mock.timers.tick(45000);
    await new Promise(setImmediate);
    assert.equal(sent.length, 1);
    release();
    const reply = await checked;
    if (!fails) assert.equal(reply, "Pending artinya belum selesai.");
    t.mock.timers.tick(60000);
    await new Promise(setImmediate);
    assert.equal(sent.length, 1);
  });
}
