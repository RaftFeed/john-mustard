import os from "node:os";
import fs from "node:fs";
import { formatTodoList, formatBacklogList, formatSkillList, formatPersonList, formatRemindersList } from "./db.js";
import { getMinecraftStatus, formatMinecraftStatus } from "./minecraft.js";
import { listSkillProposals, rollbackSkill } from "./skills_sync.js";

function formatUptime(seconds) {
  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor((seconds % (3600 * 24)) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}

export function parseFastCommand(text = "") {
  const trimmed = text.trim();
  if (!trimmed.startsWith("#") && !trimmed.startsWith("?")) return null;

  if (/^#ping\b/i.test(trimmed)) {
    return { type: "ping" };
  }

  if (/^#(todo|tugas)\b/i.test(trimmed)) {
    return { type: "listTodos" };
  }

  if (/^#today\b/i.test(trimmed)) {
    return { type: "today" };
  }

  if (/^#week\b/i.test(trimmed)) {
    return { type: "week" };
  }

  const doneMatch = trimmed.match(/^#done\s+(\d+)$/i);
  if (doneMatch) {
    return { type: "done", id: parseInt(doneMatch[1], 10) };
  }

  if (/^#undo\b/i.test(trimmed)) {
    return { type: "undo" };
  }

  const delMatch = trimmed.match(/^#(delete|del|hapus)\s+(\d+)$/i);
  if (delMatch) {
    return { type: "delete", id: parseInt(delMatch[2], 10) };
  }

  const updateMatch = trimmed.match(/^#update\s+(\d+)\s+(.+)$/is);
  if (updateMatch) {
    return { type: "update", id: parseInt(updateMatch[1], 10), raw: updateMatch[2].trim() };
  }

  const idOnlyMatch = trimmed.match(/^#(\d+)$/);
  if (idOnlyMatch) {
    return { type: "detail", id: parseInt(idOnlyMatch[1], 10) };
  }

  const addMatch = trimmed.match(/^#(add|catat|tambah)\s+(.+)$/is);
  if (addMatch) {
    return { type: "add", raw: addMatch[2].trim() };
  }

  const dailyMatch = trimmed.match(/^#daily(\s+(1|0|on|off))?$/i);
  if (dailyMatch) {
    const val = dailyMatch[2] ? dailyMatch[2].toLowerCase() : "check";
    return { type: "daily", value: val };
  }

  if (/^#(dew|mustard)\b/i.test(trimmed)) {
    return { type: "dew" };
  }

  if (/^#skills?\b/i.test(trimmed)) {
    return { type: "skills" };
  }

  if (/^#(reminders?|pengingat)\b/i.test(trimmed)) {
    return { type: "reminders" };
  }

  if (/^#(kontak|contacts|directory)\b/i.test(trimmed)) {
    return { type: "contacts" };
  }

  if (/^#proposals?\b/i.test(trimmed)) {
    return { type: "proposals" };
  }

  const rollbackMatch = trimmed.match(/^#rollback\s+([a-zA-Z0-9_-]+)(?:\s+(?:v)?(\d+))?$/i);
  if (rollbackMatch) {
    return {
      type: "rollback",
      name: rollbackMatch[1],
      version: rollbackMatch[2] ? parseInt(rollbackMatch[2], 10) : null
    };
  }

  const backlogMatch = trimmed.match(/^#backlog(\s+(.*))?$/is);
  if (backlogMatch) {
    const sub = (backlogMatch[2] || "").trim();
    const bDoneMatch = sub.match(/^done\s+(\d+)$/i);
    if (!sub || sub.toLowerCase() === "list") {
      return { type: "backlogList" };
    }
    if (bDoneMatch) {
      return { type: "backlogDone", id: parseInt(bDoneMatch[1], 10) };
    }
    return { type: "backlogAdd", idea: sub };
  }

  if (/^#(health|server|sys|system)\b/i.test(trimmed)) {
    return { type: "health" };
  }

  if (/^#(mc|minecraft)\b/i.test(trimmed)) {
    return { type: "minecraft" };
  }

  if (
    trimmed === "?help" ||
    trimmed === "/help" ||
    trimmed === "!help" ||
    trimmed.toLowerCase() === "help" ||
    trimmed.toLowerCase() === "? help" ||
    /^#(help|menu)\b/i.test(trimmed)
  ) {
    return { type: "help" };
  }

  return null;
}

export function formatServerHealth(store) {
  const uptimeSec = os.uptime();
  const nodeUptime = process.uptime();
  const totalMem = (os.totalmem() / 1024 / 1024 / 1024).toFixed(1);
  const freeMem = (os.freemem() / 1024 / 1024 / 1024).toFixed(1);
  const usedMem = (totalMem - freeMem).toFixed(1);
  const memPct = Math.round(((totalMem - freeMem) / totalMem) * 100);

  const procRss = (process.memoryUsage().rss / 1024 / 1024).toFixed(1);
  const cpus = os.cpus();
  const cpuCores = cpus.length;
  const loadAvg = os.loadavg().map((l) => l.toFixed(2)).join(", ");

  let diskInfo = "N/A";
  try {
    if (fs.statfsSync) {
      const rootStat = fs.statfsSync("/");
      const totalDisk = ((rootStat.bsize * rootStat.blocks) / (1024 * 1024 * 1024)).toFixed(1);
      const freeDisk = ((rootStat.bsize * rootStat.bfree) / (1024 * 1024 * 1024)).toFixed(1);
      const usedDisk = (totalDisk - freeDisk).toFixed(1);
      const diskPct = Math.round((usedDisk / totalDisk) * 100);
      diskInfo = `${usedDisk}/${totalDisk} GB (${diskPct}%, sisa ${freeDisk} GB)`;
    }
  } catch {}

  const dbStats = store?.getHealthStats ? store.getHealthStats() : null;
  const dbLine = dbStats ? `\n• DB: ${dbStats.pendingTodos} pending/${dbStats.todos} total | ${dbStats.vault} vault` : "";

  return `*[SERVER HEALTH]*
• Uptime: Host ${formatUptime(uptimeSec)} | Bot ${formatUptime(nodeUptime)}
• CPU: ${cpuCores} vCPU | Load: ${loadAvg}
• RAM: Host ${usedMem}/${totalMem} GB (${memPct}%) | Bot RSS ${procRss} MB
• Disk: ${diskInfo}${dbLine}`;
}

export async function executeFastCommand(cmd, { store, chatId, isOwner = false }) {
  if (!cmd) return null;

  switch (cmd.type) {
    case "ping": {
      const uptime = formatUptime(process.uptime());
      const mem = (process.memoryUsage().rss / 1024 / 1024).toFixed(1);
      const pendingTodos = store ? store.getTodos(chatId, true).length : 0;
      return `PONG!\n• Status: Online (Ready)\n• Uptime: ${uptime}\n• RAM: ${mem} MB\n• Tugas Pending: ${pendingTodos}`;
    }

    case "dew": {
      return "🤠 MY NAME IS JOHN MUSTARDDD DEW DEW DEW 🥀";
    }

    case "listTodos": {
      const todos = store.getTodos(chatId, false);
      return formatTodoList(todos);
    }

    case "today": {
      const todos = store.getTodosDue(chatId, 0);
      if (todos.length === 0) return "*[Tugas Hari Ini]*\nGak ada tugas dengan deadline hari ini. Aman.";
      return `*[Tugas Deadline Hari Ini]*\n\n${formatTodoList(todos)}`;
    }

    case "week": {
      const todos = store.getTodosDue(chatId, 7);
      if (todos.length === 0) return "*[Tugas 7 Hari Ke Depan]*\nGak ada tugas dalam 7 hari ke depan. Santai.";
      return `*[Tugas 7 Hari Ke Depan]*\n\n${formatTodoList(todos)}`;
    }

    case "done": {
      const changed = store.completeTodo(cmd.id, chatId);
      if (changed > 0) {
        return `[OK] Tugas #${cmd.id} selesai. (Ketik #undo kalau mau batalin)`;
      }
      return `[!] Tugas #${cmd.id} gak ketemu atau udah selesai.`;
    }

    case "undo": {
      const restored = store.undoLastDone(chatId);
      if (restored) {
        return `[OK] Tugas #${restored.id} ("${restored.task}") dibalikin jadi pending.`;
      }
      return "[!] Gak ada riwayat tugas yang baru ditandai selesai.";
    }

    case "delete": {
      const changed = store.deleteTodo(cmd.id, chatId);
      if (changed > 0) {
        return `[OK] Tugas #${cmd.id} berhasil dihapus.`;
      }
      return `[!] Tugas #${cmd.id} gak ketemu.`;
    }

    case "update": {
      let task = cmd.raw;
      let tag = undefined;
      const tagMatch = task.match(/#(\w+)/);
      if (tagMatch) {
        tag = tagMatch[1];
        task = task.replace(tagMatch[0], "").trim();
      }
      let deadline = undefined;
      const dlMatch = task.match(/dl:(\S+)/i);
      if (dlMatch) {
        const parsed = new Date(dlMatch[1]).getTime();
        if (!isNaN(parsed)) deadline = parsed;
        task = task.replace(dlMatch[0], "").trim();
      }
      const changed = store.updateTodo(cmd.id, chatId, {
        task: task || undefined,
        deadline,
        tag
      });
      if (changed > 0) {
        return `[OK] Tugas #${cmd.id} berhasil diupdate jadi: "${task}"`;
      }
      return `[!] Tugas #${cmd.id} gak ketemu.`;
    }

    case "detail": {
      const todo = store.getTodoById(cmd.id, chatId);
      if (!todo) return `[!] Tugas #${cmd.id} gak ketemu.`;
      const dlStr = todo.deadline
        ? new Date(todo.deadline).toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) + " WIB"
        : "Tanpa deadline";
      return `*[Detail Tugas #${todo.id}]*\n• Tugas: ${todo.task}\n• Deadline: ${dlStr}\n• Kategori: ${todo.category || "work"}\n• Tag: ${todo.tag || "-"}\n• Status: ${todo.done ? "Selesai" : "Pending"}`;
    }

    case "add": {
      let task = cmd.raw;
      let tag = null;
      const tagMatch = task.match(/#(\w+)/);
      if (tagMatch) {
        tag = tagMatch[1];
        task = task.replace(tagMatch[0], "").trim();
      }
      let deadline = null;
      const dlMatch = task.match(/dl:(\S+)/i);
      if (dlMatch) {
        const parsed = new Date(dlMatch[1]).getTime();
        if (!isNaN(parsed)) deadline = parsed;
        task = task.replace(dlMatch[0], "").trim();
      }
      const id = store.addTodo(chatId, task, deadline, tag);
      return `[OK] Tugas #${id} dicatat: "${task}"`;
    }

    case "daily": {
      if (cmd.value === "1" || cmd.value === "on") {
        store.setDailyDigest(chatId, true);
        return "[OK] Daily reminder jam 07:00 WIB diaktifkan.";
      } else if (cmd.value === "0" || cmd.value === "off") {
        store.setDailyDigest(chatId, false);
        return "[OK] Daily reminder dimatikan.";
      }
      return "*[Daily Reminder]*\nFormat: `#daily 1` (aktifkan jam 07:00 WIB) atau `#daily 0` (matikan).";
    }

    case "skills": {
      const list = store.getSkills();
      return formatSkillList(list);
    }

    case "reminders": {
      const list = store.listReminders ? store.listReminders(chatId) : [];
      return formatRemindersList(list);
    }

    case "contacts": {
      const list = store.listPersons ? store.listPersons() : [];
      return formatPersonList(list);
    }

    case "proposals": {
      const props = listSkillProposals();
      if (!props.pending || props.pending.length === 0) {
        return "*[Proposal Skill]*\nTidak ada proposal skill yang menunggu persetujuan.";
      }
      const lines = ["*[Proposal Skill Menunggu Review]*\n"];
      props.pending.forEach((p, idx) => {
        lines.push(`${idx + 1}. *${p.name}*\n   _${p.description}_`);
      });
      lines.push("\n_Gunakan tool approveSkill atau rejectSkill untuk memproses._");
      return lines.join("\n");
    }

    case "rollback": {
      if (!isOwner) return "[!] Fitur #rollback khusus owner.";
      const res = rollbackSkill(cmd.name, { toVersion: cmd.version, store, rolledBackBy: chatId });
      if (res.status !== "success") {
        return `[!] Gagal rollback skill: ${res.error}`;
      }
      return `[OK] ${res.message}`;
    }

    case "backlogList": {
      if (!isOwner) return "[!] Fitur #backlog khusus owner.";
      const list = store.getBacklogs(chatId);
      return formatBacklogList(list);
    }

    case "backlogDone": {
      if (!isOwner) return "[!] Fitur #backlog khusus owner.";
      const changed = store.completeBacklog(cmd.id, chatId);
      if (changed > 0) return `[OK] Ide *[#${cmd.id}]* udah kelar.`;
      return `[!] Ide *[#${cmd.id}]* gak ketemu.`;
    }

    case "backlogAdd": {
      if (!isOwner) return "[!] Fitur #backlog khusus owner.";
      const bId = store.addBacklog(chatId, cmd.idea);
      return `*[Backlog]*\nDicatat.\n• ID: #${bId}\n• Ide: ${cmd.idea}`;
    }

    case "health": {
      if (!isOwner) return "[!] Fitur #health khusus owner (+6281234567890).";
      return formatServerHealth(store);
    }

    case "minecraft": {
      if (!isOwner) return "[!] Fitur #mc khusus owner (+6281234567890).";
      const status = await getMinecraftStatus();
      return formatMinecraftStatus(status);
    }

    case "help": {
      return `*[🤠 MY NAME IS JOHN MUSTARDDD DEW DEW DEW 🥀]*
_Autonomous WhatsApp AI & Fast Command Engine_

*Perintah Umum (Bypass AI):*
- #ping — Cek status, latency, RAM & uptime
- #dew — MY NAME IS JOHN MUSTARDDD 🤠
- #help — Tampilkan menu panduan ini

*Perintah To-Do & Tugas (Manual):*
- #tugas / #todo — Lihat to-do list pending
- #reminders — Lihat daftar pengingat/reminder aktif
- #today — Tugas deadline hari ini
- #week — Tugas 7 hari ke depan
- #<id> — Cek detail tugas (misal: #1)
- #add <tugas> — Tambah tugas (opsi: dl:YYYY-MM-DD #tag)
- #update <id> <pesan> — Edit tugas (misal: #update 1 Pitching gameseed dl:2026-09-27)
- #done <id> — Tandai tugas selesai
- #undo — Batalkan #done terakhir
- #del <id> — Hapus tugas (misal: #del 1)

*Perintah Otomasi & Pengaturan:*
- #daily <1/0> — Aktifkan/matikan rekap to-do jam 07:00 WIB
- #skills — Lihat daftar skill & macro otomatis
- #proposals — Cek antrean proposal skill
- #rollback <skill> [v] — Kembalikan versi skill
- #kontak — Direktori koordinasi pasangan & keluarga

*Perintah Owner / Admin:*
- #health / #server — Cek kesehatan server, CPU, RAM, disk & DB
- #mc / #minecraft — Cek status server Minecraft & player aktif
- #backlog <ide> — Catat ide fitur/perbaikan
- #backlog list — Lihat daftar backlog ide
- #backlog done <id> — Tandai backlog selesai

*Fitur Otomatis (Langsung Chat / VN):*
- Voice Note: Kirim rekaman suara apa pun, langsung diproses sat-set.
- Document Vault: Kirim foto/PDF/struk/KTP -> auto OCR & disimpan.
- Web Search: Tanya info terkini, berita, cuaca, harga, atau skor bola.
- Chat Bebas: Diskusi, riset, coding, kalkulasi matematika, dsb.

*Catatan:* Perintah dengan awalan *#* dieksekusi instan tanpa LLM (cepat, akurat, anti-halu).`;
    }

    default:
      return null;
  }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("src/commands.js")) {
  import("node:assert").then(async ({ default: assert }) => {
    import("./db.js").then(async ({ Storage }) => {
      const store = new Storage(":memory:");
      const chatId = "628999999999";

      // Test parsing
      assert.strictEqual(parseFastCommand("#ping").type, "ping");
      assert.strictEqual(parseFastCommand("#todo").type, "listTodos");
      assert.strictEqual(parseFastCommand("#tugas").type, "listTodos");
      assert.strictEqual(parseFastCommand("#today").type, "today");
      assert.strictEqual(parseFastCommand("#week").type, "week");
      assert.strictEqual(parseFastCommand("#done 5").id, 5);
      assert.strictEqual(parseFastCommand("#undo").type, "undo");
      assert.strictEqual(parseFastCommand("#del 3").id, 3);
      assert.strictEqual(parseFastCommand("#delete 4").id, 4);
      assert.strictEqual(parseFastCommand("#42").id, 42);
      assert.strictEqual(parseFastCommand("#add Kerjakan PR #kuliah").raw, "Kerjakan PR #kuliah");
      assert.strictEqual(parseFastCommand("#daily 1").value, "1");
      assert.strictEqual(parseFastCommand("#dew").type, "dew");
      assert.strictEqual(parseFastCommand("#skills").type, "skills");
      assert.strictEqual(parseFastCommand("#reminders").type, "reminders");
      assert.strictEqual(parseFastCommand("#pengingat").type, "reminders");
      assert.strictEqual(parseFastCommand("#kontak").type, "contacts");
      assert.strictEqual(parseFastCommand("#contacts").type, "contacts");
      assert.strictEqual(parseFastCommand("#proposals").type, "proposals");
      assert.strictEqual(parseFastCommand("#rollback rekap_malam 2").type, "rollback");
      assert.strictEqual(parseFastCommand("#rollback rekap_malam 2").name, "rekap_malam");
      assert.strictEqual(parseFastCommand("#rollback rekap_malam 2").version, 2);
      assert.strictEqual(parseFastCommand("#health").type, "health");
      assert.strictEqual(parseFastCommand("#mc").type, "minecraft");
      assert.strictEqual(parseFastCommand("#help").type, "help");
      assert.strictEqual(parseFastCommand("halo john"), null);

      // Test execution
      const dewRes = await executeFastCommand(parseFastCommand("#dew"), { store, chatId });
      assert.ok(dewRes.includes("DEW DEW DEW"));

      const skillsRes = await executeFastCommand(parseFastCommand("#skills"), { store, chatId });
      assert.ok(skillsRes.includes("Custom Skills"));

      const contactsRes = await executeFastCommand(parseFastCommand("#kontak"), { store, chatId });
      assert.ok(contactsRes.includes("Direktori Kontak"));

      const proposalsRes = await executeFastCommand(parseFastCommand("#proposals"), { store, chatId });
      assert.ok(proposalsRes.includes("Proposal"));

      const pingRes = await executeFastCommand(parseFastCommand("#ping"), { store, chatId });
      assert.ok(pingRes.includes("PONG!"));

      const healthDenied = await executeFastCommand(parseFastCommand("#health"), { store, chatId, isOwner: false });
      assert.ok(healthDenied.includes("khusus owner"));

      const healthAllowed = await executeFastCommand(parseFastCommand("#health"), { store, chatId, isOwner: true });
      assert.ok(healthAllowed.includes("SERVER HEALTH"));

      const addRes = await executeFastCommand(parseFastCommand("#add Belajar analgor #kuliah"), { store, chatId });
      assert.ok(addRes.includes("[OK] Tugas #1 dicatat"));

      const detailRes = await executeFastCommand(parseFastCommand("#1"), { store, chatId });
      assert.ok(detailRes.includes("Belajar analgor"));

      const listRes = await executeFastCommand(parseFastCommand("#todo"), { store, chatId });
      assert.ok(listRes.includes("Belajar analgor"));

      const doneRes = await executeFastCommand(parseFastCommand("#done 1"), { store, chatId });
      assert.ok(doneRes.includes("[OK] Tugas #1 selesai"));

      const undoRes = await executeFastCommand(parseFastCommand("#undo"), { store, chatId });
      assert.ok(undoRes.includes("dibalikin jadi pending"));

      const updateRes = await executeFastCommand(parseFastCommand("#update 1 Belajar analgor rev2"), { store, chatId });
      assert.ok(updateRes.includes("[OK] Tugas #1 berhasil diupdate"));

      const helpRes = await executeFastCommand(parseFastCommand("#help"), { store, chatId });
      assert.ok(helpRes.includes("JOHN MUSTARD"));

      const delRes = await executeFastCommand(parseFastCommand("#del 1"), { store, chatId });
      assert.ok(delRes.includes("[OK] Tugas #1 berhasil dihapus"));

      console.log("Commands module self-test OK");
    });
  });
}
