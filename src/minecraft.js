/**
 * Backward compatibility proxy for Minecraft Server Status.
 * Core implementation relocated to src/extensions/minecraft.js.
 */
export {
  getMinecraftStatus,
  formatMinecraftStatus,
  isEnabled as isMinecraftEnabled
} from "./extensions/minecraft.js";

import { getMinecraftStatus, formatMinecraftStatus } from "./extensions/minecraft.js";

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
