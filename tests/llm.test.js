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
import { executeTool } from "../src/llm/tools.js";
import { Storage } from "../src/db.js";

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

test("LLM Tools: addReminder calculates 1h default for events and supports custom remindAt", async () => {
  const store = new Storage(":memory:");
  const eventIso = new Date(Date.now() + 7200_000).toISOString();

  // Event with default 1h before
  const res1 = await executeTool("addReminder", {
    message: "Rapat Koordinasi",
    isEvent: true,
    eventAtIso: eventIso
  }, { store, chatId: "test-chat" });

  assert.strictEqual(res1.toolResult.success, true);
  const rem1 = store.getReminderById(res1.toolResult.id);
  assert.strictEqual(rem1.event_at, new Date(eventIso).getTime());
  assert.strictEqual(rem1.remind_at, rem1.event_at - 3600_000);

  // Event with custom remindAtIso (30 min before)
  const customIso = new Date(Date.now() + 7200_000 - 1800_000).toISOString();
  const res2 = await executeTool("addReminder", {
    message: "Webinar Tech",
    isEvent: true,
    eventAtIso: eventIso,
    remindAtIso: customIso
  }, { store, chatId: "test-chat" });

  assert.strictEqual(res2.toolResult.success, true);
  const rem2 = store.getReminderById(res2.toolResult.id);
  assert.strictEqual(rem2.event_at, new Date(eventIso).getTime());
  assert.strictEqual(rem2.remind_at, new Date(customIso).getTime());

  // Non-event regular reminder
  const regIso = new Date(Date.now() + 3600_000).toISOString();
  const res3 = await executeTool("addReminder", {
    message: "Minum Vitamin",
    isEvent: false,
    remindAtIso: regIso
  }, { store, chatId: "test-chat" });

  assert.strictEqual(res3.toolResult.success, true);
  const rem3 = store.getReminderById(res3.toolResult.id);
  assert.strictEqual(rem3.event_at, null);
  assert.strictEqual(rem3.remind_at, new Date(regIso).getTime());

  // Test listReminders with targetDateIso
  const monTime = new Date("2026-09-28T10:00:00+07:00").getTime();
  const tueTime = new Date("2026-09-29T10:00:00+07:00").getTime();
  store.addReminder("test-chat", "TM Valorant Senin", monTime, null, "reminder", monTime);
  store.addReminder("test-chat", "Match Valorant Selasa", tueTime, null, "reminder", tueTime);

  const resListMon = await executeTool("listReminders", {
    targetDateIso: "2026-09-28"
  }, { store, chatId: "test-chat" });

  assert.strictEqual(resListMon.toolResult.count, 1);
  assert.ok(resListMon.formattedList.includes("TM Valorant Senin"));
  assert.ok(!resListMon.formattedList.includes("Match Valorant Selasa"));

  // Test addTodo with prompt context & getTodoDetail
  const userPrompt = "Bikinin to do list submit proposal hackathon SEA besok sore jam 5 ya";
  const resAddTodo = await executeTool("addTodo", {
    task: "Submit Proposal Hackathon SEA",
    deadlineIso: "2026-09-30T17:00:00+07:00",
    tag: "#hackathon"
  }, { store, chatId: "test-chat", userText: userPrompt });

  assert.strictEqual(resAddTodo.toolResult.success, true);
  assert.strictEqual(resAddTodo.toolResult.description, userPrompt);

  const resDetail = await executeTool("getTodoDetail", {
    todoId: 1
  }, { store, chatId: "test-chat" });

  assert.strictEqual(resDetail.toolResult.success, true);
  assert.strictEqual(resDetail.toolResult.todo.task, "Submit Proposal Hackathon SEA");
  assert.ok(resDetail.toolResult.formatted.includes("Prompt / Deskripsi Asli:"));
  assert.ok(resDetail.toolResult.formatted.includes(userPrompt));

  // Test sendDirectMessage guard in group chat: reject non-explicit PC
  const resGroupDM = await executeTool("sendDirectMessage", {
    recipient: "Mami",
    message: "itu cuma typo doang wlek"
  }, { store, chatId: "120363029582992016@g.us", userText: "bilangin mami itu cuma typo doang wlek" });

  assert.ok(resGroupDM.toolResult.error);
  assert.ok(resGroupDM.toolResult.error.includes("Di obrolan grup dilarang"));

  // Test sendDirectMessage allowed in group chat when explicit PC requested
  const resGroupExplicitDM = await executeTool("sendDirectMessage", {
    recipient: "Mami",
    message: "jangan lupa belanja"
  }, { store, chatId: "120363029582992016@g.us", userText: "tolong pc mami jangan lupa belanja" });

  // Will either succeed or fail at WhatsApp dispatch, but NOT blocked by group guard
  assert.strictEqual(resGroupExplicitDM.toolResult.error?.includes("Di obrolan grup dilarang"), false);
});

test("LLM Engine: single-turn mutation short-circuits to avoid turn 2 delay", async () => {
  const { processChat } = await import("../src/llm.js");
  const { Storage } = await import("../src/db.js");
  const originalFetch = globalThis.fetch;
  let fetchCallCount = 0;

  globalThis.fetch = async (url, opts) => {
    fetchCallCount++;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              functionCall: {
                name: "deleteReminder",
                args: { reminderId: 1 }
              }
            }]
          }
        }]
      })
    };
  };

  try {
    const store = new Storage(":memory:");
    store.addReminder("user1", "Acara webinar", Date.now() + 3600_000);
    const mockRotator = { execute: async (fn) => fn("test-key") };

    const reply = await processChat(mockRotator, "hapus acara 1 dong", {
      store,
      chatId: "user1",
      senderNumber: "user1"
    });

    assert.strictEqual(fetchCallCount, 1, "Should short-circuit after turn 1 mutation");
    assert.ok(reply.includes("Beres"), "Reply should confirm mutation immediately");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("LLM Engine: injects quoted message context anchor when user replies to bot or contact", async () => {
  const { processChat } = await import("../src/llm.js");
  const { Storage } = await import("../src/db.js");
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
        candidates: [{ content: { parts: [{ text: "Siap, jadwal diundur ke jam 20:00 WIB." }] } }]
      })
    };
  };

  try {
    const store = new Storage(":memory:");
    store.addPerson({ name: "Mami", phone: "6282297432850", relationship: "Ibu" });
    const mockRotator = { execute: async (fn) => fn("test-key") };

    // Test A: Reply to Bot
    await processChat(mockRotator, "jam 20:00 aja", {
      store,
      chatId: "user1",
      senderNumber: "user1",
      quoted: { fromMe: true, text: "Mau diundur ke jam berapa jadwalnya?" }
    });

    assert.ok(capturedPayload, "Payload should be captured");
    const sysPromptA = capturedPayload.systemInstruction.parts[0].text;
    assert.ok(sysPromptA.includes("[KONTEKS PESAN YANG DI-REPLY]"));
    assert.ok(sysPromptA.includes("PENGGUNA ME-REPLY PESAN BOT"));

    // Test B: Reply to Contact (Mami)
    await processChat(mockRotator, "tolong catat ini", {
      store,
      chatId: "120363029582992016@g.us",
      senderNumber: "user1",
      quoted: { fromMe: false, senderNumber: "6282297432850", text: "Besok beli telur 1 kg" }
    });

    const sysPromptB = capturedPayload.systemInstruction.parts[0].text;
    assert.ok(sysPromptB.includes("[KONTEKS PESAN YANG DI-REPLY]"));
    assert.ok(sysPromptB.includes("Mami (+6282297432850)"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
