import test from "node:test";
import assert from "node:assert";
import { parseFastCommand, executeFastCommand, buildSelfUpdatePrompt } from "../src/commands.js";
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

test("Commands: deleteMultiple removes exactly the requested visual numbers (one snapshot)", async () => {
  const store = new Storage(":memory:");
  const ctx = { store, chatId: "user1", isOwner: true, senderNumber: "user1", senderName: "Tester" };

  for (const name of ["T1", "T2", "T3", "T4", "T5", "T6", "T7"]) store.addTodo("user1", name);
  const before = store.getTodos("user1");

  const res = await executeFastCommand({ type: "deleteMultiple", ids: [1, 2, 3, 4], target: "todo" }, ctx);
  assert.ok(res.includes("Berhasil menghapus 4 item"));

  const remaining = store.getTodos("user1");
  assert.deepStrictEqual(remaining.map((t) => t.id), before.slice(4).map((t) => t.id));
});

test("Commands: parseFastCommand parses uncomplete variants", () => {
  assert.strictEqual(parseFastCommand("#unfinish 2").type, "uncomplete");
  assert.strictEqual(parseFastCommand("#unfinish 2").id, 2);
  assert.strictEqual(parseFastCommand("#undone 5").id, 5);
  assert.strictEqual(parseFastCommand("batalin tugas 3").type, "uncomplete");
  assert.strictEqual(parseFastCommand("batalin tugas 3").id, 3);
  assert.strictEqual(parseFastCommand("3 belum selesai").type, "uncomplete");
  assert.strictEqual(parseFastCommand("unfinish 4").id, 4);
});

test("Commands: executeFastCommand uncomplete reverts a finished task", async () => {
  const store = new Storage(":memory:");
  const ctx = { store, chatId: "user1", isOwner: true, senderNumber: "user1", senderName: "Tester" };
  const id = store.addTodo("user1", "Ngerjain laporan");
  store.completeTodo(id, "user1", { rawId: true });
  assert.strictEqual(store.getTodos("user1").length, 0);

  const res = await executeFastCommand({ type: "uncomplete", id: 1 }, ctx);
  assert.ok(res.includes("belum selesai"));
  assert.strictEqual(store.getTodos("user1").length, 1);
});

test("Commands: viewing the to-do list anchors numbering (routine hidden)", async () => {
  const store = new Storage(":memory:");
  const ctx = { store, chatId: "user1", isOwner: true, senderNumber: "user1", senderName: "Tester" };
  store.addTodo("user1", "Absen kuliah", null, null, "routine");
  store.addTodo("user1", "Beli susu");
  const b = store.addTodo("user1", "Bayar listrik");

  const shown = await executeFastCommand({ type: "listTodos" }, ctx);
  assert.ok(shown.includes("Beli susu"));
  assert.ok(!shown.includes("Absen kuliah"));

  // Nomor urut merujuk ke list yang ditampilkan (#2 = Bayar listrik), bukan tugas rutin.
  assert.strictEqual(store.resolveTodoId(2, "user1"), b);
});

test("Commands: parseFastCommand and executeFastCommand handle expanded natural add, list, and doneMultiple", async () => {
  const store = new Storage(":memory:");
  const ctx = { store, chatId: "user1", isOwner: true, senderNumber: "user1", senderName: "Tester" };

  // Natural Add
  const addCmd = parseFastCommand("tambahin tugas Beli telur dan susu");
  assert.strictEqual(addCmd.type, "add");
  assert.strictEqual(addCmd.raw, "Beli telur dan susu");
  const addRes = await executeFastCommand(addCmd, ctx);
  assert.ok(addRes.includes("Beli telur dan susu"));

  const addCmd2 = parseFastCommand("catat ke todo Servis laptop");
  assert.strictEqual(addCmd2.type, "add");
  assert.strictEqual(addCmd2.raw, "Servis laptop");

  // Natural List
  assert.strictEqual(parseFastCommand("list tugas").type, "listTodos");
  assert.strictEqual(parseFastCommand("lihat todo").type, "listTodos");
  assert.strictEqual(parseFastCommand("daftar tugas").type, "listTodos");

  // Multi-done
  const mDone1 = parseFastCommand("1,2,3 done");
  assert.strictEqual(mDone1.type, "doneMultiple");
  assert.deepStrictEqual(mDone1.ids, [1, 2, 3]);

  const mDone2 = parseFastCommand("done 1 2");
  assert.strictEqual(mDone2.type, "doneMultiple");
  assert.deepStrictEqual(mDone2.ids, [1, 2]);

  // Execute doneMultiple
  store.addTodo("user1", "Tugas 2");
  store.addTodo("user1", "Tugas 3");
  const doneRes = await executeFastCommand({ type: "doneMultiple", ids: [1, 2], target: "todo" }, ctx);
  assert.ok(doneRes.includes("2 tugas selesai"));
});

test("Commands: buildSelfUpdatePrompt mandates git pull --rebase, conflict abort, and push origin", () => {
  const prompt = buildSelfUpdatePrompt("tambah perintah #joke");
  assert.ok(prompt.includes("git fetch origin && git pull --rebase origin main"));
  assert.ok(prompt.includes("git rebase --abort"));
  assert.ok(prompt.includes("git push origin main"));
});

test("Commands: executeFastCommand done auto-deletes overdue completed todo and allows undo", async () => {
  const { Storage } = await import("../src/db.js");
  const store = new Storage(":memory:");
  const chatId = "user_auto_del";
  const ctx = { store, chatId };

  // 1. Todo with past deadline
  const tId = store.addTodo(chatId, "Tugas Telat", Date.now() - 3600_000);
  const doneCmd = parseFastCommand(`#done ${tId}`);
  const doneRes = await executeFastCommand(doneCmd, ctx);

  assert.ok(doneRes.includes("selesai & otomatis dihapus karena sudah lewat deadline"));

  // Verify it is marked done AND soft-deleted in DB
  const rawTodo = store.db.prepare("SELECT * FROM todos WHERE id = ?").get(tId);
  assert.strictEqual(rawTodo.done, 1);
  assert.ok(rawTodo.deleted_at);

  // 2. Undo restores the todo
  const undoCmd = parseFastCommand("#undo");
  const undoRes = await executeFastCommand(undoCmd, ctx);
  assert.ok(undoRes.includes("berhasil dipulihkan"));
  const rawRestored = store.db.prepare("SELECT * FROM todos WHERE id = ?").get(tId);
  assert.strictEqual(rawRestored.deleted_at, null);

  // 3. Todo without past deadline (future deadline) -> completed, but NOT deleted
  const tFutureId = store.addTodo(chatId, "Tugas Masa Depan", Date.now() + 3600_000);
  const doneFutureCmd = parseFastCommand(`#done ${tFutureId}`);
  const doneFutureRes = await executeFastCommand(doneFutureCmd, ctx);
  assert.ok(doneFutureRes.includes("[OK] Tugas"));
  assert.ok(!doneFutureRes.includes("otomatis dihapus"));
  const rawFuture = store.db.prepare("SELECT * FROM todos WHERE id = ?").get(tFutureId);
  assert.strictEqual(rawFuture.done, 1);
  assert.strictEqual(rawFuture.deleted_at, null);
});

test("Commands: parseFastCommand and executeFastCommand clearDone deletes completed tasks and supports undo", async () => {
  assert.strictEqual(parseFastCommand("#clear-done").type, "clearDone");
  assert.strictEqual(parseFastCommand("#cleardone").type, "clearDone");
  assert.strictEqual(parseFastCommand("#del-done").type, "clearDone");
  assert.strictEqual(parseFastCommand("yg done apus").type, "clearDone");
  assert.strictEqual(parseFastCommand("Yg udh done apus aja").type, "clearDone");
  assert.strictEqual(parseFastCommand("bersihin yang beres").type, "clearDone");
  assert.strictEqual(parseFastCommand("hapus yang selesai").type, "clearDone");
  assert.strictEqual(parseFastCommand("hapus yg done").type, "clearDone");
  assert.strictEqual(parseFastCommand("hapus tugas yang sudah selesai").type, "clearDone");
  assert.strictEqual(parseFastCommand("semua tugas selesai hapus").type, "clearDone");

  const store = new Storage(":memory:");
  const chatId = "user_clear_cmd";
  const ctx = { store, chatId, isOwner: true, senderNumber: chatId, senderName: "Tester" };

  // Kasus tidak ada tugas selesai
  const noDoneRes = await executeFastCommand({ type: "clearDone" }, ctx);
  assert.ok(noDoneRes.includes("Tidak ada tugas berstatus selesai"));

  // Tambah beberapa tugas
  const t1 = store.addTodo(chatId, "Task 1");
  const t2 = store.addTodo(chatId, "Task 2");
  const t3 = store.addTodo(chatId, "Task 3");
  store.completeTodo(t2, chatId, { rawId: true });
  store.completeTodo(t3, chatId, { rawId: true });

  const clearRes = await executeFastCommand({ type: "clearDone" }, ctx);
  assert.ok(clearRes.includes("Berhasil menghapus 2 tugas"));
  assert.ok(clearRes.includes("#undo"));

  // Check remaining todos
  assert.strictEqual(store.getTodos(chatId, false).length, 1);

  // Undo batch
  const undoRes = await executeFastCommand(parseFastCommand("#undo"), ctx);
  assert.ok(undoRes.includes("Berhasil memulihkan 2 tugas"));
  assert.strictEqual(store.getTodos(chatId, false, null, true).length, 3);
});

test("Commands: Unified Fast Commands CRUD for Vault, Notes, Contacts, Backlogs, and Requests", async () => {
  // 1. Parsing tests
  assert.strictEqual(parseFastCommand("#vault").type, "vaultList");
  assert.strictEqual(parseFastCommand("#vault list").type, "vaultList");
  assert.strictEqual(parseFastCommand("#vault cari steam").type, "vaultSearch");
  assert.strictEqual(parseFastCommand("#vault cari steam").query, "steam");
  assert.strictEqual(parseFastCommand("#vault get 2").type, "vaultGet");
  assert.strictEqual(parseFastCommand("#vault get 2").id, 2);
  assert.strictEqual(parseFastCommand("#vault del 1").type, "vaultDel");
  assert.strictEqual(parseFastCommand("#vault del 1").id, 1);
  assert.strictEqual(parseFastCommand("#vault rename 1 new_file.pdf").type, "vaultRename");
  assert.strictEqual(parseFastCommand("#vault rename 1 new_file.pdf").name, "new_file.pdf");

  assert.strictEqual(parseFastCommand("#notes").type, "noteList");
  assert.strictEqual(parseFastCommand("#note list").type, "noteList");
  assert.strictEqual(parseFastCommand("#note get wifi").type, "noteGet");
  assert.strictEqual(parseFastCommand("#note get wifi").key, "wifi");
  assert.strictEqual(parseFastCommand("#note add wifi sandi123").type, "noteAdd");
  assert.strictEqual(parseFastCommand("#note add wifi sandi123").key, "wifi");
  assert.strictEqual(parseFastCommand("#note add wifi sandi123").content, "sandi123");
  assert.strictEqual(parseFastCommand("#note del wifi").type, "noteDel");
  assert.strictEqual(parseFastCommand("#note del wifi").key, "wifi");

  assert.strictEqual(parseFastCommand("#kontak add Joko | 0812345 | Teman | Teman SMA").type, "contactAdd");
  assert.strictEqual(parseFastCommand("#kontak del Joko").type, "contactDel");
  assert.strictEqual(parseFastCommand("#kontak del Joko").name, "Joko");

  assert.strictEqual(parseFastCommand("#backlog del 3").type, "backlogDel");
  assert.strictEqual(parseFastCommand("#backlog del 3").id, 3);

  assert.strictEqual(parseFastCommand("#request del 4").type, "requestDel");
  assert.strictEqual(parseFastCommand("#request del 4").id, 4);
  assert.strictEqual(parseFastCommand("#fr del 4").type, "requestDel");

  // 2. Execution tests
  const store = new Storage(":memory:");
  const chatId = "6285236467838";
  const ctx = { store, chatId, isOwner: true, senderNumber: chatId, senderName: "Lord Rafid" };

  // Vault execution
  const vId = store.saveVaultFile({
    ownerId: chatId,
    filename: "Steam Promo",
    category: "documents",
    filepath: "vault/documents/promo.pdf",
    mimetype: "application/pdf",
    filesize: 1024,
    summary: "Diskon 50%"
  });

  const vListRes = await executeFastCommand(parseFastCommand("#vault"), ctx);
  assert.ok(vListRes.includes("Steam Promo"));
  assert.ok(vListRes.includes("[1]"));

  const vSearchRes = await executeFastCommand(parseFastCommand("#vault cari steam"), ctx);
  assert.ok(vSearchRes.includes("Steam Promo"));

  const vRenameRes = await executeFastCommand(parseFastCommand("#vault rename 1 Steam Sale Summer"), ctx);
  assert.ok(vRenameRes.includes("berhasil diupdate"));
  assert.strictEqual(store.getVaultFileById(vId).filename, "Steam Sale Summer");

  const vDelRes = await executeFastCommand(parseFastCommand("#vault del 1"), ctx);
  assert.ok(vDelRes.includes("berhasil dihapus"));
  assert.strictEqual(store.listVaultFiles(chatId).length, 0);

  // Undo vault
  const undoRes = await executeFastCommand(parseFastCommand("#undo"), ctx);
  assert.ok(undoRes.includes("berhasil dipulihkan"));
  assert.strictEqual(store.listVaultFiles(chatId).length, 1);

  // Notes execution
  const noteAddRes = await executeFastCommand(parseFastCommand("#note add wifi sandi123"), ctx);
  assert.ok(noteAddRes.includes("Catatan 'wifi' berhasil disimpan"));

  const noteGetRes = await executeFastCommand(parseFastCommand("#note get wifi"), ctx);
  assert.ok(noteGetRes.includes("sandi123"));

  const noteListRes = await executeFastCommand(parseFastCommand("#note list"), ctx);
  assert.ok(noteListRes.includes("wifi"));

  const noteDelRes = await executeFastCommand(parseFastCommand("#note del wifi"), ctx);
  assert.ok(noteDelRes.includes("berhasil dihapus"));

  // Contacts execution
  const cAddRes = await executeFastCommand(parseFastCommand("#kontak add Joko | 0812345 | Teman | Teman SMA"), ctx);
  assert.ok(cAddRes.includes("berhasil disimpan"));
  assert.strictEqual(store.getPerson("Joko")?.role, "Teman");

  const cDelRes = await executeFastCommand(parseFastCommand("#kontak del Joko"), ctx);
  assert.ok(cDelRes.includes("berhasil dihapus"));
  assert.strictEqual(store.getPerson("Joko"), null);

  // Backlog Del execution
  const bId = store.addBacklog(chatId, "Ide super");
  const bDelRes = await executeFastCommand(parseFastCommand(`#backlog del ${bId}`), ctx);
  assert.ok(bDelRes.includes("berhasil dihapus"));
  assert.strictEqual(store.getBacklogs(chatId).length, 0);

  // Request Del execution
  const rId = store.addFeatureRequest("628111", "User", "Fitur widget");
  const rDelRes = await executeFastCommand(parseFastCommand(`#request del ${rId}`), ctx);
  assert.ok(rDelRes.includes("berhasil dihapus"));
  assert.strictEqual(store.getFeatureRequests().length, 0);
});


