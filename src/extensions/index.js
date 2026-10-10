import * as hermesExt from "./hermes.js";
import * as minecraftExt from "./minecraft.js";

export const ALL_EXTENSIONS = [
  hermesExt,
  minecraftExt
];

export function getActiveExtensions() {
  return ALL_EXTENSIONS.filter(ext => {
    try {
      return typeof ext.isEnabled === "function" ? ext.isEnabled() : true;
    } catch {
      return false;
    }
  });
}

export function getExtensionDeclarations() {
  const active = getActiveExtensions();
  const declarations = [];
  for (const ext of active) {
    if (Array.isArray(ext.toolDeclarations)) {
      declarations.push(...ext.toolDeclarations);
    }
  }
  return declarations;
}

export async function executeExtensionTool(name, args, ctx) {
  const active = getActiveExtensions();
  for (const ext of active) {
    if (typeof ext.executeTool === "function") {
      const res = await ext.executeTool(name, args, ctx);
      if (res !== undefined) {
        return res;
      }
    }
  }
  return undefined;
}

export function matchExtensionFastCommand(trimmed = "") {
  const active = getActiveExtensions();
  for (const ext of active) {
    if (typeof ext.matchFastCommand === "function") {
      const match = ext.matchFastCommand(trimmed);
      if (match) {
        return match;
      }
    }
  }
  return null;
}

export async function executeExtensionFastCommand(cmd, ctx) {
  const active = getActiveExtensions();
  for (const ext of active) {
    if (typeof ext.executeFastCommand === "function") {
      const res = await ext.executeFastCommand(cmd, ctx);
      if (res !== undefined) {
        return res;
      }
    }
  }
  return undefined;
}

export function getExtensionHelpSections(isOwner) {
  const active = getActiveExtensions();
  const lines = [];
  for (const ext of active) {
    if (typeof ext.getHelpLines === "function") {
      const extLines = ext.getHelpLines(isOwner);
      if (Array.isArray(extLines) && extLines.length > 0) {
        lines.push(...extLines);
      }
    }
  }
  return lines;
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("src/extensions/index.js")) {
  import("node:assert").then(async ({ default: assert }) => {
    const active = getActiveExtensions();
    assert.ok(Array.isArray(active));

    const decls = getExtensionDeclarations();
    assert.ok(Array.isArray(decls));

    console.log("Extension Registry self-test OK");
  });
}
