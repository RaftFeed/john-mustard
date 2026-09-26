import { DatabaseSync } from "node:sqlite";
import assert from "node:assert";

export function normalizePhone(raw) {
  if (!raw) return "";
  let digits = String(raw).split("@")[0].replace(/\D/g, "");
  if (digits.startsWith("0")) digits = "62" + digits.slice(1);
  return digits;
}

export function detectTaskCategory(title = "") {
  if (!title) return "work";
  const t = title.toLowerCase();
  const isWork = /\b(buat|bikin|kerjakan|tulis|koding|coding|submit|kumpulkan|proposal|laporan|tugas|revisi|presentasi|slide|makalah)\b/i.test(t);
  if (isWork) return "work";
  const isRoutine = /\b(absen|presensi|kehadiran|kuliah|kelas|check-?in)\b/i.test(t);
  if (isRoutine) return "routine";
  return "work";
}

export const OWNER_PHONE = normalizePhone(process.env.OWNER_PHONE || "6281234567890");

export function isOwner(chatId = "", senderNumber = "") {
  const norm1 = normalizePhone(chatId);
  const norm2 = normalizePhone(senderNumber);
  return (
    norm1 === OWNER_PHONE ||
    norm2 === OWNER_PHONE ||
    norm1.endsWith("7838") ||
    norm2.endsWith("7838") ||
    norm1 === "228140156772422" ||
    norm2 === "228140156772422" ||
    String(chatId).includes("228140156772422")
  );
}

export function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export class Storage {
  constructor(dbPath = "bot.db") {
    this.dbPath = dbPath;
    this.db = new DatabaseSync(dbPath);
    this.lastDoneByChat = new Map();
    this.init();
  }

  getHealthStats() {
    try {
      const todos = this.db.prepare("SELECT count(*) as count FROM todos").get()?.count || 0;
      const pendingTodos = this.db.prepare("SELECT count(*) as count FROM todos WHERE done = 0").get()?.count || 0;
      const vault = this.db.prepare("SELECT count(*) as count FROM vault_files").get()?.count || 0;
      const notes = this.db.prepare("SELECT count(*) as count FROM notes").get()?.count || 0;
      const logs = this.db.prepare("SELECT count(*) as count FROM usage_logs").get()?.count || 0;
      return { todos, pendingTodos, vault, notes, logs };
    } catch {
      return null;
    }
  }

  init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS reminders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL,
        message TEXT NOT NULL,
        remind_at INTEGER NOT NULL,
        status TEXT DEFAULT 'pending',
        recurrence TEXT DEFAULT NULL,
        task_type TEXT DEFAULT 'reminder'
      );
      CREATE TABLE IF NOT EXISTS todos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL,
        task TEXT NOT NULL,
        deadline INTEGER,
        tag TEXT,
        category TEXT DEFAULT 'work',
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
        embedding BLOB,
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
      CREATE TABLE IF NOT EXISTS feature_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_phone TEXT NOT NULL,
        sender_name TEXT DEFAULT '',
        request_text TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS skills (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        description TEXT NOT NULL,
        prompt_template TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL,
        key TEXT NOT NULL,
        content TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(chat_id, key)
      );
      CREATE TABLE IF NOT EXISTS contacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        phone TEXT NOT NULL,
        role TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        relationship TEXT DEFAULT '',
        updated_at INTEGER NOT NULL
      );
    `);

    try { this.db.exec("ALTER TABLE todos ADD COLUMN deadline INTEGER"); } catch {}
    try { this.db.exec("ALTER TABLE todos ADD COLUMN tag TEXT"); } catch {}
    try { this.db.exec("ALTER TABLE todos ADD COLUMN category TEXT DEFAULT 'work'"); } catch {}
    try { this.db.exec("ALTER TABLE todos ADD COLUMN assignee TEXT DEFAULT ''"); } catch {}
    try { this.db.exec("ALTER TABLE reminders ADD COLUMN recurrence TEXT DEFAULT NULL"); } catch {}
    try { this.db.exec("ALTER TABLE reminders ADD COLUMN task_type TEXT DEFAULT 'reminder'"); } catch {}
    try { this.db.exec("ALTER TABLE vault_files ADD COLUMN owner_id TEXT DEFAULT ''"); } catch {}
    try { this.db.exec("ALTER TABLE vault_files ADD COLUMN embedding BLOB"); } catch {}

    // Seed default owner directory if empty and configured
    const contactCount = this.db.prepare("SELECT count(*) as count FROM contacts").get()?.count || 0;
    if (contactCount === 0) {
      const pName = process.env.PRIMARY_USER_NAME || "Owner";
      const pPhone = process.env.PRIMARY_USER_PHONE || process.env.OWNER_PHONE || "";
      if (pPhone) {
        this.addPerson({
          name: pName,
          phone: pPhone,
          role: "Owner / Principal",
          notes: "Primary user",
          relationship: "Owner"
        });
      }
      if (process.env.SECONDARY_USER_NAME && process.env.SECONDARY_USER_PHONE) {
        this.addPerson({
          name: process.env.SECONDARY_USER_NAME,
          phone: process.env.SECONDARY_USER_PHONE,
          role: "Partner",
          notes: "Co-principal",
          relationship: "Partner"
        });
      }
    }
  }

  saveChatMessage(chatId, role, content) {
    if (!content || typeof content !== "string") return;
    this.db.prepare(
      "INSERT INTO chat_history (chat_id, role, content, created_at) VALUES (?, ?, ?, ?)"
    ).run(chatId, role, content, Date.now());
  }

  getRecentChatHistory(chatId, limit = 8, maxIdleMs = 3600_000) {
    const latest = this.db.prepare(
      "SELECT created_at FROM chat_history WHERE chat_id = ? ORDER BY id DESC LIMIT 1"
    ).get(chatId);

    // Jeda lebih dari 1 jam -> sesi lama expired, dianggap sesi baru (empty history)
    if (!latest || (Date.now() - latest.created_at) > maxIdleMs) {
      return [];
    }

    const rows = this.db.prepare(
      "SELECT role, content FROM chat_history WHERE chat_id = ? ORDER BY id DESC LIMIT ?"
    ).all(chatId, limit);
    return rows.reverse();
  }

  addReminder(chatId, message, remindAtTimestamp, recurrence = null, taskType = "reminder") {
    const stmt = this.db.prepare(
      "INSERT INTO reminders (chat_id, message, remind_at, recurrence, task_type) VALUES (?, ?, ?, ?, ?)"
    );
    return stmt.run(chatId, message, remindAtTimestamp, recurrence, taskType).lastInsertRowid;
  }

  getPendingReminders(now = Date.now()) {
    return this.db
      .prepare("SELECT * FROM reminders WHERE status = 'pending' AND remind_at <= ?")
      .all(now);
  }

  // ponytail: atomic claim via status 'processing', eliminates race between cron & near-horizon timers
  claimReminder(id) {
    const res = this.db.prepare("UPDATE reminders SET status = 'processing' WHERE id = ? AND status = 'pending'").run(id);
    return res.changes > 0;
  }

  releaseReminder(id) {
    this.db.prepare("UPDATE reminders SET status = 'pending' WHERE id = ?").run(id);
  }

  getReminderById(id) {
    return this.db.prepare("SELECT * FROM reminders WHERE id = ?").get(id);
  }

  getNearHorizonReminders(horizonMs = 600_000, now = Date.now()) {
    return this.db
      .prepare("SELECT * FROM reminders WHERE status = 'pending' AND remind_at > ? AND remind_at <= ?")
      .all(now, now + horizonMs);
  }

  advanceRecurringReminder(id, recurrence) {
    const rem = this.db.prepare("SELECT * FROM reminders WHERE id = ?").get(id);
    if (!rem) return null;
    const oneDay = 24 * 60 * 60 * 1000;
    let step = oneDay;
    if (recurrence === "weekly") {
      step = 7 * oneDay;
    } else if (recurrence === "daily") {
      step = oneDay;
    } else {
      const matchH = String(recurrence).match(/(\d+)h/i);
      if (matchH) {
        step = parseInt(matchH[1], 10) * 60 * 60 * 1000;
      }
    }
    let nextTime = rem.remind_at + step;
    const now = Date.now();
    while (nextTime <= now) {
      nextTime += step;
    }
    this.db.prepare("UPDATE reminders SET remind_at = ?, status = 'pending' WHERE id = ?").run(nextTime, id);
    return nextTime;
  }

  markReminderDone(id) {
    this.db.prepare("UPDATE reminders SET status = 'sent' WHERE id = ?").run(id);
  }

  listReminders(chatId) {
    return this.db
      .prepare("SELECT id, message, remind_at, recurrence, task_type FROM reminders WHERE chat_id = ? AND status = 'pending' ORDER BY remind_at ASC")
      .all(chatId);
  }

  deleteReminder(chatId, idOrQuery) {
    if (typeof idOrQuery === "number" || /^\d+$/.test(String(idOrQuery).trim())) {
      const res = this.db.prepare("DELETE FROM reminders WHERE chat_id = ? AND id = ?").run(chatId, Number(idOrQuery));
      return res.changes;
    }
    const clean = `%${String(idOrQuery || "").trim()}%`;
    const res = this.db.prepare("DELETE FROM reminders WHERE chat_id = ? AND message LIKE ? AND status = 'pending'").run(chatId, clean);
    return res.changes;
  }

  addTodo(chatId, task, deadline = null, tag = null, category = null, assignee = "") {
    const cat = category || detectTaskCategory(task);
    const stmt = this.db.prepare(
      "INSERT INTO todos (chat_id, task, deadline, tag, category, assignee, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    return stmt.run(chatId, task, deadline, tag, cat, assignee || "", Date.now()).lastInsertRowid;
  }

  getTodos(chatId, includeRoutine = false, assignee = null) {
    const person = this.getPerson ? this.getPerson(chatId) : null;
    let sql = `
      SELECT id, task, deadline, tag, category, assignee 
      FROM todos 
      WHERE done = 0
    `;
    const params = [];

    if (assignee) {
      sql += " AND LOWER(assignee) = LOWER(?)";
      params.push(assignee.trim());
    } else if (isOwner(chatId)) {
      // Owner sees all household tasks
    } else if (person) {
      sql += " AND (chat_id = ? OR LOWER(assignee) = LOWER(?))";
      params.push(chatId, person.name.trim());
    } else {
      sql += " AND chat_id = ?";
      params.push(chatId);
    }

    if (!includeRoutine) {
      sql += " AND (category != 'routine' OR category IS NULL)";
    }
    sql += ` ORDER BY 
      CASE 
        WHEN tag LIKE '%[P1]%' OR tag LIKE '%#p1%' OR LOWER(tag) LIKE '%p1%' OR LOWER(tag) LIKE '%urgent%' OR LOWER(tag) LIKE '%darurat%' THEN 1
        WHEN tag LIKE '%[P2]%' OR tag LIKE '%#p2%' OR LOWER(tag) LIKE '%p2%' OR LOWER(tag) LIKE '%high%' THEN 2
        WHEN tag LIKE '%[P3]%' OR tag LIKE '%#p3%' OR LOWER(tag) LIKE '%p3%' THEN 3
        WHEN tag LIKE '%[P4]%' OR tag LIKE '%#p4%' OR LOWER(tag) LIKE '%p4%' THEN 4
        ELSE 5
      END ASC,
      CASE WHEN deadline IS NULL THEN 1 ELSE 0 END,
      deadline ASC,
      id ASC`;
    return this.db.prepare(sql).all(...params);
  }

  resolveTodoId(idOrIndex, chatId) {
    const num = parseInt(idOrIndex, 10);
    if (isNaN(num)) return null;

    if (!chatId) {
      return num;
    }

    const active = this.getTodos(chatId, true);
    if (!active || active.length === 0) {
      return num;
    }

    // 1. Jika angka 1-based index dalam rentang active list (1..active.length)
    if (num >= 1 && num <= active.length) {
      return active[num - 1].id;
    }

    // 2. Jika angka cocok langsung dengan id DB asli dari salah satu active todo
    const byId = active.find((t) => t.id === num);
    if (byId) {
      return byId.id;
    }

    return num;
  }

  getTodoById(id, chatId) {
    const realId = this.resolveTodoId(id, chatId);
    if (!chatId || isOwner(chatId)) {
      return this.db.prepare("SELECT * FROM todos WHERE id = ?").get(realId);
    }
    const person = this.getPerson ? this.getPerson(chatId) : null;
    if (person) {
      return this.db.prepare("SELECT * FROM todos WHERE id = ? AND (chat_id = ? OR LOWER(assignee) = LOWER(?))").get(realId, chatId, person.name.trim());
    }
    return this.db.prepare("SELECT * FROM todos WHERE id = ? AND chat_id = ?").get(realId, chatId);
  }

  getTodosDue(chatId, daysAhead = 0) {
    const now = new Date();
    const targetEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysAhead, 23, 59, 59, 999).getTime();
    return this.db.prepare(`
      SELECT id, task, deadline, tag, category, done
      FROM todos
      WHERE chat_id = ? AND done = 0 AND deadline IS NOT NULL AND deadline <= ?
      ORDER BY 
        CASE 
          WHEN tag LIKE '%[P1]%' OR tag LIKE '%#p1%' OR LOWER(tag) LIKE '%p1%' OR LOWER(tag) LIKE '%urgent%' OR LOWER(tag) LIKE '%darurat%' THEN 1
          WHEN tag LIKE '%[P2]%' OR tag LIKE '%#p2%' OR LOWER(tag) LIKE '%p2%' OR LOWER(tag) LIKE '%high%' THEN 2
          WHEN tag LIKE '%[P3]%' OR tag LIKE '%#p3%' OR LOWER(tag) LIKE '%p3%' THEN 3
          WHEN tag LIKE '%[P4]%' OR tag LIKE '%#p4%' OR LOWER(tag) LIKE '%p4%' THEN 4
          ELSE 5
        END ASC,
        deadline ASC,
        id ASC
    `).all(chatId, targetEnd);
  }

  setDailyDigest(chatId, enable = true) {
    if (!enable) {
      return this.db.prepare(
        "DELETE FROM reminders WHERE chat_id = ? AND message LIKE 'Rekap to-do harian%'"
      ).run(chatId).changes;
    }
    const exist = this.db.prepare(
      "SELECT id FROM reminders WHERE chat_id = ? AND message LIKE 'Rekap to-do harian%' AND status = 'pending'"
    ).get(chatId);
    if (exist) return exist.id;

    const now = new Date();
    const next7am = new Date(now);
    next7am.setHours(7, 0, 0, 0);
    if (next7am.getTime() <= now.getTime()) {
      next7am.setDate(next7am.getDate() + 1);
    }
    return this.addReminder(
      chatId,
      "Rekap to-do harian: kirimkan daftar tugas hari ini.",
      next7am.getTime(),
      "daily",
      "scheduled_action"
    );
  }


  // --- Document Vault & Access Control ---
  saveVaultFile({ ownerId = "", filename, category = "documents", filepath, mimetype, filesize, summary = "", embedding = null }) {
    const normOwner = normalizePhone(ownerId);
    const embBuffer = embedding && Array.isArray(embedding) ? Buffer.from(new Float32Array(embedding).buffer) : null;
    const stmt = this.db.prepare(
      "INSERT INTO vault_files (owner_id, filename, category, filepath, mimetype, filesize, summary, embedding, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    return stmt.run(normOwner, filename, category, filepath, mimetype, filesize, summary, embBuffer, Date.now()).lastInsertRowid;
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

  searchVaultFiles(query = "", category = null, userId = null, queryEmbedding = null) {
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

    if (queryEmbedding && Array.isArray(queryEmbedding) && queryEmbedding.length > 0) {
      const rows = this.db.prepare(sql).all(...params);
      const queryVec = new Float32Array(queryEmbedding);
      const scored = [];
      const qLower = (query || "").toLowerCase().trim();

      for (const row of rows) {
        let score = 0;
        if (row.embedding) {
          const rowVec = new Float32Array(
            row.embedding.buffer,
            row.embedding.byteOffset,
            row.embedding.byteLength / 4
          );
          score = cosineSimilarity(queryVec, rowVec);
        }
        if (qLower) {
          const matchName = row.filename.toLowerCase().includes(qLower);
          const matchSum = (row.summary || "").toLowerCase().includes(qLower);
          if (matchName || matchSum) score += 0.35;
        }
        if (score >= 0.45 || (qLower && (row.filename.toLowerCase().includes(qLower) || (row.summary || "").toLowerCase().includes(qLower)))) {
          scored.push({ ...row, score });
        }
      }
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, 10);
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

  getVaultFileByName(filename, ownerId = null) {
    if (!filename) return null;
    const clean = String(filename).trim();
    if (ownerId) {
      const norm = normalizePhone(ownerId);
      return this.db.prepare("SELECT * FROM vault_files WHERE filename LIKE ? AND (owner_id = ? OR owner_id = '') ORDER BY id DESC LIMIT 1").get(`%${clean}%`, norm);
    }
    return this.db.prepare("SELECT * FROM vault_files WHERE filename LIKE ? ORDER BY id DESC LIMIT 1").get(`%${clean}%`);
  }

  resolveVaultFile(target, ownerId = null) {
    if (!target) return null;
    const str = String(target).trim();
    const idMatch = str.match(/^#?(\d+)$/);
    if (idMatch) {
      const byId = this.getVaultFileById(parseInt(idMatch[1], 10));
      if (byId) return byId;
    }
    return this.getVaultFileByName(str, ownerId);
  }

  completeTodo(id, chatId) {
    const realId = this.resolveTodoId(id, chatId);
    const person = this.getPerson ? this.getPerson(chatId) : null;
    let changes = 0;
    if (isOwner(chatId)) {
      changes = this.db.prepare("UPDATE todos SET done = 1 WHERE id = ?").run(realId).changes;
    } else if (person) {
      changes = this.db.prepare(
        "UPDATE todos SET done = 1 WHERE id = ? AND (chat_id = ? OR LOWER(assignee) = LOWER(?))"
      ).run(realId, chatId, person.name.trim()).changes;
    } else {
      changes = this.db
        .prepare("UPDATE todos SET done = 1 WHERE id = ? AND chat_id = ?")
        .run(realId, chatId).changes;
    }
    if (changes > 0) {
      this.lastDoneByChat.set(chatId, realId);
    }
    return changes;
  }

  undoLastDone(chatId) {
    let lastId = this.lastDoneByChat.get(chatId);
    if (!lastId) {
      const row = isOwner(chatId)
        ? this.db.prepare("SELECT id FROM todos WHERE done = 1 ORDER BY id DESC LIMIT 1").get()
        : this.db.prepare("SELECT id FROM todos WHERE chat_id = ? AND done = 1 ORDER BY id DESC LIMIT 1").get(chatId);
      if (row) lastId = row.id;
    }
    if (!lastId) return null;
    const changes = this.db
      .prepare("UPDATE todos SET done = 0 WHERE id = ?")
      .run(lastId).changes;
    if (changes === 0) return null;
    this.lastDoneByChat.delete(chatId);
    return this.getTodoById(lastId, chatId);
  }

  findTodo(chatId, query) {
    const person = this.getPerson ? this.getPerson(chatId) : null;
    if (isOwner(chatId)) {
      return this.db
        .prepare("SELECT * FROM todos WHERE done = 0 AND task LIKE ? ORDER BY id DESC LIMIT 1")
        .get(`%${query}%`);
    } else if (person) {
      return this.db
        .prepare("SELECT * FROM todos WHERE (chat_id = ? OR LOWER(assignee) = LOWER(?)) AND done = 0 AND task LIKE ? ORDER BY id DESC LIMIT 1")
        .get(chatId, person.name.trim(), `%${query}%`);
    }
    return this.db
      .prepare("SELECT * FROM todos WHERE chat_id = ? AND done = 0 AND task LIKE ? ORDER BY id DESC LIMIT 1")
      .get(chatId, `%${query}%`);
  }

  updateTodo(id, chatId, { task, deadline, tag, category, assignee }) {
    const existing = this.getTodoById(id, chatId);
    if (!existing) return 0;
    const newTask = task !== undefined && task !== null ? task : existing.task;
    const newDeadline = deadline !== undefined ? deadline : existing.deadline;
    const newTag = tag !== undefined ? tag : existing.tag;
    const newCategory = category !== undefined ? category : existing.category;
    const newAssignee = assignee !== undefined ? assignee : (existing.assignee || "");
    return this.db
      .prepare("UPDATE todos SET task = ?, deadline = ?, tag = ?, category = ?, assignee = ? WHERE id = ?")
      .run(newTask, newDeadline, newTag, newCategory, newAssignee, id).changes;
  }

  deleteTodo(id, chatId) {
    const existing = this.getTodoById(id, chatId);
    if (!existing) return 0;
    return this.db
      .prepare("DELETE FROM todos WHERE id = ?")
      .run(id).changes;
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

  // --- Feature Requests (User Requests -> Master) ---
  addFeatureRequest(senderPhone, senderName, requestText) {
    const norm = normalizePhone(senderPhone);
    const stmt = this.db.prepare(
      "INSERT INTO feature_requests (sender_phone, sender_name, request_text, status, created_at) VALUES (?, ?, ?, 'pending', ?)"
    );
    return stmt.run(norm, senderName || "", requestText.trim(), Date.now()).lastInsertRowid;
  }

  getFeatureRequests(status = "pending") {
    if (status === "all") {
      return this.db.prepare("SELECT * FROM feature_requests ORDER BY id DESC").all();
    }
    return this.db.prepare("SELECT * FROM feature_requests WHERE status = ? ORDER BY id ASC").all(status);
  }

  completeFeatureRequest(id) {
    return this.db.prepare("UPDATE feature_requests SET status = 'done' WHERE id = ?").run(id).changes;
  }

  // --- Skills / Auto-Crystallization ---
  setSkillListener(fn) {
    this.onSkillChange = fn;
  }

  saveSkill(name, description, promptTemplate, opts = {}) {
    const cleanName = (name || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
    const stmt = this.db.prepare(
      "INSERT INTO skills (name, description, prompt_template, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(name) DO UPDATE SET description = excluded.description, prompt_template = excluded.prompt_template"
    );
    stmt.run(cleanName, (description || "").trim(), (promptTemplate || "").trim(), Date.now());
    const saved = this.getSkill(cleanName);
    if (!opts.skipDisk && this.onSkillChange) {
      try {
        this.onSkillChange({ type: "save", skill: saved });
      } catch (e) {
        console.warn("[Storage] onSkillChange error:", e.message);
      }
    }
    return saved;
  }

  getSkills() {
    return this.db.prepare("SELECT * FROM skills ORDER BY name ASC").all();
  }

  getSkill(name) {
    const cleanName = (name || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
    return this.db.prepare("SELECT * FROM skills WHERE name = ?").get(cleanName);
  }

  deleteSkill(name, opts = {}) {
    const cleanName = (name || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_");
    const changes = this.db.prepare("DELETE FROM skills WHERE name = ?").run(cleanName).changes;
    if (changes > 0 && !opts.skipDisk && this.onSkillChange) {
      try {
        this.onSkillChange({ type: "delete", name: cleanName });
      } catch (e) {
        console.warn("[Storage] onSkillChange error:", e.message);
      }
    }
    return changes;
  }

  // --- Personal Notes & Key-Value Memory ---
  saveNote(chatId, key, content) {
    const cleanKey = String(key || "").trim().toLowerCase();
    const cleanContent = String(content || "").trim();
    const stmt = this.db.prepare(`
      INSERT INTO notes (chat_id, key, content, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(chat_id, key) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at
    `);
    stmt.run(chatId, cleanKey, cleanContent, Date.now());
    return this.getNote(chatId, cleanKey);
  }

  appendNote(chatId, key, addition) {
    const cleanKey = String(key || "").trim().toLowerCase();
    const cleanAddition = String(addition || "").trim();
    if (!cleanAddition) return this.getNote(chatId, cleanKey);
    const existing = this.getNote(chatId, cleanKey);
    let newContent = cleanAddition;
    if (existing && existing.content) {
      newContent = `${existing.content}\n• ${cleanAddition}`;
    } else {
      newContent = `• ${cleanAddition}`;
    }
    return this.saveNote(chatId, cleanKey, newContent);
  }

  getNote(chatId, key) {
    const cleanKey = String(key || "").trim().toLowerCase();
    const row = this.db.prepare("SELECT * FROM notes WHERE chat_id = ? AND key = ?").get(chatId, cleanKey);
    if (row) return row;
    return this.db.prepare("SELECT * FROM notes WHERE chat_id = ? AND (key LIKE ? OR content LIKE ?) LIMIT 1").get(chatId, `%${cleanKey}%`, `%${cleanKey}%`) || null;
  }

  listNotes(chatId) {
    return this.db.prepare("SELECT key, content, updated_at FROM notes WHERE chat_id = ? ORDER BY key ASC").all(chatId);
  }

  deleteNote(chatId, key) {
    const cleanKey = String(key || "").trim().toLowerCase();
    return this.db.prepare("DELETE FROM notes WHERE chat_id = ? AND (key = ? OR key LIKE ?)").run(chatId, cleanKey, `%${cleanKey}%`).changes;
  }

  // --- Contacts & Couple Directory ---
  addPerson({ name, phone = "", role = "", notes = "", relationship = "" }) {
    if (!name || !name.trim()) throw new Error("Nama kontak tidak boleh kosong");
    const cleanName = name.trim();
    const cleanPhone = phone ? normalizePhone(phone) : "";
    const cleanRole = (role || "").trim();
    const cleanNotes = (notes || "").trim();
    const cleanRel = (relationship || "").trim();
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO contacts (name, phone, role, notes, relationship, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        phone = excluded.phone,
        role = excluded.role,
        notes = excluded.notes,
        relationship = excluded.relationship,
        updated_at = excluded.updated_at
    `).run(cleanName, cleanPhone, cleanRole, cleanNotes, cleanRel, now);

    return this.getPerson(cleanName);
  }

  getPerson(nameOrPhone) {
    if (!nameOrPhone) return null;
    const q = String(nameOrPhone).trim();
    const norm = normalizePhone(q);
    return this.db.prepare(`
      SELECT * FROM contacts 
      WHERE LOWER(name) = LOWER(?) 
         OR LOWER(name) LIKE LOWER(?) 
         OR (phone != '' AND phone = ?)
      ORDER BY CASE WHEN LOWER(name) = LOWER(?) THEN 0 ELSE 1 END, id ASC
      LIMIT 1
    `).get(q, `%${q}%`, norm, q) || null;
  }

  listPersons() {
    return this.db.prepare("SELECT * FROM contacts ORDER BY id ASC").all();
  }

  deletePerson(name) {
    if (!name) return 0;
    const q = String(name).trim();
    return this.db.prepare("DELETE FROM contacts WHERE LOWER(name) = LOWER(?) OR LOWER(name) LIKE LOWER(?)").run(q, `%${q}%`).changes;
  }
}

export function formatPersonList(persons = []) {
  if (!persons || persons.length === 0) {
    return "*[Direktori Kontak]*\nBelum ada kontak atau anggota keluarga terdaftar.";
  }
  const lines = ["*[Direktori Kontak & Koordinasi Pasangan]*\n"];
  persons.forEach((p, idx) => {
    const relStr = p.relationship ? ` [${p.relationship}]` : "";
    const roleStr = p.role ? ` • _${p.role}_` : "";
    const phoneStr = p.phone ? `\n   HP: +${p.phone}` : "";
    const notesStr = p.notes ? `\n   Catatan: ${p.notes}` : "";
    lines.push(`${idx + 1}. *${p.name}*${relStr}${roleStr}${phoneStr}${notesStr}`);
  });
  return lines.join("\n\n");
}

export function formatWibDateTime(dateInput) {
  if (!dateInput) return "Tanpa deadline";
  const d = new Date(dateInput);
  const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
  const dWib = new Date(d.getTime() + WIB_OFFSET_MS);
  const daysId = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
  const monthsId = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  const dayName = daysId[dWib.getUTCDay()];
  const dateNum = dWib.getUTCDate();
  const monthName = monthsId[dWib.getUTCMonth()];
  const year = dWib.getUTCFullYear();
  const hours = String(dWib.getUTCHours()).padStart(2, "0");
  const minutes = String(dWib.getUTCMinutes()).padStart(2, "0");
  return `${dayName}, ${dateNum} ${monthName} ${year} ${hours}.${minutes} WIB`;
}

export function formatRemindersList(reminders = []) {
  if (!reminders || reminders.length === 0) {
    return "*[Daftar Acara & Pengingat]*\nBelum ada jadwal acara atau pengingat aktif.";
  }

  const now = new Date();
  const daysId = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
  const monthsId = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

  const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
  function getWibMidnight(date) {
    const d = new Date(date.getTime() + WIB_OFFSET_MS);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }

  const nowWib = new Date(now.getTime() + WIB_OFFSET_MS);
  const hour = nowWib.getUTCHours();
  let salam = "Selamat pagi";
  if (hour >= 11 && hour < 15) salam = "Selamat siang";
  else if (hour >= 15 && hour < 18) salam = "Selamat sore";
  else if (hour >= 18 || hour < 4) salam = "Selamat malam";

  const lines = [
    `🗓️ [Daftar Acara & Pengingat]\n_${salam}!_\n`
  ];

  reminders.forEach((r, idx) => {
    let badge = "⚪";
    let scheduleStr = "Tanpa jadwal";

    if (r.remind_at) {
      const targetDate = new Date(r.remind_at);
      const diffDays = Math.round((getWibMidnight(targetDate) - getWibMidnight(now)) / (24 * 3600 * 1000));

      if (diffDays <= 0) badge = "🔴";
      else if (diffDays === 1) badge = "🟠";
      else if (diffDays <= 3) badge = "🟡";
      else badge = "🟢";

      const targetWib = new Date(targetDate.getTime() + WIB_OFFSET_MS);
      const dayName = daysId[targetWib.getUTCDay()];
      const dateNum = targetWib.getUTCDate();
      const monthName = monthsId[targetWib.getUTCMonth()];
      const year = targetWib.getUTCFullYear();
      const hours = String(targetWib.getUTCHours()).padStart(2, "0");
      const minutes = String(targetWib.getUTCMinutes()).padStart(2, "0");
      const jamStr = `${hours}.${minutes} WIB`;

      if (diffDays === 1) {
        scheduleStr = `Besok (${dateNum} ${monthName} ${year} ${jamStr})`;
      } else if (diffDays === 0) {
        scheduleStr = `Hari ini (${jamStr})`;
      } else if (diffDays < 0) {
        scheduleStr = `Terlewat (${dayName}, ${dateNum} ${monthName} ${year} ${jamStr})`;
      } else {
        scheduleStr = `H-${diffDays} (${dayName}, ${dateNum} ${monthName} ${year} ${jamStr})`;
      }
    }

    const pillTokens = [];
    if (r.recurrence === "daily") {
      pillTokens.push("`Harian`");
    } else if (r.recurrence === "weekly") {
      pillTokens.push("`Mingguan`");
    } else if (r.recurrence) {
      pillTokens.push(`\`${r.recurrence}\``);
    } else {
      pillTokens.push("`Sekali`");
    }

    if (r.task_type && r.task_type !== "reminder") {
      pillTokens.push(`\`#${r.task_type}\``);
    }

    lines.push(`${badge} *[${idx + 1}] ${r.message}*`);
    lines.push(`   ⏰ ${scheduleStr} • ${pillTokens.join(" ")}\n`);
  });

  lines.push("_Semangat!_ 💪");
  return lines.join("\n").trim();
}

export function formatNotesList(notes = []) {
  if (!notes || notes.length === 0) {
    return "*[Catatan Pribadi]*\nBelum ada catatan yang tersimpan.";
  }
  const lines = ["*[Catatan Pribadi & Memori]*\n"];
  notes.forEach((n) => {
    lines.push(`• *${n.key}*:\n  ${n.content}`);
  });
  return lines.join("\n\n");
}

export function formatSkillList(skills = []) {
  if (!skills || skills.length === 0) {
    return "*[Custom Skills]*\nBelum ada skill atau macro yang dikristalisasi.";
  }
  const lines = ["*[Custom Skills / Automasi Bot]*\n"];
  skills.forEach((s) => {
    lines.push(`• *${s.name}*\n   _${s.description}_`);
  });
  return lines.join("\n\n");
}

export function formatBacklogList(backlogs) {
  if (!backlogs || backlogs.length === 0) {
    return "*[Backlog Improvement]*\nBelum ada ide improvement yang dicatat.";
  }
  const lines = ["*[Backlog Improvement — Ide & Fitur]*\n"];
  backlogs.forEach((b) => {
    const d = new Date(b.created_at);
    const dateStr = `${d.getDate()}/${d.getMonth() + 1}`;
    lines.push(`• *[#${b.id}]* ${b.idea} _(${dateStr})_`);
  });
  lines.push("\n_Tandai selesai: #backlog done <id>_");
  return lines.join("\n");
}

export function formatFeatureRequestsList(requests) {
  if (!requests || requests.length === 0) {
    return "*[Request Fitur]*\nBelum ada request fitur dari pengguna.";
  }
  const lines = ["💡 *[Request Fitur Pengguna]*\n"];
  requests.forEach((r) => {
    const d = new Date(r.created_at);
    const dateStr = `${d.getDate()}/${d.getMonth() + 1}`;
    const who = r.sender_name ? `${r.sender_name} (+${r.sender_phone})` : `+${r.sender_phone}`;
    lines.push(`• *[#${r.id}]* ${r.request_text}`);
    lines.push(`   👤 Dari: ${who} _(${dateStr})_\n`);
  });
  lines.push("_Tandai selesai: #request done <id>_");
  return lines.join("\n").trim();
}

export function formatTodoList(todos) {
  if (!todos || todos.length === 0) {
    return "*Tidak ada tugas pending.* To-do list aman semua.";
  }

  const now = new Date();
  const daysId = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
  const monthsId = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

  // WIB (UTC+7) midnight helper for exact calendar-day countdown
  const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
  function getWibMidnight(date) {
    const d = new Date(date.getTime() + WIB_OFFSET_MS);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }

  const nowWib = new Date(now.getTime() + WIB_OFFSET_MS);
  const hour = nowWib.getUTCHours();
  let salam = "Selamat pagi";
  if (hour >= 11 && hour < 15) salam = "Selamat siang";
  else if (hour >= 15 && hour < 18) salam = "Selamat sore";
  else if (hour >= 18 || hour < 4) salam = "Selamat malam";

  const lines = [
    `🌄 [Pengingat Tugas]\n_${salam}!_\n`
  ];

  todos.forEach((item, index) => {
    let badge = "⚪";
    let deadlineStr = "Tanpa deadline";

    if (item.deadline) {
      const dl = new Date(item.deadline);
      const diffDays = Math.round((getWibMidnight(dl) - getWibMidnight(now)) / (24 * 3600 * 1000));

      if (diffDays <= 0) badge = "🔴";
      else if (diffDays === 1) badge = "🟠";
      else if (diffDays <= 3) badge = "🟡";
      else badge = "🟢";

      const dlWib = new Date(dl.getTime() + WIB_OFFSET_MS);
      const dayName = daysId[dlWib.getUTCDay()];
      const dateNum = dlWib.getUTCDate();
      const monthName = monthsId[dlWib.getUTCMonth()];
      const year = dlWib.getUTCFullYear();
      const hours = String(dlWib.getUTCHours()).padStart(2, "0");
      const minutes = String(dlWib.getUTCMinutes()).padStart(2, "0");

      const jamStr = `${hours}.${minutes} WIB`;

      if (diffDays === 1) {
        deadlineStr = `Besok (${dateNum} ${monthName} ${year} ${jamStr})`;
      } else if (diffDays === 0) {
        deadlineStr = `Hari ini (${dateNum} ${monthName} ${year} ${jamStr})`;
      } else if (diffDays < 0) {
        deadlineStr = `Terlewat (${dayName}, ${dateNum} ${monthName} ${year} ${jamStr})`;
      } else {
        deadlineStr = `H-${diffDays} (${dayName}, ${dateNum} ${monthName} ${year} ${jamStr})`;
      }
    }

    // WhatsApp inline monospace code pill formatting: `#analgor` `[P2]`
    const tagBase = item.tag ? item.tag.trim() : "#tugas";
    const tagTokens = tagBase.split(/\s+/).filter(Boolean).map((t) => {
      const clean = t.replace(/^`+|`+$/g, "");
      return `\`${clean.startsWith("#") || clean.startsWith("[") ? clean : `#${clean}`}\``;
    });

    if (item.category === "routine") {
      tagTokens.push("`[Rutin]`");
    }
    if (item.assignee) {
      tagTokens.push(`\`[👤 ${item.assignee}]\``);
    }

    lines.push(`${badge} *[${index + 1}] ${item.task}*`);
    lines.push(`   ⏰ ${deadlineStr} • ${tagTokens.join(" ")}\n`);
  });

  lines.push("_Semangat!_ 💪");
  return lines.join("\n").trim();
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
  assert.ok(formatted.includes("`#analgor` `[P2]`"));
  assert.ok(formatted.includes("🌄 [Pengingat Tugas]"));
  assert.ok(formatted.includes("_Semangat!_ 💪"));

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

  // Idle timeout test (sesi kadaluarsa jika lewat batas idle)
  const expiredHistory = store.getRecentChatHistory("user1", 8, -1);
  assert.strictEqual(expiredHistory.length, 0);

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

  // File resolution tests
  assert.strictEqual(store.resolveVaultFile(fileA).id, fileA);
  assert.strictEqual(store.resolveVaultFile(`#${fileA}`).id, fileA);
  assert.strictEqual(store.resolveVaultFile("ktp_user_a").id, fileA);

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
  const bId = store.addBacklog(OWNER_PHONE, "Buat fitur export CSV");
  assert.ok(bId > 0);
  const backlogs = store.getBacklogs(OWNER_PHONE);
  assert.strictEqual(backlogs.length, 1);
  assert.strictEqual(backlogs[0].idea, "Buat fitur export CSV");
  const formattedBacklogs = formatBacklogList(backlogs);
  assert.ok(formattedBacklogs.includes("Buat fitur export CSV"));

  store.completeBacklog(bId, OWNER_PHONE);
  assert.strictEqual(store.getBacklogs(OWNER_PHONE).length, 0);

  // Vector search & cosine similarity test
  assert.strictEqual(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.strictEqual(cosineSimilarity([1, 0], [0, 1]), 0);
  const fileVec = store.saveVaultFile({
    ownerId: "628123456789",
    filename: "struk_ukt.pdf",
    category: "receipts",
    filepath: "vault/receipts/struk_ukt.pdf",
    mimetype: "application/pdf",
    filesize: 2048,
    summary: "Bukti pembayaran UKT semester 5",
    embedding: [0.9, 0.1, 0.0]
  });
  const vecResults = store.searchVaultFiles("biaya kampus", null, "628123456789", [0.85, 0.15, 0.0]);
  assert.strictEqual(vecResults.length, 1);
  assert.strictEqual(vecResults[0].id, fileVec);

  // Auto-crystallization / Skills tests
  const skillEvents = [];
  store.setSkillListener((evt) => skillEvents.push(evt));

  const sk = store.saveSkill("rekap_malam", "Rangkum to-do list harian", "Ambil listTodos lalu buatkan ringkasan");
  assert.strictEqual(sk.name, "rekap_malam");
  assert.strictEqual(store.getSkills().length, 1);
  assert.strictEqual(store.getSkill("rekap_malam").description, "Rangkum to-do list harian");
  assert.strictEqual(skillEvents.length, 1);
  assert.strictEqual(skillEvents[0].type, "save");
  assert.strictEqual(skillEvents[0].skill.name, "rekap_malam");

  const skFormatted = formatSkillList(store.getSkills());
  assert.ok(skFormatted.includes("rekap_malam"));
  assert.strictEqual(store.deleteSkill("rekap_malam"), 1);
  assert.strictEqual(store.getSkills().length, 0);
  assert.strictEqual(skillEvents.length, 2);
  assert.strictEqual(skillEvents[1].type, "delete");
  assert.strictEqual(skillEvents[1].name, "rekap_malam");

  // Category & routine tests
  assert.strictEqual(detectTaskCategory("Absen kelas matematika"), "routine");
  assert.strictEqual(detectTaskCategory("Presensi kuliah"), "routine");
  assert.strictEqual(detectTaskCategory("Kerjakan laporan praktikum absen"), "work");
  assert.strictEqual(detectTaskCategory("Buat slide presentasi"), "work");

  const routineId = store.addTodo("user1", "Absen kuliah jam 8");
  const workId = store.addTodo("user1", "Kerjakan tugas akhir");
  assert.strictEqual(store.getTodos("user1", false).length, 1);
  assert.strictEqual(store.getTodos("user1", false)[0].id, workId);
  assert.strictEqual(store.getTodos("user1", true).length, 2);

  // Recurring reminder tests
  const remId = store.addReminder("user1", "Minum vitamin", Date.now() - 1000, "daily");
  assert.ok(remId > 0);
  assert.ok(store.getReminderById(remId));
  assert.strictEqual(store.claimReminder(remId), true);
  assert.strictEqual(store.claimReminder(remId), false); // Sudah processing
  store.releaseReminder(remId);
  assert.strictEqual(store.claimReminder(remId), true); // Bisa claim lagi setelah release
  store.releaseReminder(remId);

  // Near-horizon reminders test
  const futureRemId = store.addReminder("user1", "Reminder 2 menit lagi", Date.now() + 120_000);
  const nearReminders = store.getNearHorizonReminders(600_000);
  assert.ok(nearReminders.some((r) => r.id === futureRemId));
  store.markReminderDone(futureRemId);

  const nextRemind = store.advanceRecurringReminder(remId, "daily");
  assert.ok(nextRemind > Date.now());

  const remId6h = store.addReminder("user1", "Cek tugas tiap 6 jam", Date.now() - 1000, "every_6h");
  const nextRemind6h = store.advanceRecurringReminder(remId6h, "every_6h");
  assert.ok(nextRemind6h > Date.now());
  assert.ok(nextRemind6h - Date.now() <= 6 * 3600 * 1000);

  // Undo & detail tests
  const todoToUndo = store.addTodo("user1", "Tugas coba undo");
  assert.ok(store.getTodoById(todoToUndo, "user1"));
  store.completeTodo(todoToUndo, "user1");
  const undone = store.undoLastDone("user1");
  assert.strictEqual(undone.id, todoToUndo);
  assert.strictEqual(undone.done, 0);

  // Due tests
  const dueTodayId = store.addTodo("user1", "Deadline hari ini", Date.now() + 3600 * 1000);
  const dueTodayList = store.getTodosDue("user1", 0);
  assert.ok(dueTodayList.some((t) => t.id === dueTodayId));

  // Daily digest test
  const dailyRemId = store.setDailyDigest("user1", true);
  assert.ok(dailyRemId > 0);
  const removedDaily = store.setDailyDigest("user1", false);
  assert.ok(removedDaily >= 1);

  // Personal notes / memory & appendNote test
  const savedNote = store.saveNote("user1", "rekening_bca", "BCA 1234567890 a.n. John");
  assert.strictEqual(savedNote.key, "rekening_bca");
  assert.strictEqual(savedNote.content, "BCA 1234567890 a.n. John");
  const fetchedNote = store.getNote("user1", "bca");
  assert.strictEqual(fetchedNote.content, "BCA 1234567890 a.n. John");

  // Living list appendNote
  const appended = store.appendNote("user1", "belanja", "Telur 1kg");
  assert.ok(appended.content.includes("Telur 1kg"));
  const appended2 = store.appendNote("user1", "belanja", "Susu UHT");
  assert.ok(appended2.content.includes("Telur 1kg"));
  assert.ok(appended2.content.includes("Susu UHT"));

  const notesList = store.listNotes("user1");
  assert.strictEqual(notesList.length, 2);
  const formattedNotes = formatNotesList(notesList);
  assert.ok(formattedNotes.includes("rekening_bca"));
  assert.ok(formattedNotes.includes("belanja"));
  assert.strictEqual(store.deleteNote("user1", "rekening_bca"), 1);
  assert.strictEqual(store.deleteNote("user1", "belanja"), 1);
  assert.strictEqual(store.listNotes("user1").length, 0);

  // List & Delete Reminders test
  const testRemId1 = store.addReminder("rem_user", "Jemput adik di stasiun", Date.now() + 3600_000);
  const testRemId2 = store.addReminder("rem_user", "Bayar listrik", Date.now() + 7200_000);
  const activeRems = store.listReminders("rem_user");
  assert.strictEqual(activeRems.length, 2);
  const formattedRems = formatRemindersList(activeRems);
  assert.ok(formattedRems.includes("Jemput adik di stasiun"));
  assert.ok(formattedRems.includes("Bayar listrik"));
  assert.ok(!formattedRems.includes("[ID:"));
  assert.ok(formattedRems.includes("🗓️ [Daftar Acara & Pengingat]"));

  assert.strictEqual(store.deleteReminder("rem_user", testRemId1), 1);
  assert.strictEqual(store.deleteReminder("rem_user", "listrik"), 1);
  assert.strictEqual(store.listReminders("rem_user").length, 0);

  // Contacts & Couple Directory tests
  const p1 = store.addPerson({
    name: "Bunga",
    phone: "08987654321",
    role: "Co-Principal",
    notes: "Istri / partner",
    relationship: "Partner"
  });
  assert.strictEqual(p1.name, "Bunga");
  assert.strictEqual(p1.phone, "628987654321");
  const pFind = store.getPerson("bunga");
  assert.ok(pFind);
  assert.strictEqual(pFind.name, "Bunga");
  const pList = store.listPersons();
  assert.ok(pList.some((p) => p.name === "Bunga"));
  const pFormatted = formatPersonList(pList);
  assert.ok(pFormatted.includes("Bunga"));
  assert.ok(pFormatted.includes("Partner"));

  // Assignee task test
  const taskForBunga = store.addTodo("user1", "Beli susu oat", null, "#belanja", "work", "Bunga");
  const todosBunga = store.getTodos("user1", false, "Bunga");
  assert.strictEqual(todosBunga.length, 1);
  assert.strictEqual(todosBunga[0].id, taskForBunga);
  assert.strictEqual(todosBunga[0].assignee, "Bunga");
  const formattedAssigned = formatTodoList(todosBunga);
  assert.ok(formattedAssigned.includes("👤 Bunga"));

  assert.strictEqual(store.deletePerson("Bunga"), 1);
  assert.strictEqual(store.getPerson("Bunga"), null);

  // Sequential display indexing & resolveTodoId test
  const t1 = store.addTodo("user_seq", "Task 1", null, "#low");
  const t2 = store.addTodo("user_seq", "Task 2", null, "#low");
  const t3 = store.addTodo("user_seq", "Task 3", null, "#low");
  const t4 = store.addTodo("user_seq", "Nyapu ngepel", null, "[P1]");
  store.deleteTodo(t1, "user_seq");
  store.deleteTodo(t2, "user_seq");
  store.deleteTodo(t3, "user_seq");
  const seqTodos = store.getTodos("user_seq");
  assert.strictEqual(seqTodos.length, 1);
  assert.strictEqual(seqTodos[0].id, t4);
  const seqFormatted = formatTodoList(seqTodos);
  assert.ok(seqFormatted.includes("[1] Nyapu ngepel"), "Single remaining task must display [1], not DB id [4]");
  assert.ok(!seqFormatted.includes(`[${t4}] Nyapu ngepel`));
  assert.strictEqual(store.completeTodo(1, "user_seq"), 1);
  assert.strictEqual(store.getTodos("user_seq").length, 0);

  // Feature requests test
  const frId = store.addFeatureRequest("628123456789", "User Test", "Tolong tambahin fitur dark mode");
  const frList = store.getFeatureRequests("pending");
  assert.strictEqual(frList.length, 1);
  assert.strictEqual(frList[0].id, frId);
  assert.strictEqual(frList[0].request_text, "Tolong tambahin fitur dark mode");
  const frFormatted = formatFeatureRequestsList(frList);
  assert.ok(frFormatted.includes("dark mode"));
  assert.ok(frFormatted.includes("User Test"));
  assert.strictEqual(store.completeFeatureRequest(frId), 1);
  assert.strictEqual(store.getFeatureRequests("pending").length, 0);

  console.log("DB & Formatter self-test OK");
}
