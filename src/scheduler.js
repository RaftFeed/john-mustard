import { sendText } from "./waha.js";

export function startScheduler(store, intervalMs = 15_000) {
  setInterval(async () => {
    try {
      const pending = store.getPendingReminders();
      for (const item of pending) {
        await sendText(item.chat_id, `? *PENGINGAT:*\n${item.message}`);
        store.markReminderDone(item.id);
      }
    } catch (err) {
      console.error("Scheduler error:", err.message);
    }
  }, intervalMs);
}
