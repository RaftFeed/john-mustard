import assert from "node:assert";

export class KeyRotator {
  constructor(keys, cooldownMs = 60_000) {
    if (!keys || keys.length === 0) throw new Error("Keys kosong.");
    this.keys = keys.map((k) => k.trim()).filter(Boolean);
    if (this.keys.length === 0) throw new Error("Tidak ada key valid ditemukan.");
    this.index = 0;
    this.cooldowns = new Map();
    this.deadKeys = new Set();
    this.cooldownMs = cooldownMs;
  }

  getKey() {
    const now = Date.now();
    let bestKey = null;
    let minUntil = Infinity;

    // Prioritaskan key yang belum ditandai mati/suspend
    const candidateKeys = this.keys.filter((k) => !this.deadKeys.has(k));
    const pool = candidateKeys.length > 0 ? candidateKeys : this.keys;

    for (let i = 0; i < pool.length; i++) {
      const idx = (this.index + i) % pool.length;
      const key = pool[idx];
      const until = this.cooldowns.get(key) || 0;
      if (until <= now) {
        this.index = (idx + 1) % pool.length;
        return key;
      }
      if (until < minUntil) {
        minUntil = until;
        bestKey = key;
      }
    }

    // Jika semua key sedang cooldown, pakai key yang masa cooldown-nya paling cepat selesai
    if (bestKey) {
      return bestKey;
    }

    throw new Error("Semua API key sedang cooldown atau tidak dapat diakses.");
  }

  markLimited(key, customMs = null) {
    this.cooldowns.set(key, Date.now() + (customMs || this.cooldownMs));
  }

  markDead(key) {
    this.deadKeys.add(key);
    this.cooldowns.set(key, Date.now() + 7 * 24 * 60 * 60 * 1000);
  }

  async execute(requestFn) {
    let attempts = 0;
    const maxAttempts = this.keys.length;
    let lastErr = null;

    while (attempts < maxAttempts) {
      const key = this.getKey();
      attempts++;

      // Anti busy-wait: jika semua key cooldown dan bestKey masih dalam masa tunggu, tunggu sampai pulih
      const until = this.cooldowns.get(key) || 0;
      const now = Date.now();
      if (until > now) {
        const waitMs = Math.min(until - now, 10_000);
        if (waitMs > 0) {
          await new Promise((r) => setTimeout(r, waitMs));
        }
      }

      try {
        return await requestFn(key);
      } catch (err) {
        lastErr = err;
        const msg = err.message || "";
        const status = err.status || 0;

        // Error fatal payload / model tidak ada - jangan rotasi key agar tidak memicu deteksi spam di key lain
        const isFatalPayload =
          status === 400 ||
          msg.includes("400") ||
          msg.includes("INVALID_ARGUMENT") ||
          status === 404 ||
          msg.includes("404") ||
          msg.includes("NOT_FOUND");

        if (isFatalPayload) {
          throw err;
        }

        const isRateLimit =
          status === 429 ||
          msg.includes("429") ||
          msg.includes("RESOURCE_EXHAUSTED");

        const isDemandSpike =
          status === 503 ||
          msg.includes("503") ||
          msg.includes("UNAVAILABLE");

        const isAuthError =
          status === 401 ||
          status === 403 ||
          msg.includes("401") ||
          msg.includes("403") ||
          msg.includes("PERMISSION_DENIED") ||
          msg.includes("UNAUTHENTICATED") ||
          msg.includes("API_KEY_INVALID");

        if (isRateLimit) {
          this.markLimited(key, 15_000); // cooldown 15 detik
          // Backoff delay sebelum mencoba key berikutnya (cegah burst hammering antar-key)
          const delay = Math.min(1000 * Math.pow(1.5, attempts - 1), 3000);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }

        if (isDemandSpike) {
          this.markLimited(key, 3_000); // 503 spike sementara, cooldown 3 detik
          await new Promise((r) => setTimeout(r, 500));
          continue;
        }

        if (isAuthError) {
          console.warn(`[KeyRotator] Key ${key.slice(0, 15)}... mati/ditolak (${status || "auth error"}). Blacklist permanen.`);
          this.markDead(key);
          continue;
        }

        throw err;
      }
    }
    throw lastErr || new Error("Semua API key exhausted setelah retry.");
  }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("src/rotator.js")) {
  const rotator = new KeyRotator(["keyA", "keyB", "keyC"]);
  assert.strictEqual(rotator.getKey(), "keyA");
  assert.strictEqual(rotator.getKey(), "keyB");
  rotator.markLimited("keyB");
  assert.strictEqual(rotator.getKey(), "keyC");

  // Test dead key exclusion
  rotator.markDead("keyA");
  assert.strictEqual(rotator.getKey(), "keyC"); // should skip keyA because it's marked dead

  // Test fatal payload error does not rotate
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
    assert.strictEqual(calledCount, 1); // exactly 1 attempt, no rotation on 404
  }

  console.log("KeyRotator self-test OK");
}
