import { geminiPayloadToOpenAI, openAIToGeminiResponse } from "./adapter.js";
import { KeyRotator } from "../rotator.js";

const DEFAULT_MODEL = process.env.GEMINI_MODEL || "ag/gemini-3.8-flash-high";
const PRO_MODEL = process.env.GEMINI_PRO_MODEL || "ag/gemini-3.8-flash-high";

export const OPENCODE_POOL = [
  "oc/deepseek-v4.1-flash-free",
  "oc/glm-5.3-flash-free",
  "oc/mimo-v2.6-flash-free",
  "oc/minimax-m3.1-flash-free",
  "oc/nemotron-3.5-lightning-free",
  "oc/nemotron-3-ultra-free",
  "oc/beam-free",
  "oc/longcat-2.5-preview-free",
  "oc/big-pickle"
];
const TEXT_FALLBACKS = [process.env.STEP_MODEL || "nous/stepfun/step-3.7-flash:free", ...OPENCODE_POOL];
export const FAST_CASCADE = [DEFAULT_MODEL, ...TEXT_FALLBACKS];
export const SMART_CASCADE = [PRO_MODEL, ...TEXT_FALLBACKS];
// Audio remains on its native provider; text-only fallbacks must not receive audio as an image.
export const AUDIO_CASCADE = [DEFAULT_MODEL];

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
const fallbackRotators = new WeakMap();

function executeModelRequest(rotator, model, request) {
  // Nous OAuth refresh belongs to the official Hermes proxy, not gateway API keys.
  if (model.startsWith("nous/")) return request("");
  if (!model.startsWith("oc/") || !Array.isArray(rotator.keys)) return rotator.execute(request);
  // Upstream model limits must not cool the gateway key for unrelated providers
  // or for another free model. Keep key rotation within each fallback model.
  let scopes = fallbackRotators.get(rotator);
  if (!scopes) fallbackRotators.set(rotator, scopes = new Map());
  if (!scopes.has(model)) scopes.set(model, new KeyRotator(rotator.keys, rotator.cooldownMs));
  return scopes.get(model).execute(request);
}

async function callModel(rotator, model, payload, deadline) {
  return executeModelRequest(rotator, model, async (key) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("Batas waktu cascade AI tercapai.");
    const isNous = model.startsWith("nous/");
    const native = !model.includes("/") || model.startsWith("ag/");
    const baseUrl = isNous
      ? (process.env.NOUS_PROXY_URL || "").replace(/\/+$/, "")
      : NINEROUTER_BASE_URL();
    if (!baseUrl) throw new Error("Nous Portal proxy belum dikonfigurasi.");
    const upstreamModel = isNous ? model.slice(5) : model;
    const url = native ? `${baseUrl}/v1beta/models/${model}:generateContent` : `${baseUrl}${isNous ? "" : "/v1"}/chat/completions`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${isNous ? "hermes-proxy" : key}`,
        ...(!isNous ? { "x-goog-api-key": key } : {})
      },
      body: JSON.stringify(native ? payload : geminiPayloadToOpenAI(upstreamModel, payload)),
      signal: AbortSignal.timeout(Math.min(25000, remaining))
    });
    if (!res.ok) {
      const err = new Error(await res.text());
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    if (!native && !data.choices?.length) {
      const err = new Error("Provider mengembalikan respons tanpa pilihan jawaban.");
      err.status = 502;
      throw err;
    }
    return native ? data : openAIToGeminiResponse(data, model);
  });
}

export async function generateContent(rotator, payload, baseCascade = null) {
  const models = [...new Set(getActiveModels(baseCascade || DEFAULT_CASCADE))];
  const deadline = Date.now() + 90000;
  const hasMedia = payload.contents?.some((c) => c.parts?.some((p) => p.inlineData));
  let lastErr = null;

  for (const model of models) {
    if ((modelCooldowns.get(model) || 0) > Date.now()) continue;
    if (hasMedia && (model.startsWith("nous/") || model.startsWith("oc/"))) continue;
    if (model.startsWith("nous/") && !process.env.NOUS_PROXY_URL) continue;
    if (Date.now() >= deadline) break;
    try {
      try {
        return await callModel(rotator, model, payload, deadline);
      } catch (err) {
        // Only a rejected tool mode warrants ANY -> AUTO. Network/capacity failures
        // must advance to the next provider rather than replay the entire cascade.
        if (err.status !== 400 || payload.toolConfig?.functionCallingConfig?.mode !== "ANY" ||
            !/tool.?choice|function.?calling|tool.?config|mode.*(?:ANY|required)/i.test(err.message)) throw err;
        const autoPayload = { ...payload, toolConfig: { functionCallingConfig: { mode: "AUTO" } } };
        return await callModel(rotator, model, autoPayload, deadline);
      }
    } catch (err) {
      lastErr = err;
      const is404 = err.status === 404;
      const cooldown = is404 ? 86400000 : err.status === 429 ? 60000 : 15000;
      markModelUnavailable(model, cooldown);
      // Do not log arbitrary provider bodies: they can contain request data.
      console.warn(`[LLM] Model ${model} gagal (${err.status || err.name || "error"}); cooldown ${cooldown / 1000}s. Mencoba fallback berikutnya.`);
    }
  }
  throw lastErr || new Error("Semua model AI sedang tidak tersedia atau dalam cooldown.");
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
