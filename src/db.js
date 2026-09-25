import { DatabaseSync } from "node:sqlite";
import assert from "node:assert";

export function normalizePhone(raw) {
  if (!raw) return "";
  let digits = String(raw).split("@")[0].replace(/\D/g, "");
  if (digits.startsWith("0")) digits = "62" + digits.slice(1);
  return digits;
}

export const OWNER_PHONE = normalizePhone(process.env.OWNER_PHONE || "6281234567890");

export class Storage {
  constructor(dbPath = "bot.db") {
    this.db = new DatabaseSync(dbPath);
    this.init();
  }

  init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS reminders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL,
        message TEXT NOT NULL,
        remind_at INTEGER NOT NULL,
        status TEXT DEFAULT 'pending'
      );
      CREATE TABLE IF NOT EXISTS todos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL,
        task TEXT NOT NULL,
        deadline INTEGER,
        tag TEXT,
        done INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS vault_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        owner_id TEXT DEFAULT '',
        filename TEXT NOT NULL,
        category TEXT DEFAULT 'documents',
        filepath TEXT NOT NULL,
        mimetype TEXT NOT NULL,
        filesize INTEGER NOT NULL,
        summary TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS file_permissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        granted_at INTEGER NOT NULL,
        UNIQUE(file_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS file_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_id INTEGER NOT NULL,
        requester_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS usage_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        prompt TEXT NOT NULL,
        tools_used TEXT,
        status TEXT DEFAULT 'success',
        error_msg TEXT
      );
      CREATE TABLE IF NOT EXISTS chat_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS backlogs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        idea TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at INTEGER NOT NULL
      );
    `);

    try { this.db.exec("ALTER TABLE todos ADD COLUMN deadline INTEGER"); } catch {}
    try { this.db.exec("ALTER TABLE todos ADD COLUMN tag TEXT"); } catch {}
    try { this.db.exec("ALTER TABLE vault_files ADD COLUMN owner_id TEXT DEFAULT ''"); } catch {}
  }

  saveChatMessage(chatId, role, content) {
    if (!content || typeof content !== "string") return;
    this.db.prepare(
      "INSERT INTO chat_history (chat_id, role, content, created_at) VALUES (?, ?, ?, ?)"
    ).run(chatId, role, content, Date.now());
  }

  getRecentChatHistory(chatId, limit = 8) {
    const rows = this.db.prepare(
      "SELECT role, content FROM chat_history WHERE chat_id = ? ORDER BY id DESC LIMIT ?"
    ).all(chatId, limit);
    return rows.reverse();
  }

  addReminder(chatId, message, remindAtTimestamp) {
    const stmt = this.db.prepare(
      "INSERT INTO reminders (chat_id, message, remind_at) VALUES (?, ?, ?)"
    );
    return stmt.run(chatId, message, remindAtTimestamp).lastInsertRowid;
  }

  getPendingReminders(now = Date.now()) {
    return this.db
      .prepare("SELECT * FROM reminders WHERE status = 'pending' AND remind_at <= ?")
      .all(now);
  }

  markReminderDone(id) {
    this.db.prepare("UPDATE reminders SET status = 'sent' WHERE id = ?").run(id);
  }

  addTodo(chatId, task, deadline = null, tag = null) {
    const stmt = this.db.prepare(
      "INSERT INTO todos (chat_id, task, deadline, tag, created_at) VALUES (?, ?, ?, ?, ?)"
    );
    return stmt.run(chatId, task, deadline, tag, Date.now()).lastInsertRowid;
  }

  getTodos(chatId) {
    return this.db
      .prepare(`
        SELECT id, task, deadline, tag 
        FROM todos 
        WHERE chat_id = ? AND done = 0 
        ORDER BY CASE WHEN deadline IS NULL THEN 1 ELSE 0 END, deadline ASC, id ASC
      `)
      .all(chatId);
  }


  // --- Document Vault & Access Control ---
  saveVaultFile({ ownerId = "", filename, category = "documents", filepath, mimetype, filesize, summary = "" }) {
    const normOwner = normalizePhone(ownerId);
    const stmt = this.db.prepare(
      "INSERT INTO vault_files (owner_id, filename, category, filepath, mimetype, filesize, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );
    return stmt.run(normOwner, filename, category, filepath, mimetype, filesize, summary, Date.now()).lastInsertRowid;
  }

  hasFileAccess(fileId, userId) {
    const file = this.getVaultFileById(fileId);
    if (!file) return false;
    const norm = normalizePhone(userId);
    if (!file.owner_id || normalizePhone(file.owner_id) === norm) return true;
    const perm = this.db.prepare("SELECT id FROM file_permissions WHERE file_id = ? AND user_id = ?").get(fileId, norm);
    return Boolean(perm);
  }

  grantFileAccess(fileId, targetUserId) {
    const norm = normalizePhone(targetUserId);
    return this.db.prepare(
      "INSERT OR IGNORE INTO file_permissions (file_id, user_id, granted_at) VALUES (?, ?, ?)"
    ).run(fileId, norm, Date.now()).changes;
  }

  revokeFileAccess(fileId, targetUserId) {
    const norm = normalizePhone(targetUserId);
    return this.db.prepare(
      "DELETE FROM file_permissions WHERE file_id = ? AND user_id = ?"
    ).run(fileId, norm).changes;
  }

  createFileRequest(fileId, requesterId, ownerId) {
    const reqNorm = normalizePhone(requesterId);
    const ownerNorm = normalizePhone(ownerId);
    return this.db.prepare(
      "INSERT INTO file_requests (file_id, requester_id, owner_id, status, created_at) VALUES (?, ?, ?, 'pending', ?)"
    ).run(fileId, reqNorm, ownerNorm, Date.now()).lastInsertRowid;
  }

  getFileRequest(requestId) {
    return this.db.prepare("SELECT * FROM file_requests WHERE id = ?").get(requestId);
  }

  respondFileRequest(requestId, status) {
    return this.db.prepare("UPDATE file_requests SET status = ? WHERE id = ?").run(status, requestId).changes;
  }

  searchVaultFiles(query = "", category = null, userId = null) {
    let sql = `
      SELECT DISTINCT v.* FROM vault_files v
      LEFT JOIN file_permissions p ON v.id = p.file_id
      WHERE 1=1
    `;
    const params = [];

    if (userId) {
      const norm = normalizePhone(userId);
      sql += " AND (v.owner_id = ? OR p.user_id = ? OR v.owner_id = '' OR v.owner_id IS NULL)";
      params.push(norm, norm);
    }

    if (category) {
      sql += " AND v.category = ?";
      params.push(category);
    }

    if (query && query.trim() !== "") {
      sql += " AND (v.filename LIKE ? OR v.summary LIKE ?)";
      params.push(`%${query}%`, `%${query}%`);
    }

    sql += " ORDER BY v.id DESC LIMIT 10";
    return this.db.prepare(sql).all(...params);
  }

  getVaultFileById(id) {
    return this.db.prepare("SELECT * FROM vault_files WHERE id = ?").get(id);
  }

  completeTodo(id, chatId) {
    return this.db
      .prepare("UPDATE todos SET done = 1 WHERE id = ? AND chat_id = ?")
      .run(id, chatId).changes;
  }

  findTodo(chatId, query) {
    return this.db
      .prepare("SELECT * FROM todos WHERE chat_id = ? AND done = 0 AND task LIKE ? ORDER BY id DESC LIMIT 1")
      .get(chatId, `%${query}%`);
  }

  updateTodo(id, chatId, { task, deadline, tag }) {
    const existing = this.db.prepare("SELECT * FROM todos WHERE id = ? AND chat_id = ?").get(id, chatId);
    if (!existing) return 0;
    const newTask = task !== undefined && task !== null ? task : existing.task;
    const newDeadline = deadline !== undefined ? deadline : existing.deadline;
    const newTag = tag !== undefined ? tag : existing.tag;
    return this.db
      .prepare("UPDATE todos SET task = ?, deadline = ?, tag = ? WHERE id = ? AND chat_id = ?")
      .run(newTask, newDeadline, newTag, id, chatId).changes;
  }

  deleteTodo(id, chatId) {
    return this.db
      .prepare("DELETE FROM todos WHERE id = ? AND chat_id = ?")
      .run(id, chatId).changes;
  }

  // --- Backlog (Owner Only) ---
  addBacklog(userId, idea) {
    const norm = normalizePhone(userId);
    const stmt = this.db.prepare(
      "INSERT INTO backlogs (user_id, idea, status, created_at) VALUES (?, ?, 'pending', ?)"
    );
    return stmt.run(norm, idea.trim(), Date.now()).lastInsertRowid;
  }

  getBacklogs(userId, status = "pending") {
    const norm = normalizePhone(userId);
    let sql = "SELECT id, idea, status, created_at FROM backlogs WHERE user_id = ?";
    const params = [norm];
    if (status) {
      sql += " AND status = ?";
      params.push(status);
    }
    sql += " ORDER BY id ASC";
    return this.db.prepare(sql).all(...params);
  }

  completeBacklog(id, userId) {
    const norm = normalizePhone(userId);
    return this.db.prepare(
      "UPDATE backlogs SET status = 'done' WHERE id = ? AND user_id = ?"
    ).run(id, norm).changes;
  }
}

export function formatBacklogList(backlogs) {
  if (!backlogs || backlogs.length === 0) {
    return "💡 *[Backlog Improvement]*\nBelum ada ide improvement yang dicatat.";
  }
  const lines = ["💡 *[Backlog Improvement — Ide & Fitur]*\n"];
  backlogs.forEach((b) => {
    const d = new Date(b.created_at);
    const dateStr = `${d.getDate()}/${d.getMonth() + 1}`;
    lines.push(`📌 *[#${b.id}]* ${b.idea} _(${dateStr})_`);
  });
  lines.push("\n_Tandai selesai: #backlog done <id>_");
  return lines.join("\n");
}

export function formatTodoList(todos) {
  if (!todos || todos.length === 0) {
    return "?? *Tidak ada tugas pending!* Semua to-do list sudah selesai.";
  }

  const now = new Date();
  const daysId = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
  const monthsId = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

  let lines = ["\u{1F304} *[Pengingat Tugas]*\n"];

  todos.forEach((item) => {
    let badge = "??";
    let deadlineStr = "Tanpa deadline";

    if (item.deadline) {
      const dl = new Date(item.deadline);
      const diffMs = dl.getTime() - now.getTime();
      const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

      if (diffDays <= 0) badge = "\u{1F534}";
      else if (diffDays <= 2) badge = "\u{1F7E1}";
      else badge = "\u{1F7E2}";

      const dayName = daysId[dl.getDay()];
      const dateNum = dl.getDate();
      const monthName = monthsId[dl.getMonth()];
      const year = dl.getFullYear();
      const hours = String(dl.getHours()).padStart(2, "0");
      const minutes = String(dl.getMinutes()).padStart(2, "0");

      const hText = diffDays <= 0 ? "Hari ini / Terlewat" : `H-${diffDays}`;
      deadlineStr = `${hText} (${dayName}, ${dateNum} ${monthName} ${year} ${hours}:${minutes})`;
    }

    lines.push(`${badge} *[${item.id}] ${item.task}*`);
    lines.push(`\u251C\u2500\u2500 ${deadlineStr}`);
    const tagStr = item.tag ? (item.tag.startsWith("#") ? item.tag : `#${item.tag}`) : "#tugas";
    lines.push(`\u2514\u2500\u2500 ${tagStr}\n`);
  });

  lines.push("Semangat! \u{1F4AA}");
  return lines.join("\n");
}

export function logInteraction(db, { prompt, tools = [], status = "success", error = null }) {
  const stmt = db.prepare(`
    INSERT INTO usage_logs (timestamp, prompt, tools_used, status, error_msg)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(Date.now(), prompt, JSON.stringify(tools), status, error);
}

export function getAuditSummary(db, days = 7) {
  const since = Date.now() - days * 86400000;
  const rows = db.prepare("SELECT * FROM usage_logs WHERE timestamp >= ? ORDER BY id DESC").all(since);
  
  const total = rows.length;
  const errors = rows.filter((r) => r.status === "error");
  const noTool = rows.filter((r) => !r.tools_used || r.tools_used === "[]");

  return {
    totalInteractions: total,
    errorCount: errors.length,
    frequentQueriesWithoutTools: noTool.slice(0, 20).map((r) => r.prompt),
    recentErrors: errors.slice(0, 5).map((r) => ({ prompt: r.prompt, err: r.error_msg }))
  };
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("src/db.js")) {
  const store = new Storage(":memory:");
  const dl = new Date("2026-09-27T23:59:00+07:00").getTime();
  const id = store.addTodo("user1", "LKP 6 Analisis Algoritme", dl, "#analgor [P2]");
  const todos = store.getTodos("user1");
  assert.strictEqual(todos.length, 1);
  const formatted = formatTodoList(todos);
  assert.ok(formatted.includes("[1] LKP 6 Analisis Algoritme"));
  assert.ok(formatted.includes("#analgor [P2]"));

  const found = store.findTodo("user1", "LKP 6");
  assert.strictEqual(found.id, id);

  const updated = store.updateTodo(id, "user1", { task: "LKP 6 Revisi" });
  assert.strictEqual(updated, 1);
  assert.strictEqual(store.getTodos("user1")[0].task, "LKP 6 Revisi");

  const deleted = store.deleteTodo(id, "user1");
  assert.strictEqual(deleted, 1);
  assert.strictEqual(store.getTodos("user1").length, 0);

  store.saveChatMessage("user1", "user", "halo");
  store.saveChatMessage("user1", "model", "siap");
  const history = store.getRecentChatHistory("user1");
  assert.strictEqual(history.length, 2);
  assert.strictEqual(history[0].content, "halo");
  assert.strictEqual(history[1].content, "siap");

  // Multi-user & ACL tests
  assert.strictEqual(normalizePhone("08123456789"), "628123456789");
  assert.strictEqual(normalizePhone("628123456789@c.us"), "628123456789");

  const fileA = store.saveVaultFile({
    ownerId: "08123456789",
    filename: "ktp_user_a.jpg",
    category: "id_cards",
    filepath: "vault/id_cards/ktp_user_a.jpg",
    mimetype: "image/jpeg",
    filesize: 1024,
    summary: "KTP User A"
  });

  // Owner has access
  assert.strictEqual(store.hasFileAccess(fileA, "628123456789"), true);
  // Other user does NOT have access
  assert.strictEqual(store.hasFileAccess(fileA, "628999999999"), false);

  // Search results are scoped
  const searchOther = store.searchVaultFiles("KTP", null, "628999999999");
  assert.strictEqual(searchOther.length, 0);

  const searchOwner = store.searchVaultFiles("KTP", null, "08123456789");
  assert.strictEqual(searchOwner.length, 1);

  // User A grants access to User B
  store.grantFileAccess(fileA, "08999999999");
  assert.strictEqual(store.hasFileAccess(fileA, "628999999999"), true);

  const searchGranted = store.searchVaultFiles("KTP", null, "628999999999");
  assert.strictEqual(searchGranted.length, 1);

  // Request flow
  const reqId = store.createFileRequest(fileA, "628777777777", "08123456789");
  const req = store.getFileRequest(reqId);
  assert.strictEqual(req.status, "pending");
  assert.strictEqual(req.requester_id, "628777777777");

  store.respondFileRequest(reqId, "approved");
  assert.strictEqual(store.getFileRequest(reqId).status, "approved");

  // Backlog tests
  const bId = store.addBacklog("6281234567890", "Buat fitur export CSV");
  assert.ok(bId > 0);
  const backlogs = store.getBacklogs("6281234567890");
  assert.strictEqual(backlogs.length, 1);
  assert.strictEqual(backlogs[0].idea, "Buat fitur export CSV");
  const formattedBacklogs = formatBacklogList(backlogs);
  assert.ok(formattedBacklogs.includes("Buat fitur export CSV"));

  store.completeBacklog(bId, "6281234567890");
  assert.strictEqual(store.getBacklogs("6281234567890").length, 0);

  console.log("DB & Formatter self-test OK");
}
