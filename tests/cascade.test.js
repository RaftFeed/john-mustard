import test from "node:test";
import assert from "node:assert/strict";
import { generateContent, clearModelCooldowns, FAST_CASCADE, OPENCODE_POOL } from "../src/llm/cascade.js";
import { KeyRotator } from "../src/rotator.js";

const rotator = { execute: (fn) => fn("test-key") };
const payload = { contents: [{ role: "user", parts: [{ text: "Tes" }] }] };
const nativeReply = { candidates: [{ content: { parts: [{ text: "OK" }] } }] };
const openAIReply = { choices: [{ message: { content: "OK" }, finish_reason: "stop" }] };
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });

function setup(t) {
  clearModelCooldowns();
  const before = { models: process.env.GEMINI_MODELS, nous: process.env.NOUS_PROXY_URL };
  delete process.env.GEMINI_MODELS;
  process.env.NOUS_PROXY_URL = "http://nous-proxy.test/v1";
  t.after(() => {
    clearModelCooldowns();
    for (const [key, value] of [["GEMINI_MODELS", before.models], ["NOUS_PROXY_URL", before.nous]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
}

test("Cascade: primary High then Step then only free OpenCode pool", () => {
  assert.equal(FAST_CASCADE[0], "ag/gemini-3.8-flash-high");
  assert.equal(FAST_CASCADE[1], "nous/stepfun/step-3.7-flash:free");
  assert.deepEqual(FAST_CASCADE.slice(2), OPENCODE_POOL);
  assert.ok(OPENCODE_POOL.every((m) => m.endsWith("-free") || m === "oc/big-pickle"));
});

test("Cascade: High failure -> Nous failure -> OpenCode tool call, without repeating ANY", async (t) => {
  setup(t);
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    if (calls.length < 3) return response({ error: "capacity exhausted" }, 503);
    return response({ choices: [{ message: { tool_calls: [{ function: { name: "listTodos", arguments: "{}" } }] } }] });
  });
  const result = await generateContent(rotator, { ...payload, toolConfig: { functionCallingConfig: { mode: "ANY" } } }, FAST_CASCADE);
  assert.equal(calls.length, 3);
  assert.match(calls[0].url, /gemini-3.8-flash-high:generateContent$/);
  assert.equal(calls[1].url, "http://nous-proxy.test/v1/chat/completions");
  assert.equal(calls[1].body.model, "stepfun/step-3.7-flash:free");
  assert.equal(calls[2].body.model, OPENCODE_POOL[0]);
  assert.equal(calls[2].body.tool_choice, "required");
  assert.equal(result.candidates[0].content.parts[0].functionCall.name, "listTodos");
});

test("Cascade: missing models remain skipped on subsequent requests", async (t) => {
  setup(t);
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    calls.push(url);
    return url.includes("missing") ? response({ error: "missing" }, 404) : response(nativeReply);
  });
  await generateContent(rotator, payload, ["missing", "healthy"]);
  await generateContent(rotator, payload, ["missing", "healthy"]);
  assert.equal(calls.filter((u) => u.includes("missing")).length, 1);
  assert.equal(calls.length, 3);
});

test("Cascade: rate limits on Gemini, Nous and one free model do not block the next free model", async (t) => {
  setup(t);
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push(JSON.parse(options.body).model || url);
    return calls.length < 4 ? response({ error: "rate limited" }, 429) : response(openAIReply);
  });
  const result = await generateContent(new KeyRotator(["test-key"]), payload, ["ag/test", FAST_CASCADE[1], OPENCODE_POOL[0], OPENCODE_POOL[1]]);
  assert.equal(calls.length, 4);
  assert.equal(result.candidates[0].content.parts[0].text, "OK");
});

test("Cascade: only explicit tool-mode rejection retries the same model in AUTO", async (t) => {
  setup(t);
  const modes = [];
  t.mock.method(globalThis, "fetch", async (_, options) => {
    modes.push(JSON.parse(options.body).toolConfig.functionCallingConfig.mode);
    return modes.length === 1 ? response({ error: "tool_choice required unsupported" }, 400) : response(nativeReply);
  });
  await generateContent(rotator, { ...payload, toolConfig: { functionCallingConfig: { mode: "ANY" } } }, ["primary"]);
  assert.deepEqual(modes, ["ANY", "AUTO"]);
});

test("Cascade: missing Nous setup and unsupported media skip text-only providers", async (t) => {
  setup(t);
  delete process.env.NOUS_PROXY_URL;
  const calls = [];
  t.mock.method(globalThis, "fetch", async (_, options) => {
    calls.push(JSON.parse(options.body).model);
    return response(openAIReply);
  });
  await generateContent(rotator, payload, [FAST_CASCADE[1], OPENCODE_POOL[0]]);
  assert.deepEqual(calls, [OPENCODE_POOL[0]]);
  const media = { contents: [{ role: "user", parts: [{ inlineData: { mimeType: "audio/ogg", data: "AA==" } }] }] };
  await assert.rejects(generateContent(rotator, media, [FAST_CASCADE[1], OPENCODE_POOL[0]]), /tidak tersedia/);
  assert.equal(calls.length, 1);
});

test("Cascade: limits total retry time instead of multiplying model timeouts", async (t) => {
  setup(t);
  let now = 1000;
  let calls = 0;
  const timeouts = [];
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  t.mock.method(AbortSignal, "timeout", (ms) => { timeouts.push(ms); return timeout(ms); });
  t.mock.method(Date, "now", () => now);
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    now += calls === 4 ? 15000 : 25000;
    throw new DOMException("request aborted", "TimeoutError");
  });
  await assert.rejects(generateContent(rotator, payload, ["a", "b", "c", "d", "e"]), /aborted/);
  assert.equal(calls, 4);
  assert.deepEqual(timeouts, [25000, 25000, 25000, 15000]);
  assert.equal(now, 91000);
});
