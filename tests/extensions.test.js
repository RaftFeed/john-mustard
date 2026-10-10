import test from "node:test";
import assert from "node:assert";
import {
  getActiveExtensions,
  getExtensionDeclarations,
  matchExtensionFastCommand,
  executeExtensionFastCommand,
  getExtensionHelpSections
} from "../src/extensions/index.js";
import { parseFastCommand, executeFastCommand } from "../src/commands.js";
import { TOOLS, executeTool } from "../src/llm/tools.js";

test("Extensions: getActiveExtensions reacts to environment toggles", () => {
  const prevHermes = process.env.ENABLE_HERMES;
  const prevMc = process.env.ENABLE_MINECRAFT;

  try {
    process.env.ENABLE_HERMES = "false";
    process.env.ENABLE_MINECRAFT = "false";

    const active = getActiveExtensions();
    assert.strictEqual(active.length, 0);

    const decls = getExtensionDeclarations();
    assert.strictEqual(decls.length, 0);

    assert.strictEqual(matchExtensionFastCommand("#mc"), null);
    assert.strictEqual(matchExtensionFastCommand("#vps cek"), null);
    assert.strictEqual(parseFastCommand("#mc"), null);
    assert.strictEqual(parseFastCommand("#vps cek"), null);

    const help = getExtensionHelpSections(true);
    assert.strictEqual(help.length, 0);

    // Tools getter reflects empty extension declarations
    const hermesTool = TOOLS[0].functionDeclarations.find(d => d.name === "manageRemoteServer");
    const mcTool = TOOLS[0].functionDeclarations.find(d => d.name === "checkMinecraftServer");
    assert.strictEqual(hermesTool, undefined);
    assert.strictEqual(mcTool, undefined);

    // Re-enable
    process.env.ENABLE_HERMES = "true";
    process.env.ENABLE_MINECRAFT = "true";

    const activeReenabled = getActiveExtensions();
    assert.strictEqual(activeReenabled.length, 2);

    assert.ok(matchExtensionFastCommand("#mc"));
    assert.ok(matchExtensionFastCommand("#vps cek"));
    assert.strictEqual(parseFastCommand("#mc").type, "minecraft");
    assert.strictEqual(parseFastCommand("#vps cek").type, "hermes");

    const reenabledHermesTool = TOOLS[0].functionDeclarations.find(d => d.name === "manageRemoteServer");
    const reenabledMcTool = TOOLS[0].functionDeclarations.find(d => d.name === "checkMinecraftServer");
    assert.ok(reenabledHermesTool);
    assert.ok(reenabledMcTool);
  } finally {
    if (prevHermes !== undefined) process.env.ENABLE_HERMES = prevHermes;
    else delete process.env.ENABLE_HERMES;

    if (prevMc !== undefined) process.env.ENABLE_MINECRAFT = prevMc;
    else delete process.env.ENABLE_MINECRAFT;
  }
});

test("Extensions: dynamic help text injection only shows enabled extensions", async () => {
  const prevHermes = process.env.ENABLE_HERMES;
  const prevMc = process.env.ENABLE_MINECRAFT;

  try {
    process.env.ENABLE_HERMES = "false";
    process.env.ENABLE_MINECRAFT = "false";

    const helpDisabled = await executeFastCommand({ type: "help" }, { isOwner: true });
    assert.strictEqual(helpDisabled.includes("Ekstensi Aktif (Server & Ops)"), false);
    assert.strictEqual(helpDisabled.includes("#vps / #hermes"), false);
    assert.strictEqual(helpDisabled.includes("#mc / #minecraft"), false);

    // Enable Hermes only
    process.env.ENABLE_HERMES = "true";
    process.env.ENABLE_MINECRAFT = "false";

    const helpHermesOnly = await executeFastCommand({ type: "help" }, { isOwner: true });
    assert.strictEqual(helpHermesOnly.includes("Ekstensi Aktif (Server & Ops)"), true);
    assert.strictEqual(helpHermesOnly.includes("#vps / #hermes"), true);
    assert.strictEqual(helpHermesOnly.includes("#mc / #minecraft"), false);
  } finally {
    if (prevHermes !== undefined) process.env.ENABLE_HERMES = prevHermes;
    else delete process.env.ENABLE_HERMES;

    if (prevMc !== undefined) process.env.ENABLE_MINECRAFT = prevMc;
    else delete process.env.ENABLE_MINECRAFT;
  }
});
