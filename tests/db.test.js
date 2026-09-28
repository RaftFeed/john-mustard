import test from "node:test";
import assert from "node:assert";
import { Storage, formatTodoList, formatTodoDetail, formatPersonList, formatFeatureRequestsList, formatRemindersList, parseWibDayRange } from "../src/db.js";

test("Storage: in-memory DB operations (todos, contacts, dedup, cooldown)", () => {
  const store = new Storage(":memory:");

  // Dedup test
  assert.strictEqual(store.isMessageDuplicate("msg_1"), false);
  assert.strictEqual(store.isMessageDuplicate("msg_1"), true);
  assert.strictEqual(store.isMessageDuplicate("msg_2"), false);

  // Model cooldown test
  assert.strictEqual(store.isModelCooling("gemini-test"), false);
  store.setModelCooldown("gemini-test", 5000);
  assert.strictEqual(store.isModelCooling("gemini-test"), true);
  store.clearModelCooldowns();
  assert.strictEqual(store.isModelCooling("gemini-test"), false);

  // Bot settings test
  assert.strictEqual(store.getSetting("test_key", "default_val"), "default_val");
  store.setSetting("test_key", "saved_val");
  assert.strictEqual(store.getSetting("test_key"), "saved_val");

  // Todo CRUD & Overdue test
  const id1 = store.addTodo("user1", "Belajar Node.js", Date.now() + 3600_000, "#coding");
  assert.ok(id1 > 0);
  const todos = store.getTodos("user1");
  assert.strictEqual(todos.length, 1);
  assert.strictEqual(todos[0].task, "Belajar Node.js");

  // Overdue task test
  const overdueId = store.addTodo("user1", "Tugas Terlewat", Date.now() - 3600_000);
  const overdueList = store.getTodos("user1");
  const formattedOverdue = formatTodoList(overdueList);
  assert.ok(formattedOverdue.includes("[TERLEWAT]"));
  assert.ok(formattedOverdue.includes("🔴"));

  // getPendingTodoDeadlines & markTodoReminded
  const pending = store.getPendingTodoDeadlines();
  assert.ok(pending.some((t) => t.id === overdueId));
  assert.strictEqual(store.markTodoReminded(overdueId), 1);
  const pendingAfter = store.getPendingTodoDeadlines();
  assert.ok(!pendingAfter.some((t) => t.id === overdueId));

  // Contacts test (default loaded from config/contacts.json)
  const persons = store.listPersons();
  assert.ok(persons.length >= 1, "Expected at least 1 default profile loaded");
  assert.ok(persons.some((p) => p.name === "Rafid"));

  // Event reminders with 1h default and custom offset
  const futureEventAt = Date.now() + 7200_000; // 2 hours later
  const evId1 = store.addReminder("user1", "Rapat Kerja", null, null, "reminder", futureEventAt);
  const ev1 = store.getReminderById(evId1);
  assert.strictEqual(ev1.event_at, futureEventAt);
  assert.strictEqual(ev1.remind_at, futureEventAt - 3600_000); // 1h before

  // Custom reminder offset (e.g. 30 min before)
  const customRemindAt = futureEventAt - 1800_000;
  const evId2 = store.addReminder("user1", "Kuliah AI", customRemindAt, null, "reminder", futureEventAt);
  const ev2 = store.getReminderById(evId2);
  assert.strictEqual(ev2.event_at, futureEventAt);
  assert.strictEqual(ev2.remind_at, customRemindAt);

  // Event < 1h away sets remind_at to now
  const nearEventAt = Date.now() + 1800_000;
  const evId3 = store.addReminder("user1", "Mepet Banget", null, null, "reminder", nearEventAt);
  const ev3 = store.getReminderById(evId3);
  assert.strictEqual(ev3.event_at, nearEventAt);
  assert.ok(ev3.remind_at <= Date.now());

  // advanceReminderToEventTime
  assert.strictEqual(store.advanceReminderToEventTime(evId1, futureEventAt), true);
  const advancedEv1 = store.getReminderById(evId1);
  assert.strictEqual(advancedEv1.remind_at, futureEventAt);
  assert.strictEqual(advancedEv1.status, "pending");
});

test("Storage: listReminders and getTodos date filtering with WIB range", () => {
  const store = new Storage(":memory:");

  // Monday: 2026-09-28
  const mondayRange = parseWibDayRange("2026-09-28");
  assert.ok(mondayRange);
  assert.strictEqual(mondayRange.dateStr, "2026-09-28");

  // Tuesday: 2026-09-29
  const tuesdayRange = parseWibDayRange("2026-09-29");

  const monday10Wib = new Date("2026-09-28T10:00:00+07:00").getTime();
  const tuesday14Wib = new Date("2026-09-29T14:00:00+07:00").getTime();

  // Add reminders: 1 on Monday, 1 on Tuesday
  store.addReminder("user1", "Acara Senin", monday10Wib, null, "reminder", monday10Wib);
  store.addReminder("user1", "Acara Selasa", tuesday14Wib, null, "reminder", tuesday14Wib);

  // List all
  const allRems = store.listReminders("user1");
  assert.strictEqual(allRems.length, 2);

  // List Monday only
  const mondayRems = store.listReminders("user1", "2026-09-28");
  assert.strictEqual(mondayRems.length, 1);
  assert.strictEqual(mondayRems[0].message, "Acara Senin");

  // Format Monday list
  const formattedMonday = formatRemindersList(mondayRems, { targetDate: "2026-09-28" });
  assert.ok(formattedMonday.includes("Jadwal Hari Senin, 28 Sep 2026"));
  assert.ok(formattedMonday.includes("Acara Senin"));
  assert.ok(!formattedMonday.includes("Acara Selasa"));

  // Format empty day
  const formattedWednesday = formatRemindersList([], { targetDate: "2026-09-30" });
  assert.ok(formattedWednesday.includes("Tidak ada jadwal acara atau pengingat untuk hari Rabu, 30 Sep 2026"));

  // Add todos: 1 on Monday, 1 on Tuesday
  store.addTodo("user1", "Tugas Senin", monday10Wib, "#tugas");
  store.addTodo("user1", "Tugas Selasa", tuesday14Wib, "#tugas");

  // Filter todos Monday only
  const mondayTodos = store.getTodos("user1", false, null, false, "2026-09-28");
  assert.strictEqual(mondayTodos.length, 1);
  assert.strictEqual(mondayTodos[0].task, "Tugas Senin");

  const formattedTodosMonday = formatTodoList(mondayTodos, false, { targetDate: "2026-09-28" });
  assert.ok(formattedTodosMonday.includes("To-Do List - Senin, 28 Sep 2026"));
  assert.ok(formattedTodosMonday.includes("Tugas Senin"));
  assert.ok(!formattedTodosMonday.includes("Tugas Selasa"));

  const formattedTodosEmpty = formatTodoList([], false, { targetDate: "2026-09-30" });
  assert.ok(formattedTodosEmpty.includes("Tidak ada tugas atau deadline untuk hari Rabu, 30 Sep 2026"));
  assert.ok(formattedTodosEmpty.includes("[To-Do List]"));

  // Delete reminder by visual index (1-based index)
  assert.strictEqual(store.deleteReminder("user1", 1), 1);
  const remainingRems = store.listReminders("user1");
  assert.strictEqual(remainingRems.length, 1);
  assert.strictEqual(remainingRems[0].message, "Acara Selasa");

  // Todo description & formatTodoDetail test
  const promptText = "Tolong bikinin tugas buat koding frontend login page pakai react";
  const descTodoId = store.addTodo("user1", "Koding Frontend Login", monday10Wib, "#react", "work", "Rafid", promptText);
  const fetchedTodo = store.getTodoById(descTodoId);
  assert.strictEqual(fetchedTodo.description, promptText);

  // Visual index 2 resolves to the same task
  const fetchedByVisual = store.getTodoById(2, "user1");
  assert.strictEqual(fetchedByVisual.description, promptText);

  // List brief format does not contain prompt text
  const briefList = formatTodoList([fetchedTodo]);
  assert.ok(briefList.includes("Koding Frontend Login"));
  assert.ok(!briefList.includes(promptText));

  // Detail format contains full prompt text and details
  const detailView = formatTodoDetail(fetchedTodo);
  assert.ok(detailView.includes("Detail Tugas"));
  assert.ok(detailView.includes("Koding Frontend Login"));
  assert.ok(detailView.includes("Prompt / Deskripsi Asli:"));
  assert.ok(detailView.includes(promptText));

  // Update description
  store.updateTodo(descTodoId, null, { description: "Prompt revisi: tambahkan fitur oauth google" });
  const updatedDescTodo = store.getTodoById(descTodoId);
  assert.strictEqual(updatedDescTodo.description, "Prompt revisi: tambahkan fitur oauth google");
});
