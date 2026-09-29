import assert from "node:assert";
import { parseFastCommand } from "./commands.js";

/**
 * Per-Chat FIFO Queue with 1.0s Burst Debouncing & Mid-Turn Mailbox Steering (Helmis pattern)
 * Coalesces rapid sequential messages within delayMs (default 1000ms),
 * routes follow-up messages during in-flight turns directly to the active turn mailbox,
 * and maintains strict sequential order per chat to prevent race conditions.
 */
export class ChatQueue {
  constructor(handler, delayMs = 1000) {
    this.handler = handler;
    this.delayMs = delayMs;
    this.chats = new Map(); // chatId -> { queue: [], mailbox: null, timer: null, running: false }
  }

  getMailbox(chatId) {
    const entry = this.chats.get(chatId);
    return entry?.mailbox || null;
  }

  enqueue(incoming) {
    if (!incoming || !incoming.from) return;
    const chatId = incoming.from;

    let chat = this.chats.get(chatId);
    if (!chat) {
      chat = {
        queue: [],
        mailbox: null,
        timer: null,
        running: false
      };
      this.chats.set(chatId, chat);
    }

    // 1. Jika turn sedang aktif berjalan di chat ini, rute pesan langsung ke mailbox aktif (Mid-Turn Steering)
    // KECUALI jika pesan adalah Fast Command: tahan di queue agar dieksekusi terpisah & bersih setelah turn selesai
    const cleanBody = (incoming.body || "").replace(/^@\S+\s*/, "").trim();
    const isFast = Boolean(parseFastCommand(cleanBody) || parseFastCommand(incoming.body || ""));
    if (chat.mailbox && !isFast) {
      chat.mailbox.push(incoming);
      return;
    }

    // 2. Jika pesan media, bypass debounce delay
    if (incoming.hasMedia) {
      if (chat.timer) clearTimeout(chat.timer);
      chat.timer = null;
      chat.queue.push(incoming);
      this._processQueue(chatId);
      return;
    }

    // 3. Burst debouncing (1.0s)
    chat.queue.push(incoming);
    if (chat.timer) clearTimeout(chat.timer);

    chat.timer = setTimeout(() => {
      chat.timer = null;
      this._processQueue(chatId);
    }, this.delayMs);
  }

  async _processQueue(chatId) {
    const chat = this.chats.get(chatId);
    if (!chat || chat.running || chat.queue.length === 0) return;

    chat.running = true;

    // Ambil dan gabungkan seluruh batch debounce
    const batch = [...chat.queue];
    chat.queue = [];

    const firstMsg = { ...batch[0] };
    const combinedTexts = batch.map((m) => m.body).filter(Boolean);
    firstMsg.body = combinedTexts.join("\n");
    firstMsg.id = batch[batch.length - 1].id;
    firstMsg.timestamp = batch[batch.length - 1].timestamp;

    // Pasang mailbox aktif selama turn ReAct berlangsung
    const mailbox = [];
    chat.mailbox = mailbox;
    firstMsg.mailbox = mailbox;

    try {
      await this.handler(firstMsg);
    } catch (err) {
      console.error(`ChatQueue error [${chatId}]:`, err.message);
    } finally {
      chat.mailbox = null;
      chat.running = false;

      // Transfer pesan yang masuk di detik-detik akhir turn kembali ke queue
      if (mailbox.length > 0) {
        for (const unconsumed of mailbox) {
          chat.queue.push(unconsumed);
        }
        setTimeout(() => this._processQueue(chatId), 20);
      } else if (chat.queue.length > 0) {
        setTimeout(() => this._processQueue(chatId), 20);
      }
    }
  }
}

// ponytail: per-chat mailbox queue with zero external broker, stdlib map & timers
export function createDebounceQueue(handler, delayMs = 1000) {
  const manager = new ChatQueue(handler, delayMs);
  const enqueueFn = (msg) => manager.enqueue(msg);
  enqueueFn.manager = manager;
  return enqueueFn;
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("src/queue.js")) {
  const processed = [];
  const midTurnReceived = [];

  const fakeHandler = async (msg) => {
    processed.push(msg.body);
    // Simulasi turn lama (80ms)
    await new Promise((r) => setTimeout(r, 80));
    // Simulasi ReAct loop draining mailbox
    if (msg.mailbox && msg.mailbox.length > 0) {
      const steered = msg.mailbox.splice(0, msg.mailbox.length);
      midTurnReceived.push(...steered);
    }
  };

  const queue = createDebounceQueue(fakeHandler, 40);

  // 1. Send 3 rapid messages (debounce coalescence)
  queue({ from: "user1", body: "halo", id: "1" });
  queue({ from: "user1", body: "tolong ingatkan", id: "2" });
  queue({ from: "user1", body: "besok jam 9", id: "3" });

  // 2. Setelah 60ms (turn mulai jalan), kirim mid-turn steering
  setTimeout(() => {
    queue({ from: "user1", body: "eh ganti jam 10 ya", id: "4" });
  }, 60);

  setTimeout(() => {
    assert.strictEqual(processed.length, 1);
    assert.strictEqual(processed[0], "halo\ntolong ingatkan\nbesok jam 9");
    assert.strictEqual(midTurnReceived.length, 1);
    assert.strictEqual(midTurnReceived[0].body, "eh ganti jam 10 ya");
    console.log("Queue debounce & mid-turn mailbox self-test OK");
  }, 200);
}
