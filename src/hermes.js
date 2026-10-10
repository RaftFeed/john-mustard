/**
 * Backward compatibility proxy for Hermes Agent.
 * Core implementation relocated to src/extensions/hermes.js.
 */
export {
  queryHermesAgent,
  formatHermesResponse,
  buildSelfUpdatePrompt,
  isEnabled as isHermesEnabled
} from "./extensions/hermes.js";

import { queryHermesAgent, formatHermesResponse } from "./extensions/hermes.js";

if (process.argv[1]?.replace(/\\/g, "/").endsWith("src/hermes.js")) {
  import("node:assert").then(async ({ default: assert }) => {
    assert.strictEqual(typeof queryHermesAgent, "function");
    assert.strictEqual(typeof formatHermesResponse, "function");

    const errFormatted = formatHermesResponse({ success: false, error: "Koneksi timeout" });
    assert.ok(errFormatted.includes("*[HERMES ERROR]*"));

    const okFormatted = formatHermesResponse({ success: true, reply: "Docker restart sukses" });
    assert.ok(okFormatted.includes("*[HERMES AGENT]*"));
    assert.ok(okFormatted.includes("Docker restart sukses"));

    console.log("Hermes module self-test OK");
  });
}
