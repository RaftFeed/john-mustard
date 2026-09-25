import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function contentSha256(content) {
  return crypto.createHash("sha256").update(content || "", "utf-8").digest("hex");
}

export function getProposalsDir(customDir = null) {
  if (customDir) return path.resolve(customDir);
  if (process.env.SKILL_PROPOSALS_DIR) return path.resolve(process.env.SKILL_PROPOSALS_DIR);
  return path.resolve(path.join("skills", ".proposals"));
}

export function getSkillVersionsDir(skillsDir, name) {
  const cleanName = (name || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  return path.join(skillsDir, cleanName, ".versions");
}

export function readSkillRegistry(skillsDir = "skills") {
  const regPath = path.join(skillsDir, ".skill-registry.json");
  if (!fs.existsSync(regPath)) return {};
  try {
    const raw = fs.readFileSync(regPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export function writeSkillRegistry(skillsDir = "skills", registry = {}) {
  if (!fs.existsSync(skillsDir)) fs.mkdirSync(skillsDir, { recursive: true });
  const regPath = path.join(skillsDir, ".skill-registry.json");
  const tmpPath = `${regPath}.tmp.${process.pid}`;
  fs.writeFileSync(tmpPath, JSON.stringify(registry, null, 2), "utf-8");
  fs.renameSync(tmpPath, regPath);
}

export function recordSkillVersion(name, content, { skillsDir = "skills", source = "manual", previousVersion = null, proposalPath = null } = {}) {
  const cleanName = (name || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  const registry = readSkillRegistry(skillsDir);
  const entry = registry[cleanName] || {};
  const prev = previousVersion !== null ? previousVersion : (entry.version || 0);
  const version = prev + 1;
  const versionsDir = getSkillVersionsDir(skillsDir, cleanName);
  if (!fs.existsSync(versionsDir)) fs.mkdirSync(versionsDir, { recursive: true });

  const verFile = path.join(versionsDir, `v${String(version).padStart(3, "0")}.md`);
  fs.writeFileSync(verFile, content, "utf-8");

  entry.version = version;
  entry.updated_at = new Date().toISOString();
  entry.source = source;
  entry.sha256 = contentSha256(content);
  entry.version_file = verFile;
  if (previousVersion !== null) entry.previous_version = previousVersion;
  if (proposalPath) entry.proposal_path = proposalPath;

  registry[cleanName] = entry;
  writeSkillRegistry(skillsDir, registry);
  return version;
}

export function proposeSkill(name, description, content, { requestedBy = "operator", proposalsDir = null } = {}) {
  const cleanName = (name || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  if (!cleanName) throw new Error("Nama proposal skill tidak boleh kosong.");
  const pDir = getProposalsDir(proposalsDir);
  if (!fs.existsSync(pDir)) fs.mkdirSync(pDir, { recursive: true });

  const proposalPath = path.join(pDir, `${cleanName}.md`);
  const markdown = `---
name: ${cleanName}
description: ${(description || "Proposed skill").trim()}
status: proposed
requested_by: ${requestedBy}
created_at: ${new Date().toISOString()}
---

${(content || "").trim()}
`;
  fs.writeFileSync(proposalPath, markdown, "utf-8");
  return {
    status: "proposed",
    name: cleanName,
    proposalPath
  };
}

export function listSkillProposals({ proposalsDir = null } = {}) {
  const pDir = getProposalsDir(proposalsDir);
  if (!fs.existsSync(pDir)) return { pending: [], rejected: [], approved: [] };

  const entries = fs.readdirSync(pDir);
  const pending = [];
  const rejected = [];
  const approved = [];

  for (const f of entries) {
    const full = path.join(pDir, f);
    if (!fs.statSync(full).isFile()) continue;

    if (f.endsWith(".md")) {
      const txt = fs.readFileSync(full, "utf-8");
      const parsed = parseSkillFromMarkdown(txt, path.basename(f, ".md"));
      pending.push({ file: f, name: parsed.name, description: parsed.description, path: full });
    } else if (f.endsWith(".rejected")) {
      const orig = f.replace(/\.rejected$/, "");
      rejected.push({ file: f, name: orig, path: full });
    } else if (f.endsWith(".approved")) {
      const orig = f.replace(/\.approved$/, "");
      approved.push({ file: f, name: orig, path: full });
    }
  }

  return { pending, rejected, approved };
}

export function approveSkillProposal(nameOrPath, { store = null, skillsDir = "skills", proposalsDir = null } = {}) {
  const pDir = getProposalsDir(proposalsDir);
  let proposalFile = nameOrPath;
  if (!path.isAbsolute(proposalFile) && !fs.existsSync(proposalFile)) {
    const candidate = path.join(pDir, `${nameOrPath.replace(/\.md$/, "")}.md`);
    if (fs.existsSync(candidate)) proposalFile = candidate;
  }
  if (!fs.existsSync(proposalFile)) {
    return { status: "not_found", error: `Proposal file '${nameOrPath}' tidak ditemukan.` };
  }

  const raw = fs.readFileSync(proposalFile, "utf-8");
  const parsed = parseSkillFromMarkdown(raw, path.basename(proposalFile, ".md"));
  const name = parsed.name;

  // Snapshot active skill to .versions if exists
  const activeStandard = path.join(skillsDir, name, "SKILL.md");
  const activeFlat = path.join(skillsDir, `${name}.md`);
  let previousVersion = null;
  const registry = readSkillRegistry(skillsDir);
  const entry = registry[name];
  if (entry && entry.version) previousVersion = entry.version;

  let existingContent = "";
  if (fs.existsSync(activeStandard)) {
    existingContent = fs.readFileSync(activeStandard, "utf-8");
  } else if (fs.existsSync(activeFlat)) {
    existingContent = fs.readFileSync(activeFlat, "utf-8");
  }

  if (existingContent) {
    if (!previousVersion) previousVersion = 1;
    const vDir = getSkillVersionsDir(skillsDir, name);
    if (!fs.existsSync(vDir)) fs.mkdirSync(vDir, { recursive: true });
    const snapFile = path.join(vDir, `v${String(previousVersion).padStart(3, "0")}.md`);
    fs.writeFileSync(snapFile, existingContent, "utf-8");
  }

  // Promote to active standard SKILL.md
  const targetDir = path.join(skillsDir, name);
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
  const targetFile = path.join(targetDir, "SKILL.md");
  const activeMarkdown = serializeSkillToMarkdown(parsed);
  fs.writeFileSync(targetFile, activeMarkdown, "utf-8");

  // Save to DB
  if (store) {
    store.saveSkill(parsed.name, parsed.description, parsed.prompt_template, { skipDisk: true });
  }

  // Record version
  const newVersion = recordSkillVersion(name, activeMarkdown, {
    skillsDir,
    source: "proposal_approval",
    previousVersion,
    proposalPath: proposalFile
  });

  // Mark proposal as approved
  const approvedFile = `${proposalFile}.approved`;
  try { fs.renameSync(proposalFile, approvedFile); } catch {}

  return {
    status: "success",
    skill: name,
    version: newVersion,
    previous_version: previousVersion,
    active_file: targetFile
  };
}

export function rejectSkillProposal(nameOrPath, { reason = "unspecified", proposalsDir = null } = {}) {
  const pDir = getProposalsDir(proposalsDir);
  let proposalFile = nameOrPath;
  if (!path.isAbsolute(proposalFile) && !fs.existsSync(proposalFile)) {
    const candidate = path.join(pDir, `${nameOrPath.replace(/\.md$/, "")}.md`);
    if (fs.existsSync(candidate)) proposalFile = candidate;
  }
  if (!fs.existsSync(proposalFile)) {
    return { status: "not_found", error: `Proposal file '${nameOrPath}' tidak ditemukan.` };
  }

  const raw = fs.readFileSync(proposalFile, "utf-8");
  const rejectedFile = `${proposalFile}.rejected`;
  const header = `<!-- rejected_at: ${new Date().toISOString()} reason: ${reason} -->\n`;
  fs.writeFileSync(rejectedFile, header + raw, "utf-8");
  try { fs.unlinkSync(proposalFile); } catch {}

  return {
    status: "success",
    proposal: proposalFile,
    rejected_file: rejectedFile,
    reason
  };
}

export function listSkillVersions(name, { skillsDir = "skills" } = {}) {
  const cleanName = (name || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  const registry = readSkillRegistry(skillsDir);
  const entry = registry[cleanName];
  if (!entry) {
    return { status: "not_found", error: `Tidak ada riwayat versi untuk skill '${cleanName}'.` };
  }

  const vDir = getSkillVersionsDir(skillsDir, cleanName);
  const archived = [];
  if (fs.existsSync(vDir)) {
    for (const f of fs.readdirSync(vDir)) {
      if (/^v\d{3}\.md$/.test(f)) archived.push(f.replace(/\.md$/, ""));
    }
  }

  return {
    status: "success",
    skill: cleanName,
    active_version: entry.version,
    previous_version: entry.previous_version || null,
    source: entry.source,
    updated_at: entry.updated_at,
    sha256: entry.sha256,
    archived_versions: archived.sort()
  };
}

export function rollbackSkill(name, { toVersion = null, store = null, skillsDir = "skills", rolledBackBy = "operator" } = {}) {
  const cleanName = (name || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  const registry = readSkillRegistry(skillsDir);
  const entry = registry[cleanName];
  if (!entry || !entry.version) {
    return { status: "not_found", error: `Tidak ada riwayat versi untuk skill '${cleanName}'.` };
  }

  const activeVersion = entry.version;
  const vDir = getSkillVersionsDir(skillsDir, cleanName);
  let targetVersion = toVersion;

  if (targetVersion === null) {
    targetVersion = entry.previous_version;
    if (!targetVersion && fs.existsSync(vDir)) {
      const all = fs.readdirSync(vDir)
        .filter((f) => /^v\d{3}\.md$/.test(f))
        .map((f) => parseInt(f.slice(1, 4), 10))
        .filter((v) => v < activeVersion)
        .sort((a, b) => b - a);
      if (all.length > 0) targetVersion = all[0];
    }
  }

  if (!targetVersion) {
    return { status: "not_found", error: `Tidak ada versi sebelumnya yang dapat di-rollback untuk skill '${cleanName}'.` };
  }

  const verFile = path.join(vDir, `v${String(targetVersion).padStart(3, "0")}.md`);
  if (!fs.existsSync(verFile)) {
    return { status: "not_found", error: `Versi v${targetVersion} tidak ditemukan di arsip ${verFile}.` };
  }

  const restoreRaw = fs.readFileSync(verFile, "utf-8");
  const parsed = parseSkillFromMarkdown(restoreRaw, cleanName);

  // Archive current active version before overwriting (reversible rollback!)
  const activeFile = path.join(skillsDir, cleanName, "SKILL.md");
  if (fs.existsSync(activeFile)) {
    const curContent = fs.readFileSync(activeFile, "utf-8");
    const snapCurrent = path.join(vDir, `v${String(activeVersion).padStart(3, "0")}.md`);
    fs.writeFileSync(snapCurrent, curContent, "utf-8");
  }

  // Restore content to active file
  const restoredMarkdown = serializeSkillToMarkdown(parsed);
  fs.writeFileSync(activeFile, restoredMarkdown, "utf-8");

  // Update SQLite
  if (store) {
    store.saveSkill(cleanName, parsed.description, parsed.prompt_template, { skipDisk: true });
  }

  // Update registry
  entry.version = targetVersion;
  entry.updated_at = new Date().toISOString();
  entry.source = `rollback_from_v${activeVersion}`;
  entry.previous_version = activeVersion;
  entry.sha256 = contentSha256(restoredMarkdown);
  entry.rolled_back_by = rolledBackBy;
  registry[cleanName] = entry;
  writeSkillRegistry(skillsDir, registry);

  return {
    status: "success",
    skill: cleanName,
    rolled_back_from: activeVersion,
    active_version: targetVersion,
    message: `Skill '${cleanName}' berhasil di-rollback dari v${activeVersion} ke v${targetVersion}.`
  };
}

/**
 * Serialize a skill object from SQLite to human-readable Markdown with YAML frontmatter.
 */
export function serializeSkillToMarkdown(skill) {
  const name = (skill.name || "unnamed_skill").trim();
  const desc = (skill.description || "").replace(/\r?\n/g, " ").trim();
  const content = (skill.prompt_template || "").trim();

  return `---
name: ${name}
description: ${desc}
---

${content}
`;
}

/**
 * Parse a markdown file with optional YAML frontmatter into a skill object.
 */
export function parseSkillFromMarkdown(rawText = "", fallbackName = "") {
  const trimmed = rawText.trim();
  let name = fallbackName;
  let description = "";
  let template = trimmed;

  const fmMatch = trimmed.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (fmMatch) {
    const frontmatter = fmMatch[1];
    template = (fmMatch[2] || "").trim();

    const nameMatch = frontmatter.match(/^name:\s*(["']?)(.*?)\1\s*$/m);
    if (nameMatch && nameMatch[2]) {
      name = nameMatch[2].trim();
    }

    const descMatch = frontmatter.match(/^description:\s*(["']?)(.*?)\1\s*$/m);
    if (descMatch && descMatch[2]) {
      description = descMatch[2].trim();
    }
  } else {
    // If no frontmatter, extract description from first line if it starts with #
    const lines = trimmed.split(/\r?\n/);
    if (lines.length > 1 && lines[0].startsWith("#")) {
      description = lines[0].replace(/^#+\s*/, "").trim();
      template = lines.slice(1).join("\n").trim();
    }
  }

  const cleanName = (name || fallbackName || "skill")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_");

  return {
    name: cleanName,
    description: description || "Custom skill",
    prompt_template: template
  };
}

/**
 * Discover all skill files (supports flat skills/*.md and agentskills.io standard skills/<name>/SKILL.md)
 */
export function findSkillFiles(skillsDir = "skills") {
  if (!fs.existsSync(skillsDir)) return [];
  const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".md")) {
      results.push({
        filePath: path.join(skillsDir, entry.name),
        fallbackName: path.basename(entry.name, ".md")
      });
    } else if (entry.isDirectory() && !entry.name.startsWith(".")) {
      const subSkill = path.join(skillsDir, entry.name, "SKILL.md");
      if (fs.existsSync(subSkill)) {
        results.push({
          filePath: subSkill,
          fallbackName: entry.name
        });
      }
    }
  }
  return results;
}

/**
 * Write a skill object from DB to a .md file in skillsDir.
 */
export function writeSkillToDisk(skill, skillsDir = "skills") {
  if (!skill || !skill.name) return null;
  if (!fs.existsSync(skillsDir)) {
    fs.mkdirSync(skillsDir, { recursive: true });
  }

  const cleanName = (skill.name || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  const dirPath = path.join(skillsDir, cleanName);
  const standardFilePath = path.join(dirPath, "SKILL.md");
  const flatFilePath = path.join(skillsDir, `${cleanName}.md`);

  // If already organized as directory-based agentskills.io format, keep it there
  const filePath = fs.existsSync(standardFilePath) ? standardFilePath : flatFilePath;
  const content = serializeSkillToMarkdown(skill);

  if (fs.existsSync(filePath)) {
    try {
      const existing = fs.readFileSync(filePath, "utf-8");
      if (existing.trim() === content.trim()) return filePath;
    } catch {}
  }

  fs.writeFileSync(filePath, content, "utf-8");
  return filePath;
}

/**
 * Remove a .md file from disk when deleted from DB.
 */
export function deleteSkillFromDisk(name, skillsDir = "skills") {
  if (!name) return false;
  const cleanName = (name || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  const flatFilePath = path.join(skillsDir, `${cleanName}.md`);
  const standardFilePath = path.join(skillsDir, cleanName, "SKILL.md");

  let deleted = false;
  if (fs.existsSync(flatFilePath)) {
    try {
      fs.unlinkSync(flatFilePath);
      deleted = true;
    } catch {}
  }
  if (fs.existsSync(standardFilePath)) {
    try {
      fs.unlinkSync(standardFilePath);
      try { fs.rmdirSync(path.join(skillsDir, cleanName)); } catch {}
      deleted = true;
    } catch {}
  }
  return deleted;
}

/**
 * Initial synchronization pass:
 * 1. Read all *.md files on disk -> sync to SQLite DB.
 * 2. If DB has skills not yet on disk -> dump to disk.
 */
export function syncDiskToDb(store, skillsDir = "skills") {
  if (!fs.existsSync(skillsDir)) {
    fs.mkdirSync(skillsDir, { recursive: true });
  }

  const skillFiles = findSkillFiles(skillsDir);
  const diskSkillNames = new Set();

  for (const { filePath, fallbackName } of skillFiles) {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const parsed = parseSkillFromMarkdown(content, fallbackName);
      diskSkillNames.add(parsed.name);

      const inDb = store.getSkill(parsed.name);
      if (
        !inDb ||
        inDb.description !== parsed.description ||
        inDb.prompt_template !== parsed.prompt_template
      ) {
        store.saveSkill(parsed.name, parsed.description, parsed.prompt_template, { skipDisk: true });
        console.log(`[SkillsSync] Disk -> DB synced: ${parsed.name}`);
      }
    } catch (err) {
      console.warn(`[SkillsSync] Gagal membaca ${filePath}:`, err.message);
    }
  }

  // Reverse-sync: dump DB skills missing on disk
  const dbSkills = store.getSkills();
  for (const s of dbSkills) {
    if (!diskSkillNames.has(s.name)) {
      writeSkillToDisk(s, skillsDir);
      console.log(`[SkillsSync] DB -> Disk written: ${s.name}.md`);
    }
  }
}

/**
 * Initialize bidirectional 2-Way Sync Engine:
 * - Listens for SQLite mutations -> writes to disk.
 * - Watches disk changes (fs.watch) -> writes to SQLite.
 */
export function initSkillsWatcher(store, skillsDir = "skills") {
  // 1. Initial full sync
  syncDiskToDb(store, skillsDir);

  // 2. Attach DB -> Disk hook
  store.setSkillListener(({ type, skill, name }) => {
    if (type === "save" && skill) {
      writeSkillToDisk(skill, skillsDir);
    } else if (type === "delete" && name) {
      deleteSkillFromDisk(name, skillsDir);
    }
  });

  // 3. Attach Disk -> DB watcher
  let debounceTimer = null;
  const pendingFiles = new Set();

  try {
    const watcher = fs.watch(skillsDir, { recursive: true }, (eventType, filename) => {
      if (!filename || !filename.endsWith(".md")) return;
      pendingFiles.add(filename);

      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        for (const file of pendingFiles) {
          const filePath = path.join(skillsDir, file);
          const isDirSkill = path.basename(file).toLowerCase() === "skill.md";
          const fallbackName = isDirSkill
            ? path.basename(path.dirname(file)).toLowerCase().replace(/[^a-z0-9_-]/g, "_")
            : path.basename(file, ".md").toLowerCase().replace(/[^a-z0-9_-]/g, "_");

          if (fs.existsSync(filePath)) {
            try {
              const content = fs.readFileSync(filePath, "utf-8");
              const parsed = parseSkillFromMarkdown(content, fallbackName);
              const inDb = store.getSkill(parsed.name);

              if (
                !inDb ||
                inDb.description !== parsed.description ||
                inDb.prompt_template !== parsed.prompt_template
              ) {
                store.saveSkill(parsed.name, parsed.description, parsed.prompt_template, { skipDisk: true });
                console.log(`🔄 [SkillsSync] Disk edit detected -> Synced to DB: ${parsed.name}`);
              }
            } catch (err) {
              console.warn(`[SkillsSync] Watcher error reading ${file}:`, err.message);
            }
          } else {
            // File deleted on disk
            const deleted = store.deleteSkill(fallbackName, { skipDisk: true });
            if (deleted > 0) {
              console.log(`🗑️ [SkillsSync] Disk file deleted -> Removed from DB: ${fallbackName}`);
            }
          }
        }
        pendingFiles.clear();
      }, 250);
    });

    return watcher;
  } catch (err) {
    console.warn("[SkillsSync] fs.watch not supported or failed:", err.message);
    return null;
  }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("src/skills_sync.js")) {
  import("node:assert").then(async ({ default: assert }) => {
    import("./db.js").then(async ({ Storage }) => {
      const tmpDir = path.join("test_skills_dir_" + Date.now());

      try {
        const store = new Storage(":memory:");

        // 1. Serialization & Parsing tests
        const sampleSkill = {
          name: "auto_rekap_pagi",
          description: "Rangkum jadwal kuliah jam 8",
          prompt_template: "Ambil listTodos dan filter #kuliah."
        };
        const mdText = serializeSkillToMarkdown(sampleSkill);
        assert.ok(mdText.includes("name: auto_rekap_pagi"));
        assert.ok(mdText.includes("description: Rangkum jadwal kuliah jam 8"));
        assert.ok(mdText.includes("Ambil listTodos dan filter #kuliah."));

        const parsed = parseSkillFromMarkdown(mdText, "auto_rekap_pagi");
        assert.strictEqual(parsed.name, "auto_rekap_pagi");
        assert.strictEqual(parsed.description, "Rangkum jadwal kuliah jam 8");
        assert.strictEqual(parsed.prompt_template, "Ambil listTodos dan filter #kuliah.");

        // Fallback without frontmatter
        const noFm = parseSkillFromMarkdown("# Ringkas Tugas\nInstruksi tanpa frontmatter.", "fallback_skill");
        assert.strictEqual(noFm.name, "fallback_skill");
        assert.strictEqual(noFm.description, "Ringkas Tugas");
        assert.strictEqual(noFm.prompt_template, "Instruksi tanpa frontmatter.");

        // 2. Disk writing & deletion tests
        const writtenPath = writeSkillToDisk(sampleSkill, tmpDir);
        assert.ok(fs.existsSync(writtenPath));

        const contentOnDisk = fs.readFileSync(writtenPath, "utf-8");
        assert.ok(contentOnDisk.includes("auto_rekap_pagi"));

        // 3. syncDiskToDb test
        syncDiskToDb(store, tmpDir);
        const inDb = store.getSkill("auto_rekap_pagi");
        assert.ok(inDb);
        assert.strictEqual(inDb.name, "auto_rekap_pagi");
        assert.strictEqual(inDb.description, "Rangkum jadwal kuliah jam 8");

        // 4. Reverse sync test (DB -> Disk)
        store.saveSkill("rekap_malam", "Rangkum malam", "Prompt malam", { skipDisk: true });
        syncDiskToDb(store, tmpDir);
        assert.ok(fs.existsSync(path.join(tmpDir, "rekap_malam.md")));

        // 5. Watcher test
        const watcher = initSkillsWatcher(store, tmpDir);
        assert.ok(watcher !== undefined);

        // Test DB mutation triggers disk write
        store.saveSkill("skill_baru_db", "Desc baru", "Prompt baru");
        assert.ok(fs.existsSync(path.join(tmpDir, "skill_baru_db.md")));

        // Test DB deletion triggers disk delete
        store.deleteSkill("skill_baru_db");
        assert.strictEqual(fs.existsSync(path.join(tmpDir, "skill_baru_db.md")), false);

        // 6. agentskills.io standard subfolder test (skills/<name>/SKILL.md)
        const subDir = path.join(tmpDir, "expert_math");
        fs.mkdirSync(subDir, { recursive: true });
        fs.writeFileSync(
          path.join(subDir, "SKILL.md"),
          "---\nname: expert_math\ndescription: Solusi kalkulasi math kompleks\n---\n\nInstruksi math.",
          "utf-8"
        );
        syncDiskToDb(store, tmpDir);
        const mathSkill = store.getSkill("expert_math");
        assert.ok(mathSkill);
        assert.strictEqual(mathSkill.description, "Solusi kalkulasi math kompleks");

        // 7. Proposals, Versioning & Audit Rollback tests
        const propDir = path.join(tmpDir, ".proposals");
        const prop = proposeSkill("data_audit", "Analisis audit data", "Langkah 1: cek DB", {
          requestedBy: "tester",
          proposalsDir: propDir
        });
        assert.strictEqual(prop.status, "proposed");
        assert.ok(fs.existsSync(prop.proposalPath));

        const propList = listSkillProposals({ proposalsDir: propDir });
        assert.strictEqual(propList.pending.length, 1);
        assert.strictEqual(propList.pending[0].name, "data_audit");

        const approved = approveSkillProposal("data_audit", {
          store,
          skillsDir: tmpDir,
          proposalsDir: propDir
        });
        assert.strictEqual(approved.status, "success");
        assert.strictEqual(approved.version, 1);
        assert.ok(store.getSkill("data_audit"));

        // Update skill to create v2
        const v2 = recordSkillVersion("data_audit", "---\nname: data_audit\ndescription: Analisis audit data v2\n---\n\nLangkah v2", {
          skillsDir: tmpDir,
          source: "test_update",
          previousVersion: 1
        });
        assert.strictEqual(v2, 2);

        const vList = listSkillVersions("data_audit", { skillsDir: tmpDir });
        assert.strictEqual(vList.status, "success");
        assert.strictEqual(vList.active_version, 2);
        assert.ok(vList.archived_versions.includes("v001"));

        // Rollback to v1
        const rolled = rollbackSkill("data_audit", {
          toVersion: 1,
          store,
          skillsDir: tmpDir
        });
        assert.strictEqual(rolled.status, "success");
        assert.strictEqual(rolled.active_version, 1);
        assert.strictEqual(rolled.rolled_back_from, 2);

        if (watcher && typeof watcher.close === "function") {
          watcher.close();
        }

        console.log("SkillsSync module self-test OK");
      } finally {
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {}
      }
    });
  });
}
