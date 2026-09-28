import assert from "node:assert";

export class KeyRotator {
  // ponytail: sticky key with SQLite fallback index persistence. Skipped: multi-process distributed locks. Add when scaling across multiple bot instances.
  constructor(keys, optionsOrCooldown = 60_000, maybeStore = null) {
    if (!keys || keys.length === 0) throw new Error("Keys kosong.");
    this.keys = keys.map((k) => k.trim()).filter(Boolean);
    if (this.keys.length === 0) throw new Error("Tidak ada key valid ditemukan.");

    let cooldownMs = 60_000;
    let store = null;
    if (typeof optionsOrCooldown === "object" && optionsOrCooldown !== null) {
      cooldownMs = optionsOrCooldown.cooldownMs ?? 60_000;
      store = optionsOrCooldown.store ?? null;
    } else {
      cooldownMs = typeof optionsOrCooldown === "number" ? optionsOrCooldown : 60_000;
      store = maybeStore;
    }

    this.index = 0;
    this.cooldowns = new Map();
    this.deadKeys = new Set();
    this.cooldownMs = cooldownMs;
    this.store = store;

    this.restoreSavedIndex();
  }

  attachStore(store) {
    this.store = store;
    this.restoreSavedIndex();
  }

  restoreSavedIndex() {
    if (!this.store || typeof this.store.getSetting !== "function") return;
    try {
      const savedKey = this.store.getSetting("active_gemini_key");
      const keyIdx = savedKey ? this.keys.indexOf(savedKey) : -1;
      if (keyIdx !== -1) {
        this.index = keyIdx;
        return;
      }
      const savedIdxStr = this.store.getSetting("active_gemini_key_index");
      if (savedIdxStr !== null && savedIdxStr !== undefined) {
        const parsed = parseInt(savedIdxStr, 10);
        if (!isNaN(parsed) && parsed >= 0 && parsed < this.keys.length) {
          this.index = parsed;
        }
      }
    } catch {}
  }

  setIndex(idx) {
    this.index = idx;
    if (this.store && typeof this.store.setSetting === "function") {
      try {
        this.store.setSetting("active_gemini_key_index", String(this.index));
        if (this.keys[this.index]) {
          this.store.setSetting("active_gemini_key", this.keys[this.index]);
        }
      } catch {}
    }
  }

  getKey() {
    const now = Date.now();
    let bestKey = null;
    let minUntil = Infinity;

    const hasLivingKeys = this.keys.some((k) => !this.deadKeys.has(k));
    const isUsable = (k) => (!hasLivingKeys || !this.deadKeys.has(k));

    if (this.index >= this.keys.length || this.index < 0) {
      this.setIndex(0);
    }

    const activeKey = this.keys[this.index];
    const activeUntil = this.cooldowns.get(activeKey) || 0;

    // Sticky: tetap gunakan key aktif saat ini jika tidak mati dan tidak cooling
    if (activeKey && isUsable(activeKey) && activeUntil <= now) {
      return activeKey;
    }

    // Key aktif tidak usable atau sedang cooldown -> cari key berikutnya secara sekuensial
    for (let i = 1; i < this.keys.length; i++) {
      const idx = (this.index + i) % this.keys.length;
      const key = this.keys[idx];
      if (!isUsable(key)) continue;

      const until = this.cooldowns.get(key) || 0;
      if (until <= now) {
        this.setIndex(idx);
        return key;
      }
      if (until < minUntil) {
        minUntil = until;
        bestKey = key;
      }
    }

    // Jika semua key sedang cooldown, cek apakah key aktif yang paling cepat selesai
    if (activeKey && isUsable(activeKey) && activeUntil < minUntil) {
      minUntil = activeUntil;
      bestKey = activeKey;
    }

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
        if (waitMs > 0 && waitMs <= 1000) {
          await new Promise((r) => setTimeout(r, waitMs));
        } else if (waitMs > 1000) {
          throw new Error(`Semua key sedang cooldown (${Math.round((until - now) / 1000)}s tersisa).`);
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

        const isDemandSpike =
          status === 503 ||
          msg.includes("503") ||
          msg.includes("UNAVAILABLE");

        const isTimeout =
          msg.includes("timeout") ||
          msg.includes("aborted");

        // Timeout jaringan/model hang: jangan buang waktu coba key lain, langsung lempar ke cascade
        if (isTimeout) {
          throw err;
        }

        // 503 demand spike: coba maksimal 2 key berbeda tanpa sleep. Jika tetap 503, lempar ke model berikutnya
        if (isDemandSpike) {
          this.markLimited(key, 15_000);
          if (attempts >= 2) {
            throw err;
          }
          continue;
        }

        const isRateLimit =
          status === 429 ||
          msg.includes("429") ||
          msg.includes("RESOURCE_EXHAUSTED");

        const isAuthError =
          status === 401 ||
          status === 403 ||
          msg.includes("401") ||
          msg.includes("403") ||
          msg.includes("PERMISSION_DENIED") ||
          msg.includes("UNAUTHENTICATED") ||
          msg.includes("API_KEY_INVALID");

        if (isRateLimit) {
          const isDailyQuota = msg.includes("PerDay") || msg.includes("free_tier_requests");
          if (isDailyQuota) {
            // Kuota model habis: langsung throw agar cascade pindah ke model berikutnya tanpa sleep
            throw err;
          }
          this.markLimited(key, 30_000);
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
  assert.strictEqual(rotator.getKey(), "keyA"); // sticky on keyA
  rotator.markLimited("keyA");
  assert.strictEqual(rotator.getKey(), "keyB"); // switches to keyB
  assert.strictEqual(rotator.getKey(), "keyB"); // sticky on keyB
  rotator.markLimited("keyB");
  assert.strictEqual(rotator.getKey(), "keyC");

  // Test dead key exclusion
  rotator.markDead("keyC");
  rotator.markDead("keyA");
  assert.strictEqual(rotator.getKey(), "keyB"); // keyA & keyC dead, keyB is only living key even if cooling

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

  // Test 503 fast-fails after max 2 keys, timeout fast-fails on 1 key
  let count503 = 0;
  try {
    await rotator.execute(async () => {
      count503++;
      const err = new Error("503 Service Unavailable");
      err.status = 503;
      throw err;
    });
    assert.fail("Should throw 503");
  } catch (err) {
    assert.strictEqual(err.status, 503);
    assert.strictEqual(count503, 2);
  }

  let countTimeout = 0;
  try {
    await rotator.execute(async () => {
      countTimeout++;
      const err = new Error("The operation was aborted due to timeout");
      throw err;
    });
    assert.fail("Should throw timeout");
  } catch (err) {
    assert.ok(err.message.includes("timeout"));
    assert.strictEqual(countTimeout, 1);
  }

  console.log("KeyRotator self-test OK");
}
