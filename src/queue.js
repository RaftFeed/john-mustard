import assert from "node:assert";

/**
 * Inbound Debounce Queue (Helmis pattern)
 * Coalesces rapid sequential messages within delayMs (default 1000ms)
 * into a single unified turn before triggering the message handler.
 */
export function createDebounceQueue(handler, delayMs = 1000) {
  const queues = new Map();

  return function enqueue(incoming) {
    if (!incoming || !incoming.from) return;

    // Media messages bypass debounce delay to process immediately
    if (incoming.hasMedia) {
      if (queues.has(incoming.from)) {
        const existing = queues.get(incoming.from);
        clearTimeout(existing.timer);
        queues.delete(incoming.from);
        if (existing.texts.length > 0) {
          existing.msg.body = existing.texts.filter(Boolean).join("\n");
          handler(existing.msg).catch((err) => console.error("Debounce flush error:", err));
        }
      }
      return handler(incoming).catch((err) => console.error("Handler error:", err));
    }

    let entry = queues.get(incoming.from);
    if (!entry) {
      entry = {
        msg: { ...incoming },
        texts: incoming.body ? [incoming.body] : [],
        timer: null
      };
      queues.set(incoming.from, entry);
    } else {
      clearTimeout(entry.timer);
      if (incoming.body) {
        entry.texts.push(incoming.body);
      }
      entry.msg.id = incoming.id;
      entry.msg.timestamp = incoming.timestamp;
    }

    entry.timer = setTimeout(() => {
      queues.delete(incoming.from);
      entry.msg.body = entry.texts.filter(Boolean).join("\n");
      handler(entry.msg).catch((err) => console.error("Debounce handler error:", err));
    }, delayMs);
  };
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("src/queue.js")) {
  const processed = [];
  const fakeHandler = async (msg) => {
    processed.push(msg.body);
  };

  const queue = createDebounceQueue(fakeHandler, 50);

  // Send 3 rapid messages
  queue({ from: "user1", body: "halo", id: "1" });
  queue({ from: "user1", body: "tolong ingatkan", id: "2" });
  queue({ from: "user1", body: "besok jam 9", id: "3" });

  setTimeout(() => {
    assert.strictEqual(processed.length, 1);
    assert.strictEqual(processed[0], "halo\ntolong ingatkan\nbesok jam 9");
    console.log("Queue debounce self-test OK");
  }, 100);
}
