import test from "node:test";
import assert from "node:assert";
import { parseFastCommand, executeFastCommand } from "../src/commands.js";
import { Storage } from "../src/db.js";

test("Commands: parseFastCommand parses keywords and prefix commands", () => {
  assert.strictEqual(parseFastCommand("#ping").type, "ping");
  assert.strictEqual(parseFastCommand("#todo").type, "listTodos");
  assert.strictEqual(parseFastCommand("todo").type, "listTodos");
  assert.strictEqual(parseFastCommand("#today").type, "today");
  assert.strictEqual(parseFastCommand("#week").type, "week");
  assert.strictEqual(parseFastCommand("#agenda").type, "reminders");
  assert.strictEqual(parseFastCommand("#done 5").id, 5);
  assert.strictEqual(parseFastCommand("#undo").type, "undo");
  assert.strictEqual(parseFastCommand("#del 3").id, 3);
  assert.strictEqual(parseFastCommand("#add Kerjakan PR #kuliah").raw, "Kerjakan PR #kuliah");
  assert.strictEqual(parseFastCommand("#dew").type, "dew");
  assert.strictEqual(parseFastCommand("#vps cek docker").type, "hermes");
  assert.strictEqual(parseFastCommand("#vps cek docker").instruction, "cek docker");
  assert.strictEqual(parseFastCommand("#hermes status").type, "hermes");
  assert.strictEqual(parseFastCommand("#deploy").type, "deploy");
  assert.strictEqual(parseFastCommand("#deploy").status, false);
  assert.strictEqual(parseFastCommand("#deploy status").status, true);
  assert.strictEqual(parseFastCommand("#selfupdate tambahin perintah #joke").type, "selfupdate");
  assert.strictEqual(parseFastCommand("#selfupdate tambahin perintah #joke").instruction, "tambahin perintah #joke");
  assert.strictEqual(parseFastCommand("halo john"), null);
});

test("Commands: executeFastCommand executes ping, dew, and task commands", async () => {
  const store = new Storage(":memory:");
  const ctx = { store, chatId: "user1", isOwner: true, senderNumber: "user1", senderName: "Tester" };

  const pingRes = await executeFastCommand({ type: "ping" }, ctx);
  assert.ok(pingRes.includes("PONG!"));

  const dewRes = await executeFastCommand({ type: "dew" }, ctx);
  assert.ok(dewRes.includes("DEW DEW DEW"));

  const vpsNonOwner = await executeFastCommand({ type: "hermes", instruction: "cek docker" }, { ...ctx, isOwner: false });
  assert.ok(vpsNonOwner.includes("khusus owner"));

  const deployNonOwner = await executeFastCommand(parseFastCommand("#deploy"), { ...ctx, isOwner: false });
  assert.ok(deployNonOwner.includes("khusus owner"));

  const selfUpdateNonOwner = await executeFastCommand(parseFastCommand("#selfupdate tambah fitur"), { ...ctx, isOwner: false });
  assert.ok(selfUpdateNonOwner.includes("khusus owner"));

  const vpsEmpty = await executeFastCommand({ type: "hermes", instruction: "" }, ctx);
  assert.ok(vpsEmpty.includes("Format Perintah Hermes VPS"));

  const addRes = await executeFastCommand({ type: "add", raw: "Belajar matematika" }, ctx);
  assert.ok(addRes.includes("Tugas #1 dicatat"));

  const listRes = await executeFastCommand({ type: "listTodos" }, ctx);
  assert.ok(listRes.includes("Belajar matematika"));

  const detailRes = await executeFastCommand({ type: "detail", id: 1 }, ctx);
  assert.ok(detailRes.includes("Detail Tugas #1"));
  assert.ok(detailRes.includes("Belajar matematika"));
  assert.ok(detailRes.includes("Prompt / Deskripsi Asli:"));
  assert.ok(detailRes.includes("Belajar matematika"));

  // Natural language fast commands
  const replaceCmd = parseFastCommand("1 bukan matematika tapi fisika");
  assert.strictEqual(replaceCmd.type, "replaceTitle");
  const replaceRes = await executeFastCommand(replaceCmd, ctx);
  assert.ok(replaceRes.includes("Belajar fisika"));

  const moveCmd = parseFastCommand("pindah 1 ke acara");
  assert.strictEqual(moveCmd.type, "moveToReminder");
  const moveRes = await executeFastCommand(moveCmd, ctx);
  assert.ok(moveRes.includes("Berhasil dipindahkan ke agenda/acara"));

  const delCmd = parseFastCommand("hapus 1");
  assert.strictEqual(delCmd.type, "delete");
  const delRes = await executeFastCommand(delCmd, ctx);
  assert.ok(delRes.includes("berhasil dihapus"));
});

test("Commands: parseFastCommand parses explicit target keywords", () => {
  const remDel1 = parseFastCommand("hapus acara 1");
  assert.strictEqual(remDel1.type, "delete");
  assert.strictEqual(remDel1.target, "reminder");
  assert.strictEqual(remDel1.id, 1);

  const remDel2 = parseFastCommand("1 acara apus");
  assert.strictEqual(remDel2.type, "delete");
  assert.strictEqual(remDel2.target, "reminder");
  assert.strictEqual(remDel2.id, 1);

  const todoDel = parseFastCommand("hapus tugas 2");
  assert.strictEqual(todoDel.type, "delete");
  assert.strictEqual(todoDel.target, "todo");
  assert.strictEqual(todoDel.id, 2);

  const remDone = parseFastCommand("acara 1 kelar");
  assert.strictEqual(remDone.type, "done");
  assert.strictEqual(remDone.target, "reminder");
  assert.strictEqual(remDone.id, 1);

  const todoDone = parseFastCommand("tugas 3 beres");
  assert.strictEqual(todoDone.type, "done");
  assert.strictEqual(todoDone.target, "todo");
  assert.strictEqual(todoDone.id, 3);
});

test("Commands: executeFastCommand resolves context between To-Do and Reminder", async () => {
  const store = new Storage(":memory:");
  const chatId = "context_chat";
  const ctx = { store, chatId, isOwner: true, senderNumber: chatId, senderName: "Lord" };

  // Setup: 1 To-Do and 1 Reminder
  store.addTodo(chatId, "LKP Praktikum AI");
  store.addReminder(chatId, "Pasar malam sama Dorime", Date.now() + 86400000);

  assert.strictEqual(store.getTodos(chatId, true).length, 1);
  assert.strictEqual(store.listReminders(chatId).length, 1);

  // Scenario 1: User quotes an Acara list with "1 apus" -> deletes Reminder, NOT Todo
  const quotedAcara = {
    content: "[Daftar Acara & Pengingat]\nSelamat siang!\n\n[1] Pasar malam sama Dorime\n— H-16 (Kam, 15 Okt 2026 17:00)\n  sekali"
  };
  const res1 = await executeFastCommand({ type: "delete", id: 1, target: "auto" }, { ...ctx, quoted: quotedAcara });
  assert.ok(res1.includes("Acara/pengingat #1 berhasil dihapus"));
  assert.strictEqual(store.listReminders(chatId).length, 0); // Reminder deleted
  assert.strictEqual(store.getTodos(chatId, true).length, 1); // Todo remains intact!

  // Re-add reminder for scenario 2
  store.addReminder(chatId, "Meeting Proyek", Date.now() + 86400000);

  // Scenario 2: User quotes a To-Do list with "1 apus" -> deletes Todo, NOT Reminder
  const quotedTodo = {
    content: "🌄 [To-Do List]\nSelamat siang!\n\n🟡 [1] LKP Praktikum AI"
  };
  const res2 = await executeFastCommand({ type: "delete", id: 1, target: "auto" }, { ...ctx, quoted: quotedTodo });
  assert.ok(res2.includes("Tugas #1 berhasil dihapus"));
  assert.strictEqual(store.getTodos(chatId, true).length, 0); // Todo deleted
  assert.strictEqual(store.listReminders(chatId).length, 1); // Reminder remains intact!

  // Re-add todo and setup scenario 3 (Chat history context without quote)
  store.addTodo(chatId, "Beli beras");
  store.saveChatMessage(chatId, "model", "[Daftar Acara & Pengingat]\n[1] Meeting Proyek\n— H-1");

  // User sends "1 apus" without quote, but last bot message was Acara list -> deletes Reminder!
  const res3 = await executeFastCommand({ type: "delete", id: 1, target: "auto" }, ctx);
  assert.ok(res3.includes("Acara/pengingat #1 berhasil dihapus"));
  assert.strictEqual(store.listReminders(chatId).length, 0); // Reminder deleted
  assert.strictEqual(store.getTodos(chatId, true).length, 1); // Todo remains intact!

  // Scenario 4: "1 kelar" on reminder list marks/deletes reminder
  store.addReminder(chatId, "Webinar AI", Date.now() + 86400000);
  store.saveChatMessage(chatId, "model", "[Daftar Acara & Pengingat]\n[1] Webinar AI");
  const res4 = await executeFastCommand({ type: "done", id: 1, target: "auto" }, ctx);
  assert.ok(res4.includes("selesai & dihapus dari agenda"));
  assert.strictEqual(store.listReminders(chatId).length, 0);

  // Scenario 5: Ambiguous "1 apus" when both lists exist and no recent list in history
  const initialTodosCount = store.getTodos(chatId, true).length;
  store.addReminder(chatId, "Acara Wisuda", Date.now() + 86400000);
  // Clear recent chat history with non-list message
  store.saveChatMessage(chatId, "model", "Siap Lord, ada yang bisa dibantu?");

  const resAmbiguous = await executeFastCommand({ type: "delete", id: 1, target: "auto" }, ctx);
  assert.ok(resAmbiguous.includes("Mau hapus nomor #1 dari To-Do List atau dari Daftar Acara?"));
  assert.strictEqual(store.getTodos(chatId, true).length, initialTodosCount);
  assert.strictEqual(store.listReminders(chatId).length, 1);

  // Scenario 6: Explicit command "hapus tugas 1" deletes todo and gives #undo hint
  const resExplicit = await executeFastCommand({ type: "delete", id: 1, target: "todo" }, ctx);
  assert.ok(resExplicit.includes("Tugas #1 berhasil dihapus"));
  assert.ok(resExplicit.includes("#undo"));
  assert.strictEqual(store.getTodos(chatId, true).length, initialTodosCount - 1);

  // Scenario 7: #undo restores recently deleted todo
  const resUndo = await executeFastCommand({ type: "undo" }, ctx);
  assert.ok(resUndo.includes("berhasil dipulihkan"));
  assert.ok(resUndo.includes("Beli beras"));
  assert.strictEqual(store.getTodos(chatId, true).length, initialTodosCount);
});


