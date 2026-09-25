import { Storage, getAuditSummary } from "../src/db.js";

const store = new Storage("bot.db");
const report = getAuditSummary(store.db, 7);

console.log("==================================================");
console.log("?? KACUNG BOT: USAGE & FEATURE AUDIT (7 HARI)");
console.log("==================================================");
console.log(`Total Pesan Diproses : ${report.totalInteractions}`);
console.log(`Total Error          : ${report.errorCount}`);

console.log("\n[?? Permintaan Sering Tanpa Tool / Potensi Fitur Baru]:");
if (report.frequentQueriesWithoutTools.length === 0) {
  console.log("  (Belum ada data interaksi)");
} else {
  report.frequentQueriesWithoutTools.forEach((p, idx) => console.log(`  ${idx + 1}. "${p}"`));
}

if (report.recentErrors.length > 0) {
  console.log("\n[?? Error Terbaru]:");
  console.log(JSON.stringify(report.recentErrors, null, 2));
}
console.log("==================================================");
