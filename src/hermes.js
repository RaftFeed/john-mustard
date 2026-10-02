export async function queryHermesAgent(instruction, options = {}) {
  const baseUrl = options.baseUrl !== undefined ? options.baseUrl : (process.env.HERMES_API_URL || "");
  const apiKey = options.apiKey || process.env.HERMES_API_KEY || "";
  const timeoutMs = options.timeoutMs || parseInt(process.env.HERMES_TIMEOUT_MS || "120000", 10);

  if (!baseUrl) {
    return { success: false, error: "HERMES_API_URL belum dikonfigurasi di .env" };
  }

  const endpoint = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify({
        model: options.model || "hermes-agent",
        messages: [
          {
            role: "system",
            content: "You are an autonomous server management agent on this VPS. Execute commands carefully. If modifying the repository at /home/ubuntu/john-mustard (or repo path), ALWAYS run 'git fetch origin && git pull --rebase origin main' first before making any changes or commits. If a rebase conflict occurs, abort immediately with 'git rebase --abort'. If making commits, push cleanly with 'git push origin main'. Return concise execution summaries and logs."
          },
          {
            role: "user",
            content: instruction
          }
        ],
        temperature: 0.2
      }),
      signal: AbortSignal.timeout(timeoutMs)
    });

    if (!res.ok) {
      const errText = await res.text();
      return { success: false, error: `Hermes HTTP error ${res.status}: ${errText}` };
    }

    const data = await res.json();
    const reply = data?.choices?.[0]?.message?.content || "(Tidak ada output dari Hermes)";
    return { success: true, reply };
  } catch (err) {
    if (err.name === "TimeoutError") {
      return { success: false, error: `Hermes timeout (${timeoutMs / 1000}s) saat menjalankan task.` };
    }
    return { success: false, error: `Hermes connection error: ${err.message}` };
  }
}

export function formatHermesResponse(res) {
  if (!res.success) {
    return `*[HERMES ERROR]* ${res.error}`;
  }
  return `*[HERMES AGENT]*\n${res.reply}`;
}

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
