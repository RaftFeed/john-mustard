import test from "node:test";
import assert from "node:assert";
import { isSafeUrl, isSafeUrlSync, isPrivateIp } from "../src/llm.js";

test("SSRF: isPrivateIp detects private, loopback, and cloud metadata IPs", () => {
  assert.strictEqual(isPrivateIp("127.0.0.1"), true);
  assert.strictEqual(isPrivateIp("127.0.0.254"), true);
  assert.strictEqual(isPrivateIp("10.0.0.1"), true);
  assert.strictEqual(isPrivateIp("192.168.1.1"), true);
  assert.strictEqual(isPrivateIp("172.16.0.1"), true);
  assert.strictEqual(isPrivateIp("172.31.255.255"), true);
  assert.strictEqual(isPrivateIp("169.254.169.254"), true);
  assert.strictEqual(isPrivateIp("::1"), true);
  assert.strictEqual(isPrivateIp("::ffff:127.0.0.1"), true);
  assert.strictEqual(isPrivateIp("8.8.8.8"), false);
  assert.strictEqual(isPrivateIp("1.1.1.1"), false);
});

test("SSRF: isSafeUrlSync blocks dangerous internal hostnames and private IPs", () => {
  assert.strictEqual(isSafeUrlSync("http://localhost:3000"), false);
  assert.strictEqual(isSafeUrlSync("http://waha:3000/api"), false);
  assert.strictEqual(isSafeUrlSync("http://bot:4500/webhook"), false);
  assert.strictEqual(isSafeUrlSync("http://runner:8000/run"), false);
  assert.strictEqual(isSafeUrlSync("http://scheduler/tick"), false);
  assert.strictEqual(isSafeUrlSync("http://127.0.0.1:8080"), false);
  assert.strictEqual(isSafeUrlSync("http://192.168.1.1"), false);
  assert.strictEqual(isSafeUrlSync("http://10.0.0.1"), false);
  assert.strictEqual(isSafeUrlSync("http://172.20.0.2"), false);
  assert.strictEqual(isSafeUrlSync("http://169.254.169.254/latest/meta-data"), false);
  assert.strictEqual(isSafeUrlSync("ftp://example.com"), false);
  assert.strictEqual(isSafeUrlSync("https://en.wikipedia.org/wiki/Node.js"), true);
});

test("SSRF: isSafeUrl resolves DNS and rejects private destinations", async () => {
  assert.strictEqual(await isSafeUrl("http://localhost:3000/api"), false);
  assert.strictEqual(await isSafeUrl("http://waha:3000/api"), false);
  assert.strictEqual(await isSafeUrl("http://runner:8000/run"), false);
  assert.strictEqual(await isSafeUrl("http://127.0.0.1:8080"), false);
  assert.strictEqual(await isSafeUrl("https://en.wikipedia.org/wiki/Node.js"), true);
});
