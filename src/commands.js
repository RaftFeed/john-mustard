import { formatTodoList, formatBacklogList, formatSkillList } from "./db.js";

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

export function executeFastCommand(cmd, { store, chatId, isOwner = false }) {
  if (!cmd) return null;

  switch (cmd.type) {
    case "ping": {
      const uptime = formatUptime(process.uptime());
      const mem = (process.memoryUsage().rss / 1024 / 1024).toFixed(1);
      const pendingTodos = store.getTodos(chatId, true).length;
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

    case "help": {
      return `*[JOHN MUSTARD — FAST COMMANDS]*\n(Bypass AI, instant & anti-lemot)\n\n• #ping — Cek status & latency bot\n• #todo / #tugas — Lihat to-do list pending\n• #today — Tugas deadline hari ini\n• #week — Tugas 7 hari ke depan\n• #<id> — Cek detail tugas (contoh: #1)\n• #done <id> — Tandai selesai (contoh: #done 1)\n• #undo — Batalkan selesai terakhir\n• #del <id> — Hapus tugas (contoh: #del 1)\n• #add <tugas> — Tambah tugas tanpa AI (opsi dl:YYYY-MM-DD #tag)\n• #daily <1/0> — On/off reminder harian jam 07:00 WIB\n• #skills — Lihat daftar skill & macro otomatis\n• #help — Tampilkan menu ini\n\nUntuk chat bebas atau riset, langsung ketik pesan atau kirim VN kaya biasa.`;
    }

    default:
      return null;
  }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("src/commands.js")) {
  import("node:assert").then(async ({ default: assert }) => {
    import("./db.js").then(({ Storage }) => {
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
      assert.strictEqual(parseFastCommand("#help").type, "help");
      assert.strictEqual(parseFastCommand("halo john"), null);

      // Test execution
      const dewRes = executeFastCommand(parseFastCommand("#dew"), { store, chatId });
      assert.ok(dewRes.includes("DEW DEW DEW"));

      const skillsRes = executeFastCommand(parseFastCommand("#skills"), { store, chatId });
      assert.ok(skillsRes.includes("Custom Skills"));

      const pingRes = executeFastCommand(parseFastCommand("#ping"), { store, chatId });
      assert.ok(pingRes.includes("PONG!"));

      const addRes = executeFastCommand(parseFastCommand("#add Belajar analgor #kuliah"), { store, chatId });
      assert.ok(addRes.includes("[OK] Tugas #1 dicatat"));

      const detailRes = executeFastCommand(parseFastCommand("#1"), { store, chatId });
      assert.ok(detailRes.includes("Belajar analgor"));

      const listRes = executeFastCommand(parseFastCommand("#todo"), { store, chatId });
      assert.ok(listRes.includes("Belajar analgor"));

      const doneRes = executeFastCommand(parseFastCommand("#done 1"), { store, chatId });
      assert.ok(doneRes.includes("[OK] Tugas #1 selesai"));

      const undoRes = executeFastCommand(parseFastCommand("#undo"), { store, chatId });
      assert.ok(undoRes.includes("dibalikin jadi pending"));

      const delRes = executeFastCommand(parseFastCommand("#del 1"), { store, chatId });
      assert.ok(delRes.includes("[OK] Tugas #1 berhasil dihapus"));

      console.log("Commands module self-test OK");
    });
  });
}
