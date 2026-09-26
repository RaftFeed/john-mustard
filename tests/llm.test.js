import test from "node:test";
import assert from "node:assert";
import {
  detectUnexecutedMutationClaim,
  formatForWhatsApp,
  sanitizeLatexForWhatsApp,
  parseHtmlTableToMarkdown,
  isActionIntent,
  isGreetingIntent
} from "../src/llm.js";

test("LLM Guards: detectUnexecutedMutationClaim identifies false completion claims", () => {
  assert.strictEqual(detectUnexecutedMutationClaim("Sudah kutambahkan tugasnya bro!", []), true);
  assert.strictEqual(detectUnexecutedMutationClaim("Berhasil dihapus dari to-do list.", []), true);
  assert.strictEqual(detectUnexecutedMutationClaim("Sudah kutambahkan tugasnya bro!", ["addTodo"]), false);
  assert.strictEqual(detectUnexecutedMutationClaim("Halo ada yang bisa kubantu?", []), false);
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
