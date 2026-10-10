import os from "node:os";
import fs from "node:fs";
import { formatTodoList, formatBacklogList, formatFeatureRequestsList, formatSkillList, formatPersonList, formatRemindersList, formatAcaraList, formatPengingatList, formatVaultList, formatNotesList, formatWibDateTime, formatTodoDetail, normalizePhone, OWNER_PHONE } from "./db.js";
import { sendText, sendFile, searchAndSendWebImage, getWhitelistPhones, resolveWhitelistRecipient, formatSenderDisplay } from "./waha.js";
import { listSkillProposals, rollbackSkill } from "./skills_sync.js";
import {
  matchExtensionFastCommand,
  executeExtensionFastCommand,
  getExtensionHelpSections
} from "./extensions/index.js";
export { buildSelfUpdatePrompt } from "./extensions/hermes.js";

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

  // Keyword langsung tanpa tanda # atau ?
  if (
    /^(?:#)?(?:tolong\s+)?(?:list|lihat|tampil(?:kan|in)?|show|cek|daftar)\s+(?:tugas|todo|to-?do|daftar\s+tugas)$/i.test(trimmed) ||
    /^(#)?(todo|todos|tugas|list\s*todo|list\s*tugas)$/i.test(trimmed)
  ) {
    return { type: "listTodos" };
  }
  if (/^(#)?(agenda|acara|jadwal|events?)$/i.test(trimmed)) {
    return { type: "reminders", category: "acara" };
  }
  if (/^(#)?(reminders?|pengingat)$/i.test(trimmed)) {
    return { type: "reminders", category: "pengingat" };
  }
  if (/^(#)?(today|hari\s*ini)$/i.test(trimmed)) {
    return { type: "today" };
  }
  if (/^(#)?(week|minggu\s*ini)$/i.test(trimmed)) {
    return { type: "week" };
  }

  // Clear completed tasks (hapus tugas selesai / yg done apus / #clear-done)
  if (
    /^(?:#)?(?:clear-?done|hapus-?done|del-?done|clean-?done|hapus-?selesai)$/i.test(trimmed) ||
    /^(?:#)?(?:tolong\s+|coba\s+)?(?:hapus|apus|del|delete|clear|bersihkan|bersihin|sapu\s+bersih)\s+(?:semua\s+)?(?:tugas\s+|todo\s+)?(?:yang\s+|yg\s+)?(?:sudah\s+|udh\s+|sdh\s+)?(?:selesai|done|beres|kelar)(?:\s+(?:aja|dong|ya|dah|deh|lah|wok|bray))?$/i.test(trimmed) ||
    /^(?:#)?(?:tolong\s+|coba\s+)?(?:semua\s+)?(?:tugas\s+|todo\s+)?(?:yang\s+|yg\s+)?(?:sudah\s+|udh\s+|sdh\s+)?(?:selesai|done|beres|kelar)\s+(?:tolong\s+)?(?:hapus|apus|del|delete|clear|bersihkan|bersihin|sapu\s+bersih)(?:\s+(?:aja|dong|ya|dah|deh|lah|wok|bray))?$/i.test(trimmed)
  ) {
    return { type: "clearDone" };
  }

  // Explicit Acara Delete (hapus acara 1, 1 acara apus, del agenda 2, etc.)
  const acaraDelMatch =
    trimmed.match(/^(?:hapus|apus|del|delete)\s+(?:acara|agenda|jadwal|event)\s+(?:no(?:mor)?\s*)?([\d,\s]+)$/i) ||
    trimmed.match(/^(?:acara|agenda|jadwal|event)\s+(?:no(?:mor)?\s*)?([\d,\s]+)\s+(?:hapus|apus|del|delete)$/i) ||
    trimmed.match(/^(?:no(?:mor)?\s*)?([\d,\s]+)\s+(?:acara|agenda|jadwal|event)\s+(?:hapus|apus|del|delete)$/i) ||
    trimmed.match(/^(?:hapus|apus|del|delete)\s+(?:no(?:mor)?\s*)?([\d,\s]+)\s+(?:acara|agenda|jadwal|event)$/i);
  if (acaraDelMatch) {
    const ids = acaraDelMatch[1].split(/[\s,]+/).map((n) => parseInt(n, 10)).filter((n) => !isNaN(n));
    if (ids.length === 1) return { type: "delete", id: ids[0], target: "reminder", category: "acara" };
    if (ids.length > 1) return { type: "deleteMultiple", ids, target: "reminder", category: "acara" };
  }

  // Explicit Pengingat Delete (hapus reminder 1, 1 pengingat apus, del reminder 2, etc.)
  const pengingatDelMatch =
    trimmed.match(/^(?:hapus|apus|del|delete)\s+(?:reminder|pengingat)\s+(?:no(?:mor)?\s*)?([\d,\s]+)$/i) ||
    trimmed.match(/^(?:reminder|pengingat)\s+(?:no(?:mor)?\s*)?([\d,\s]+)\s+(?:hapus|apus|del|delete)$/i) ||
    trimmed.match(/^(?:no(?:mor)?\s*)?([\d,\s]+)\s+(?:reminder|pengingat)\s+(?:hapus|apus|del|delete)$/i) ||
    trimmed.match(/^(?:hapus|apus|del|delete)\s+(?:no(?:mor)?\s*)?([\d,\s]+)\s+(?:reminder|pengingat)$/i);
  if (pengingatDelMatch) {
    const ids = pengingatDelMatch[1].split(/[\s,]+/).map((n) => parseInt(n, 10)).filter((n) => !isNaN(n));
    if (ids.length === 1) return { type: "delete", id: ids[0], target: "reminder", category: "pengingat" };
    if (ids.length > 1) return { type: "deleteMultiple", ids, target: "reminder", category: "pengingat" };
  }

  // Explicit Todo Delete (hapus tugas 1, 1 tugas apus, del todo 2, etc.)
  const todoDelMatch =
    trimmed.match(/^(?:hapus|apus|del|delete)\s+(?:tugas|todo)\s+(?:no(?:mor)?\s*)?([\d,\s]+)$/i) ||
    trimmed.match(/^(?:tugas|todo)\s+(?:no(?:mor)?\s*)?([\d,\s]+)\s+(?:hapus|apus|del|delete)$/i) ||
    trimmed.match(/^(?:no(?:mor)?\s*)?([\d,\s]+)\s+(?:tugas|todo)\s+(?:hapus|apus|del|delete)$/i) ||
    trimmed.match(/^(?:hapus|apus|del|delete)\s+(?:no(?:mor)?\s*)?([\d,\s]+)\s+(?:tugas|todo)$/i);
  if (todoDelMatch) {
    const ids = todoDelMatch[1].split(/[\s,]+/).map((n) => parseInt(n, 10)).filter((n) => !isNaN(n));
    if (ids.length === 1) return { type: "delete", id: ids[0], target: "todo" };
    if (ids.length > 1) return { type: "deleteMultiple", ids, target: "todo" };
  }

  // Explicit Acara Done (acara 1 kelar, done acara 2, 1 agenda selesai, etc.)
  const acaraDoneMatch =
    trimmed.match(/^(?:kelar|beres|selesai|done)\s+(?:acara|agenda|jadwal|event)\s+(?:no(?:mor)?\s*)?(\d+)$/i) ||
    trimmed.match(/^(?:acara|agenda|jadwal|event)\s+(?:no(?:mor)?\s*)?(\d+)\s*(?:udh|udah|sdh|sudah)?\s*(?:kelar|beres|selesai|done)$/i) ||
    trimmed.match(/^(?:no(?:mor)?\s*)?(\d+)\s+(?:acara|agenda|jadwal|event)\s*(?:udh|udah|sdh|sudah)?\s*(?:kelar|beres|selesai|done)$/i);
  if (acaraDoneMatch) {
    return { type: "done", id: parseInt(acaraDoneMatch[1], 10), target: "reminder", category: "acara" };
  }

  // Explicit Pengingat Done (reminder 1 kelar, done pengingat 2, etc.)
  const pengingatDoneMatch =
    trimmed.match(/^(?:kelar|beres|selesai|done)\s+(?:reminder|pengingat)\s+(?:no(?:mor)?\s*)?(\d+)$/i) ||
    trimmed.match(/^(?:reminder|pengingat)\s+(?:no(?:mor)?\s*)?(\d+)\s*(?:udh|udah|sdh|sudah)?\s*(?:kelar|beres|selesai|done)$/i) ||
    trimmed.match(/^(?:no(?:mor)?\s*)?(\d+)\s+(?:reminder|pengingat)\s*(?:udh|udah|sdh|sudah)?\s*(?:kelar|beres|selesai|done)$/i);
  if (pengingatDoneMatch) {
    return { type: "done", id: parseInt(pengingatDoneMatch[1], 10), target: "reminder", category: "pengingat" };
  }

  // Explicit Todo Done (tugas 1 kelar, done todo 2, 1 tugas beres, etc.)
  const todoDoneMatch =
    trimmed.match(/^(?:kelar|beres|selesai|done)\s+(?:tugas|todo)\s+(?:no(?:mor)?\s*)?(\d+)$/i) ||
    trimmed.match(/^(?:tugas|todo)\s+(?:no(?:mor)?\s*)?(\d+)\s*(?:udh|udah|sdh|sudah)?\s*(?:kelar|beres|selesai|done)$/i) ||
    trimmed.match(/^(?:no(?:mor)?\s*)?(\d+)\s+(?:tugas|todo)\s*(?:udh|udah|sdh|sudah)?\s*(?:kelar|beres|selesai|done)$/i);
  if (todoDoneMatch) {
    return { type: "done", id: parseInt(todoDoneMatch[1], 10), target: "todo" };
  }

  // Natural Add (tambahin tugas X, catat X ke todo, etc.)
  const naturalAdd = trimmed.match(
    /^(?:tolong\s+)?(?:tambahin|tambah|catat(?:in|kan)?|add|bikin)\s+(?:tugas|todo|to-?do|ke\s+(?:todo|tugas))\s*(.+)$/i
  );
  if (naturalAdd && naturalAdd[1].trim()) {
    return { type: "add", raw: naturalAdd[1].trim() };
  }

  // Natural Commands (Bypass LLM for instant <10ms execution)
  const naturalDone =
    trimmed.match(/^(?:no(?:mor)?\s*)?([\d,\s]+)\s*(?:udh|udah|sdh|sudah)?\s*(?:kelar|beres|selesai|done)$/i) ||
    trimmed.match(/^(?:kelar|beres|selesai|done)\s+(?:no(?:mor)?\s*)?([\d,\s]+)$/i);
  if (naturalDone) {
    const ids = naturalDone[1].split(/[\s,]+/).map((n) => parseInt(n, 10)).filter((n) => !isNaN(n));
    if (ids.length === 1) return { type: "done", id: ids[0], target: "auto" };
    if (ids.length > 1) return { type: "doneMultiple", ids, target: "auto" };
  }

  // Natural Uncomplete (batalin tugas 3, unfinish 3, 3 belum selesai, etc.)
  const naturalUncomplete =
    trimmed.match(/^(?:batal(?:in|kan)?|cancel|unfinish|undo)\s+(?:selesai(?:nya)?\s+)?(?:tugas|todo|to-?do|no(?:mor)?)?\s*(\d+)$/i) ||
    trimmed.match(/^(?:belum\s+selesai|unfinish|batal(?:in|kan)?|cancel)\s+(?:tugas|todo|to-?do)\s+(?:no(?:mor)?\s*)?(\d+)$/i) ||
    trimmed.match(/^(?:no(?:mor)?\s*)?(\d+)\s+(?:belum\s+selesai|batal(?:in|kan)?|unfinish|jadi\s+pending|balikin(?:\s+jadi\s+pending)?)$/i);
  if (naturalUncomplete) {
    return { type: "uncomplete", id: parseInt(naturalUncomplete[1], 10) };
  }

  const naturalDel =
    trimmed.match(/^(?:hapus|apus|del|delete)\s+(?:no(?:mor)?\s*)?([\d,\s]+)$/i) ||
    trimmed.match(/^(?:no(?:mor)?\s*)?([\d,\s]+)\s+(?:hapus|apus|del|delete)$/i);
  if (naturalDel) {
    const ids = naturalDel[1].split(/[\s,]+/).map((n) => parseInt(n, 10)).filter((n) => !isNaN(n));
    if (ids.length === 1) return { type: "delete", id: ids[0], target: "auto" };
    if (ids.length > 1) return { type: "deleteMultiple", ids, target: "auto" };
  }

  const naturalMove =
    trimmed.match(/^(?:eh\s+)?(?:itu\s+)?(?:tolong\s+)?(?:pindah(?:in)?|ganti)\s+(?:no(?:mor)?\s*)?(\d+)\s+(?:ke\s+)(todo|tugas|acara|agenda)(?:.*)$/i) ||
    trimmed.match(/^(?:eh\s+)?(?:itu\s+)?(?:tolong\s+)?(?:pindah(?:in)?|ganti)\s+(?:ke\s+)(todo|tugas|acara|agenda)\s+(?:no(?:mor)?\s*)?(\d+)(?:.*)$/i);
  if (naturalMove) {
    const id = parseInt(naturalMove[1], 10);
    const target = naturalMove[2].toLowerCase();
    const isTargetTodo = target === "todo" || target === "tugas";
    return { type: isTargetTodo ? "moveToTodo" : "moveToReminder", id };
  }

  const naturalReplace = trimmed.match(/^(?:no(?:mor)?\s*)?(\d+)\s+bukan\s+(.+?)\s+tapi\s+(.+)$/i);
  if (naturalReplace) {
    return {
      type: "replaceTitle",
      id: parseInt(naturalReplace[1], 10),
      find: naturalReplace[2].trim(),
      replace: naturalReplace[3].trim()
    };
  }

  const naturalRename = trimmed.match(/^(?:edit|ganti)\s+(?:nama|judul)?\s*(?:no(?:mor)?\s*)?(\d+)\s+jadi\s+(.+)$/i);
  if (naturalRename) {
    return {
      type: "renameItem",
      id: parseInt(naturalRename[1], 10),
      newTitle: naturalRename[2].trim()
    };
  }

  const naturalTime = trimmed.match(/^(?:edit|ganti)?\s*(?:jam|waktu)\s*(?:no(?:mor)?\s*)?(\d+)\s+(?:jadi|ke|ganti ke)\s+(\d{1,2}[:.]\d{2})$/i);
  if (naturalTime) {
    return {
      type: "updateTime",
      id: parseInt(naturalTime[1], 10),
      newTime: naturalTime[2].replace(".", ":")
    };
  }

  if (!trimmed.startsWith("#") && !trimmed.startsWith("?")) return null;

  if (/^#ping\b/i.test(trimmed)) {
    return { type: "ping" };
  }

  const doneMatch = trimmed.match(/^#done\s+(\d+)$/i);
  if (doneMatch) {
    return { type: "done", id: parseInt(doneMatch[1], 10), target: "auto" };
  }

  const unDoneMatch = trimmed.match(/^#(?:undone|unfinish|uncomplete)\s+(\d+)$/i);
  if (unDoneMatch) {
    return { type: "uncomplete", id: parseInt(unDoneMatch[1], 10) };
  }

  if (/^#undo\b/i.test(trimmed)) {
    return { type: "undo" };
  }

  const delMatch = trimmed.match(/^#(delete|del|hapus)\s+(\d+)$/i);
  if (delMatch) {
    return { type: "delete", id: parseInt(delMatch[2], 10), target: "auto" };
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

  const vaultMatch = trimmed.match(/^#vault(\s+(.*))?$/is);
  if (vaultMatch) {
    const sub = (vaultMatch[2] || "").trim();
    if (!sub || sub.toLowerCase() === "list") {
      return { type: "vaultList" };
    }
    const cariMatch = sub.match(/^(?:cari|search)\s+(.+)$/i);
    if (cariMatch) {
      return { type: "vaultSearch", query: cariMatch[1].trim() };
    }
    const getMatch = sub.match(/^(?:get|ambil|kirim)\s+(\d+)$/i);
    if (getMatch) {
      return { type: "vaultGet", id: parseInt(getMatch[1], 10) };
    }
    const delMatch = sub.match(/^(?:del|delete|hapus|apus)\s+(\d+)$/i);
    if (delMatch) {
      return { type: "vaultDel", id: parseInt(delMatch[1], 10) };
    }
    const renameMatch = sub.match(/^rename\s+(\d+)\s+(.+)$/i);
    if (renameMatch) {
      return { type: "vaultRename", id: parseInt(renameMatch[1], 10), name: renameMatch[2].trim() };
    }
    return { type: "vaultSearch", query: sub };
  }

  const noteMatch = trimmed.match(/^#(notes?|catatan)(\s+(.*))?$/is);
  if (noteMatch) {
    const sub = (noteMatch[3] || "").trim();
    if (!sub || sub.toLowerCase() === "list") {
      return { type: "noteList" };
    }
    const getMatch = sub.match(/^get\s+(\S+)$/i);
    if (getMatch) {
      return { type: "noteGet", key: getMatch[1] };
    }
    const addMatch = sub.match(/^(?:add|set|simpan)\s+(\S+)\s+(.+)$/is);
    if (addMatch) {
      return { type: "noteAdd", key: addMatch[1], content: addMatch[2].trim() };
    }
    const delMatch = sub.match(/^(?:del|hapus|delete|remove)\s+(\S+)$/i);
    if (delMatch) {
      return { type: "noteDel", key: delMatch[1] };
    }
    return { type: "noteGet", key: sub };
  }
  if (/^#delnote\s+(\S+)$/i.test(trimmed)) {
    const match = trimmed.match(/^#delnote\s+(\S+)$/i);
    return { type: "noteDel", key: match[1] };
  }

  const kontakAddMatch = trimmed.match(/^#(?:kontak|contacts|directory)\s+add\s+(.+)$/is);
  if (kontakAddMatch) {
    const parts = kontakAddMatch[1].split("|").map((s) => s.trim());
    return {
      type: "contactAdd",
      name: parts[0] || "",
      phone: parts[1] || "",
      role: parts[2] || "",
      notes: parts[3] || ""
    };
  }
  const kontakDelMatch = trimmed.match(/^#(?:kontak|contacts|directory)\s+(?:del|hapus|delete)\s+(.+)$/i);
  if (kontakDelMatch) {
    return { type: "contactDel", name: kontakDelMatch[1].trim() };
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
    const bDelMatch = sub.match(/^(?:del|delete|hapus|remove)\s+(\d+)$/i);
    if (!sub || sub.toLowerCase() === "list") {
      return { type: "backlogList" };
    }
    if (bDoneMatch) {
      return { type: "backlogDone", id: parseInt(bDoneMatch[1], 10) };
    }
    if (bDelMatch) {
      return { type: "backlogDel", id: parseInt(bDelMatch[1], 10) };
    }
    return { type: "backlogAdd", idea: sub };
  }

  const requestMatch = trimmed.match(/^#(request|feedback)(\s+(.*))?$/is);
  if (requestMatch) {
    const sub = (requestMatch[3] || "").trim();
    const rDoneMatch = sub.match(/^done\s+(\d+)$/i);
    const rDelMatch = sub.match(/^(?:del|delete|hapus|remove)\s+(\d+)$/i);
    if (!sub || sub.toLowerCase() === "list") {
      return { type: "requestList" };
    }
    if (rDoneMatch) {
      return { type: "requestDone", id: parseInt(rDoneMatch[1], 10) };
    }
    if (rDelMatch) {
      return { type: "requestDel", id: parseInt(rDelMatch[1], 10) };
    }
    return { type: "requestAdd", text: sub };
  }

  const frDelMatch = trimmed.match(/^#fr\s+(?:del|delete|hapus)\s+(\d+)$/i);
  if (frDelMatch) {
    return { type: "requestDel", id: parseInt(frDelMatch[1], 10) };
  }

  if (/^#requests\b/i.test(trimmed)) {
    return { type: "requestList" };
  }

  if (/^#whitelist\b/i.test(trimmed)) {
    return { type: "whitelist" };
  }

  const imgMatch = trimmed.match(/^#(foto|gambar|img|image)(\s+(.*))?$/is);
  if (imgMatch) {
    const q = (imgMatch[3] || "").trim();
    return { type: "searchImage", query: q };
  }

  const pcMatch = trimmed.match(/^#(pc|japri|dm|pm)\s+(\S+)\s+(.+)$/is);
  if (pcMatch) {
    return {
      type: "sendDirectMessage",
      recipient: pcMatch[2],
      message: pcMatch[3].trim()
    };
  }

  if (/^#(health|server|sys|system)\b/i.test(trimmed)) {
    return { type: "health" };
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

  const extCmd = matchExtensionFastCommand(trimmed);
  if (extCmd) {
    return extCmd;
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

export function resolveItemScope(target = "auto", { store, chatId, quoted } = {}) {
  if (target === "reminder" || target === "todo" || target === "acara" || target === "pengingat") {
    return target;
  }

  // 1. Periksa pesan yang di-reply (quote)
  if (quoted) {
    const qText = typeof quoted.content === "string"
      ? quoted.content
      : (quoted.content?.text || quoted.text || quoted.body || "");
    if (qText) {
      const isAcara = /\[Daftar Acara & Agenda\]|\[Daftar Acara\]|\[ACARA\]|#acara/i.test(qText);
      const isPengingat = /\[Daftar Pengingat\]|\[Pengingat\]|#pengingat|\[Sistem\]/i.test(qText);
      const isReminder = /\[Daftar Acara & Pengingat\]|\[Pengingat Acara & Agenda\]|🗓️|— H-\d+|sekali\b/i.test(qText);
      const isTodo = /\[To-Do List\]|🌄|\[Tugas Hari Ini\]|\[Tugas 7 Hari Ke Depan\]|🟡\s*\[\d+\]|🟢\s*\[\d+\]/i.test(qText);
      if (isAcara && !isTodo && !isPengingat) return "acara";
      if (isPengingat && !isTodo && !isAcara) return "pengingat";
      if (isReminder && !isTodo) return "reminder";
      if (isTodo && !isReminder && !isAcara && !isPengingat) return "todo";
    }
  }

  // 2. Periksa pesan terakhir bot di chat_history
  if (store && typeof store.getRecentChatHistory === "function" && chatId) {
    try {
      const history = store.getRecentChatHistory(chatId, 8);
      for (let i = history.length - 1; i >= 0; i--) {
        const msg = history[i];
        if (msg.role === "model" && msg.content) {
          const isAcara = /\[Daftar Acara & Agenda\]|\[Daftar Acara\]|\[ACARA\]|#acara/i.test(msg.content);
          const isPengingat = /\[Daftar Pengingat\]|\[Pengingat\]|#pengingat|\[Sistem\]/i.test(msg.content);
          const isReminder = /\[Daftar Acara & Pengingat\]|\[Pengingat Acara & Agenda\]|🗓️|— H-\d+|sekali\b/i.test(msg.content);
          const isTodo = /\[To-Do List\]|🌄|\[Tugas Hari Ini\]|\[Tugas 7 Hari Ke Depan\]/i.test(msg.content);
          if (isAcara && !isTodo && !isPengingat) return "acara";
          if (isPengingat && !isTodo && !isAcara) return "pengingat";
          if (isReminder && !isTodo) return "reminder";
          if (isTodo && !isReminder && !isAcara && !isPengingat) return "todo";
          break;
        }
      }
    } catch {}
  }

  // 3. Jika tidak ada petunjuk list terakhir, cek keberadaan item aktif
  if (store && chatId) {
    try {
      const hasTodos = store.getTodos ? store.getTodos(chatId, true).length > 0 : false;
      const hasEvents = store.listEvents ? store.listEvents(chatId).length > 0 : false;
      const hasPengingat = store.listPengingat ? store.listPengingat(chatId).length > 0 : false;
      const hasReminders = store.listReminders ? store.listReminders(chatId).length > 0 : false;
      if (hasEvents && !hasTodos && !hasPengingat) return "acara";
      if (hasPengingat && !hasTodos && !hasEvents) return "pengingat";
      if (hasReminders && !hasTodos) return "reminder";
      if (hasTodos && !hasReminders) return "todo";
    } catch {}
  }

  return "ambiguous";
}

export async function executeFastCommand(cmd, ctx = {}) {
  if (!cmd) return null;
  const { store, chatId, isOwner = false, senderName = "", senderNumber = "", quoted = null } = ctx;

  // Catat urutan list terakhir yang ditampilkan supaya nomor urut yang dirujuk user
  // selalu merujuk ke item yang mereka lihat.
  const rememberTodos = (list) => {
    if (store && store.rememberTodoList && Array.isArray(list)) store.rememberTodoList(chatId, list);
  };
  const rememberRems = (list) => {
    if (store && store.rememberReminderList && Array.isArray(list)) store.rememberReminderList(chatId, list);
  };
  const rememberAcara = (list) => {
    if (store && store.rememberAcaraList && Array.isArray(list)) store.rememberAcaraList(chatId, list);
    if (store && store.rememberReminderList && Array.isArray(list)) store.rememberReminderList(chatId, list);
  };
  const rememberPengingat = (list) => {
    if (store && store.rememberPengingatList && Array.isArray(list)) store.rememberPengingatList(chatId, list);
    if (store && store.rememberReminderList && Array.isArray(list)) store.rememberReminderList(chatId, list);
  };

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
      const isGroup = String(chatId).endsWith("@g.us");
      const todos = store.getTodos(chatId, false);
      rememberTodos(todos);
      return formatTodoList(todos, isGroup);
    }

    case "today": {
      const isGroup = String(chatId).endsWith("@g.us");
      const todos = store.getTodosDue(chatId, 0);
      if (todos.length === 0) return "*[Tugas Hari Ini]*\nGak ada tugas dengan deadline hari ini. Aman.";
      rememberTodos(todos);
      return formatTodoList(todos, isGroup);
    }

    case "week": {
      const isGroup = String(chatId).endsWith("@g.us");
      const todos = store.getTodosDue(chatId, 7);
      if (todos.length === 0) return "*[Tugas 7 Hari Ke Depan]*\nGak ada tugas dalam 7 hari ke depan. Santai.";
      rememberTodos(todos);
      return formatTodoList(todos, isGroup);
    }

    case "done": {
      const scope = resolveItemScope(cmd.category || cmd.target, { store, chatId, quoted });
      if (scope === "acara") {
        if (store.deleteReminder) {
          const targetId = store.resolveAcaraId ? store.resolveAcaraId(cmd.id, chatId) : cmd.id;
          const remChanged = store.deleteReminder(chatId, targetId, { rawId: true });
          if (remChanged > 0) {
            const remaining = store.listEvents ? store.listEvents(chatId) : [];
            rememberAcara(remaining);
            const formatted = remaining.length > 0 ? `\n\n${formatAcaraList(remaining)}` : "";
            return `[OK] Acara #${cmd.id} selesai & dihapus dari agenda.${formatted}`;
          }
        }
        return `[!] Acara #${cmd.id} gak ketemu atau udah selesai.`;
      }
      if (scope === "pengingat") {
        if (store.deleteReminder) {
          const targetId = store.resolvePengingatId ? store.resolvePengingatId(cmd.id, chatId) : cmd.id;
          const remChanged = store.deleteReminder(chatId, targetId, { rawId: true });
          if (remChanged > 0) {
            const remaining = store.listPengingat ? store.listPengingat(chatId) : [];
            rememberPengingat(remaining);
            const formatted = remaining.length > 0 ? `\n\n${formatPengingatList(remaining)}` : "";
            return `[OK] Pengingat #${cmd.id} selesai & dihapus.${formatted}`;
          }
        }
        return `[!] Pengingat #${cmd.id} gak ketemu atau udah selesai.`;
      }
      if (scope === "reminder") {
        if (store.deleteReminder) {
          const remChanged = store.deleteReminder(chatId, cmd.id);
          if (remChanged > 0) {
            const remaining = store.listReminders ? store.listReminders(chatId) : [];
            rememberRems(remaining);
            const formatted = remaining.length > 0 ? `\n\n${formatRemindersList(remaining)}` : "";
            return `[OK] Acara/pengingat #${cmd.id} selesai & dihapus dari agenda.${formatted}`;
          }
        }
        return `[!] Acara/pengingat #${cmd.id} gak ketemu atau udah selesai.`;
      }
      if (scope === "todo") {
        const targetTodo = store.getTodoById ? store.getTodoById(cmd.id, chatId) : null;
        const changed = store.completeTodo(cmd.id, chatId);
        if (changed > 0) {
          const isOverdue = Boolean(targetTodo && targetTodo.deadline && targetTodo.deadline <= Date.now());
          if (isOverdue && store.deleteTodo) {
            store.deleteTodo(targetTodo.id, chatId, { rawId: true });
            rememberTodos(store.getTodos ? store.getTodos(chatId, false) : []);
            return `[OK] Tugas #${cmd.id} selesai & otomatis dihapus karena sudah lewat deadline. (Ketik #undo kalau mau batalin)`;
          }
          rememberTodos(store.getTodos ? store.getTodos(chatId, false) : []);
          return `[OK] Tugas #${cmd.id} selesai. (Ketik #undo atau "batalin tugas ${cmd.id}" kalau mau batalin)`;
        }
        return `[!] Tugas #${cmd.id} gak ketemu atau udah selesai.`;
      }
      return `Mau tandai selesai nomor #${cmd.id} untuk Tugas, Acara, atau Pengingat? Ketik "#done ${cmd.id}", "acara ${cmd.id} selesai", atau "pengingat ${cmd.id} selesai".`;
    }

    case "doneMultiple": {
      const scope = resolveItemScope(cmd.category || cmd.target || "auto", { store, chatId, quoted });
      let completed = 0;
      let autoArchived = 0;
      for (const id of cmd.ids) {
        if (scope === "acara" && store.deleteReminder) {
          const targetId = store.resolveAcaraId ? store.resolveAcaraId(id, chatId) : id;
          const changed = store.deleteReminder(chatId, targetId, { rawId: true });
          if (changed > 0) completed++;
        } else if (scope === "pengingat" && store.deleteReminder) {
          const targetId = store.resolvePengingatId ? store.resolvePengingatId(id, chatId) : id;
          const changed = store.deleteReminder(chatId, targetId, { rawId: true });
          if (changed > 0) completed++;
        } else if (scope === "reminder" && store.deleteReminder) {
          const changed = store.deleteReminder(chatId, id);
          if (changed > 0) completed++;
        } else {
          const targetTodo = store.getTodoById ? store.getTodoById(id, chatId) : null;
          const changed = store.completeTodo(id, chatId);
          if (changed > 0) {
            completed++;
            if (targetTodo && targetTodo.deadline && targetTodo.deadline <= Date.now() && store.deleteTodo) {
              store.deleteTodo(targetTodo.id, chatId, { rawId: true });
              autoArchived++;
            }
          }
        }
      }
      if (completed > 0) {
        if (scope === "acara" && store.listEvents) {
          rememberAcara(store.listEvents(chatId));
          return `[OK] ${completed} acara selesai.`;
        }
        if (scope === "pengingat" && store.listPengingat) {
          rememberPengingat(store.listPengingat(chatId));
          return `[OK] ${completed} pengingat selesai.`;
        }
        if (scope === "reminder" && store.listReminders) {
          rememberRems(store.listReminders(chatId));
          return `[OK] ${completed} acara/pengingat selesai.`;
        }
        rememberTodos(store.getTodos ? store.getTodos(chatId, false) : []);
        if (autoArchived > 0) {
          return `[OK] ${completed} tugas selesai (${autoArchived} otomatis dihapus karena lewat deadline).`;
        }
        return `[OK] ${completed} tugas selesai.`;
      }
      return `[!] Tidak ada tugas yang ditemukan atau sudah selesai.`;
    }

    case "uncomplete": {
      const changed = store.uncompleteTodo ? store.uncompleteTodo(cmd.id, chatId) : 0;
      if (changed > 0) {
        rememberTodos(store.getTodos ? store.getTodos(chatId, false) : []);
        return `[OK] Tugas #${cmd.id} dibalikin jadi belum selesai.`;
      }
      return `[!] Tugas #${cmd.id} gak ketemu atau statusnya belum ditandai selesai.`;
    }

    case "undo": {
      const isGroup = String(chatId).endsWith("@g.us");
      if (store.restoreLastDeleted) {
        const restoredDel = store.restoreLastDeleted(chatId);
        if (restoredDel) {
          if (restoredDel.type === "todoBatch") {
            const remaining = store.getTodos ? store.getTodos(chatId, false) : [];
            rememberTodos(remaining);
            const formatted = remaining.length > 0 ? `\n\n${formatTodoList(remaining, isGroup)}` : "";
            return `[OK] Berhasil memulihkan ${restoredDel.count} tugas yang sebelumnya selesai.${formatted}`;
          } else if (restoredDel.type === "todo") {
            const remaining = store.getTodos ? store.getTodos(chatId, false) : [];
            rememberTodos(remaining);
            const formatted = remaining.length > 0 ? `\n\n${formatTodoList(remaining, isGroup)}` : "";
            return `[OK] Tugas #${restoredDel.item.id} ("${restoredDel.item.task}") berhasil dipulihkan.${formatted}`;
          } else if (restoredDel.type === "reminder") {
            const remaining = store.listReminders ? store.listReminders(chatId) : [];
            rememberRems(remaining);
            const formatted = remaining.length > 0 ? `\n\n${formatRemindersList(remaining)}` : "";
            return `[OK] Acara/pengingat #${restoredDel.item.id} ("${restoredDel.item.message}") berhasil dipulihkan.${formatted}`;
          } else if (restoredDel.type === "vault") {
            const remaining = store.listVaultFiles ? store.listVaultFiles(chatId) : [];
            if (store.rememberVaultList) store.rememberVaultList(chatId, remaining);
            return `[OK] File '${restoredDel.item.filename}' berhasil dipulihkan kembali ke Vault dari .trash.`;
          }
        }
      }
      const restored = store.undoLastDone(chatId);
      if (restored) {
        rememberTodos(store.getTodos ? store.getTodos(chatId, false) : []);
        return `[OK] Tugas #${restored.id} ("${restored.task}") dibalikin jadi pending.`;
      }
      return "[!] Gak ada riwayat tugas atau pengingat yang baru dihapus/ditandai selesai.";
    }

    case "delete": {
      const isGroup = String(chatId).endsWith("@g.us");
      const scope = resolveItemScope(cmd.category || cmd.target, { store, chatId, quoted });
      if (scope === "acara") {
        if (store.deleteReminder) {
          const targetId = store.resolveAcaraId ? store.resolveAcaraId(cmd.id, chatId) : cmd.id;
          const remChanged = store.deleteReminder(chatId, targetId, { rawId: true });
          if (remChanged > 0) {
            const remaining = store.listEvents ? store.listEvents(chatId) : [];
            rememberAcara(remaining);
            const formatted = remaining.length > 0 ? `\n\n${formatAcaraList(remaining)}` : "";
            return `[OK] Acara #${cmd.id} berhasil dihapus (Ketik #undo untuk memulihkan).${formatted}`;
          }
        }
        return `[!] Acara #${cmd.id} gak ketemu.`;
      }
      if (scope === "pengingat") {
        if (store.deleteReminder) {
          const targetId = store.resolvePengingatId ? store.resolvePengingatId(cmd.id, chatId) : cmd.id;
          const remChanged = store.deleteReminder(chatId, targetId, { rawId: true });
          if (remChanged > 0) {
            const remaining = store.listPengingat ? store.listPengingat(chatId) : [];
            rememberPengingat(remaining);
            const formatted = remaining.length > 0 ? `\n\n${formatPengingatList(remaining)}` : "";
            return `[OK] Pengingat #${cmd.id} berhasil dihapus (Ketik #undo untuk memulihkan).${formatted}`;
          }
        }
        return `[!] Pengingat #${cmd.id} gak ketemu.`;
      }
      if (scope === "reminder") {
        if (store.deleteReminder) {
          const remChanged = store.deleteReminder(chatId, cmd.id);
          if (remChanged > 0) {
            const remaining = store.listReminders ? store.listReminders(chatId) : [];
            rememberRems(remaining);
            const formatted = remaining.length > 0 ? `\n\n${formatRemindersList(remaining)}` : "";
            return `[OK] Acara/pengingat #${cmd.id} berhasil dihapus (Ketik #undo untuk memulihkan).${formatted}`;
          }
        }
        return `[!] Acara/pengingat #${cmd.id} gak ketemu.`;
      }
      if (scope === "todo") {
        const changed = store.deleteTodo(cmd.id, chatId);
        if (changed > 0) {
          const remaining = store.getTodos ? store.getTodos(chatId) : [];
          rememberTodos(remaining);
          const formatted = remaining.length > 0 ? `\n\n${formatTodoList(remaining, isGroup)}` : "";
          return `[OK] Tugas #${cmd.id} berhasil dihapus (Ketik #undo untuk memulihkan).${formatted}`;
        }
        return `[!] Tugas #${cmd.id} gak ketemu atau udah dihapus.`;
      }
      return `Mau hapus nomor #${cmd.id} dari To-Do List atau dari Daftar Acara? Ketik "hapus tugas ${cmd.id}", "hapus acara ${cmd.id}", atau "hapus pengingat ${cmd.id}".`;
    }

    case "deleteMultiple": {
      const isGroup = String(chatId).endsWith("@g.us");
      const scope = resolveItemScope(cmd.category || cmd.target, { store, chatId, quoted });
      if (scope === "ambiguous") {
        return `Mau hapus [${cmd.ids.join(", ")}] dari To-Do List atau dari Daftar Acara? Contoh: "hapus tugas ${cmd.ids.join(" ")}", "hapus acara ${cmd.ids.join(" ")}", atau "hapus pengingat ${cmd.ids.join(" ")}".`;
      }
      const deletedTodos = [];
      const deletedRems = [];
      if (scope === "acara") {
        const realIds = cmd.ids.map((id) => (store.resolveAcaraId ? store.resolveAcaraId(id, chatId) : id));
        for (const realId of realIds) {
          if (store.deleteReminder && store.deleteReminder(chatId, realId, { rawId: true }) > 0) {
            deletedRems.push(realId);
          }
        }
      } else if (scope === "pengingat") {
        const realIds = cmd.ids.map((id) => (store.resolvePengingatId ? store.resolvePengingatId(id, chatId) : id));
        for (const realId of realIds) {
          if (store.deleteReminder && store.deleteReminder(chatId, realId, { rawId: true }) > 0) {
            deletedRems.push(realId);
          }
        }
      } else if (scope === "reminder") {
        // Resolve semua nomor urut dari SATU snapshot dulu, biar tidak bergeser
        // saat beberapa item dihapus berturut-turut dalam satu perintah.
        const realIds = store.resolveReminderIndexes ? store.resolveReminderIndexes(cmd.ids, chatId) : cmd.ids;
        for (const realId of realIds) {
          if (store.deleteReminder && store.deleteReminder(chatId, realId, { rawId: true }) > 0) {
            deletedRems.push(realId);
          }
        }
      } else if (scope === "todo") {
        const realIds = store.resolveTodoIndexes ? store.resolveTodoIndexes(cmd.ids, chatId) : cmd.ids;
        for (const realId of realIds) {
          if (store.deleteTodo(realId, chatId, { rawId: true }) > 0) {
            deletedTodos.push(realId);
          }
        }
      }
      const totalDeleted = deletedTodos.length + deletedRems.length;
      if (totalDeleted === 0) {
        return `[!] Tidak ada item dari [${cmd.ids.join(", ")}] yang ditemukan.`;
      }
      let reply = `[OK] Berhasil menghapus ${totalDeleted} item (Ketik #undo untuk memulihkan).`;
      if (deletedTodos.length > 0) {
        const remaining = store.getTodos ? store.getTodos(chatId) : [];
        rememberTodos(remaining);
        reply += `\n\n${formatTodoList(remaining, isGroup)}`;
      } else if (deletedRems.length > 0) {
        if (scope === "acara") {
          const remaining = store.listEvents ? store.listEvents(chatId) : [];
          rememberAcara(remaining);
          reply += `\n\n${formatAcaraList(remaining)}`;
        } else if (scope === "pengingat") {
          const remaining = store.listPengingat ? store.listPengingat(chatId) : [];
          rememberPengingat(remaining);
          reply += `\n\n${formatPengingatList(remaining)}`;
        } else {
          const remaining = store.listReminders ? store.listReminders(chatId) : [];
          rememberRems(remaining);
          reply += `\n\n${formatRemindersList(remaining)}`;
        }
      }
      return reply;
    }

    case "clearDone": {
      const isGroup = String(chatId).endsWith("@g.us");
      const result = store.clearCompletedTodos ? store.clearCompletedTodos(chatId) : { count: 0, items: [] };
      if (!result || result.count === 0) {
        return "[!] Tidak ada tugas berstatus selesai yang perlu dihapus.";
      }
      const remaining = store.getTodos ? store.getTodos(chatId, false) : [];
      rememberTodos(remaining);
      const formatted = remaining.length > 0 ? `\n\n${formatTodoList(remaining, isGroup)}` : "";
      return `[OK] Berhasil menghapus ${result.count} tugas yang sudah selesai (Ketik #undo untuk memulihkan).${formatted}`;
    }

    case "moveToTodo": {
      const isGroup = String(chatId).endsWith("@g.us");
      const targetRemId = store.resolveReminderId ? store.resolveReminderId(cmd.id, chatId) : cmd.id;
      const rem = store.getReminderById ? store.getReminderById(targetRemId) : null;
      if (rem) {
        const todoId = store.addTodo(chatId, rem.message, rem.event_at || rem.remind_at, rem.task_type || null, null, "");
        if (store.deleteReminder) store.deleteReminder(chatId, targetRemId);
        const remainingTodos = store.getTodos ? store.getTodos(chatId) : [];
        rememberTodos(remainingTodos);
        const formatted = remainingTodos.length > 0 ? `\n\n${formatTodoList(remainingTodos, isGroup)}` : "";
        return `[OK] Berhasil dipindahkan ke daftar tugas (Tugas #${todoId}: "${rem.message}").${formatted}`;
      }
      return `[!] Acara #${cmd.id} gak ketemu untuk dipindahkan.`;
    }

    case "moveToReminder": {
      const todo = store.getTodoById ? store.getTodoById(cmd.id, chatId) : null;
      if (todo) {
        const remindAt = todo.deadline || (Date.now() + 3600_000);
        const remId = store.addReminder(chatId, todo.task, remindAt, null, "reminder", remindAt);
        store.deleteTodo(cmd.id, chatId);
        const remainingRems = store.listReminders ? store.listReminders(chatId) : [];
        rememberRems(remainingRems);
        const formatted = remainingRems.length > 0 ? `\n\n${formatRemindersList(remainingRems)}` : "";
        return `[OK] Berhasil dipindahkan ke agenda/acara (Acara #${remId}: "${todo.task}").${formatted}`;
      }
      return `[!] Tugas #${cmd.id} gak ketemu untuk dipindahkan.`;
    }

    case "replaceTitle": {
      const targetRemId = store.resolveReminderId ? store.resolveReminderId(cmd.id, chatId) : cmd.id;
      const rem = store.getReminderById ? store.getReminderById(targetRemId) : null;
      if (rem && store.updateReminder) {
        const newMsg = rem.message.replace(new RegExp(cmd.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), cmd.replace);
        store.updateReminder(chatId, targetRemId, { message: newMsg });
        const remaining = store.listReminders ? store.listReminders(chatId) : [];
        rememberRems(remaining);
        return `[OK] Acara #${cmd.id} diubah jadi: "${newMsg}"\n\n${formatRemindersList(remaining)}`;
      }
      const todo = store.getTodoById ? store.getTodoById(cmd.id, chatId) : null;
      if (todo) {
        const newTask = todo.task.replace(new RegExp(cmd.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), cmd.replace);
        store.updateTodo(cmd.id, chatId, { task: newTask });
        const isGroup = String(chatId).endsWith("@g.us");
        const remaining = store.getTodos ? store.getTodos(chatId) : [];
        rememberTodos(remaining);
        return `[OK] Tugas #${cmd.id} diubah jadi: "${newTask}"\n\n${formatTodoList(remaining, isGroup)}`;
      }
      return `[!] Item #${cmd.id} gak ketemu.`;
    }

    case "renameItem": {
      const targetRemId = store.resolveReminderId ? store.resolveReminderId(cmd.id, chatId) : cmd.id;
      const rem = store.getReminderById ? store.getReminderById(targetRemId) : null;
      if (rem && store.updateReminder) {
        store.updateReminder(chatId, targetRemId, { message: cmd.newTitle });
        const remaining = store.listReminders ? store.listReminders(chatId) : [];
        rememberRems(remaining);
        return `[OK] Acara #${cmd.id} diubah jadi: "${cmd.newTitle}"\n\n${formatRemindersList(remaining)}`;
      }
      const todo = store.getTodoById ? store.getTodoById(cmd.id, chatId) : null;
      if (todo) {
        store.updateTodo(cmd.id, chatId, { task: cmd.newTitle });
        const isGroup = String(chatId).endsWith("@g.us");
        const remaining = store.getTodos ? store.getTodos(chatId) : [];
        rememberTodos(remaining);
        return `[OK] Tugas #${cmd.id} diubah jadi: "${cmd.newTitle}"\n\n${formatTodoList(remaining, isGroup)}`;
      }
      return `[!] Item #${cmd.id} gak ketemu.`;
    }

    case "updateTime": {
      const [hours, minutes] = cmd.newTime.split(":").map((n) => parseInt(n, 10));
      const targetRemId = store.resolveReminderId ? store.resolveReminderId(cmd.id, chatId) : cmd.id;
      const rem = store.getReminderById ? store.getReminderById(targetRemId) : null;
      if (rem && store.updateReminder) {
        const baseTimestamp = rem.event_at || rem.remind_at || Date.now();
        const WIB_OFFSET = 7 * 3600 * 1000;
        const d = new Date(baseTimestamp + WIB_OFFSET);
        const updatedUtc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hours - 7, minutes, 0);
        store.updateReminder(chatId, targetRemId, { remindAt: updatedUtc, eventAt: updatedUtc });
        const remaining = store.listReminders ? store.listReminders(chatId) : [];
        rememberRems(remaining);
        return `[OK] Jam acara #${cmd.id} diubah jadi ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")} WIB.\n\n${formatRemindersList(remaining)}`;
      }
      const todo = store.getTodoById ? store.getTodoById(cmd.id, chatId) : null;
      if (todo) {
        const baseTimestamp = todo.deadline || Date.now();
        const WIB_OFFSET = 7 * 3600 * 1000;
        const d = new Date(baseTimestamp + WIB_OFFSET);
        const updatedUtc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hours - 7, minutes, 0);
        store.updateTodo(cmd.id, chatId, { deadline: updatedUtc });
        const isGroup = String(chatId).endsWith("@g.us");
        const remaining = store.getTodos ? store.getTodos(chatId) : [];
        rememberTodos(remaining);
        return `[OK] Deadline tugas #${cmd.id} diubah jadi ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")} WIB.\n\n${formatTodoList(remaining, isGroup)}`;
      }
      return `[!] Item #${cmd.id} gak ketemu.`;
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
      return formatTodoDetail(todo);
    }

    case "add": {
      const originalPrompt = cmd.raw;
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
      const id = store.addTodo(chatId, task, deadline, tag, null, "", originalPrompt);
      return `[OK] Tugas #${id} dicatat: "${task}"`;
    }

    case "daily": {
      if (cmd.value === "1" || cmd.value === "on") {
        store.setDailyDigest(chatId, true);
        return "[OK] Rekap harian jam 07:00 WIB diaktifkan (to-do list + daftar acara & agenda).";
      } else if (cmd.value === "0" || cmd.value === "off") {
        store.setDailyDigest(chatId, false);
        return "[OK] Rekap harian dimatikan.";
      }
      const isDailyActive = store.hasActiveDailyDigest ? store.hasActiveDailyDigest(chatId) : false;
      const statusStr = isDailyActive ? "Aktif (Setiap hari 07:00 WIB)" : "Nonaktif";
      return `*[Rekap Harian]*\nStatus: ${statusStr}\n\nFormat: \`#daily 1\` (aktifkan jam 07:00 WIB) atau \`#daily 0\` (matikan).`;
    }

    case "selfupdate":
    case "deploy": {
      const extRes = await executeExtensionFastCommand(cmd, ctx);
      if (extRes !== undefined) return extRes;
      return `[!] Fitur #${cmd.type} sedang dinonaktifkan atau ekstensi tidak aktif.`;
    }

    case "skills": {
      const list = store.getSkills();
      return formatSkillList(list);
    }

    case "reminders": {
      if (cmd.category === "pengingat") {
        const list = store.listPengingat ? store.listPengingat(chatId) : [];
        rememberPengingat(list);
        return formatPengingatList(list);
      }
      // default / category: "acara"
      const list = store.listEvents ? store.listEvents(chatId) : [];
      rememberAcara(list);
      return formatAcaraList(list);
    }

    case "contacts": {
      const list = store.listPersons ? store.listPersons() : [];
      return formatPersonList(list);
    }

    case "whitelist": {
      const phones = getWhitelistPhones();
      if (phones.length === 0) return "*[Whitelist Bot]*\nBelum ada nomor yang didaftarkan.";
      const contacts = store?.listPersons ? store.listPersons() : [];
      const lines = [`📋 *Daftar Whitelist Akses Bot (${phones.length} Nomor)*:`];
      phones.forEach((p, idx) => {
        let label = "";
        const matchedContact = contacts.find((c) => normalizePhone(c.phone) === p);
        if (matchedContact) {
          label = ` (${matchedContact.name}${matchedContact.relationship ? ` - ${matchedContact.relationship}` : ""})`;
        } else if (p === normalizePhone(process.env.PRIMARY_USER_PHONE || process.env.OWNER_PHONE || "6285236467838")) {
          label = ` (${process.env.PRIMARY_USER_NAME || "Rafid"} - Master/Owner)`;
        } else if (p === normalizePhone(process.env.SECONDARY_USER_PHONE || "6289514718700")) {
          label = ` (${process.env.SECONDARY_USER_NAME || "Karimah"})`;
        }
        lines.push(`${idx + 1}. +${p}${label}`);
      });
      return lines.join("\n");
    }

    case "sendDirectMessage": {
      const rawTarget = String(cmd.recipient || "").trim();
      const rawMsg = String(cmd.message || "").trim();
      if (!rawTarget || !rawMsg) {
        return "[!] Format salah. Contoh: `#pc karimah tolong beli beras`";
      }
      const res = resolveWhitelistRecipient(rawTarget, store);
      if (!res) {
        return `[!] Kontak atau nomor '${rawTarget}' tidak valid.`;
      }
      if (res.error) {
        return `[!] ${res.error}`;
      }
      const senderDisplay = formatSenderDisplay(senderNumber || chatId, senderName, store);
      const outboundText = `📩 *[Pesan dari ${senderDisplay}]*\n\n${rawMsg}`;
      try {
        await sendText(`${res.targetPhone}@c.us`, outboundText);
      } catch (err) {
        if (err.cause?.code === "ECONNREFUSED" || err.message?.includes("ECONNREFUSED")) {
          console.warn(`[WAHA] Offline dev/test mode - message not dispatched: ${err.message}`);
        } else {
          return `[!] Gagal mengirim pesan ke WhatsApp: ${err.message}`;
        }
      }
      return `[OK] Pesan berhasil dikirimkan ke ${res.recipientDisplayName} (+${res.targetPhone}) via chat pribadi (PC).`;
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

    case "requestAdd": {
      if (!cmd.text) {
        return "[!] Tuliskan ide fitur yang diminta. Contoh: #request integrasi google calendar";
      }
      const senderPhone = senderNumber || chatId;
      const id = store.addFeatureRequest(senderPhone, senderName, cmd.text);
      try {
        const normSender = normalizePhone(senderPhone);
        const who = senderName ? `${senderName} (+${normSender})` : `+${normSender}`;
        sendText(
          `${OWNER_PHONE}@c.us`,
          `💡 *[Feature Request Baru]*\n• ID: #${id}\n• Dari: ${who}\n• Request:\n"${cmd.text}"`
        ).catch(() => {});
      } catch {}
      return `[OK] Request fitur #${id} berhasil dicatat & dilaporkan ke master. Nuhun masukannya!`;
    }

    case "requestList": {
      if (!isOwner) return `[!] Daftar request fitur hanya bisa diakses oleh master (+${OWNER_PHONE}).`;
      const list = store.getFeatureRequests("pending");
      return formatFeatureRequestsList(list);
    }

    case "requestDone": {
      if (!isOwner) return `[!] Hanya master (+${OWNER_PHONE}) yang bisa menandai request selesai.`;
      const changed = store.completeFeatureRequest(cmd.id);
      if (changed > 0) return `[OK] Request fitur #${cmd.id} ditandai selesai.`;
      return `[!] Request fitur #${cmd.id} gak ketemu.`;
    }

    case "backlogDel": {
      if (!isOwner) return "[!] Fitur #backlog khusus owner.";
      const changed = store.deleteBacklog ? store.deleteBacklog(cmd.id, chatId) : 0;
      if (changed > 0) return `[OK] Backlog *[#${cmd.id}]* berhasil dihapus.`;
      return `[!] Backlog *[#${cmd.id}]* tidak ditemukan.`;
    }

    case "requestDel": {
      if (!isOwner) return `[!] Hanya master (+${OWNER_PHONE}) yang bisa menghapus request fitur.`;
      const changed = store.deleteFeatureRequest ? store.deleteFeatureRequest(cmd.id, chatId) : 0;
      if (changed > 0) return `[OK] Request fitur #${cmd.id} berhasil dihapus.`;
      return `[!] Request fitur #${cmd.id} tidak ditemukan.`;
    }

    case "vaultList": {
      const files = store.listVaultFiles ? store.listVaultFiles(chatId) : [];
      if (store.rememberVaultList) store.rememberVaultList(chatId, files);
      return formatVaultList(files);
    }

    case "vaultSearch": {
      const files = store.searchVaultFiles ? store.searchVaultFiles(cmd.query, null, chatId) : [];
      if (store.rememberVaultList) store.rememberVaultList(chatId, files);
      return formatVaultList(files);
    }

    case "vaultGet": {
      const realId = store.resolveVaultFileId ? store.resolveVaultFileId(cmd.id, chatId) : cmd.id;
      const file = store.getVaultFileById ? store.getVaultFileById(realId) : null;
      if (!file) return `[!] File #${cmd.id} tidak ditemukan di Document Vault.`;
      if (!store.hasFileAccess(file.id, chatId)) return `[!] Akses ditolak ke file #${cmd.id}.`;
      await sendFile(chatId, file.filepath, file.filename, file.summary || file.filename);
      return `[OK] Mengirimkan file '${file.filename}'...`;
    }

    case "vaultDel": {
      const realId = store.resolveVaultFileId ? store.resolveVaultFileId(cmd.id, chatId) : cmd.id;
      const file = store.getVaultFileById ? store.getVaultFileById(realId) : null;
      if (!file) return `[!] File #${cmd.id} tidak ditemukan di Document Vault.`;
      const changed = store.deleteVaultFile ? store.deleteVaultFile(realId, chatId) : 0;
      if (changed > 0) {
        return `[OK] File '${file.filename}' berhasil dihapus dari Vault dan dipindahkan ke .trash. (Ketik #undo kalau mau batalin).`;
      }
      return `[!] Gagal menghapus file #${cmd.id} (akses ditolak atau file tidak ada).`;
    }

    case "vaultRename": {
      const realId = store.resolveVaultFileId ? store.resolveVaultFileId(cmd.id, chatId) : cmd.id;
      const changed = store.updateVaultFile ? store.updateVaultFile(realId, chatId, { filename: cmd.name }) : 0;
      if (changed > 0) return `[OK] File #${cmd.id} berhasil diupdate menjadi '${cmd.name}'.`;
      return `[!] Gagal mengupdate file #${cmd.id}.`;
    }

    case "noteList": {
      const notes = store.listNotes ? store.listNotes(chatId) : [];
      return formatNotesList(notes);
    }

    case "noteGet": {
      const note = store.getNote ? store.getNote(chatId, cmd.key) : null;
      if (!note) return `[!] Catatan '${cmd.key}' tidak ditemukan.`;
      return `*[Catatan: ${note.key}]*\n${note.content}`;
    }

    case "noteAdd": {
      const saved = store.saveNote ? store.saveNote(chatId, cmd.key, cmd.content) : { key: cmd.key };
      return `[OK] Catatan '${saved.key}' berhasil disimpan.`;
    }

    case "noteDel": {
      const changed = store.deleteNote ? store.deleteNote(chatId, cmd.key) : 0;
      if (changed > 0) return `[OK] Catatan '${cmd.key}' berhasil dihapus.`;
      return `[!] Catatan '${cmd.key}' tidak ditemukan.`;
    }

    case "contactAdd": {
      const p = store.addPerson ? store.addPerson({
        name: cmd.name,
        phone: cmd.phone,
        role: cmd.role,
        notes: cmd.notes
      }) : { name: cmd.name };
      return `[OK] Kontak '${p.name}' berhasil disimpan.`;
    }

    case "contactDel": {
      const changed = store.deletePerson ? store.deletePerson(cmd.name) : 0;
      if (changed > 0) return `[OK] Kontak '${cmd.name}' berhasil dihapus.`;
      return `[!] Kontak '${cmd.name}' tidak ditemukan.`;
    }

    case "health": {
      if (!isOwner) return `[!] Fitur #health khusus owner (+${OWNER_PHONE}).`;
      return formatServerHealth(store);
    }

    case "hermes":
    case "minecraft": {
      const extRes = await executeExtensionFastCommand(cmd, ctx);
      if (extRes !== undefined) return extRes;
      return `[!] Fitur #${cmd.type} sedang dinonaktifkan atau ekstensi tidak aktif.`;
    }

    case "searchImage": {
      if (!cmd.query) {
        return "[!] Format: #foto <kata kunci> (contoh: #foto kucing anggora)";
      }
      const res = await searchAndSendWebImage(chatId, cmd.query);
      if (res.success) {
        return `[OK] Gambar untuk "${cmd.query}" berhasil dikirimkan.`;
      }
      return `[!] ${res.error || "Gagal mencari gambar."}`;
    }

    case "help": {
      const extHelp = getExtensionHelpSections(isOwner);
      const extLines = extHelp.length > 0 ? `\n\n*Ekstensi Aktif (Server & Ops):*\n${extHelp.join("\n")}` : "";

      return `*[🤠 MY NAME IS JOHN MUSTARDDD DEW DEW DEW 🥀]*
_Autonomous WhatsApp AI & Fast Command Engine_

*Perintah Umum (Bypass AI):*
- #ping — Cek status, latency, RAM & uptime
- #dew — MY NAME IS JOHN MUSTARDDD 🤠
- #help — Tampilkan menu panduan ini

*Perintah To-Do & Jadwal (Manual):*
- #tugas / #todo — Lihat to-do list pending
- #acara / #agenda — Lihat daftar acara & agenda mendatang
- #pengingat / #reminders — Lihat daftar pengingat aktif & rekap harian
- #today — Tugas deadline hari ini
- #week — Tugas 7 hari ke depan
- #<id> — Cek detail tugas (misal: #1)
- #add <tugas> — Tambah tugas (opsi: dl:YYYY-MM-DD #tag)
- #update <id> <pesan> — Edit tugas (misal: #update 1 Pitching gameseed dl:2026-09-27)
- #done <id> — Tandai tugas selesai
- #unfinish <id> — Batalkan status selesai tugas (jadi pending lagi)
- #undo — Batalkan status #done atau penghapusan file/tugas terakhir
- #del <id> — Hapus tugas (misal: #del 1)

*Perintah Vault & Catatan (Dokumen):*
- #vault / #vault list — Lihat daftar dokumen vault tersimpan
- #vault cari <keyword> — Cari dokumen di vault
- #vault get <id> — Ambil/unduh file dokumen dari vault
- #vault del <id> — Hapus file dari vault (bisa di-#undo)
- #vault rename <id> <nama> — Ganti nama file dokumen
- #note / #note list — Lihat daftar catatan
- #note get <key> — Baca isi catatan
- #note add <key> <isi> — Tambah/update catatan
- #note del <key> — Hapus catatan

*Perintah Otomasi & Pengaturan:*
- #foto <kata kunci> — Cari gambar di internet & kirim ke chat (alias: #gambar)
- #request <ide> — Kirim ide/request fitur ke master bot
- #daily <1/0> — Aktifkan/matikan rekap harian jam 07:00 WIB (to-do list + daftar acara)
- #skills — Lihat daftar skill & macro otomatis
- #proposals — Cek antrean proposal skill
- #rollback <skill> [v] — Kembalikan versi skill
- #kontak — Direktori koordinasi pasangan & keluarga
- #kontak add <nama> | <no> | <role> | <notes> — Tambah/update kontak
- #kontak del <nama> — Hapus kontak dari direktori
- #whitelist — Cek daftar nomor yang di-whitelist
- #pc <nama/nomor> <pesan> — Kirim pesan pribadi (PC) langsung ke kontak whitelist (alias: #japri)

*Perintah Owner / Admin:*
- #health / #server — Cek kesehatan server, CPU, RAM, disk & DB
- #requests — Lihat daftar request fitur dari pengguna
- #request done <id> — Tandai request selesai
- #request del <id> — Hapus request fitur
- #backlog <ide> — Catat ide fitur/perbaikan
- #backlog list — Lihat daftar backlog ide
- #backlog done <id> — Tandai backlog selesai
- #backlog del <id> — Hapus ide backlog${extLines}

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
      assert.strictEqual(parseFastCommand("todo").type, "listTodos");
      assert.strictEqual(parseFastCommand("Todo").type, "listTodos");
      assert.strictEqual(parseFastCommand("#tugas").type, "listTodos");
      assert.strictEqual(parseFastCommand("tugas").type, "listTodos");
      assert.strictEqual(parseFastCommand("#today").type, "today");
      assert.strictEqual(parseFastCommand("today").type, "today");
      assert.strictEqual(parseFastCommand("#week").type, "week");
      assert.strictEqual(parseFastCommand("#agenda").type, "reminders");
      assert.strictEqual(parseFastCommand("agenda").type, "reminders");
      assert.strictEqual(parseFastCommand("#acara").type, "reminders");
      assert.strictEqual(parseFastCommand("acara").type, "reminders");
      assert.strictEqual(parseFastCommand("jadwal").type, "reminders");
      assert.strictEqual(parseFastCommand("#done 5").id, 5);
      assert.strictEqual(parseFastCommand("#undo").type, "undo");
      assert.strictEqual(parseFastCommand("#del 3").id, 3);
      assert.strictEqual(parseFastCommand("#delete 4").id, 4);
      assert.strictEqual(parseFastCommand("#42").id, 42);
      assert.strictEqual(parseFastCommand("#add Kerjakan PR #kuliah").raw, "Kerjakan PR #kuliah");
      assert.strictEqual(parseFastCommand("#daily 1").value, "1");
      assert.strictEqual(parseFastCommand("#deploy").type, "deploy");
      assert.strictEqual(parseFastCommand("#deploy").status, false);
      assert.strictEqual(parseFastCommand("#deploy status").status, true);
      assert.strictEqual(parseFastCommand("#selfupdate tambahin perintah #joke").type, "selfupdate");
      assert.strictEqual(parseFastCommand("#selfupdate tambahin perintah #joke").instruction, "tambahin perintah #joke");
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
      assert.strictEqual(parseFastCommand("3 kelar").type, "done");
      assert.strictEqual(parseFastCommand("3 kelar").id, 3);
      assert.strictEqual(parseFastCommand("selesai 5").id, 5);
      assert.strictEqual(parseFastCommand("hapus 1, 2").type, "deleteMultiple");
      assert.deepStrictEqual(parseFastCommand("hapus 1, 2").ids, [1, 2]);
      assert.strictEqual(parseFastCommand("hapus 3").type, "delete");
      assert.strictEqual(parseFastCommand("hapus 3").id, 3);
      assert.strictEqual(parseFastCommand("pindah 1 ke todo").type, "moveToTodo");
      assert.strictEqual(parseFastCommand("pindah 2 ke acara").type, "moveToReminder");
      assert.strictEqual(parseFastCommand("1 bukan apel tapi jeruk").type, "replaceTitle");
      assert.strictEqual(parseFastCommand("ganti nama 1 jadi Belajar Fisika").type, "renameItem");
      assert.strictEqual(parseFastCommand("jam 1 ganti ke 14:30").type, "updateTime");
      assert.strictEqual(parseFastCommand("jam 1 ganti ke 14:30").newTime, "14:30");

      assert.strictEqual(parseFastCommand("#mc").type, "minecraft");
      assert.strictEqual(parseFastCommand("#vps cek docker").type, "hermes");
      assert.strictEqual(parseFastCommand("#vps cek docker").instruction, "cek docker");
      assert.strictEqual(parseFastCommand("#hermes status").type, "hermes");
      assert.strictEqual(parseFastCommand("#hermes status").instruction, "status");
      assert.strictEqual(parseFastCommand("#help").type, "help");
      assert.strictEqual(parseFastCommand("halo john"), null);

      // Test execution
      const dewRes = await executeFastCommand(parseFastCommand("#dew"), { store, chatId });
      assert.ok(dewRes.includes("DEW DEW DEW"));

      const skillsRes = await executeFastCommand(parseFastCommand("#skills"), { store, chatId });
      assert.ok(skillsRes.includes("Custom Skills"));

      const contactsRes = await executeFastCommand(parseFastCommand("#kontak"), { store, chatId });
      assert.ok(contactsRes.includes("Direktori Kontak"));

      const whitelistCmd = parseFastCommand("#whitelist");
      assert.strictEqual(whitelistCmd.type, "whitelist");
      const whitelistRes = await executeFastCommand(whitelistCmd, { store, chatId });
      assert.ok(whitelistRes.includes("Whitelist"));

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

      // Fast command feature request test
      const reqCmd = parseFastCommand("#request bikin bot bisa kirim sticker");
      assert.strictEqual(reqCmd.type, "requestAdd");
      assert.strictEqual(reqCmd.text, "bikin bot bisa kirim sticker");
      const reqAddRes = await executeFastCommand(reqCmd, { store, chatId, senderName: "Siti" });
      assert.ok(reqAddRes.includes("[OK] Request fitur"));

      const reqListCmd = parseFastCommand("#requests");
      assert.strictEqual(reqListCmd.type, "requestList");
      const reqListDenied = await executeFastCommand(reqListCmd, { store, chatId, isOwner: false });
      assert.ok(reqListDenied.includes("master"));
      const reqListAllowed = await executeFastCommand(reqListCmd, { store, chatId, isOwner: true });
      assert.ok(reqListAllowed.includes("kirim sticker"));

      const reqDoneCmd = parseFastCommand("#request done 1");
      assert.strictEqual(reqDoneCmd.type, "requestDone");
      const reqDoneRes = await executeFastCommand(reqDoneCmd, { store, chatId, isOwner: true });
      assert.ok(reqDoneRes.includes("selesai"));

      // Fast command #pc test
      const pcCmd = parseFastCommand("#pc karimah tolong beli garam");
      assert.strictEqual(pcCmd.type, "sendDirectMessage");
      assert.strictEqual(pcCmd.recipient, "karimah");
      assert.strictEqual(pcCmd.message, "tolong beli garam");

      const japriCmd = parseFastCommand("#japri 628999999999 halo");
      assert.strictEqual(japriCmd.type, "sendDirectMessage");
      const japriDenied = await executeFastCommand(japriCmd, { store, chatId });
      assert.ok(japriDenied.includes("tidak terdaftar dalam whitelist"));

      // Test natural commands execution
      store.addReminder(chatId, "Beli apel malang", Date.now() + 3600_000);
      const natReplaceRes = await executeFastCommand(parseFastCommand("1 bukan apel tapi jeruk"), { store, chatId });
      assert.ok(natReplaceRes.includes("Beli jeruk malang"));

      const natMoveRes = await executeFastCommand(parseFastCommand("pindah 1 ke todo"), { store, chatId });
      assert.ok(natMoveRes.includes("Berhasil dipindahkan ke daftar tugas"));

      const natDelRes = await executeFastCommand(parseFastCommand("hapus 1"), { store, chatId });
      assert.ok(natDelRes.includes("berhasil dihapus"));

      console.log("Commands module self-test OK");
    });
  });
}
