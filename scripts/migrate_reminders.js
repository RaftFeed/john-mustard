#!/usr/bin/env node
/**
 * scripts/migrate_reminders.js
 * Migrasi data reminder acara lama ke skema pengingat 2-stage (H-1 jam sebelum acara & saat acara mulai).
 *
 * Penggunaan:
 *   node scripts/migrate_reminders.js            # Dry-run (hanya simulasi)
 *   node scripts/migrate_reminders.js --dry-run  # Dry-run eksplisit
 *   node scripts/migrate_reminders.js --apply    # Eksekusi migrasi ke database
 */

import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import process from "node:process";

const DB_PATH = process.env.DB_PATH || path.resolve(process.cwd(), "bot.db");
const args = process.argv.slice(2);
const isApply = args.includes("--apply");
const isDryRun = !isApply || args.includes("--dry-run");

const EVENT_REGEX = /\b(acara|agenda|jadwal|kuliah|kelas|rapat|meeting|latihan|pr|tugas|webinar|janji temu|technical meeting|tm)\b/i;

function formatWib(timestamp) {
  if (!timestamp) return "-";
  const d = new Date(timestamp + 7 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} WIB`;
}

function runMigration() {
  console.log(`=== Migrasi Reminder Acara (H-1 Jam) ===`);
  console.log(`Database : ${DB_PATH}`);
  console.log(`Mode     : ${isApply ? "APPLY (Menulis ke DB)" : "DRY-RUN (Simulasi saja)"}\n`);

  let db;
  try {
    db = new DatabaseSync(DB_PATH);
  } catch (err) {
    console.error(`[!] Gagal membuka database: ${err.message}`);
    process.exit(1);
  }

  const now = Date.now();
  const rows = db.prepare(
    "SELECT id, chat_id, message, remind_at, recurrence, task_type, event_at FROM reminders WHERE status = 'pending' AND (event_at > ? OR remind_at > ?)"
  ).all(now, now);

  if (rows.length === 0) {
    console.log("Tidak ada data reminder pending masa depan yang perlu diperiksa.");
    return;
  }

  const candidates = [];

  for (const row of rows) {
    if (row.task_type === "scheduled_action") continue;

    const isEvent = Boolean(
      row.event_at ||
      row.task_type === "event" ||
      EVENT_REGEX.test(row.message || "")
    );
    if (!isEvent) continue;

    const eventAt = row.event_at || row.remind_at;
    let targetRemindAt = row.remind_at;

    if (eventAt - now > 3600_000) {
      targetRemindAt = eventAt - 3600_000;
    } else {
      targetRemindAt = eventAt;
    }

    const newTaskType = row.task_type === "reminder" ? "event" : row.task_type;

    const needsUpdate = (
      row.event_at !== eventAt ||
      row.remind_at !== targetRemindAt ||
      row.task_type !== newTaskType
    );

    if (needsUpdate) {
      candidates.push({
        id: row.id,
        chat_id: row.chat_id,
        message: row.message,
        oldEventAt: row.event_at,
        newEventAt: eventAt,
        oldRemindAt: row.remind_at,
        newRemindAt: targetRemindAt,
        oldTaskType: row.task_type,
        newTaskType
      });
    }
  }

  if (candidates.length === 0) {
    console.log("Semua data reminder acara sudah sesuai dengan skema H-1 jam. Tidak ada perubahan yang diperlukan.");
    return;
  }

  console.log(`Ditemukan ${candidates.length} reminder acara yang perlu dimigrasikan:\n`);

  for (const item of candidates) {
    console.log(`[#${item.id}] "${item.message}"`);
    console.log(`  - Event At  : ${formatWib(item.oldEventAt)} -> ${formatWib(item.newEventAt)}`);
    console.log(`  - Remind At : ${formatWib(item.oldRemindAt)} -> ${formatWib(item.newRemindAt)} (${item.newEventAt - now > 3600_000 ? "H-1 jam" : "Kurang dari 1 jam, lewati H-1"})`);
    console.log(`  - Task Type : ${item.oldTaskType} -> ${item.newTaskType}`);
    console.log("");
  }

  if (isApply) {
    const updateStmt = db.prepare(
      "UPDATE reminders SET event_at = ?, remind_at = ?, task_type = ? WHERE id = ?"
    );
    let count = 0;
    for (const item of candidates) {
      updateStmt.run(item.newEventAt, item.newRemindAt, item.newTaskType, item.id);
      count++;
    }
    console.log(`[OK] Berhasil memperbarui ${count} reminder di database.`);
  } else {
    console.log(`[DRY-RUN] Simulasi selesai. Untuk menerapkan perubahan ke database, jalankan:`);
    console.log(`  node scripts/migrate_reminders.js --apply\n`);
  }
}

runMigration();
