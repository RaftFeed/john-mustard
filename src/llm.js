/**
 * LLM Module Façade (Deep Modules & Seam Discipline)
 * Coordinates sub-modules under ./llm/:
 * - formatters.js: Markdown tables, LaTeX, WhatsApp formatting
 * - guards.js: SSRF validation, anti-hallucination, intent classification
 * - cascade.js: Model tiers, cooldowns, Gemini API integration
 * - tools.js: 30+ function definitions and execution dispatcher
 * - engine.js: ReAct loop, mid-turn mailbox steering, multi-turn chat orchestrator
 */

export {
  formatRowsToMarkdown,
  parseHtmlTableToMarkdown,
  parseCsvToMarkdown,
  stripHallucinatedToolChips,
  sanitizeLatexForWhatsApp,
  formatForWhatsApp
} from "./llm/formatters.js";

export {
  isPrivateIp,
  isSafeUrlSync,
  isSafeUrl,
  fetchUrlContent,
  detectUnexecutedMutationClaim,
  isAmbiguousScheduleStatement,
  isNoFluffRequest,
  isActionIntent,
  isGreetingIntent,
  isExplicitPrivateRequest
} from "./llm/guards.js";

export {
  FAST_CASCADE,
  SMART_CASCADE,
  DEFAULT_CASCADE,
  selectModelCascade,
  markModelUnavailable,
  clearModelCooldowns,
  getActiveModels,
  generateContent,
  getEmbedding
} from "./llm/cascade.js";

export {
  TOOLS,
  executeTool
} from "./llm/tools.js";

export {
  injectMailboxSteering,
  processChat
} from "./llm/engine.js";

// Self-test block for standalone invocation
if (process.argv[1]?.replace(/\\/g, "/").endsWith("src/llm.js")) {
  import("node:assert").then(async ({ default: assert }) => {
    const {
      processChat,
      executeTool,
      isActionIntent,
      isGreetingIntent,
      isNoFluffRequest,
      detectUnexecutedMutationClaim,
      isAmbiguousScheduleStatement,
      parseHtmlTableToMarkdown,
      parseCsvToMarkdown,
      formatRowsToMarkdown,
      clearModelCooldowns,
      getActiveModels,
      markModelUnavailable,
      selectModelCascade,
      injectMailboxSteering,
      stripHallucinatedToolChips,
      sanitizeLatexForWhatsApp,
      formatForWhatsApp,
      isSafeUrl,
      TOOLS
    } = await import("./llm.js");

    assert.strictEqual(typeof processChat, "function");
    assert.strictEqual(typeof executeTool, "function");
    assert.strictEqual(isActionIntent("tambahkan tugas"), true);
    assert.strictEqual(isActionIntent("ingatkan besok jam 7"), true);
    assert.strictEqual(isActionIntent("hitung 25 * 40 pake python"), true);
    assert.strictEqual(isActionIntent("halo bro"), false);
    assert.strictEqual(isGreetingIntent("halo"), true);
    assert.strictEqual(isGreetingIntent("p"), true);
    assert.strictEqual(isGreetingIntent("yo wasap"), true);
    assert.strictEqual(isGreetingIntent("@john halo"), true);
    assert.strictEqual(isGreetingIntent("selamat pagi"), true);
    assert.strictEqual(isGreetingIntent("samlekom"), true);
    assert.strictEqual(isGreetingIntent("sup"), true);
    assert.strictEqual(isGreetingIntent("bang john"), true);
    assert.strictEqual(isGreetingIntent("haloooo"), true);
    assert.strictEqual(isGreetingIntent("morning bro"), true);
    assert.strictEqual(isGreetingIntent("tambahkan tugas"), false);
    const decls = TOOLS[0].functionDeclarations.map((d) => d.name);
    assert.ok(decls.includes("addBacklog"));
    assert.ok(decls.includes("listBacklogs"));
    assert.ok(decls.includes("completeBacklog"));
    assert.ok(decls.includes("submitFeatureRequest"));
    assert.ok(decls.includes("listFeatureRequests"));
    assert.ok(decls.includes("executePython"));
    assert.ok(decls.includes("saveSkill"));
    assert.ok(decls.includes("listSkills"));
    assert.ok(decls.includes("deleteSkill"));
    assert.ok(decls.includes("loadSkill"));
    assert.ok(decls.includes("updateSkill"));
    assert.ok(decls.includes("processPdf"));
    assert.ok(decls.includes("mergePdf"));
    assert.ok(decls.includes("splitPdf"));
    assert.ok(decls.includes("compressPdf"));
    assert.ok(decls.includes("convertDocument"));
    assert.ok(decls.includes("ocrDocument"));
    assert.ok(decls.includes("getTodosDue"));
    assert.ok(decls.includes("undoLastTodo"));
    assert.ok(decls.includes("setDailyDigest"));
    assert.ok(decls.includes("proposeSkill"));
    assert.ok(decls.includes("approveSkill"));
    assert.ok(decls.includes("rejectSkill"));
    assert.ok(decls.includes("listSkillVersions"));
    assert.ok(decls.includes("rollbackSkill"));
    assert.ok(decls.includes("addPerson"));
    assert.ok(decls.includes("getPerson"));
    assert.ok(decls.includes("listPersons"));
    assert.ok(decls.includes("deletePerson"));
    assert.ok(decls.includes("addReminder"));
    assert.ok(decls.includes("listReminders"));
    assert.ok(decls.includes("deleteReminder"));
    assert.ok(decls.includes("updateReminder"));
    assert.ok(decls.includes("saveNote"));
    assert.ok(decls.includes("appendNote"));
    assert.ok(decls.includes("getNote"));
    assert.ok(decls.includes("listNotes"));
    assert.ok(decls.includes("deleteNote"));
    assert.ok(decls.includes("readUrl"));
    assert.strictEqual(isActionIntent("pelajari skill rekap tugas"), true);
    assert.strictEqual(isActionIntent("gabung file pdf #1 dan #2"), true);
    assert.strictEqual(isActionIntent("kompres pdf dokumen ini"), true);
    assert.strictEqual(isActionIntent("konversi file laporan.docx ke pdf"), true);
    assert.strictEqual(isActionIntent("scan ocr foto ktp"), true);
    assert.strictEqual(isActionIntent("undo tugas terakhir"), true);
    assert.strictEqual(isActionIntent("buat proposal skill export json"), true);
    assert.strictEqual(isActionIntent("rollback skill rekap_malam"), true);
    assert.strictEqual(isActionIntent("tambahkan kontak Bunga istri"), true);
    assert.strictEqual(isActionIntent("baca url https://id.wikipedia.org"), true);
    assert.strictEqual(isActionIntent("catat nomor rekening bca 12345"), true);
    assert.strictEqual(isActionIntent("lihat catatan pribadi"), true);
    assert.strictEqual(isActionIntent("gimana kondisi server bot"), true);
    assert.strictEqual(isActionIntent("cek server menkrep"), true);
    assert.strictEqual(isActionIntent("ada yang online mc gak"), true);
    assert.strictEqual(isActionIntent("tolong pc karimah link video ini"), true);
    assert.strictEqual(isActionIntent("japri razita tugas tadi"), true);
    assert.ok(decls.includes("checkServerHealth"));
    assert.ok(decls.includes("checkMinecraftServer"));
    assert.ok(decls.includes("sendDirectMessage"));

    // SSRF Safety Tests
    assert.strictEqual(await isSafeUrl("http://localhost:3000/api"), false);
    assert.strictEqual(await isSafeUrl("http://waha:3000/api"), false);
    assert.strictEqual(await isSafeUrl("http://runner:8000/run"), false);
    assert.strictEqual(await isSafeUrl("http://127.0.0.1:8080"), false);
    assert.strictEqual(await isSafeUrl("http://192.168.1.1/router"), false);
    assert.strictEqual(await isSafeUrl("http://10.0.0.5/secret"), false);
    assert.strictEqual(await isSafeUrl("http://172.20.0.2/meta"), false);
    assert.strictEqual(await isSafeUrl("http://169.254.169.254/latest/meta-data"), false);
    assert.strictEqual(await isSafeUrl("https://en.wikipedia.org/wiki/Node.js"), true);

    // Mutation Claim Detection Tests
    assert.strictEqual(detectUnexecutedMutationClaim("Sudah kutambahkan tugasnya bro!", []), true);
    assert.strictEqual(detectUnexecutedMutationClaim("Berhasil dihapus dari to-do list.", []), true);
    assert.strictEqual(detectUnexecutedMutationClaim("Woles Lord, udah gw majuin ke jam 21.00 WIB ya", []), true);
    assert.strictEqual(detectUnexecutedMutationClaim("Sudah kutambahkan tugasnya bro!", ["addTodo"]), false);
    assert.strictEqual(detectUnexecutedMutationClaim("Halo ada yang bisa kubantu?", []), false);

    // Ambiguous Schedule Statement Tests
    assert.strictEqual(isAmbiguousScheduleStatement("Jam 7 mah papi blm balik"), true);
    assert.strictEqual(isAmbiguousScheduleStatement("ganti ke jam 20.00"), false);

    // HTML Table & CSV Parser Tests
    const sampleHtml = `
      <table>
        <tr><th>Nama Matkul</th><th>Hari</th><th>Jam</th></tr>
        <tr><td>Analisis Algoritme</td><td>Senin</td><td>08:00</td></tr>
        <tr><td>Basis Data</td><td>Selasa</td><td>10:00</td></tr>
      </table>
    `;
    const parsedMd = parseHtmlTableToMarkdown(sampleHtml);
    assert.ok(parsedMd.includes("| Nama Matkul | Hari | Jam |"));
    assert.ok(parsedMd.includes("| Analisis Algoritme | Senin | 08:00 |"));

    const sampleCsv = `Mata Kuliah,Hari,Ruang\n"Kalkulus",Rabu,"Lab A"\n"Fisika",Kamis,"Lab B"`;
    const csvMd = parseCsvToMarkdown(sampleCsv);
    assert.ok(csvMd.includes("| Mata Kuliah | Hari | Ruang |"));
    assert.ok(csvMd.includes("| Kalkulus | Rabu | Lab A |"));

    const wideRows = [
      ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10", "C11"],
      ["V1", "V2", "V3", "V4", "V5", "V6", "V7", "V8", "V9", "V10", "V11"]
    ];
    const wideMd = formatRowsToMarkdown(wideRows);
    assert.ok(wideMd.includes("• *C1*: V1"));
    assert.ok(wideMd.includes("• *C11*: V11"));

    // Model Cooldown & Cascade Ordering Tests
    clearModelCooldowns();
    const testModels = ["modelA", "modelB", "modelC"];
    assert.deepStrictEqual(getActiveModels(testModels), ["modelA", "modelB", "modelC"]);
    markModelUnavailable("modelA", 60_000);
    assert.deepStrictEqual(getActiveModels(testModels), ["modelB", "modelC", "modelA"]);
    clearModelCooldowns();
    assert.deepStrictEqual(getActiveModels(testModels), ["modelA", "modelB", "modelC"]);

    // Dynamic Model Tier Selection Tests
    assert.strictEqual(selectModelCascade("tambah to-do beli susu")[0], "gemini-3.8-flash");
    assert.strictEqual(selectModelCascade("halo john apa kabar")[0], "gemini-3.8-flash");
    assert.strictEqual(selectModelCascade("#pro tolong buatkan arsitektur backend")[0], "gemini-3.8-flash");
    assert.strictEqual(selectModelCascade("tolong debug script python ini")[0], "gemini-3.8-flash");
    assert.strictEqual(selectModelCascade("lakukan analisis mendalam data ini")[0], "gemini-3.8-flash");

    // Mid-Turn Mailbox Steering Tests
    const testMailbox = [{ body: "eh koreksi: ganti jam 14.00" }];
    const testContents = [{ role: "user", parts: [{ text: "ingatkan rapat" }] }];
    const injected = injectMailboxSteering(testMailbox, testContents);
    assert.strictEqual(injected, true);
    assert.strictEqual(testMailbox.length, 0);
    assert.ok(testContents[0].parts[1].text.includes("eh koreksi: ganti jam 14.00"));

    // Guardrail, LaTeX Sanitizer, & No-Fluff Tests
    assert.strictEqual(isNoFluffRequest("Tolong buatkan teks ini, no fluff ya"), true);
    assert.strictEqual(isNoFluffRequest("buatkan rangkuman materi tanpa basa-basi"), true);
    assert.strictEqual(isNoFluffRequest("halo john apa kabar"), false);

    const rawChipsText = "Ini hasil analisis data.\n\n_↳ readUrl  executePython_";
    assert.strictEqual(stripHallucinatedToolChips(rawChipsText), "Ini hasil analisis data.");

    const rawLatex = "Kompleksitasnya adalah $\\mathcal{O}(n \\log_2 n)$ dan nilainya $x^2 + y_1 \\leq 10$.";
    const cleanMath = sanitizeLatexForWhatsApp(rawLatex);
    assert.ok(cleanMath.includes("O(n log₂ n)"));
    assert.ok(cleanMath.includes("x² + y₁ ≤ 10"));
    assert.ok(!cleanMath.includes("$"));

    // WhatsApp Markdown Converter Tests
    const rawMarkdown = "### Heading Judul\nBerikut list:\n* Item 1\n* Item 2\n**Teks tebal** dan [Link Web](https://example.com)\n> ini kutipan";
    const waFormatted = formatForWhatsApp(rawMarkdown);
    assert.ok(waFormatted.includes("*Heading Judul*"));
    assert.ok(waFormatted.includes("• Item 1"));
    assert.ok(waFormatted.includes("• Item 2"));
    assert.ok(waFormatted.includes("*Teks tebal*"));
    assert.ok(waFormatted.includes("Link Web (https://example.com)"));
    assert.ok(waFormatted.includes("_ini kutipan_"));
    assert.ok(!waFormatted.includes("###"));

    console.log("LLM module self-test OK");
  });
}
