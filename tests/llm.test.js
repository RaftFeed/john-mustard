import test from "node:test";
import assert from "node:assert";
import {
  detectUnexecutedMutationClaim,
  isAmbiguousScheduleStatement,
  formatForWhatsApp,
  sanitizeLatexForWhatsApp,
  parseHtmlTableToMarkdown,
  isActionIntent,
  isGreetingIntent,
  isExplicitPrivateRequest,
  hasExplicitRescheduleIntent,
  isFollowUpReminderIntent,
  isQuotedEventReminder,
  isAmbiguousEventReply,
  isListRequest,
  processChat,
  extractCandidateText,
  selectModelCascade,
  AUDIO_CASCADE,
  SMART_CASCADE,
  FAST_CASCADE
} from "../src/llm.js";
import { formatOutboundMentions } from "../src/waha.js";
import { executeTool } from "../src/llm/tools.js";
import { Storage } from "../src/db.js";

test("LLM Guards: detectUnexecutedMutationClaim identifies false completion claims", () => {
  assert.strictEqual(detectUnexecutedMutationClaim("Sudah kutambahkan tugasnya bro!", []), true);
  assert.strictEqual(detectUnexecutedMutationClaim("Berhasil dihapus dari to-do list.", []), true);
  assert.strictEqual(detectUnexecutedMutationClaim("Woles Lord, udah gw majuin ke jam 21.00 WIB ya", []), true);
  assert.strictEqual(detectUnexecutedMutationClaim("udah gw mundurin jadwalnya", []), true);
  assert.strictEqual(detectUnexecutedMutationClaim("Udah gw benerin sekarang, jadi nanti otomatis ngingetin.", []), true);
  assert.strictEqual(detectUnexecutedMutationClaim("Udah gw benerin sekarang, jadi nanti otomatis ngingetin.", ["updateReminder"]), false);
  assert.strictEqual(detectUnexecutedMutationClaim("Sori Lord, udah gw seting ulang dan pasang pengingatnya.", []), true);
  assert.strictEqual(detectUnexecutedMutationClaim("Sori Lord, udah gw seting ulang dan pasang pengingatnya.", ["addReminder"]), false);
  assert.strictEqual(detectUnexecutedMutationClaim("Udah diatur jadwalnya ya", []), true);
  assert.strictEqual(detectUnexecutedMutationClaim("Udah disetel jamnya", []), true);
  assert.strictEqual(detectUnexecutedMutationClaim("Udah beres tugasnya", []), true);
  assert.strictEqual(detectUnexecutedMutationClaim("Udah kelar bro", []), true);
  assert.strictEqual(detectUnexecutedMutationClaim("Udah masuk to-do list", []), true);
  assert.strictEqual(detectUnexecutedMutationClaim("Siap Mami, ini langsung aku PC dan bangunin Lord Rafid sekarang juga ya.", []), true);
  assert.strictEqual(detectUnexecutedMutationClaim("udah aku japri ke Rafid ya", []), true);
  assert.strictEqual(detectUnexecutedMutationClaim("Siap Mami, coba aku tanyain atau bantu hubungi pihak waLondon-nya lewat pesan pribadi ya, Mi. Sebentar ya!", []), true);
  assert.strictEqual(detectUnexecutedMutationClaim("Bentar ya, biar aku hubungi admin tokonya via WA.", []), true);
  assert.strictEqual(detectUnexecutedMutationClaim("Nanti aku tanyakan langsung ke pihak CS ya.", []), true);
  assert.strictEqual(detectUnexecutedMutationClaim("Maaf Mami, aku hanya asisten internal keluarga dan tidak punya akses untuk menghubungi pihak waLondon. Mami bisa langsung chat atau hubungi mereka sendiri yaa.", []), false);
  assert.strictEqual(detectUnexecutedMutationClaim("Siap Mami, ini langsung aku PC dan bangunin Lord Rafid sekarang juga ya.", ["sendDirectMessage"]), false);
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

  // Group chat with known LID: resolves to @<lid> and <lid>@lid to prevent "@Pengguna tidak dikenal"
  const resGroup = formatOutboundMentions("Halo @6285236467838 dicariin nih", null, "120363029582992016@g.us");
  assert.ok(resGroup.text.includes("@228140156772422"));
  assert.ok(!resGroup.text.includes("@6285236467838"));
  assert.ok(resGroup.mentions.includes("228140156772422@lid"));
  assert.ok(!resGroup.mentions.includes("6285236467838@c.us"));
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
  assert.strictEqual(isActionIntent("@John Mustard WA @M3-083_Rafid..."), true);
  assert.strictEqual(isActionIntent("jangan dgrup @John Mustard tapi di saluran pribadi kasih tau @M3-083_Rafid Harsyah"), true);
  assert.strictEqual(isActionIntent("halo bro"), false);

  // isExplicitPrivateRequest tests
  assert.strictEqual(isExplicitPrivateRequest("trus...!!! @John Mustard sampe @M3-083_... bangun...!!! di japriii...!!!"), true);
  assert.strictEqual(isExplicitPrivateRequest("@John Mustard WA @M3-083_Rafid..."), true);
  assert.strictEqual(isExplicitPrivateRequest("jangan dgrup @John Mustard tapi di saluran pribadi kasih tau @M3-083_Rafid Harsyah"), true);
  assert.strictEqual(isExplicitPrivateRequest("bangunin...!!! @bot"), false);
  assert.strictEqual(isExplicitPrivateRequest("TELP...!!! @John Mustard TELP...!!!"), false);
  assert.strictEqual(isExplicitPrivateRequest("bangunin rafid lewat pc"), true);
  assert.strictEqual(isExplicitPrivateRequest("tolong pc mami"), true);
  assert.strictEqual(isExplicitPrivateRequest("japri razita tugasnya"), true);
  assert.strictEqual(isExplicitPrivateRequest("dm papi sekarang"), true);
  assert.strictEqual(isExplicitPrivateRequest("bilangin mami itu cuma typo doang wlek"), false);
  assert.strictEqual(isExplicitPrivateRequest("kasih tau razita jangan lupa makan"), false);
});

test("LLM Guards: isListRequest only fires on explicit to-do/event list requests", () => {
  assert.strictEqual(isListRequest("list tugas gw dong"), true);
  assert.strictEqual(isListRequest("tugas gw apa aja"), true);
  assert.strictEqual(isListRequest("acara besok apa"), true);
  assert.strictEqual(isListRequest("agenda hari ini"), true);
  assert.strictEqual(isListRequest("jadwal hari senin aku apa aja"), true);
  assert.strictEqual(isListRequest("deadline besok"), true);
  assert.strictEqual(isListRequest("cek pengingat minggu ini"), true);
  assert.strictEqual(isListRequest("rekap harian"), true);

  assert.strictEqual(isListRequest("coba cek lognya kapan gw nyuruh itu"), false);
  assert.strictEqual(isListRequest("hapus acara 1 dong"), false);
  assert.strictEqual(isListRequest("hapus tugas 2"), false);
  assert.strictEqual(isListRequest("selesaikan tugas 1"), false);
  assert.strictEqual(isListRequest("ingetin aku tugas X jam 5"), false);
  assert.strictEqual(isListRequest("halo bro apa kabar"), false);
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

  // Event where LLM set remindAtIso == eventAtIso (must fallback to 1h before)
  const resSameTime = await executeTool("addReminder", {
    message: "Latihan OSIS",
    isEvent: true,
    eventAtIso: eventIso,
    remindAtIso: eventIso
  }, { store, chatId: "test-chat" });

  assert.strictEqual(resSameTime.toolResult.success, true);
  const remSame = store.getReminderById(resSameTime.toolResult.id);
  assert.strictEqual(remSame.event_at, new Date(eventIso).getTime());
  assert.strictEqual(remSame.remind_at, remSame.event_at - 3600_000);

  // Inferred event from message keyword "jadwal" when isEvent omitted
  const resInferred = await executeTool("addReminder", {
    message: "Pengingat jadwal dan agenda hari ini",
    remindAtIso: eventIso
  }, { store, chatId: "test-chat" });

  assert.strictEqual(resInferred.toolResult.success, true);
  const remInf = store.getReminderById(resInferred.toolResult.id);
  assert.strictEqual(remInf.event_at, new Date(eventIso).getTime());
  assert.strictEqual(remInf.remind_at, remInf.event_at - 3600_000);

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

  // Test sendDirectMessage allowed with repeated letters ("di japriii...!!!")
  const resJapriii = await executeTool("sendDirectMessage", {
    recipient: "Rafid",
    message: "Bangun woy udah ada kelas"
  }, { store, chatId: "120363029582992016@g.us", userText: "trus...!!! @John Mustard sampe @M3-083_... bangun...!!! di japriii...!!!" });
  assert.strictEqual(resJapriii.toolResult.error?.includes("Di obrolan grup dilarang"), false);

  // Test sendDirectMessage allowed with "WA @Rafid"
  const resWA = await executeTool("sendDirectMessage", {
    recipient: "Rafid",
    message: "Bangun woy"
  }, { store, chatId: "120363029582992016@g.us", userText: "@John Mustard WA @M3-083_Rafid..." });
  assert.strictEqual(resWA.toolResult.error?.includes("Di obrolan grup dilarang"), false);

  // Test sendDirectMessage allowed with "jangan dgrup tapi di saluran pribadi"
  const resSaluran = await executeTool("sendDirectMessage", {
    recipient: "Rafid",
    message: "Bangun woy"
  }, { store, chatId: "120363029582992016@g.us", userText: "jangan dgrup @John Mustard tapi di saluran pribadi kasih tau @M3-083_Rafid Harsyah" });
  assert.strictEqual(resSaluran.toolResult.error?.includes("Di obrolan grup dilarang"), false);
});

test("LLM Tools: addTodo/updateTodo return a formatted confirmation card", async () => {
  const store = new Storage(":memory:");
  const chatId = "6285236467838";

  const resAdd = await executeTool("addTodo", {
    task: "Cek broksum Stockbit",
    deadlineIso: "2026-09-30T16:30:00+07:00",
    tag: "saham"
  }, { store, chatId });

  assert.strictEqual(resAdd.toolResult.success, true);
  assert.ok(resAdd.formattedList.includes("*Cek broksum Stockbit*"));
  assert.ok(resAdd.formattedList.includes("• Deadline: "));
  assert.ok(resAdd.formattedList.includes("• Tag: #saham"));
  assert.ok(!/\bid:\s*\d+/i.test(resAdd.formattedList));

  const resUpd = await executeTool("updateTodo", {
    todoId: resAdd.toolResult.id,
    newTask: "Cek broksum Stockbit (revisi)"
  }, { store, chatId });

  assert.strictEqual(resUpd.toolResult.success, true);
  assert.ok(resUpd.formattedList.includes("*Cek broksum Stockbit (revisi)*"));
  assert.ok(resUpd.formattedList.includes("• Tag: #saham"));
});

test("LLM Engine: addTodo short-circuits to a card-style confirmation", async () => {
  const { processChat } = await import("../src/llm.js");
  const { Storage } = await import("../src/db.js");
  const originalFetch = globalThis.fetch;
  let fetchCallCount = 0;

  globalThis.fetch = async () => {
    fetchCallCount++;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              functionCall: {
                name: "addTodo",
                args: { task: "Cek broksum Stockbit", deadlineIso: "2026-09-30T16:30:00+07:00", tag: "saham" }
              }
            }]
          }
        }]
      })
    };
  };

  try {
    const store = new Storage(":memory:");
    const mockRotator = { execute: async (fn) => fn("test-key") };
    const reply = await processChat(mockRotator, "tambahin cek broksum stockbit deadline 16.30", {
      store,
      chatId: "6285236467838",
      senderNumber: "6285236467838"
    });

    assert.strictEqual(fetchCallCount, 1, "Should short-circuit after turn 1 addTodo");
    assert.ok(reply.includes("Udah dicatet ya"));
    assert.ok(reply.includes("*Cek broksum Stockbit*"));
    assert.ok(reply.includes("• Tag: #saham"));
  } finally {
    globalThis.fetch = originalFetch;
  }
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

test("LLM Engine: mutation reply omits the full remaining list when not requested", async () => {
  const { processChat } = await import("../src/llm.js");
  const { Storage } = await import("../src/db.js");
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{
        content: {
          parts: [{ functionCall: { name: "deleteReminder", args: { reminderId: 1 } } }]
        }
      }]
    })
  });

  try {
    const store = new Storage(":memory:");
    store.addReminder("user1", "Acara webinar", Date.now() + 3600_000);
    store.addReminder("user1", "Acara lain", Date.now() + 7200_000);
    const mockRotator = { execute: async (fn) => fn("test-key") };

    const reply = await processChat(mockRotator, "hapus acara 1 dong", {
      store,
      chatId: "user1",
      senderNumber: "user1"
    });

    assert.ok(reply.includes("Beres"), "Reply should confirm mutation");
    assert.ok(!reply.includes("[Daftar Acara & Pengingat]"), "Full event list must not be dumped after a mutation");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("LLM Engine: does not append the full event list when the user did not ask for it", async () => {
  const { processChat } = await import("../src/llm.js");
  const { Storage } = await import("../src/db.js");
  const originalFetch = globalThis.fetch;
  let call = 0;

  globalThis.fetch = async () => {
    call++;
    if (call === 1) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: { parts: [{ functionCall: { name: "listReminders", args: {} } }] }
          }]
        })
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: "Itu dari rekap harian jam 07.00 WIB, Lord." }] } }]
      })
    };
  };

  try {
    const store = new Storage(":memory:");
    store.addReminder("user1", "Acara webinar", Date.now() + 3600_000);
    const mockRotator = { execute: async (fn) => fn("test-key") };

    const reply = await processChat(mockRotator, "coba cek lognya kapan gw nyuruh itu", {
      store,
      chatId: "user1",
      senderNumber: "user1"
    });

    assert.ok(reply.includes("rekap harian"), "Model answer must be preserved");
    assert.ok(!reply.includes("[Daftar Acara & Pengingat]"), "Full event list must NOT be appended unrequested");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("LLM Engine: appends the full to-do list when the user explicitly asks for it", async () => {
  const { processChat } = await import("../src/llm.js");
  const { Storage } = await import("../src/db.js");
  const originalFetch = globalThis.fetch;
  let call = 0;

  globalThis.fetch = async () => {
    call++;
    if (call === 1) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: { parts: [{ functionCall: { name: "listTodos", args: {} } }] }
          }]
        })
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: "Nih, Lord." }] } }]
      })
    };
  };

  try {
    const store = new Storage(":memory:");
    store.addTodo("user1", "Cek broksum Stockbit", Date.now() + 3600_000, "saham");
    const mockRotator = { execute: async (fn) => fn("test-key") };

    const reply = await processChat(mockRotator, "list tugas gw dong", {
      store,
      chatId: "user1",
      senderNumber: "user1"
    });

    assert.ok(reply.includes("[To-Do List]"), "Full to-do list must be appended when requested");
    assert.ok(reply.includes("Cek broksum Stockbit"));
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

test("WAHA & LLM: parseIncoming and processChat resolve WhatsApp LID & pushName to Mami", async () => {
  const { parseIncoming, extractQuotedInfo, formatSenderDisplay } = await import("../src/waha.js");
  const { processChat } = await import("../src/llm.js");
  const { Storage } = await import("../src/db.js");

  const store = new Storage(":memory:");

  // Test 1: parseIncoming with WhatsApp LID and pushName "Mami"
  const webhookBody = {
    event: "message",
    payload: {
      id: "MSG_STICKER_123",
      from: "120363029582992016@g.us",
      participant: "338140156772422@lid",
      pushName: "Mami",
      type: "sticker",
      hasMedia: true,
      mediaUrl: "http://waha:3000/sticker.webp",
      replyTo: {
        id: "BOT_MSG_999",
        fromMe: true,
        body: "Bangunin Lord Rafid Kuliah jam 08.00"
      },
      timestamp: 1700000000
    }
  };

  const parsed = parseIncoming(webhookBody, "6285236467838,6282297432850", store);
  assert.ok(parsed, "Message should be parsed");
  assert.strictEqual(parsed.isSticker, true);
  assert.strictEqual(parsed.isGroup, true);
  assert.strictEqual(parsed.senderName, "Mami");
  assert.strictEqual(parsed.senderNumber, "6282297432850");
  assert.strictEqual(parsed.quoted?.fromMe, true);

  // Check that LID mapping was dynamically saved
  const mapping = store.getLidMapping("338140156772422");
  assert.ok(mapping);
  assert.strictEqual(mapping.phone, "6282297432850");

  // Test 2: formatSenderDisplay with LID
  const display = formatSenderDisplay("338140156772422", "Mami", store);
  assert.strictEqual(display, "Mami");

  // Test 3: processChat in group chat with Mami
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
        candidates: [{ content: { parts: [{ text: "Wkwk Mami ngirim stiker pasrah 😭" }] } }]
      })
    };
  };

  try {
    const mockRotator = { execute: async (fn) => fn("test-key") };
    await processChat(mockRotator, "[Stiker WhatsApp diterima]. Stiker ini dikirim oleh: Mami.", {
      store,
      chatId: "120363029582992016@g.us",
      senderNumber: parsed.senderNumber,
      senderName: parsed.senderName,
      quoted: parsed.quoted
    });

    assert.ok(capturedPayload, "Payload must be sent to LLM");
    const sysPrompt = capturedPayload.systemInstruction.parts[0].text;
    assert.ok(sysPrompt.includes("Panggil \"Mami\". DILARANG KERAS memanggil Mami dengan sebutan \"Lord\""));
    assert.ok(sysPrompt.includes("IDENTIFIKASI PENGIRIM (SANGAT PENTING)"));
    assert.ok(sysPrompt.includes("PENGGUNA ME-REPLY PESAN BOT"));

    const userContent = capturedPayload.contents.find((c) => c.role === "user");
    const userText = userContent.parts.map((p) => p.text).join(" ");
    assert.ok(userText.includes("[Pengirim: Mami (+6282297432850)]"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("LLM Guards: event reminder follow-up vs reschedule intent classification", () => {
  // 1. hasExplicitRescheduleIntent
  assert.strictEqual(hasExplicitRescheduleIntent("mundurin acaranya ke jam 19.00"), true);
  assert.strictEqual(hasExplicitRescheduleIntent("tolong undur jadwalnya ya"), true);
  assert.strictEqual(hasExplicitRescheduleIntent("geser ke jam 20.00"), true);
  assert.strictEqual(hasExplicitRescheduleIntent("ganti jam acara jadi jam 14:00"), true);
  assert.strictEqual(hasExplicitRescheduleIntent("tunda acaranya"), true);
  assert.strictEqual(hasExplicitRescheduleIntent("Ingetin lagi nanti malem jam 19.00"), false);
  assert.strictEqual(hasExplicitRescheduleIntent("jam 19.00 aja"), false);

  // 2. isFollowUpReminderIntent
  assert.strictEqual(isFollowUpReminderIntent("Ingetin lagi nanti malem jam 19.00"), true);
  assert.strictEqual(isFollowUpReminderIntent("remind lagi jam 8"), true);
  assert.strictEqual(isFollowUpReminderIntent("ping lagi nanti"), true);
  assert.strictEqual(isFollowUpReminderIntent("nanti ingetin lagi ya"), true);
  assert.strictEqual(isFollowUpReminderIntent("mundurin jadwal ke jam 19.00"), false);
  assert.strictEqual(isFollowUpReminderIntent("jam 19.00 aja"), false);

  // 3. isQuotedEventReminder
  const quotedEvent = {
    content: "⏰ [Pengingat Acara & Agenda]\n_Pengingat sebelum acara dimulai!_\n\n🔔 *[ACARA] Buat kuisioner Pemasaran*\n├── Mulai: Sel, 29 Sep 2026 12:00\n└── `#acara`"
  };
  const quotedTodo = {
    content: "🌄 [To-Do List]\n[1] Beli beras\n└── `#tugas`"
  };
  assert.strictEqual(isQuotedEventReminder(quotedEvent), true);
  assert.strictEqual(isQuotedEventReminder(quotedTodo), false);
  assert.strictEqual(isQuotedEventReminder(null), false);

  // 4. isAmbiguousEventReply
  assert.strictEqual(isAmbiguousEventReply("jam 19.00 aja", quotedEvent), true);
  assert.strictEqual(isAmbiguousEventReply("nanti malem aja", quotedEvent), true);
  assert.strictEqual(isAmbiguousEventReply("Ingetin lagi nanti malem jam 19.00", quotedEvent), false);
  assert.strictEqual(isAmbiguousEventReply("mundurin ke jam 19.00", quotedEvent), false);
  assert.strictEqual(isAmbiguousEventReply("jam 19.00 aja", quotedTodo), false);
});

test("LLM Engine: Quoted event reminder with 'ingetin lagi' injects addReminder instruction and disables updateReminder", async () => {
  const store = new Storage(":memory:");
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
        candidates: [{ content: { parts: [{ text: "Siap Lord, udah gw buatkan pengingat jam 19:00 WIB ya. Jam acaranya tetap jam 12:00 WIB." }] } }]
      })
    };
  };

  try {
    const mockRotator = { execute: async (fn) => fn("test-key") };
    const quotedEvent = {
      fromMe: true,
      content: "⏰ [Pengingat Acara & Agenda]\n🔔 *[ACARA] Buat kuisioner Pemasaran*\n├── Mulai: Sel, 29 Sep 2026 12:00\n└── `#acara`"
    };

    await processChat(mockRotator, "Ingetin lagi nanti malem jam 19.00", {
      store,
      chatId: "6285236467838",
      senderNumber: "6285236467838",
      quoted: quotedEvent
    });

    assert.ok(capturedPayload, "Payload must be sent to LLM");
    const sysPrompt = capturedPayload.systemInstruction.parts[0].text;
    assert.ok(sysPrompt.includes("PERINGATAN KHUSUS PENGINGAT ACARA"));
    assert.ok(sysPrompt.includes("addReminder"));
    assert.ok(sysPrompt.includes("DILARANG KERAS memanggil 'updateReminder'"));

    const userContent = capturedPayload.contents.find((c) => c.role === "user");
    const userTextParts = userContent.parts.map((p) => p.text).join(" ");
    assert.ok(userTextParts.includes("[INSTRUKSI SISTEM PENGINGAT ACARA]"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("LLM Engine: Ambiguous reply to quoted event forces toolConfig mode NONE to ask confirmation", async () => {
  const store = new Storage(":memory:");
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
        candidates: [{ content: { parts: [{ text: "Mau dibuatkan pengingat jam 19.00 atau jam acaranya mau diundur, Lord?" }] } }]
      })
    };
  };

  try {
    const mockRotator = { execute: async (fn) => fn("test-key") };
    const quotedEvent = {
      fromMe: true,
      content: "⏰ [Pengingat Acara & Agenda]\n🔔 *[ACARA] Buat kuisioner Pemasaran*\n├── Mulai: Sel, 29 Sep 2026 12:00\n└── `#acara`"
    };

    await processChat(mockRotator, "jam 19.00 aja", {
      store,
      chatId: "6285236467838",
      senderNumber: "6285236467838",
      quoted: quotedEvent
    });

    assert.ok(capturedPayload, "Payload must be sent to LLM");
    assert.strictEqual(capturedPayload.toolConfig?.functionCallingConfig?.mode, "NONE");

    const userContent = capturedPayload.contents.find((c) => c.role === "user");
    const userTextParts = userContent.parts.map((p) => p.text).join(" ");
    assert.ok(userTextParts.includes("[PERINGATAN SISTEM ANTI-ASUMSI]"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("LLM Engine: Tool guard blocks updateReminder if user said 'ingetin lagi' on quoted event", async () => {
  const store = new Storage(":memory:");
  const eventTime = Date.now() + 7200_000;
  const remId = store.addReminder("6285236467838", "Buat kuisioner Pemasaran", eventTime, null, "event", eventTime);

  const originalFetch = globalThis.fetch;
  let callCount = 0;
  let capturedToolResult = null;

  globalThis.fetch = async (url, opts) => {
    callCount++;
    if (callCount === 1) {
      // LLM mistakenly tries to call updateReminder to reschedule to 19:00
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{
                functionCall: {
                  name: "updateReminder",
                  args: {
                    reminderId: remId,
                    newRemindAtIso: "2026-09-29T19:00:00+07:00"
                  }
                }
              }]
            }
          }]
        })
      };
    }
    // Turn 2: LLM receives guard rejection error and responds asking confirmation or explaining
    const body = JSON.parse(opts.body);
    const lastContent = body.contents[body.contents.length - 1];
    capturedToolResult = lastContent.parts?.find((p) => p.functionResponse)?.functionResponse?.response?.result;

    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{ text: "Siap Lord, jadwal acara tetap jam 12:00 ya. Mau dibuatkan pengingat jam 19:00?" }]
          }
        }]
      })
    };
  };

  try {
    const mockRotator = { execute: async (fn) => fn("test-key") };
    const quotedEvent = {
      fromMe: true,
      content: "⏰ [Pengingat Acara & Agenda]\n🔔 *[ACARA] Buat kuisioner Pemasaran*\n├── Mulai: Sel, 29 Sep 2026 12:00\n└── `#acara`"
    };

    const reply = await processChat(mockRotator, "Ingetin lagi nanti malem jam 19.00", {
      store,
      chatId: "6285236467838",
      senderNumber: "6285236467838",
      quoted: quotedEvent
    });

    assert.ok(capturedToolResult, "Tool response must be captured");
    assert.ok(capturedToolResult.error.includes("DILARANG mengundur jam acara"), "Must return guard rejection error");

    // Verify reminder in DB was NOT moved to 19:00
    const rem = store.getReminderById(remId);
    assert.strictEqual(rem.event_at, eventTime);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("LLM Cascade: selectModelCascade routes audio to AUDIO_CASCADE and media to SMART_CASCADE", () => {
  const audioCascade = selectModelCascade("", { audio: { buffer: Buffer.from("test") } });
  assert.strictEqual(audioCascade[0], "ag/gemini-3.8-flash");
  assert.strictEqual(audioCascade, AUDIO_CASCADE);

  const mediaCascade = selectModelCascade("", { media: { buffer: Buffer.from("test") } });
  assert.strictEqual(mediaCascade, SMART_CASCADE);

  const defaultCascade = selectModelCascade("halo apa kabar");
  assert.strictEqual(defaultCascade, FAST_CASCADE);
});

test("LLM Engine: audio input injects Indonesian voice note instructions and cleans mimetype", async () => {
  const store = new Storage(":memory:");
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
        candidates: [{ content: { parts: [{ text: "Mendengar VN: undur acara. Sip Lord, udah diundur ya." }] } }]
      })
    };
  };

  try {
    const mockRotator = { execute: async (fn) => fn("test-key") };
    await processChat(mockRotator, "", {
      store,
      chatId: "6285236467838",
      senderNumber: "6285236467838",
      audio: {
        buffer: Buffer.from("fake-audio"),
        mimetype: "audio/ogg; codecs=opus",
        filename: "audio.ogg"
      }
    });

    assert.ok(capturedPayload, "Payload must be sent to LLM");
    const userContent = capturedPayload.contents.find((c) => c.role === "user");
    assert.ok(userContent, "Must have user content");

    // Verify inlineData clean mimetype (codecs stripped)
    const inlineData = userContent.parts.find((p) => p.inlineData);
    assert.ok(inlineData, "Must have inlineData");
    assert.strictEqual(inlineData.inlineData.mimeType, "audio/ogg");

    // Verify Indonesian audio prompt injection
    const textPart = userContent.parts.find((p) => p.text?.includes("[INSTRUKSI AUDIO/PESAN SUARA]"));
    assert.ok(textPart, "Must have audio instructions");
    assert.ok(textPart.text.includes("Bahasa Indonesia"));
    assert.ok(textPart.text.includes("Mendengar VN:"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("LLM Tools: 2-step deletion flow buffers pending deletion draft and executes upon confirmation", async () => {
  const { executeTool } = await import("../src/llm/tools.js");
  const store = new Storage(":memory:");
  const chatId = "6285236467838";

  // Create a todo item
  const todoId = store.addTodo(chatId, "Beli telur ayam 1kg");

  // Step 1: Unconfirmed delete request (e.g. conversational prompt without explicit confirmation)
  const step1 = await executeTool("deleteTodo", { todoId }, {
    store,
    chatId,
    senderNumber: chatId,
    userText: "tolong bersihin to-do beli telur dong"
  });

  assert.strictEqual(step1.toolResult.status, "pending_confirmation");
  assert.ok(step1.toolResult.message.includes("membutuhkan konfirmasi"));
  // Item must NOT be deleted yet!
  assert.strictEqual(store.getTodos(chatId).length, 1);

  // Check pending deletion buffer in store
  const pending = store.getPendingDeletion(chatId);
  assert.ok(pending);
  assert.strictEqual(pending.type, "todo");
  assert.strictEqual(pending.id, todoId);

  // Step 2: User confirms with "ya" or confirmed: true
  const step2 = await executeTool("deleteTodo", { todoId, confirmed: true }, {
    store,
    chatId,
    senderNumber: chatId,
    userText: "ya hapus aja"
  });

  assert.strictEqual(step2.toolResult.success, true);
  assert.strictEqual(store.getTodos(chatId).length, 0); // Now soft-deleted!
  assert.strictEqual(store.getPendingDeletion(chatId), null); // Pending cleared

  // Step 3: undoLastTodo tool restores the soft-deleted todo
  const undoResult = await executeTool("undoLastTodo", {}, {
    store,
    chatId,
    senderNumber: chatId
  });
  assert.strictEqual(undoResult.toolResult.success, true);
  assert.strictEqual(undoResult.toolResult.restoredType, "todo");
  assert.strictEqual(store.getTodos(chatId).length, 1);
  assert.strictEqual(store.getTodos(chatId)[0].task, "Beli telur ayam 1kg");
});




test("LLM Engine: extractCandidateText filters out thought parts and CoT leaks", () => {
  const candidateWithThought = {
    parts: [
      { thought: true, text: "Analyzing the User's Request\n\nRafid says his friends..." },
      { text: "Siap, saya catat feedback mod server Minecraft-nya." }
    ]
  };
  assert.strictEqual(extractCandidateText(candidateWithThought), "Siap, saya catat feedback mod server Minecraft-nya.");

  const candidateOnlyThought = {
    parts: [
      { thought: true, text: "Analyzing the User's Request\n\nThinking trace only..." }
    ]
  };
  assert.strictEqual(extractCandidateText(candidateOnlyThought), "");

  const candidateWithThoughtTag = {
    parts: [
      { text: "<thought>\nAnalyzing query\n</thought>\n\nServer Minecraft online." }
    ]
  };
  assert.strictEqual(extractCandidateText(candidateWithThoughtTag), "Server Minecraft online.");
});

test("LLM Engine: extractCandidateText drops leaked reasoning with tool-result dumps", () => {
  const candidateWaitLeak = {
    parts: [
      {
        text: "Wait, why did deleteTodo with todoId: 3 return result: \"\"?\nWait, what did the FIRST deleteTodo return?\nLet's re-read the first deleteTodo tool output carefully!\njson\n{\n  \"deletedId\": 24,\n  \"formattedList\": \"🌄 [To-Do List]\\n_Selamat pagi!_\\n\\n🔴 *[1] Quiz KKA*\",\n  \"remainingCount\": 2,\n  \"success\": true\n}\nAHA!\nLook at the first call:\ncall:default_api:deleteTodo{confirmed: true, taskQuery: \"Tugas ROA\"}\nThe response was:\ndeletedId: 24"
      }
    ]
  };
  assert.strictEqual(extractCandidateText(candidateWaitLeak), "");

  const candidateFingerprint = {
    parts: [
      {
        text: "Hmm the response was empty.\n{\n  \"success\": true,\n  \"formattedList\": \"🌄 [To-Do List]\"\n}"
      }
    ]
  };
  assert.strictEqual(extractCandidateText(candidateFingerprint), "");

  // A genuine reply that merely follows a reasoning preamble must still be salvaged.
  const candidateSalvage = {
    parts: [
      {
        text: "Wait, I need to confirm first.\n\nAda 2 to-do yang terlewat, yakin mau dihapus?"
      }
    ]
  };
  assert.strictEqual(extractCandidateText(candidateSalvage), "Ada 2 to-do yang terlewat, yakin mau dihapus?");
});
