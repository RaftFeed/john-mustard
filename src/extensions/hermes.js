import { OWNER_PHONE } from "../db.js";

const SELF_UPDATE_REPO = "/home/ubuntu/john-mustard";

export function isTestEnvironment() {
  return process.env.NODE_ENV === "test" ||
    Boolean(process.env.NODE_TEST_CONTEXT) ||
    (Array.isArray(process.execArgv) && process.execArgv.includes("--test")) ||
    (Array.isArray(process.argv) && process.argv.some(a => typeof a === "string" && (a.includes("test") || a.endsWith("commands.js") || a.endsWith("llm.js"))));
}

export function isEnabled() {
  if (process.env.ENABLE_HERMES === "false" || process.env.ENABLE_HERMES === "0") return false;
  if (process.env.ENABLE_HERMES === "true" || process.env.ENABLE_HERMES === "1") return true;
  return Boolean(process.env.HERMES_API_URL) || isTestEnvironment();
}

export function buildSelfUpdatePrompt(instruction) {
  return [
    "Kamu mengerjakan repo John Mustard di VPS ini, path " + SELF_UPDATE_REPO + ".",
    "",
    "TUGAS: " + instruction,
    "",
    "ATURAN KERAS:",
    "0. SYNC SEBELUM KERJA: Sebelum membaca/mengedit kode atau membuat commit, WAJIB jalankan:",
    "   cd " + SELF_UPDATE_REPO + " && git fetch origin && git pull --rebase origin main",
    "   Jika terjadi conflict saat rebase, WAJIB langsung jalankan `git rebase --abort` untuk menjaga repo tetap bersih, JANGAN dipaksa (no force push), dan laporkan conflict tersebut.",
    "1. Baca dulu kode terkait sebelum mengubah apa pun.",
    "2. Edit HANYA file di dalam: src/, tests/, scripts/, skills/, config/, atau system-prompt.md.",
    "3. DILARANG menyentuh: .env, docker-compose.yml, key-oracle/, 9router-data/, oauth_session_vps.json, dan semua file *.bak-*.",
    "4. Setelah selesai, WAJIB jalankan test gate ini dan tempel hasilnya:",
    "   cd " + SELF_UPDATE_REPO + " && docker run --rm -v $PWD:/app -w /app node:24-slim sh -c 'node --test tests/*.test.js'",
    "5. JIKA MEMBUAT COMMIT: Pastikan test gate lulus, lalu push ke remote: `git push origin main`.",
    "6. JANGAN restart container apa pun. Deploy dilakukan terpisah lewat script deploy.",
    "7. Laporan akhir (ringkas, bahasa Indonesia): daftar file yang diubah, ringkasan diff, status push git, dan hasil test (lulus/gagal + jumlah test)."
  ].join("\n");
}

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

export const toolDeclarations = [
  {
    name: "manageRemoteServer",
    description: "Jalankan perintah administrasi atau diagnosa server VPS / Minecraft via Hermes Agent (cek log docker, restart container, cek disk/load). Khusus owner. WAJIB dan HANYA panggil jika pengguna secara eksplisit menyebut kata 'hermes' atau 'vps'.",
    parameters: {
      type: "OBJECT",
      properties: {
        instruction: {
          type: "STRING",
          description: "Instruksi teknis yang ingin didelegasikan ke Hermes Agent di VPS (contoh: 'cek docker logs mc-paper-geyser --tail 50' atau 'cek free -m')"
        }
      },
      required: ["instruction"]
    }
  }
];

export async function executeTool(name, args, ctx) {
  if (name !== "manageRemoteServer") return undefined;
  const { isOwner, chatId, senderNumber, userText } = ctx;
  const ownerNum = ctx.OWNER_PHONE || OWNER_PHONE || "6285236467838";

  const ownerCheck = typeof isOwner === "function" ? isOwner(chatId, senderNumber) : Boolean(isOwner);
  if (!ownerCheck) {
    return {
      toolResult: { error: `Fitur manageRemoteServer hanya khusus untuk nomor owner (+${ownerNum}).` },
      formattedList: null
    };
  }

  if (userText && !/\b(?:hermes|vps)\b/i.test(userText)) {
    return {
      toolResult: {
        error: "Tool manageRemoteServer HANYA boleh dipanggil jika pengguna secara eksplisit menyebut kata 'hermes' atau 'vps' dalam pesan. Untuk server biasa, gunakan checkServerHealth atau checkMinecraftServer."
      },
      formattedList: null
    };
  }

  const res = await queryHermesAgent(args.instruction);
  if (!res.success) {
    return {
      toolResult: { success: false, error: res.error },
      formattedList: null
    };
  }

  const formattedList = `*[HERMES VPS]*\n${res.reply}`;
  return {
    toolResult: {
      success: true,
      instruction: args.instruction,
      output: res.reply
    },
    formattedList
  };
}

export function matchFastCommand(trimmed = "") {
  const selfUpdateMatch = trimmed.match(/^#selfupdate\s+([\s\S]+)$/i);
  if (selfUpdateMatch) {
    return { type: "selfupdate", instruction: selfUpdateMatch[1].trim() };
  }

  const deployMatch = trimmed.match(/^#deploy(\s+status)?$/i);
  if (deployMatch) {
    return { type: "deploy", status: Boolean(deployMatch[1]) };
  }

  if (/^#(vps|hermes)\b/i.test(trimmed)) {
    const instruction = trimmed.replace(/^#(vps|hermes)\s*/i, "").trim();
    return { type: "hermes", instruction };
  }

  return null;
}

export async function executeFastCommand(cmd, ctx) {
  const { isOwner } = ctx;
  const ownerNum = ctx.OWNER_PHONE || OWNER_PHONE || "6285236467838";

  switch (cmd.type) {
    case "selfupdate": {
      if (!isOwner) return `[!] Fitur #selfupdate khusus owner (+${ownerNum}).`;
      if (!cmd.instruction) {
        return "*[Self-Update]*\nFormat: `#selfupdate <instruksi>` (mis. `#selfupdate tambahin perintah #joke`).\nSetelah review, jalankan `#deploy`.";
      }
      const res = await queryHermesAgent(buildSelfUpdatePrompt(cmd.instruction));
      return formatHermesResponse(res);
    }

    case "deploy": {
      if (!isOwner) return `[!] Fitur #deploy khusus owner (+${ownerNum}).`;
      const scriptPath = `${SELF_UPDATE_REPO}/scripts/self-update.sh`;
      const action = cmd.status ? "status" : "deploy";
      const res = await queryHermesAgent(`Jalankan perintah ini di VPS dan laporkan output-nya apa adanya (tanpa menambah komentar): bash ${scriptPath} ${action}`);
      return formatHermesResponse(res);
    }

    case "hermes": {
      if (!isOwner) return `[!] Fitur #vps / #hermes khusus owner (+${ownerNum}).`;
      if (!cmd.instruction) {
        return `*Format Perintah Hermes VPS:*
- #vps <instruksi>
Contoh:
- #vps cek status docker
- #vps restart container mc-paper-geyser
- #vps cek pemakaian ram dan disk`;
      }
      const res = await queryHermesAgent(cmd.instruction);
      return formatHermesResponse(res);
    }

    default:
      return undefined;
  }
}

export function getHelpLines(isOwner) {
  if (!isOwner) return [];
  return [
    "- #selfupdate <instruksi> — Minta Hermes ngedit kode bot (owner). Review dulu, baru #deploy",
    "- #deploy — Deploy perubahan (test gate + restart + auto-rollback); #deploy status buat cek hasil",
    "- #vps / #hermes <instruksi> — Delegasi task atau diagnosa VPS via Hermes Agent"
  ];
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("src/extensions/hermes.js")) {
  import("node:assert").then(async ({ default: assert }) => {
    assert.strictEqual(typeof queryHermesAgent, "function");
    assert.strictEqual(typeof formatHermesResponse, "function");
    assert.strictEqual(typeof buildSelfUpdatePrompt, "function");

    const errFormatted = formatHermesResponse({ success: false, error: "Koneksi timeout" });
    assert.ok(errFormatted.includes("*[HERMES ERROR]*"));

    const okFormatted = formatHermesResponse({ success: true, reply: "Docker restart sukses" });
    assert.ok(okFormatted.includes("*[HERMES AGENT]*"));
    assert.ok(okFormatted.includes("Docker restart sukses"));

    console.log("Hermes extension module self-test OK");
  });
}
