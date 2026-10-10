import { OWNER_PHONE } from "../db.js";

export function isTestEnvironment() {
  return process.env.NODE_ENV === "test" ||
    Boolean(process.env.NODE_TEST_CONTEXT) ||
    (Array.isArray(process.execArgv) && process.execArgv.includes("--test")) ||
    (Array.isArray(process.argv) && process.argv.some(a => typeof a === "string" && (a.includes("test") || a.endsWith("commands.js") || a.endsWith("llm.js"))));
}

export function isEnabled() {
  if (process.env.ENABLE_MINECRAFT === "false" || process.env.ENABLE_MINECRAFT === "0") return false;
  if (process.env.ENABLE_MINECRAFT === "true" || process.env.ENABLE_MINECRAFT === "1") return true;
  return Boolean(process.env.MC_HOST || process.env.MINECRAFT_HOST) || isTestEnvironment();
}

export async function getMinecraftStatus(host = process.env.MC_HOST || "168.110.213.231") {
  try {
    const [javaRes, bedrockRes] = await Promise.allSettled([
      fetch(`https://api.mcstatus.io/v2/status/java/${host}:25565`, {
        signal: AbortSignal.timeout(6000)
      }).then((r) => r.json()),
      fetch(`https://api.mcstatus.io/v2/status/bedrock/${host}:19132`, {
        signal: AbortSignal.timeout(6000)
      }).then((r) => r.json())
    ]);

    const java = javaRes.status === "fulfilled" ? javaRes.value : null;
    const bedrock = bedrockRes.status === "fulfilled" ? bedrockRes.value : null;

    const isOnline = Boolean(java?.online || bedrock?.online);
    if (!isOnline) {
      return {
        online: false,
        host,
        message: "Server Minecraft sedang OFFLINE atau tidak merespons."
      };
    }

    const playersOnline = java?.players?.online ?? bedrock?.players?.online ?? 0;
    const playersMax = java?.players?.max ?? bedrock?.players?.max ?? 20;
    const playerList = (java?.players?.list || []).map((p) => p.name_clean || p.name);
    const motd = java?.motd?.clean || bedrock?.motd?.clean || "Server Mabar Bedrock & Java";
    const version = java?.version?.name_clean || bedrock?.version?.name || "Fabric / Geyser";

    return {
      online: true,
      host,
      javaPort: 25565,
      bedrockPort: 19132,
      version,
      motd,
      playersOnline,
      playersMax,
      playerList
    };
  } catch (err) {
    return {
      online: false,
      host,
      error: err.message
    };
  }
}

export function formatMinecraftStatus(status) {
  if (!status.online) {
    return `*[MC SERVER]* Offline (${status.host})`;
  }

  const playersText = status.playerList && status.playerList.length > 0
    ? status.playerList.join(", ")
    : "kosong";

  return `*[MC SERVER]* Online | v${status.version}
• Host: ${status.host} (Java: ${status.javaPort} | Bedrock: ${status.bedrockPort})
• Player: ${status.playersOnline}/${status.playersMax} (${playersText})`;
}

export const toolDeclarations = [
  {
    name: "checkMinecraftServer",
    description: "Cek status server Minecraft / menkrep / mc mabar (Java & Bedrock port 25565/19132), MOTD, versi, dan daftar player yang sedang online. Panggil saat user tanya server Minecraft, mc, menkrep, mabar, atau player online. Khusus owner.",
    parameters: {
      type: "OBJECT",
      properties: {}
    }
  }
];

export async function executeTool(name, args, ctx) {
  if (name !== "checkMinecraftServer") return undefined;
  const { isOwner, chatId, senderNumber } = ctx;
  const ownerNum = ctx.OWNER_PHONE || OWNER_PHONE || "6285236467838";

  const ownerCheck = typeof isOwner === "function" ? isOwner(chatId, senderNumber) : Boolean(isOwner);
  if (!ownerCheck) {
    return {
      toolResult: { error: `Fitur checkMinecraftServer hanya khusus untuk nomor owner (+${ownerNum}).` },
      formattedList: null
    };
  }

  const status = await getMinecraftStatus();
  const formatted = formatMinecraftStatus(status);
  return {
    toolResult: { success: true, status, formatted },
    formattedList: formatted
  };
}

export function matchFastCommand(trimmed = "") {
  if (/^#(mc|minecraft)\b/i.test(trimmed)) {
    return { type: "minecraft" };
  }
  return null;
}

export async function executeFastCommand(cmd, ctx) {
  if (cmd.type !== "minecraft") return undefined;
  const { isOwner } = ctx;
  const ownerNum = ctx.OWNER_PHONE || OWNER_PHONE || "6285236467838";

  if (!isOwner) return `[!] Fitur #mc khusus owner (+${ownerNum}).`;
  const status = await getMinecraftStatus();
  return formatMinecraftStatus(status);
}

export function getHelpLines(isOwner) {
  if (!isOwner) return [];
  return [
    "- #mc / #minecraft — Cek status server Minecraft & player aktif"
  ];
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("src/extensions/minecraft.js")) {
  import("node:assert").then(async ({ default: assert }) => {
    assert.strictEqual(typeof getMinecraftStatus, "function");
    assert.strictEqual(typeof formatMinecraftStatus, "function");
    const formattedMock = formatMinecraftStatus({
      online: true,
      host: "127.0.0.1",
      javaPort: 25565,
      bedrockPort: 19132,
      version: "1.21",
      motd: "Test Server",
      playersOnline: 2,
      playersMax: 20,
      playerList: ["Player1", "Player2"]
    });
    assert.ok(formattedMock.includes("Online"));
    assert.ok(formattedMock.includes("Player1, Player2"));
    console.log("Minecraft extension module self-test OK");
  });
}
