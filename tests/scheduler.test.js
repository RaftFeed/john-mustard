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

test("Scheduler: 2-stage event reminder pings early then pings on event start", async () => {
  const sentMessages = [];
  const mockSender = async (chatId, text) => {
    sentMessages.push({ chatId, text });
  };

  const now = Date.now();
  const eventAt = now + 3600_000; // 1 hour in future
  const eventItem = {
    id: 10,
    chat_id: "user1",
    message: "Rapat Pleno",
    remind_at: now - 1000, // Trigger Stage 1 now
    event_at: eventAt,
    status: "pending"
  };

  const mockStore = {
    claimReminder(id) {
      if (eventItem.id === id && eventItem.status === "pending") {
        eventItem.status = "claimed";
        return true;
      }
      return false;
    },
    advanceReminderToEventTime(id, targetEventAt) {
      if (eventItem.id === id) {
        eventItem.remind_at = targetEventAt;
        eventItem.status = "pending";
        return true;
      }
      return false;
    },
    markReminderDone(id) {
      if (eventItem.id === id) {
        eventItem.status = "sent";
      }
    },
    getPendingReminders() {
      const t = Date.now();
      return eventItem.status === "pending" && eventItem.remind_at <= t ? [eventItem] : [];
    },
    getNearHorizonReminders() {
      return [];
    },
    getReminderById(id) {
      return eventItem.id === id ? eventItem : null;
    },
    getPendingTodoDeadlines() {
      return [];
    }
  };

  // Phase 1 tick (Advance reminder trigger)
  const res1 = await tickScheduler(mockStore, { textSender: mockSender });
  assert.strictEqual(res1.sent, 1);
  assert.strictEqual(eventItem.status, "pending"); // Not done yet!
  assert.strictEqual(eventItem.remind_at, eventAt);
  assert.ok(sentMessages[0].text.includes("Pengingat sebelum acara dimulai"));
  assert.ok(sentMessages[0].text.includes("Rapat Pleno"));

  // Simulate time reaching eventAt
  eventItem.event_at = Date.now() - 500;
  eventItem.remind_at = Date.now() - 500; // Trigger Stage 2
  const res2 = await tickScheduler(mockStore, { textSender: mockSender });
  assert.strictEqual(res2.sent, 1);
  assert.strictEqual(eventItem.status, "sent"); // Now done!
  assert.ok(sentMessages[1].text.includes("Waktunya jadwal kegiatan"));
  assert.ok(sentMessages[1].text.includes("Rapat Pleno"));

  // Phase 3: Regular reminder without event_at
  const regItem = {
    id: 11,
    chat_id: "user1",
    message: "Minum obat batuk",
    remind_at: Date.now() - 500,
    event_at: null,
    status: "pending"
  };
  mockStore.getPendingReminders = () => [regItem];
  mockStore.claimReminder = (id) => (id === 11 ? true : false);
  mockStore.markReminderDone = (id) => { regItem.status = "sent"; };

  const res3 = await tickScheduler(mockStore, { textSender: mockSender });
  assert.strictEqual(res3.sent, 1);
  assert.ok(sentMessages[2].text.includes("[PENGINGAT] Minum obat batuk"));
  assert.ok(sentMessages[2].text.includes("#pengingat"));
  assert.ok(!sentMessages[2].text.includes("[ACARA]"));

  clearActiveTimers();
});

test("Scheduler: deduplicates similar pending reminders in same tick and suppresses double alerts", async () => {
  const sentMessages = [];
  const mockSender = async (chatId, text) => {
    sentMessages.push({ chatId, text });
  };

  const now = Date.now();
  const reminders = [
    {
      id: 29,
      chat_id: "user_dup",
      message: "SMTP 2026 Online Certificate Ceremony",
      remind_at: now - 1000,
      event_at: null,
      task_type: "reminder",
      status: "pending"
    },
    {
      id: 64,
      chat_id: "user_dup",
      message: "Zoom SMTP 2026 Online Certificate Ceremony",
      remind_at: now - 1000,
      event_at: now - 1000,
      task_type: "event",
      status: "pending"
    }
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
      return reminders.filter((r) => r.status === "pending");
    },
    getNearHorizonReminders() {
      return [];
    },
    getReminderById(id) {
      return reminders.find((r) => r.id === id);
    },
    getPendingTodoDeadlines() {
      return [];
    }
  };

  const result = await tickScheduler(mockStore, { textSender: mockSender });
  assert.strictEqual(result.sent, 1);
  assert.strictEqual(sentMessages.length, 1);
  assert.ok(sentMessages[0].text.includes("[ACARA] Zoom SMTP 2026 Online Certificate Ceremony"));
  assert.strictEqual(reminders.find((r) => r.id === 29).status, "sent");
  assert.strictEqual(reminders.find((r) => r.id === 64).status, "sent");

  clearActiveTimers();
});
