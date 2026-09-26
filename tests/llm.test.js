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
