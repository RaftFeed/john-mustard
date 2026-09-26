import test from "node:test";
import assert from "node:assert";
import { createDebounceQueue } from "../src/queue.js";

test("ChatQueue: burst debouncing coalesces rapid messages into single payload", async () => {
  const processed = [];
  const fakeHandler = async (msg) => {
    processed.push(msg.body);
  };

  const queue = createDebounceQueue(fakeHandler, 40);
  queue({ from: "chat1", body: "halo", id: "1" });
  queue({ from: "chat1", body: "tolong ingatkan", id: "2" });
  queue({ from: "chat1", body: "besok jam 9", id: "3" });

  await new Promise((r) => setTimeout(r, 90));

  assert.strictEqual(processed.length, 1);
  assert.strictEqual(processed[0], "halo\ntolong ingatkan\nbesok jam 9");
});

test("ChatQueue: mid-turn mailbox injection routes messages while turn is active", async () => {
  const processed = [];
  const midTurnReceived = [];

  const fakeHandler = async (msg) => {
    processed.push(msg.body);
    await new Promise((r) => setTimeout(r, 80));
    if (msg.mailbox && msg.mailbox.length > 0) {
      const steered = msg.mailbox.splice(0, msg.mailbox.length);
      midTurnReceived.push(...steered);
    }
  };

  const queue = createDebounceQueue(fakeHandler, 30);
  queue({ from: "chat2", body: "pesan awal", id: "a" });

  setTimeout(() => {
    queue({ from: "chat2", body: "pesan susulan saat turn jalan", id: "b" });
  }, 50);

  await new Promise((r) => setTimeout(r, 160));

  assert.strictEqual(processed.length, 1);
  assert.strictEqual(midTurnReceived.length, 1);
  assert.strictEqual(midTurnReceived[0].body, "pesan susulan saat turn jalan");
});
