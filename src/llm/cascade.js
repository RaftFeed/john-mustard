const DEFAULT_MODEL = process.env.GEMINI_MODEL || "ag/gemini-3.8-flash-high";
const PRO_MODEL = process.env.GEMINI_PRO_MODEL || "ag/gemini-3.8-flash-high";

export const FAST_CASCADE = [
  DEFAULT_MODEL,
  "ag/gemini-3.8-flash",
  "ag/gemini-3.7-flash-high",
  "ag/gemini-3.6-flash-high"
];

export const SMART_CASCADE = [
  PRO_MODEL,
  "ag/gemini-3.8-flash",
  "ag/gemini-3.7-flash-high"
];

export const AUDIO_CASCADE = [
  "ag/gemini-3.8-flash-high",
  "ag/gemini-3.8-flash",
  "ag/gemini-3.7-flash-high"
];

export const DEFAULT_CASCADE = FAST_CASCADE;

export function selectModelCascade(text = "", options = {}) {
  if (options && options.audio) {
    return AUDIO_CASCADE;
  }
  if (options && options.media) {
    return SMART_CASCADE;
  }
  const t = String(text || "").trim();
  if (/(?:^|\s)[#!]pro\b|\b(?:mode\s+pro|pake\s+pro)\b/i.test(t)) {
    return SMART_CASCADE;
  }
  const isCodeOrLogic = /\b(koding|coding|script|skrip|python|javascript|golang|rust|regex|algoritma|debug|debugging|bikin\s+program|buatkan\s+program|refactor)\b/i.test(t);
  if (isCodeOrLogic) {
    return SMART_CASCADE;
  }
  const isDeepAnalysis = /\b(analisis\s+(mendalam|data|komparasi)|bandingkan\s+secara\s+detail|kalkulasi\s+rumit|probabilitas|persamaan\s+diferensial|integral|bedah\s+dokumen|analisis\s+jurnal)\b/i.test(t);
  if (isDeepAnalysis) {
    return SMART_CASCADE;
  }
  return FAST_CASCADE;
}

const modelCooldowns = new Map();

export function markModelUnavailable(model, cooldownMs = 120_000, store = null) {
  modelCooldowns.set(model, Date.now() + cooldownMs);
  if (store && typeof store.setModelCooldown === "function") {
    store.setModelCooldown(model, cooldownMs);
  }
}

export function clearModelCooldowns(store = null) {
  modelCooldowns.clear();
  if (store && typeof store.clearModelCooldowns === "function") {
    store.clearModelCooldowns();
  }
}

export function getActiveModels(baseModels = DEFAULT_CASCADE, store = null) {
  const models = process.env.GEMINI_MODELS
    ? process.env.GEMINI_MODELS.split(",").map((m) => m.trim()).filter(Boolean)
    : baseModels;
  const now = Date.now();
  const healthy = [];
  const cooling = [];

  for (const m of models) {
    let until = modelCooldowns.get(m) || 0;
    if (until <= now && store && typeof store.isModelCooling === "function") {
      if (store.isModelCooling(m)) {
        until = now + 60_000;
      }
    }
    if (until <= now) {
      healthy.push(m);
    } else {
      cooling.push(m);
    }
  }
  return [...healthy, ...cooling];
}

const NINEROUTER_BASE_URL = () => (process.env.NINEROUTER_URL || "http://localhost:20128").replace(/\/+$/, "");

async function callGemini(rotator, model, payload) {
  return rotator.execute(async (key) => {
    const baseUrl = NINEROUTER_BASE_URL();
    const url = `${baseUrl}/v1beta/models/${model}:generateContent`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
        "x-goog-api-key": key
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(25000)
    });
    if (!res.ok) {
      const err = new Error(await res.text());
      err.status = res.status;
      throw err;
    }
    return res.json();
  });
}

export async function generateContent(rotator, payload, baseCascade = null) {
  const models = getActiveModels(baseCascade || DEFAULT_CASCADE);
  let lastErr = null;

  for (const model of models) {
    try {
      return await callGemini(rotator, model, payload);
    } catch (err) {
      lastErr = err;
      const msg = err.message || "";
      const is503 = err.status === 503 || msg.includes("503") || msg.includes("UNAVAILABLE");
      const isTimeout = msg.includes("timeout") || msg.includes("aborted");
      const is404 = err.status === 404 || msg.includes("404") || msg.includes("NOT_FOUND");
      const is429 = err.status === 429 || msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED");

      if (is404) {
        markModelUnavailable(model, 24 * 60 * 60 * 1000);
        console.warn(`[LLM] Model ${model} NOT FOUND (404). Demoted 24 jam.`);
      } else if (is503 || isTimeout) {
        markModelUnavailable(model, 15_000);
        console.warn(`[LLM] Model ${model} gagal (${err.message}). Demoted 15s. Mencoba model berikutnya...`);
      } else if (is429) {
        markModelUnavailable(model, 60_000);
        console.warn(`[LLM] Model ${model} kena quota/rate-limit (429). Demoted 60s. Mencoba model berikutnya...`);
      } else {
        console.warn(`[LLM] Model ${model} gagal (${err.message}). Mencoba model berikutnya...`);
      }
    }
  }

  if (payload.toolConfig?.functionCallingConfig?.mode === "ANY") {
    console.warn(`[LLM] Mode ANY gagal pada semua model. Mencoba fallback ke mode AUTO...`);
    const autoPayload = { ...payload, toolConfig: { functionCallingConfig: { mode: "AUTO" } } };
    const autoModels = getActiveModels(baseCascade || DEFAULT_CASCADE);
    for (const model of autoModels) {
      try {
        return await callGemini(rotator, model, autoPayload);
      } catch {}
    }
  }

  throw lastErr || new Error("Semua model AI gagal merespons.");
}

export async function getEmbedding(rotator, text) {
  if (!text || typeof text !== "string" || !text.trim() || !rotator) return null;
  return rotator.execute(async (key) => {
    const baseUrl = NINEROUTER_BASE_URL();
    const url = `${baseUrl}/v1beta/models/gemini-embedding-001:embedContent`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
        "x-goog-api-key": key
      },
      body: JSON.stringify({
        model: "models/gemini-embedding-001",
        content: { parts: [{ text: text.trim().slice(0, 2048) }] }
      }),
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) throw new Error(`Embedding API error (${res.status}): ${await res.text()}`);
    const data = await res.json();
    return data.embedding?.values || null;
  }).catch(() => null);
}
