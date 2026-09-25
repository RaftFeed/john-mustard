import { sendText } from "./waha.js";
import { processChat } from "./llm.js";

export async function tickScheduler(store, { rotator = null } = {}) {
  if (!store) return { ticked: false, sent: 0 };
  const pending = store.getPendingReminders();
  let count = 0;
  for (const item of pending) {
    if (item.task_type === "scheduled_action" && rotator) {
      try {
        const reply = await processChat(rotator, item.message, {
          store,
          chatId: item.chat_id,
          onToolCall: () => {}
        });
        if (reply && reply !== "[NO_REPLY]") {
          await sendText(item.chat_id, `🤖 *[Jadwal Otomatis Bot]*\n${reply}`);
        }
      } catch (err) {
        console.error(`Scheduled action #${item.id} error:`, err.message);
        await sendText(item.chat_id, `⚠️ Gagal menjalankan jadwal otomatis #${item.id}: ${err.message}`);
      }
    } else {
      await sendText(item.chat_id, `⏰ *PENGINGAT:*\n${item.message}`);
    }

    if (item.recurrence) {
      store.advanceRecurringReminder(item.id, item.recurrence);
    } else {
      store.markReminderDone(item.id);
    }
    count++;
  }
  return { ticked: true, sent: count };
}

export function startScheduler(store, { rotator = null, intervalMs = 15_000 } = {}) {
  setInterval(async () => {
    try {
      await tickScheduler(store, { rotator });
    } catch (err) {
      console.error("Scheduler error:", err.message);
    }
  }, intervalMs);
}
