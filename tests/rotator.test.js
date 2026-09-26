import test from "node:test";
import assert from "node:assert";
import { KeyRotator } from "../src/rotator.js";

test("KeyRotator: rotates keys in pool", () => {
  const rotator = new KeyRotator(["keyA", "keyB", "keyC"]);
  assert.strictEqual(rotator.getKey(), "keyA");
  assert.strictEqual(rotator.getKey(), "keyB");
  assert.strictEqual(rotator.getKey(), "keyC");
});

test("KeyRotator: skips cooling key and respects dead key blacklist", () => {
  const rotator = new KeyRotator(["keyA", "keyB", "keyC"]);
  rotator.markLimited("keyB");
  assert.strictEqual(rotator.getKey(), "keyA");
  assert.strictEqual(rotator.getKey(), "keyC");

  rotator.markDead("keyA");
  assert.strictEqual(rotator.getKey(), "keyC"); // keyA is dead, keyB is limited
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

test("KeyRotator: anti busy-wait waits for cooling key when all keys limited", async () => {
  const rotator = new KeyRotator(["keyA"], 50); // 50ms cooldown
  rotator.markLimited("keyA", 50);

  const start = Date.now();
  const res = await rotator.execute(async (key) => `ok_${key}`);
  const elapsed = Date.now() - start;

  assert.strictEqual(res, "ok_keyA");
  assert.ok(elapsed >= 40, `Expected elapsed >= 40ms, got ${elapsed}ms`);
});
