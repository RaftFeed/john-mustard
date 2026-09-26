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
});
