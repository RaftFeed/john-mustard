import test from "node:test";
import assert from "node:assert";
import { tickScheduler, getActiveTimersCount, clearActiveTimers } from "../src/scheduler.js";

test("Scheduler: tickScheduler handles overdue reminders, near-horizon scheduling, and overdue todos", async () => {
  const sentMessages = [];
  const mockSender = async (chatId, text) => {
    sentMessages.push({ chatId, text });
  };

  const now = Date.now();
  const reminders = [
    { id: 1, chat_id: "user1", message: "Reminder Overdue", remind_at: now - 5000, status: "pending" },
    { id: 2, chat_id: "user1", message: "Reminder Near", remind_at: now + 80, status: "pending" },
    { id: 3, chat_id: "user1", message: "Reminder Far", remind_at: now + 3600_000, status: "pending" }
  ];

  const mockStore = {
    claimReminder(id) {
      const r = reminders.find((item) => item.id === id);
      if (r && r.status === "pending") {
        r.status = "claimed";
        return true;
      }
      return false;
    },
    markReminderDone(id) {
      const r = reminders.find((item) => item.id === id);
      if (r) r.status = "sent";
    },
    getPendingReminders() {
      const t = Date.now();
      return reminders.filter((r) => r.status === "pending" && r.remind_at <= t);
    },
    getNearHorizonReminders(horizonMs) {
      const t = Date.now();
      return reminders.filter((r) => r.status === "pending" && r.remind_at > t && r.remind_at <= t + horizonMs);
    },
    getReminderById(id) {
      return reminders.find((r) => r.id === id);
    },
    getPendingTodoDeadlines() {
      return [{ id: 99, chat_id: "user1", task: "PR Tes Deadline" }];
    },
    markTodoReminded(id) {
      return id === 99 ? 1 : 0;
    }
  };

  const tickResult = await tickScheduler(mockStore, { textSender: mockSender });
  assert.strictEqual(tickResult.ticked, true);
  assert.strictEqual(tickResult.sent, 2); // 1 overdue reminder + 1 overdue todo
  assert.strictEqual(reminders[0].status, "sent");
  assert.strictEqual(getActiveTimersCount(), 1); // #2 is scheduled in near horizon

  // Wait for near-horizon timer to fire
  await new Promise((r) => setTimeout(r, 120));
  assert.strictEqual(reminders[1].status, "sent");
  assert.strictEqual(getActiveTimersCount(), 0);
  assert.strictEqual(sentMessages.length, 3);

  clearActiveTimers();
});
