import test from "node:test";
import assert from "node:assert";
import { Storage, formatTodoList, formatPersonList, formatFeatureRequestsList } from "../src/db.js";

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
