import test from "node:test";
import assert from "node:assert";
import { Storage } from "../src/db.js";
import { parseFastCommand, executeFastCommand } from "../src/commands.js";
import { executeTool } from "../src/llm/tools.js";
import { processChat } from "../src/llm.js";

test("Group Isolation: To-Do list is strictly isolated per group without leaking DM todos", () => {
  const store = new Storage(":memory:");
  const ownerDm = "6285236467838@c.us";
  const groupA = "120363029582992016@g.us";
  const groupB = "120363099999999999@g.us";

  // 1. Create personal todo in owner DM
  const dmTodoId = store.addTodo(ownerDm, "Beli kado rahasia Rafid", Date.now() + 3600_000, "#personal", "work", "Rafid");

  // 2. Create group todo in Group A
  const grpTodoId = store.addTodo(groupA, "Beli galon bersama", Date.now() + 3600_000, "#keluarga", "work", "Mas");

  // 3. Query Group A todos -> Must only contain group task
  const grpTodos = store.getTodos(groupA, false);
  assert.strictEqual(grpTodos.length, 1);
  assert.strictEqual(grpTodos[0].task, "Beli galon bersama");

  // 4. Query Group A todos with assignee "Rafid" -> Must NOT leak DM todo
  const grpTodosRafid = store.getTodos(groupA, false, "Rafid");
  assert.ok(!grpTodosRafid.some((t) => t.id === dmTodoId), "Personal DM todo must NOT leak to group even if assignee matches Rafid");
  // Group task assigned to Mas is returned because Mas is Rafid's alias
  assert.strictEqual(grpTodosRafid.length, 1);
  assert.strictEqual(grpTodosRafid[0].id, grpTodoId);

  // 5. Query Group B todos -> Must be empty
  const grpTodosB = store.getTodos(groupB, false);
  assert.strictEqual(grpTodosB.length, 0);

  // 6. Query getTodosDue in Group A -> Must only contain Group A todo
  const dueGroupA = store.getTodosDue(groupA, 1);
  assert.strictEqual(dueGroupA.length, 1);
  assert.strictEqual(dueGroupA[0].task, "Beli galon bersama");

  const dueGroupARafid = store.getTodosDue(groupA, 1, "Rafid");
  assert.ok(!dueGroupARafid.some((t) => t.id === dmTodoId), "getTodosDue must not return DM todos in group");
  assert.strictEqual(dueGroupARafid.length, 1);
  assert.strictEqual(dueGroupARafid[0].id, grpTodoId);

  // 7. getTodoByRealId in Group A cannot retrieve DM todo
  assert.strictEqual(store.getTodoByRealId(dmTodoId, groupA), undefined);
  assert.ok(store.getTodoByRealId(grpTodoId, groupA) !== undefined);

  // 8. DM still sees its own todo (and group tasks assigned to owner)
  const dmTodos = store.getTodos(ownerDm, false);
  assert.ok(dmTodos.some((t) => t.id === dmTodoId));
  assert.ok(dmTodos.some((t) => t.id === grpTodoId));
});

test("Group Isolation: Notes/Knowledge are strictly isolated per group without cross-chat fallback", () => {
  const store = new Storage(":memory:");
  const userDm = "6285236467838@c.us";
  const groupA = "120363029582992016@g.us";
  const groupB = "120363099999999999@g.us";

  // 1. Save private note in DM
  store.saveNote(userDm, "rekening_pribadi", "BCA 1234567890");

  // 2. Query note in Group A -> Must NOT leak via global fallback
  const leakedNote = store.getNote(groupA, "rekening_pribadi");
  assert.strictEqual(leakedNote, null, "Private DM note must not leak into group chat");

  // 3. Save group knowledge in Group A
  store.saveNote(groupA, "wifi_basecamp", "Pass: semangatt123");

  // 4. Query in Group A -> Found
  const grpNote = store.getNote(groupA, "wifi_basecamp");
  assert.ok(grpNote !== null);
  assert.strictEqual(grpNote.content, "Pass: semangatt123");

  // 5. Query in Group B and DM -> Must NOT leak
  assert.strictEqual(store.getNote(groupB, "wifi_basecamp"), null);
  assert.strictEqual(store.getNote(userDm, "wifi_basecamp"), null);

  // 6. listNotes and deleteNote in Group A
  assert.strictEqual(store.listNotes(groupA).length, 1);
  assert.strictEqual(store.listNotes(groupB).length, 0);
  assert.strictEqual(store.listNotes(userDm).length, 1);

  store.deleteNote(groupA, "wifi_basecamp");
  assert.strictEqual(store.listNotes(groupA).length, 0);
  // DM note remains untouched
  assert.strictEqual(store.getNote(userDm, "rekening_pribadi")?.content, "BCA 1234567890");
});

test("Group Security: Fast commands #kontak, #vault, and #whitelist are blocked in groups", async () => {
  const store = new Storage(":memory:");
  const groupA = "120363029582992016@g.us";
  const ctx = {
    store,
    chatId: groupA,
    isOwner: false,
    senderNumber: "6281234567890",
    senderName: "Member"
  };

  // 1. #kontak blocked
  const kontakRes = await executeFastCommand(parseFastCommand("#kontak"), ctx);
  assert.ok(kontakRes.includes("dinonaktifkan di obrolan grup"));

  const kontakAddRes = await executeFastCommand(parseFastCommand("#kontak add Budi | 0812 | Teman"), ctx);
  assert.ok(kontakAddRes.includes("dinonaktifkan di obrolan grup"));

  const kontakDelRes = await executeFastCommand(parseFastCommand("#kontak del Budi"), ctx);
  assert.ok(kontakDelRes.includes("dinonaktifkan di obrolan grup"));

  // 2. #vault blocked
  const vaultRes = await executeFastCommand(parseFastCommand("#vault"), ctx);
  assert.ok(vaultRes.includes("dinonaktifkan di obrolan grup"));

  const vaultSearchRes = await executeFastCommand(parseFastCommand("#vault cari rahasia"), ctx);
  assert.ok(vaultSearchRes.includes("dinonaktifkan di obrolan grup"));

  const vaultGetRes = await executeFastCommand(parseFastCommand("#vault get 1"), ctx);
  assert.ok(vaultGetRes.includes("dinonaktifkan di obrolan grup"));

  // 3. #whitelist blocked
  const whitelistRes = await executeFastCommand(parseFastCommand("#whitelist"), ctx);
  assert.ok(whitelistRes.includes("hanya dapat diakses di obrolan pribadi"));
});

test("Group Security: LLM tools for contacts and vault are blocked in group context", async () => {
  const store = new Storage(":memory:");
  const groupA = "120363029582992016@g.us";
  const toolCtx = {
    store,
    chatId: groupA,
    senderNumber: "6281234567890"
  };

  // 1. listPersons blocked
  const listP = await executeTool("listPersons", {}, toolCtx);
  assert.ok(listP.toolResult.error.includes("dinonaktifkan di obrolan grup"));

  // 2. getPerson blocked
  const getP = await executeTool("getPerson", { name: "Mami" }, toolCtx);
  assert.ok(getP.toolResult.error.includes("dinonaktifkan di obrolan grup"));

  // 3. searchVault blocked
  const sVault = await executeTool("searchVault", { query: "ktp" }, toolCtx);
  assert.ok(sVault.toolResult.error.includes("dinonaktifkan di obrolan grup"));
});

test("Group Security: System prompt in group chats omits coupleContext and whitelist numbers", async () => {
  const store = new Storage(":memory:");
  const groupA = "120363029582992016@g.us";
  const originalFetch = globalThis.fetch;
  let capturedPayload = null;

  try {
    globalThis.fetch = async (url, opts) => {
      capturedPayload = JSON.parse(opts.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: {
              role: "model",
              parts: [{ text: "Halo semuanya di grup!" }]
            }
          }]
        })
      };
    };

    const mockRotator = { execute: async (fn) => fn("test-key") };
    await processChat(mockRotator, "@John Mustard halo bot", {
      store,
      chatId: groupA,
      senderNumber: "6281234567890",
      senderName: "Member"
    });

    assert.ok(capturedPayload, "Request must be sent");
    const sysPrompt = capturedPayload.systemInstruction.parts[0].text;
    assert.strictEqual(sysPrompt.includes("DIREKTORI KOORDINASI PASANGAN & KONTAK KELUARGA:"), false, "System prompt in group must NOT leak personal contacts directory");
    assert.strictEqual(sysPrompt.includes("[DAFTAR WHITELIST AKSES BOT]:"), false, "System prompt in group must NOT leak whitelist phone numbers");
    assert.ok(sysPrompt.includes("ISOLASI DATA & KNOWLEDGE GRUP:"), "System prompt in group must enforce knowledge isolation");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
