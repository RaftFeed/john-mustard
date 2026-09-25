import fs from "node:fs";
import path from "node:path";

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
 * Write a skill object from DB to a .md file in skillsDir.
 */
export function writeSkillToDisk(skill, skillsDir = "skills") {
  if (!skill || !skill.name) return null;
  if (!fs.existsSync(skillsDir)) {
    fs.mkdirSync(skillsDir, { recursive: true });
  }

  const cleanName = (skill.name || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
  const filePath = path.join(skillsDir, `${cleanName}.md`);
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
  const filePath = path.join(skillsDir, `${cleanName}.md`);
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
      return true;
    } catch {}
  }
  return false;
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

  const files = fs.readdirSync(skillsDir).filter((f) => f.endsWith(".md"));
  const diskSkillNames = new Set();

  for (const f of files) {
    const filePath = path.join(skillsDir, f);
    try {
      const fallback = path.basename(f, ".md");
      const content = fs.readFileSync(filePath, "utf-8");
      const parsed = parseSkillFromMarkdown(content, fallback);
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
      console.warn(`[SkillsSync] Gagal membaca ${f}:`, err.message);
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
    const watcher = fs.watch(skillsDir, (eventType, filename) => {
      if (!filename || !filename.endsWith(".md")) return;
      pendingFiles.add(filename);

      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        for (const file of pendingFiles) {
          const filePath = path.join(skillsDir, file);
          const skillName = path.basename(file, ".md").toLowerCase().replace(/[^a-z0-9_-]/g, "_");

          if (fs.existsSync(filePath)) {
            try {
              const content = fs.readFileSync(filePath, "utf-8");
              const parsed = parseSkillFromMarkdown(content, skillName);
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
            const deleted = store.deleteSkill(skillName, { skipDisk: true });
            if (deleted > 0) {
              console.log(`🗑️ [SkillsSync] Disk file deleted -> Removed from DB: ${skillName}`);
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
