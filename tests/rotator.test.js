import test from "node:test";
import assert from "node:assert";
import { KeyRotator } from "../src/rotator.js";
import { Storage } from "../src/db.js";

test("KeyRotator: uses active key sequentially (sticky) until limited", () => {
  const rotator = new KeyRotator(["keyA", "keyB", "keyC"]);
  assert.strictEqual(rotator.getKey(), "keyA");
  assert.strictEqual(rotator.getKey(), "keyA"); // sticks to keyA

  rotator.markLimited("keyA");
  assert.strictEqual(rotator.getKey(), "keyB"); // switches to keyB
  assert.strictEqual(rotator.getKey(), "keyB"); // sticks to keyB
});

test("KeyRotator: skips cooling key and respects dead key blacklist", () => {
  const rotator = new KeyRotator(["keyA", "keyB", "keyC"]);
  rotator.markLimited("keyB");
  assert.strictEqual(rotator.getKey(), "keyA");

  rotator.markDead("keyA");
  assert.strictEqual(rotator.getKey(), "keyC"); // keyA is dead, keyB is limited -> advances to keyC
  assert.strictEqual(rotator.getKey(), "keyC"); // sticks to keyC
});

test("KeyRotator: persists active key in store and restores on restart", () => {
  const store = new Storage(":memory:");
  const rotator1 = new KeyRotator(["keyA", "keyB", "keyC"], { store });
  assert.strictEqual(rotator1.getKey(), "keyA");

  rotator1.markLimited("keyA");
  assert.strictEqual(rotator1.getKey(), "keyB"); // switches to keyB (index 1)

  // Simulate bot reboot with fresh rotator using same store
  const rotator2 = new KeyRotator(["keyA", "keyB", "keyC"], { store });
  assert.strictEqual(rotator2.index, 1);
  assert.strictEqual(rotator2.getKey(), "keyB"); // remains on keyB, never reverts to keyA!
});

test("KeyRotator: fatal error (404 / 400) stops retry without rotating", async () => {
  const rotator = new KeyRotator(["keyA", "keyB", "keyC"]);
  let calledCount = 0;
  try {
    await rotator.execute(async () => {
      calledCount++;
      const err = new Error("models/xyz is NOT_FOUND");
      err.status = 404;
      throw err;
    });
    assert.fail("Should throw 404");
  } catch (err) {
    assert.strictEqual(err.status, 404);
    assert.strictEqual(calledCount, 1);
  }
});

test("KeyRotator: fast-fails on 503 (max 2 keys) or timeout (1 key)", async () => {
  const rotator = new KeyRotator(["keyA", "keyB", "keyC"]);
  let called503 = 0;
  try {
    await rotator.execute(async () => {
      called503++;
      const err = new Error("503 Service Unavailable");
      err.status = 503;
      throw err;
    });
    assert.fail("Should throw 503");
  } catch (err) {
    assert.strictEqual(err.status, 503);
    assert.strictEqual(called503, 2);
  }

  let calledTimeout = 0;
  try {
    await rotator.execute(async () => {
      calledTimeout++;
      const err = new Error("The operation was aborted due to timeout");
      throw err;
    });
    assert.fail("Should throw timeout");
  } catch (err) {
    assert.ok(err.message.includes("timeout"));
    assert.strictEqual(calledTimeout, 1);
  }
});

test("KeyRotator: anti busy-wait waits for cooling key when all keys limited", async () => {
  const rotator = new KeyRotator(["keyA"], 50); // 50ms cooldown
  rotator.markLimited("keyA", 50);

  const start = Date.now();
  const res = await rotator.execute(async (key) => `ok_${key}`);
  const elapsed = Date.now() - start;

  assert.strictEqual(res, "ok_keyA");
  assert.ok(elapsed >= 40, `Expected elapsed >= 40ms, got ${elapsed}ms`);
});

test("KeyRotator: rotates through keys on 429 until healthy key is found", async () => {
  const rotator = new KeyRotator(["key1", "key2", "key3"]);
  let attempts = 0;
  const res = await rotator.execute(async (key) => {
    attempts++;
    if (key === "key1" || key === "key2") {
      const err = new Error("429 Resource Exhausted: Quota exceeded");
      err.status = 429;
      throw err;
    }
    return `success_${key}`;
  });

  assert.strictEqual(res, "success_key3");
  assert.strictEqual(attempts, 3);
});

test("KeyRotator: rotates on 429 daily free_tier_requests and remains sticky on healthy key", async () => {
  const rotator = new KeyRotator(["key1", "key2", "key3"]);
  let attempts = 0;
  const res = await rotator.execute(async (key) => {
    attempts++;
    if (key === "key1") {
      const err = new Error("429 RESOURCE_EXHAUSTED: Quota exceeded for metric free_tier_requests PerDay limit: 20");
      err.status = 429;
      throw err;
    }
    return `success_${key}`;
  });

  assert.strictEqual(res, "success_key2");
  assert.strictEqual(attempts, 2);
  assert.strictEqual(rotator.getKey(), "key2"); // stays sticky on key2
});
