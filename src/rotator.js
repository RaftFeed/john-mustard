import assert from "node:assert";

export class KeyRotator {
  constructor(keys, cooldownMs = 60_000) {
    if (!keys || keys.length === 0) throw new Error("Keys kosong.");
    this.keys = keys.map((k) => k.trim()).filter(Boolean);
    if (this.keys.length === 0) throw new Error("Tidak ada key valid ditemukan.");
    this.index = 0;
    this.cooldowns = new Map();
    this.cooldownMs = cooldownMs;
  }

  getKey() {
    const now = Date.now();
    for (let i = 0; i < this.keys.length; i++) {
      const idx = (this.index + i) % this.keys.length;
      const key = this.keys[idx];
      const until = this.cooldowns.get(key) || 0;
      if (until <= now) {
        this.index = (idx + 1) % this.keys.length;
        return key;
      }
    }
    throw new Error("Semua API key sedang cooldown atau tidak dapat diakses.");
  }

  markLimited(key, customMs = null) {
    this.cooldowns.set(key, Date.now() + (customMs || this.cooldownMs));
  }

  async execute(requestFn) {
    let attempts = 0;
    while (attempts < this.keys.length) {
      const key = this.getKey();
      try {
        return await requestFn(key);
      } catch (err) {
        const msg = err.message || "";
        const isRateLimitOrDemand =
          err.status === 429 ||
          err.status === 503 ||
          msg.includes("429") ||
          msg.includes("503") ||
          msg.includes("RESOURCE_EXHAUSTED") ||
          msg.includes("UNAVAILABLE");

        const isPermissionDenied =
          err.status === 403 ||
          msg.includes("403") ||
          msg.includes("PERMISSION_DENIED");

        if (isRateLimitOrDemand) {
          this.markLimited(key, 60_000); // cooldown 1 menit
          attempts++;
          continue;
        }

        if (isPermissionDenied) {
          console.warn(`[KeyRotator] Key ${key.slice(0, 15)}... kena 403 Permission Denied. Blacklist 24 jam.`);
          this.markLimited(key, 24 * 60 * 60 * 1000); // blacklist 24 jam
          attempts++;
          continue;
        }

        throw err;
      }
    }
    throw new Error("Semua API key exhausted setelah retry.");
  }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("src/rotator.js")) {
  const rotator = new KeyRotator(["keyA", "keyB"]);
  assert.strictEqual(rotator.getKey(), "keyA");
  assert.strictEqual(rotator.getKey(), "keyB");
  rotator.markLimited("keyA");
  assert.strictEqual(rotator.getKey(), "keyB");
  console.log("KeyRotator self-test OK");
}
