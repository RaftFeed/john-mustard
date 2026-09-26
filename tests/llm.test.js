import test from "node:test";
import assert from "node:assert";
import {
  detectUnexecutedMutationClaim,
  isAmbiguousScheduleStatement,
  formatForWhatsApp,
  sanitizeLatexForWhatsApp,
  parseHtmlTableToMarkdown,
  isActionIntent,
  isGreetingIntent
} from "../src/llm.js";
import { formatOutboundMentions } from "../src/waha.js";

test("LLM Guards: detectUnexecutedMutationClaim identifies false completion claims", () => {
  assert.strictEqual(detectUnexecutedMutationClaim("Sudah kutambahkan tugasnya bro!", []), true);
  assert.strictEqual(detectUnexecutedMutationClaim("Berhasil dihapus dari to-do list.", []), true);
  assert.strictEqual(detectUnexecutedMutationClaim("Woles Lord, udah gw majuin ke jam 21.00 WIB ya", []), true);
  assert.strictEqual(detectUnexecutedMutationClaim("udah gw mundurin jadwalnya", []), true);
  assert.strictEqual(detectUnexecutedMutationClaim("Sudah kutambahkan tugasnya bro!", ["addTodo"]), false);
  assert.strictEqual(detectUnexecutedMutationClaim("Halo ada yang bisa kubantu?", []), false);
});

test("LLM Guards: isAmbiguousScheduleStatement detects time constraints without target hour", () => {
  assert.strictEqual(isAmbiguousScheduleStatement("Jam 7 mah papi blm balik"), true);
  assert.strictEqual(isAmbiguousScheduleStatement("kocak jam 9 mah papi blm pulang"), true);
  assert.strictEqual(isAmbiguousScheduleStatement("Jam 17 blom pulang nih"), true);
  assert.strictEqual(isAmbiguousScheduleStatement("masih macet di jalan belum nyampe"), true);
  assert.strictEqual(isAmbiguousScheduleStatement("jangan jam 7, papi belum balik"), true);
  assert.strictEqual(isAmbiguousScheduleStatement("ganti jadi jam 20.00 ya"), false);
  assert.strictEqual(isAmbiguousScheduleStatement("mundurin ke jam 21.00 biar sempat"), false);
  assert.strictEqual(isAmbiguousScheduleStatement("tambahkan tugas cuci mobil"), false);
});

test("WAHA: formatOutboundMentions resolves contact names, pushnames, and aliases to phone", () => {
  const res1 = formatOutboundMentions("Woi Lord @M3-083_Rafid Harsyah, dibeliin Persona 3 Reload nih!");
  assert.ok(res1.text.includes("@6285236467838"));
  assert.ok(!res1.text.includes("@M3-083_Rafid Harsyah"));
  assert.ok(res1.mentions.includes("6285236467838@c.us"));

  const res2 = formatOutboundMentions("Tolong tag @simas ya!");
  assert.ok(res2.text.includes("@6285236467838"));
  assert.ok(res2.mentions.includes("6285236467838@c.us"));
});

test("LLM Formatters: HTML table parser and LaTeX sanitizer", () => {
  const sampleHtml = `
    <table>
      <tr><th>Nama Matkul</th><th>Hari</th></tr>
      <tr><td>Analisis Algoritme</td><td>Senin</td></tr>
    </table>
  `;
  const parsedMd = parseHtmlTableToMarkdown(sampleHtml);
  assert.ok(parsedMd.includes("| Nama Matkul | Hari |"));
  assert.ok(parsedMd.includes("| Analisis Algoritme | Senin |"));

  const latexFormula = "$$\\int_0^1 x^2 dx = \\frac{1}{3}$$";
  const sanitized = sanitizeLatexForWhatsApp(latexFormula);
  assert.ok(!sanitized.includes("$$"));
  assert.ok(!sanitized.includes("\\frac"));

  const waFormatted = formatForWhatsApp("### Judul\n**Tebal**\n- Poin 1");
  assert.ok(waFormatted.includes("*Judul*"));
  assert.ok(waFormatted.includes("*Tebal*"));
  assert.ok(waFormatted.includes("• Poin 1"));
});

test("LLM Intents: isActionIntent and isGreetingIntent classification", () => {
  assert.strictEqual(isGreetingIntent("halo"), true);
  assert.strictEqual(isGreetingIntent("p"), true);
  assert.strictEqual(isGreetingIntent("selamat pagi"), true);
  assert.strictEqual(isActionIntent("tambahkan tugas baru"), true);
  assert.strictEqual(isActionIntent("tolong ingatkan besok jam 7"), true);
  assert.strictEqual(isActionIntent("halo bro"), false);
});

test("LLM Engine: group chat message prefixes active speaker identity", async () => {
  const { processChat } = await import("../src/llm.js");
  const originalFetch = globalThis.fetch;
  let capturedPayload = null;

  globalThis.fetch = async (url, opts) => {
    if (opts?.body) {
      capturedPayload = JSON.parse(opts.body);
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: "Halo Mami, sistem aman terkendali." }] } }]
      })
    };
  };

  try {
    const mockRotator = {
      execute: async (fn) => fn("test-key")
    };

    const mockStore = {
      getPerson: (q) => (q === "6282297432850" ? { name: "Mami", phone: "6282297432850", relationship: "Ibu" } : null),
      getRecentChatHistory: () => [],
      getUserTonePreference: () => null
    };

    const reply = await processChat(mockRotator, "da ERROR blon kamu...?!", {
      store: mockStore,
      chatId: "120363029582992016@g.us",
      senderNumber: "6282297432850"
    });

    assert.ok(capturedPayload, "Payload should be sent to Gemini API");
    const userContent = capturedPayload.contents.find((c) => c.role === "user");
    assert.ok(userContent, "User role content must exist");
    const userText = userContent.parts.map((p) => p.text).join(" ");
    assert.ok(userText.includes("[Pengirim: Mami (+6282297432850)]: da ERROR blon kamu...?!"));
    assert.ok(capturedPayload.systemInstruction.parts[0].text.includes("OBROLAN GRUP KELUARGA"));
    assert.ok(capturedPayload.systemInstruction.parts[0].text.includes("IDENTIFIKASI PENGIRIM (SANGAT PENTING)"));
    assert.ok(reply.includes("Mami"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("LLM Engine: group chat overrides Lord tone and includes anti-asumsi guardrails", async () => {
  const { processChat } = await import("../src/llm.js");
  const originalFetch = globalThis.fetch;
  let capturedPayload = null;

  globalThis.fetch = async (url, opts) => {
    if (opts?.body) {
      capturedPayload = JSON.parse(opts.body);
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: "Siap Mas Rafid, ada yang bisa dibantu?" }] } }]
      })
    };
  };

  try {
    const mockRotator = { execute: async (fn) => fn("test-key") };
    const mockStore = {
      getPerson: (q) => (q === "6285236467838" ? { name: "Rafid", phone: "6285236467838", relationship: "Anak Pertama" } : null),
      getRecentChatHistory: () => [],
      getUserTonePreference: () => null
    };

    await processChat(mockRotator, "Jam 17 blom pulang nih", {
      store: mockStore,
      chatId: "120363029582992016@g.us",
      senderNumber: "6285236467838"
    });

    assert.ok(capturedPayload);
    const sysPrompt = capturedPayload.systemInstruction.parts[0].text;
    assert.ok(sysPrompt.includes("Panggil \"Rafid\", \"Mas\", atau \"Lord\"."));
    assert.ok(sysPrompt.includes("ANTI-ASUMSI WAKTU & TUGAS"));
    assert.ok(sysPrompt.includes("DILARANG KERAS mengarang jam baru"));
    assert.ok(!sysPrompt.includes("gw/lu, wkwk, santuy"));

    const userContents = capturedPayload.contents.find((c) => c.role === "user");
    const warningText = userContents.parts.map((p) => p.text).join(" ");
    assert.ok(warningText.includes("PERINGATAN SISTEM ANTI-ASUMSI"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
