import { sendText } from "./waha.js";
import { processChat } from "./llm.js";
import { isSimilarReminder } from "./db.js";

export const NEAR_HORIZON_MS = 10 * 60 * 1000; // 10 menit
const activeTimers = new Map(); // id -> NodeJS.Timeout

export function getActiveTimersCount() {
  return activeTimers.size;
}

export function cancelActiveTimer(id) {
  if (activeTimers.has(id)) {
    clearTimeout(activeTimers.get(id));
    activeTimers.delete(id);
    return true;
  }
  return false;
}

export function clearActiveTimers() {
  for (const timer of activeTimers.values()) {
    clearTimeout(timer);
  }
  activeTimers.clear();
}

// ponytail: native setTimeout for sub-second precision on near-horizon items (<= 10m)
export async function executeSingleReminder(store, item, { rotator = null, textSender = sendText } = {}) {
  if (!store || !item) return false;

  // Atomic claim agar tidak bentrok antara tickScheduler & in-memory timer
  if (typeof store.claimReminder === "function") {
    const claimed = store.claimReminder(item.id);
    if (!claimed) return false;
  }

  // Deduplication check: jika pesan serupa sudah dikirim baru-baru ini ke chat yang sama, skip pengiriman
  if (typeof store.hasRecentSentReminder === "function") {
    if (store.hasRecentSentReminder(item.chat_id, item.message, 15 * 60 * 1000)) {
      if (typeof store.markReminderDone === "function") {
        store.markReminderDone(item.id);
      }
      return false;
    }
  }

  try {
    if (item.task_type === "scheduled_action" && rotator) {
      try {
        const reply = await processChat(rotator, item.message, {
          store,
          chatId: item.chat_id,
          onToolCall: () => {}
        });
        if (reply && reply !== "[NO_REPLY]") {
          await textSender(item.chat_id, `*[Jadwal Otomatis]*\n${reply}`);
        }
      } catch (err) {
        console.error(`Scheduled action #${item.id} error:`, err.message);
        await textSender(item.chat_id, `[!] Gagal eksekusi jadwal #${item.id}: ${err.message}`);
      }
    } else {
      const isStage1 = Boolean(item.event_at && item.remind_at < item.event_at && item.event_at > Date.now());
      const daysId = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
      const monthsId = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

      if (isStage1) {
        const eventWib = new Date(item.event_at + 7 * 60 * 60 * 1000);
        const evHours = String(eventWib.getUTCHours()).padStart(2, "0");
        const evMinutes = String(eventWib.getUTCMinutes()).padStart(2, "0");
        const evDayName = daysId[eventWib.getUTCDay()];
        const evDateNum = eventWib.getUTCDate();
        const evMonthName = monthsId[eventWib.getUTCMonth()];
        const evYear = eventWib.getUTCFullYear();
        const diffMinutes = Math.max(0, Math.round((item.event_at - Date.now()) / 60000));
        const timeUntil = diffMinutes >= 60
          ? `${Math.round(diffMinutes / 60)} jam lagi`
          : (diffMinutes > 0 ? `${diffMinutes} menit lagi` : "segera");

        const lines = [
          "⏰ [Pengingat Acara & Agenda]",
          "_Pengingat sebelum acara dimulai!_\n",
          `🔔 *[ACARA] ${item.message}*`,
          `├── Mulai: ${evDayName}, ${evDateNum} ${evMonthName} ${evYear} ${evHours}:${evMinutes} (${timeUntil})`,
          "└── `#acara`"
        ];
        await textSender(item.chat_id, lines.join("\n"));

        // Advance ke Stage 2 (jam acara mulai)
        if (typeof store.advanceReminderToEventTime === "function") {
          store.advanceReminderToEventTime(item.id, item.event_at);
        } else if (typeof store.updateReminderSchedule === "function") {
          store.updateReminderSchedule(item.id, item.event_at);
        } else if (typeof store.updateReminder === "function") {
          store.updateReminder(item.chat_id, item.id, { remindAt: item.event_at });
        }

        if (typeof store.getReminderById === "function") {
          const nextItem = store.getReminderById(item.id);
          if (nextItem) {
            scheduleNearHorizonReminder(store, nextItem, { rotator, textSender });
          }
        }
        return true;
      }

      const nowWib = new Date(Date.now() + 7 * 60 * 60 * 1000);
      const hours = String(nowWib.getUTCHours()).padStart(2, "0");
      const minutes = String(nowWib.getUTCMinutes()).padStart(2, "0");
      const dayName = daysId[nowWib.getUTCDay()];
      const dateNum = nowWib.getUTCDate();
      const monthName = monthsId[nowWib.getUTCMonth()];
      const year = nowWib.getUTCFullYear();

      const isEvent = Boolean(item.event_at || item.task_type === "event");
      const title = isEvent ? "⏰ [Pengingat Acara & Agenda]\n_Waktunya jadwal kegiatan!_\n" : "⏰ [Pengingat]\n_Waktunya pengingat!_\n";
      const badge = isEvent ? "[ACARA]" : "[PENGINGAT]";
      const tag = isEvent ? "`#acara`" : "`#pengingat`";

      const lines = [
        title.trim(),
        "",
        `🔔 *${badge} ${item.message}*`,
        `├── Hari ini (${dayName}, ${dateNum} ${monthName} ${year} ${hours}:${minutes})`,
        `└── ${tag}`
      ];
      await textSender(item.chat_id, lines.join("\n"));
    }

    if (item.recurrence) {
      const nextTime = store.advanceRecurringReminder(item.id, item.recurrence);
      if (nextTime && typeof store.getReminderById === "function") {
        const nextItem = store.getReminderById(item.id);
        if (nextItem) {
          scheduleNearHorizonReminder(store, nextItem, { rotator, textSender });
        }
      }
    } else {
      store.markReminderDone(item.id);
    }
    return true;
  } catch (err) {
    console.error(`Gagal eksekusi reminder #${item.id}:`, err.message);
    if (typeof store.releaseReminder === "function") {
      store.releaseReminder(item.id);
    }
    return false;
  }
}

export function scheduleNearHorizonReminder(store, reminder, { rotator = null, textSender = sendText } = {}) {
  if (!reminder || !reminder.id || typeof reminder.remind_at !== "number") return false;
  if (activeTimers.has(reminder.id)) return false;

  const now = Date.now();
  const delayMs = reminder.remind_at - now;

  // Di luar jendela horizon (misal > 10 menit)
  if (delayMs > NEAR_HORIZON_MS) return false;

  const runDelay = Math.max(0, delayMs);
  const timer = setTimeout(async () => {
    activeTimers.delete(reminder.id);
    await executeSingleReminder(store, reminder, { rotator, textSender });
  }, runDelay);

  activeTimers.set(reminder.id, timer);
  return true;
}

export async function tickScheduler(store, { rotator = null, textSender = sendText } = {}) {
  if (!store) return { ticked: false, sent: 0 };
  const pending = store.getPendingReminders();
  let count = 0;

  // 1. Safety net: eksekusi pending yang overdue atau belum ter-claim dengan batch deduplication
  const processedChatMessages = new Map();
  const dedupedPending = [];

  for (const item of pending) {
    const chatKey = item.chat_id;
    if (!processedChatMessages.has(chatKey)) {
      processedChatMessages.set(chatKey, []);
    }
    const existing = processedChatMessages.get(chatKey);
    const duplicateIdx = existing.findIndex((e) => isSimilarReminder(e.message, item.message));

    if (duplicateIdx >= 0) {
      const prev = existing[duplicateIdx];
      const itemIsEvent = Boolean(item.event_at || item.task_type === "event");
      const prevIsEvent = Boolean(prev.event_at || prev.task_type === "event");

      if (itemIsEvent && !prevIsEvent) {
        if (typeof store.markReminderDone === "function") store.markReminderDone(prev.id);
        const pIdx = dedupedPending.findIndex((p) => p.id === prev.id);
        if (pIdx >= 0) dedupedPending.splice(pIdx, 1);
        existing[duplicateIdx] = item;
        dedupedPending.push(item);
      } else {
        if (typeof store.markReminderDone === "function") store.markReminderDone(item.id);
      }
    } else {
      existing.push(item);
      dedupedPending.push(item);
    }
  }

  for (const item of dedupedPending) {
    cancelActiveTimer(item.id);
    const executed = await executeSingleReminder(store, item, { rotator, textSender });
    if (executed) count++;
  }

  // 2. Scan near-horizon reminders dan daftarkan timer in-memory jika belum terdaftar
  if (typeof store.getNearHorizonReminders === "function") {
    const nearHorizon = store.getNearHorizonReminders(NEAR_HORIZON_MS);
    for (const item of nearHorizon) {
      scheduleNearHorizonReminder(store, item, { rotator, textSender });
    }
  }

  // 3. Scan to-do deadlines approaching within 1 hour (Stage 1: H-1 jam siaga)
  if (typeof store.getPendingTodoEarlyReminders === "function") {
    const earlyTodos = store.getPendingTodoEarlyReminders(3600_000);
    for (const todo of earlyTodos) {
      if (typeof store.markTodoEarlyReminded === "function") {
        const marked = store.markTodoEarlyReminded(todo.id);
        if (!marked) continue;
      }
      try {
        const daysId = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
        const monthsId = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
        const dlWib = new Date(todo.deadline + 7 * 60 * 60 * 1000);
        const dlHours = String(dlWib.getUTCHours()).padStart(2, "0");
        const dlMinutes = String(dlWib.getUTCMinutes()).padStart(2, "0");
        const dlDayName = daysId[dlWib.getUTCDay()];
        const dlDateNum = dlWib.getUTCDate();
        const dlMonthName = monthsId[dlWib.getUTCMonth()];
        const dlYear = dlWib.getUTCFullYear();
        const diffMinutes = Math.max(0, Math.round((todo.deadline - Date.now()) / 60000));
        const timeUntil = diffMinutes >= 60
          ? `${Math.round(diffMinutes / 60)} jam lagi`
          : (diffMinutes > 0 ? `${diffMinutes} menit lagi` : "segera");

        const tagBase = todo.tag ? todo.tag.trim() : "#tugas";
        const tagTokens = tagBase.split(/\s+/).filter(Boolean).map((t) => {
          const clean = t.replace(/^`+|`+$/g, "");
          return clean.startsWith("#") || clean.startsWith("[") ? clean : `#${clean}`;
        });

        const lines = [
          "⏰ [Pengingat Deadline Tugas]",
          "_Tenggat waktu 1 jam lagi!_\n",
          `🟡 *[SEGERA] ${todo.task}*`,
          `├── Tenggat: ${dlDayName}, ${dlDateNum} ${dlMonthName} ${dlYear} ${dlHours}:${dlMinutes} (${timeUntil})`,
          `└── \`${tagTokens.join(" ")}\`\n`,
          `_Tandai selesai: ketik #done ${todo.id}_`
        ];

        await textSender(todo.chat_id, lines.join("\n"));
        count++;
      } catch (err) {
        console.error(`Gagal kirim early reminder deadline to-do #${todo.id}:`, err.message);
      }
    }
  }

  // 4. Scan pending to-do deadlines yang sudah jatuh tempo / overdue (Stage 2)
  if (typeof store.getPendingTodoDeadlines === "function") {
    const dueTodos = store.getPendingTodoDeadlines();
    for (const todo of dueTodos) {
      if (typeof store.markTodoReminded === "function") {
        const marked = store.markTodoReminded(todo.id);
        if (!marked) continue;
      }
      try {
        const daysId = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
        const monthsId = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
        const dlWib = new Date(todo.deadline + 7 * 60 * 60 * 1000);
        const dlHours = String(dlWib.getUTCHours()).padStart(2, "0");
        const dlMinutes = String(dlWib.getUTCMinutes()).padStart(2, "0");
        const dlDayName = daysId[dlWib.getUTCDay()];
        const dlDateNum = dlWib.getUTCDate();
        const dlMonthName = monthsId[dlWib.getUTCMonth()];
        const dlYear = dlWib.getUTCFullYear();

        const tagBase = todo.tag ? todo.tag.trim() : "#tugas";
        const tagTokens = tagBase.split(/\s+/).filter(Boolean).map((t) => {
          const clean = t.replace(/^`+|`+$/g, "");
          return clean.startsWith("#") || clean.startsWith("[") ? clean : `#${clean}`;
        });
        tagTokens.push("[Terlewat]");

        const lines = [
          "⏰ [Pengingat Deadline Tugas]",
          "_Tenggat waktu sudah tiba!_\n",
          `🔴 *[TERLEWAT] ${todo.task}*`,
          `├── Terlewat (${dlDayName}, ${dlDateNum} ${dlMonthName} ${dlYear} ${dlHours}:${dlMinutes})`,
          `└── \`${tagTokens.join(" ")}\`\n`,
          `_Tandai selesai: ketik #done ${todo.id}_`
        ];

        await textSender(todo.chat_id, lines.join("\n"));
        count++;
      } catch (err) {
        console.error(`Gagal kirim reminder deadline to-do #${todo.id}:`, err.message);
      }
    }
  }

  // 5. Auto-delete (soft delete) todos yang sudah selesai (done = 1) dan lewat deadline (deadline <= now)
  if (typeof store.cleanupCompletedOverdueTodos === "function") {
    try {
      store.cleanupCompletedOverdueTodos();
    } catch (err) {
      console.error("Gagal auto-delete completed overdue todos:", err.message);
    }
  }

  return { ticked: true, sent: count };
}

export function startScheduler(store, { rotator = null, intervalMs = 15_000 } = {}) {
  // Langsung scan & prime saat startup
  tickScheduler(store, { rotator }).catch((err) => console.error("Scheduler boot tick error:", err.message));

  return setInterval(async () => {
    try {
      await tickScheduler(store, { rotator });
    } catch (err) {
      console.error("Scheduler error:", err.message);
    }
  }, intervalMs);
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("src/scheduler.js")) {
  import("node:assert").then(async ({ default: assert }) => {
    clearActiveTimers();
    const sentMessages = [];
    const mockSender = async (chatId, text) => {
      sentMessages.push({ chatId, text });
    };

    let reminders = [
      { id: 1, chat_id: "user1", message: "Reminder lewat", remind_at: Date.now() - 5000, status: "pending", recurrence: null, task_type: "reminder" },
      { id: 2, chat_id: "user1", message: "Reminder 100ms", remind_at: Date.now() + 100, status: "pending", recurrence: null, task_type: "reminder" },
      { id: 3, chat_id: "user1", message: "Reminder 1 jam", remind_at: Date.now() + 3600_000, status: "pending", recurrence: null, task_type: "reminder" }
    ];

    const mockStore = {
      claimReminder(id) {
        const item = reminders.find((r) => r.id === id);
        if (!item || item.status !== "pending") return false;
        item.status = "processing";
        return true;
      },
      releaseReminder(id) {
        const item = reminders.find((r) => r.id === id);
        if (item) item.status = "pending";
      },
      markReminderDone(id) {
        const item = reminders.find((r) => r.id === id);
        if (item) item.status = "sent";
      },
      advanceRecurringReminder(id) {
        const item = reminders.find((r) => r.id === id);
        if (item) item.status = "pending";
        return Date.now() + 86400_000;
      },
      getPendingReminders() {
        const now = Date.now();
        return reminders.filter((r) => r.status === "pending" && r.remind_at <= now);
      },
      getNearHorizonReminders(horizonMs) {
        const now = Date.now();
        return reminders.filter((r) => r.status === "pending" && r.remind_at > now && r.remind_at <= now + horizonMs);
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

    // 1. Tick should execute overdue reminder (#1), overdue todo (#99), and schedule near horizon (#2)
    const tickResult = await tickScheduler(mockStore, { textSender: mockSender });
    assert.strictEqual(tickResult.ticked, true);
    assert.strictEqual(tickResult.sent, 2);
    assert.strictEqual(reminders[0].status, "sent");
    assert.strictEqual(getActiveTimersCount(), 1); // #2 is scheduled

    // 2. Far reminder (#3) should not be scheduled in near horizon
    const farScheduled = scheduleNearHorizonReminder(mockStore, reminders[2], { textSender: mockSender });
    assert.strictEqual(farScheduled, false);

    // 3. Wait 150ms for near-horizon timer (#2) to fire
    await new Promise((r) => setTimeout(r, 150));
    assert.strictEqual(reminders[1].status, "sent");
    assert.strictEqual(getActiveTimersCount(), 0);
    assert.strictEqual(sentMessages.length, 3);

    clearActiveTimers();
    console.log("Scheduler near-horizon timers self-test OK");
  });
}
