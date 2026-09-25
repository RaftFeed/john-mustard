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

if (process.argv[1]?.replace(/\\/g, "/").endsWith("src/minecraft.js")) {
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
    console.log("Minecraft module self-test OK");
  });
}
