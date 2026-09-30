import dns from "node:dns/promises";
import { formatRowsToMarkdown, parseHtmlTableToMarkdown, parseCsvToMarkdown } from "./formatters.js";

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "waha",
  "bot",
  "runner",
  "scheduler",
  "host.docker.internal"
]);

export function isPrivateIp(ip) {
  if (!ip) return true;
  let clean = ip;
  if (clean.startsWith("::ffff:")) {
    clean = clean.slice(7);
  }
  if (
    clean === "::1" ||
    clean === "::" ||
    clean.toLowerCase().startsWith("fc") ||
    clean.toLowerCase().startsWith("fd") ||
    clean.toLowerCase().startsWith("fe80")
  ) {
    return true;
  }
  const parts = clean.split(".").map((p) => parseInt(p, 10));
  if (parts.length === 4 && parts.every((p) => !isNaN(p) && p >= 0 && p <= 255)) {
    const [a, b] = parts;
    if (a === 0 || a === 127 || a === 10) return true;
    if (a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  return false;
}

export function isSafeUrlSync(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    if (BLOCKED_HOSTNAMES.has(host) || host.endsWith(".local") || host.endsWith(".internal")) return false;
    if (!host.includes(".")) return false;
    if (isPrivateIp(host)) return false;
    return true;
  } catch {
    return false;
  }
}

export async function isSafeUrl(rawUrl) {
  if (!isSafeUrlSync(rawUrl)) return false;
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    const records = await dns.lookup(host, { all: true });
    if (!records || records.length === 0) return false;
    for (const rec of records) {
      if (isPrivateIp(rec.address)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function fetchUrlContent(rawUrl) {
  if (!(await isSafeUrl(rawUrl))) {
    throw new Error("URL tidak aman atau mengarah ke alamat lokal/privat (SSRF Protection).");
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw new Error("Format URL tidak valid.");
  }

  const href = parsedUrl.href;
  const path = parsedUrl.pathname;
  const gid = parsedUrl.searchParams.get("gid") || (parsedUrl.hash.match(/gid=(\d+)/)?.[1]);

  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "*/*"
  };

  // 1. Published Google Sheets (/spreadsheets/d/e/.../pubhtml or /pub)
  if (href.includes("/spreadsheets/") && (path.includes("/d/e/") || href.includes("/pubhtml") || href.includes("/pub"))) {
    const pubMatch = href.match(/\/spreadsheets\/(?:u\/\d+\/)?d\/e\/([a-zA-Z0-9_-]+)/);
    const pubId = pubMatch ? pubMatch[1] : null;

    if (pubId) {
      const indexUrl = `https://docs.google.com/spreadsheets/d/e/${pubId}/pubhtml`;
      const res = await fetch(indexUrl, { headers, signal: AbortSignal.timeout(12000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}: Gagal memuat Google Sheet publik.`);
      const indexHtml = await res.text();

      if (res.url.includes("accounts.google.com/ServiceLogin") || indexHtml.includes("ServiceLogin")) {
        throw new Error("Dokumen Google Sheet ini masih berstatus privat. Tolong ubah akses sharing menjadi 'Siapa saja yang memiliki link' (Viewer).");
      }

      const tabMatches = [...indexHtml.matchAll(/\{\s*name:\s*"([^"]+)"[^}]*pageUrl:\s*"([^"]+)"/g)];
      const sections = [];

      if (tabMatches.length > 0) {
        for (const match of tabMatches) {
          const tabName = match[1].replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
          let pageUrl = match[2].replace(/\\\//g, "/").replace(/\\x3d/g, "=").replace(/\\x26/g, "&");

          if (gid && !pageUrl.includes(`gid=${gid}`) && tabMatches.length > 1) {
            continue;
          }

          try {
            const tabRes = await fetch(pageUrl, { headers, signal: AbortSignal.timeout(10000) });
            if (tabRes.ok) {
              const tabHtml = await tabRes.text();
              const md = parseHtmlTableToMarkdown(tabHtml);
              if (md) {
                sections.push(`### Sheet: ${tabName}\n\n${md}`);
              }
            }
          } catch {}
        }
      }

      if (sections.length === 0) {
        const directUrl = gid
          ? `https://docs.google.com/spreadsheets/d/e/${pubId}/pubhtml/sheet?headers=false&gid=${gid}`
          : `https://docs.google.com/spreadsheets/d/e/${pubId}/pubhtml/sheet?headers=false`;
        try {
          const sheetRes = await fetch(directUrl, { headers, signal: AbortSignal.timeout(10000) });
          if (sheetRes.ok) {
            const sheetHtml = await sheetRes.text();
            const md = parseHtmlTableToMarkdown(sheetHtml);
            if (md) sections.push(md);
          }
        } catch {}
      }

      if (sections.length > 0) {
        return sections.join("\n\n").slice(0, 15000);
      }
    }
  }

  // 2. Standard Google Sheets (/spreadsheets/d/{docId})
  if (href.includes("/spreadsheets/d/") && !path.includes("/d/e/")) {
    const docMatch = href.match(/\/spreadsheets\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]+)/);
    const docId = docMatch ? docMatch[1] : null;
    if (docId) {
      const gidParam = gid ? `&gid=${gid}` : "";
      const csvUrl = `https://docs.google.com/spreadsheets/d/${docId}/export?format=csv${gidParam}`;
      const res = await fetch(csvUrl, { headers, signal: AbortSignal.timeout(12000) });

      if (res.url.includes("accounts.google.com/ServiceLogin")) {
        throw new Error("Dokumen Google Sheet ini masih berstatus privat. Tolong ubah akses sharing menjadi 'Siapa saja yang memiliki link' (Viewer).");
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}: Gagal memuat Google Sheet.`);
      const csvText = await res.text();
      if (csvText.includes("<!DOCTYPE html>") || csvText.includes("<html")) {
        throw new Error("Dokumen Google Sheet tidak bisa diakses publik (perlu izin akses).");
      }
      const md = parseCsvToMarkdown(csvText);
      return (md || csvText).slice(0, 15000);
    }
  }

  // 3. Google Docs (/document/d/{docId})
  if (href.includes("/document/d/")) {
    const docMatch = href.match(/\/document\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]+)/);
    const docId = docMatch ? docMatch[1] : null;
    if (docId) {
      const txtUrl = `https://docs.google.com/document/d/${docId}/export?format=txt`;
      const res = await fetch(txtUrl, { headers, signal: AbortSignal.timeout(12000) });
      if (res.url.includes("accounts.google.com/ServiceLogin")) {
        throw new Error("Google Doc ini masih berstatus privat. Tolong ubah akses sharing menjadi 'Siapa saja yang memiliki link' (Viewer).");
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}: Gagal memuat Google Doc.`);
      const txt = await res.text();
      return txt.slice(0, 15000);
    }
  }

  // 4. Google Slides (/presentation/d/{docId})
  if (href.includes("/presentation/d/")) {
    const docMatch = href.match(/\/presentation\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]+)/);
    const docId = docMatch ? docMatch[1] : null;
    if (docId) {
      const pdfUrl = `https://docs.google.com/presentation/d/${docId}/export/pdf`;
      const res = await fetch(pdfUrl, { headers, signal: AbortSignal.timeout(15000) });
      if (res.url.includes("accounts.google.com/ServiceLogin")) {
        throw new Error("Google Slide ini masih berstatus privat. Tolong ubah akses sharing menjadi 'Siapa saja yang memiliki link' (Viewer).");
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}: Gagal memuat Google Slide.`);
      const pdfBuf = Buffer.from(await res.arrayBuffer());
      const runnerUrl = (process.env.PYTHON_RUNNER_URL || "http://localhost:8000/run").replace(/\/run$/, "/pdf");
      try {
        const pyRes = await fetch(runnerUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "extract_text",
            files: [{ data_base64: pdfBuf.toString("base64") }]
          }),
          signal: AbortSignal.timeout(15000)
        });
        if (pyRes.ok) {
          const pyData = await pyRes.json();
          if (pyData.status === "success" && pyData.text) {
            return `### Google Slides Presentation (${pyData.page_count} Slides)\n\n${pyData.text}`.slice(0, 15000);
          }
        }
      } catch {}
      return `[Berhasil mengunduh Google Slide (${pdfBuf.length} bytes), namun ekstraksi teks gagal.]`;
    }
  }

  // 5. Google Drive Files (/file/d/{fileId} or ?id={fileId})
  if (href.includes("drive.google.com") && (href.includes("/file/d/") || href.includes("id="))) {
    const fileMatch = href.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || href.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    const fileId = fileMatch ? fileMatch[1] : null;
    if (fileId) {
      const dlUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
      const res = await fetch(dlUrl, { headers, redirect: "follow", signal: AbortSignal.timeout(20000) });
      if (res.url.includes("accounts.google.com/ServiceLogin")) {
        throw new Error("File Google Drive ini masih berstatus privat. Tolong ubah akses sharing menjadi 'Siapa saja yang memiliki link' (Viewer).");
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}: Gagal mengunduh file Google Drive.`);
      const cType = res.headers.get("content-type") || "";
      if (cType.includes("pdf")) {
        const pdfBuf = Buffer.from(await res.arrayBuffer());
        const runnerUrl = (process.env.PYTHON_RUNNER_URL || "http://localhost:8000/run").replace(/\/run$/, "/pdf");
        try {
          const pyRes = await fetch(runnerUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "extract_text",
              files: [{ data_base64: pdfBuf.toString("base64") }]
            }),
            signal: AbortSignal.timeout(15000)
          });
          if (pyRes.ok) {
            const pyData = await pyRes.json();
            if (pyData.status === "success" && pyData.text) {
              return `### Dokumen PDF Google Drive (${pyData.page_count} Halaman)\n\n${pyData.text}`.slice(0, 15000);
            }
          }
        } catch {}
      } else {
        const text = await res.text();
        if (text.includes("<table") && text.includes("<tr")) {
          const tableMd = parseHtmlTableToMarkdown(text);
          if (tableMd) return tableMd.slice(0, 15000);
        }
        return text.slice(0, 15000);
      }
    }
  }

  // 6. Generic Web Page Scraper
  const res = await fetch(rawUrl, {
    headers,
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: Gagal memuat halaman web.`);
  const html = await res.text();

  if (html.includes("<table") && html.includes("<tr")) {
    const tableMd = parseHtmlTableToMarkdown(html);
    if (tableMd && tableMd.length > 50) {
      return tableMd.slice(0, 12000);
    }
  }

  const clean = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, "\n### $1\n")
    .replace(/<p[^>]*>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
  return clean.slice(0, 8000);
}

const MUTATION_TOOLS = new Set([
  "addTodo", "completeTodo", "updateTodo", "deleteTodo", "undoLastTodo",
  "addReminder", "deleteReminder", "updateReminder", "setDailyDigest", "grantFileAccess", "addBacklog", "completeBacklog",
  "submitFeatureRequest",
  "saveSkill", "deleteSkill", "updateSkill", "saveNote", "appendNote", "deleteNote",
  "processPdf", "mergePdf", "splitPdf", "compressPdf", "convertDocument",
  "proposeSkill", "approveSkill", "rejectSkill", "rollbackSkill",
  "addPerson", "deletePerson",
  "sendDirectMessage"
]);

export function detectUnexecutedMutationClaim(text = "", toolsCalled = []) {
  if (!text) return false;
  const hasMutationTool = toolsCalled.some((t) => MUTATION_TOOLS.has(t));
  if (hasMutationTool) return false;
  const claimRegex = /(sudah|udah|berhasil|telah|langsung|segera|lagi|otw)\s+(di|ku|saya|gw|gua|aku)?\s*(tambah|catat|buat|bikin|jadwal|ubah|ganti|koreksi|update|hapus|delete|selesai|simpan|kristalisasi|gabung|kompres|majuin|mundurin|geser|pindahin|pc|japri|dm|wa|chat\s+pribadi|kirim\s+pesan|benerin|atur|setel|setting|seting|pasang|masukin|masuk|beres|kelar)/i;
  const promiseRegex = /(?:ini\s+langsung|segera|langsung|coba|nanti|akan|biar)\s+(?:aku|saya|gw|gua|ku|di)\s*(?:yang\s+)?(?:coba\s+|bantu\s+)?(?:pc|japri|dm|wa|kirimkan?\s+pesan|chat|tanyain|tanyakan|hubungi|kontak|sambungkan)/i;
  const contactPromiseRegex = /(?:aku|saya|gw|gua|ku)\s*(?:yang\s+)?(?:coba\s+|bantu\s+)?(?:tanyain|tanyakan|hubungi|kontak|pc|japri|dm|wa|chat|kirimkan?\s+pesan)/i;
  const verbalHoldRegex = /(?:tanyain|hubungi|kontak|pc|japri|chat).*(?:sebentar\s+ya|tunggu\s+sebentar)/i;
  return claimRegex.test(text) || promiseRegex.test(text) || contactPromiseRegex.test(text) || verbalHoldRegex.test(text);
}

export function isAmbiguousScheduleStatement(text = "") {
  if (!text) return false;
  const t = text.trim();
  const hasDelayOrConstraint = /(belum|blm|blom|belom)\s+(balik|pulang|selesai|kelar|bisa|sempat|nyampe|ada)|(masih|lagi|lg)\s+(di\s*jalan|macet|kerja|kuliah|sekolah|sibuk|otw|repot)|jangan\s+(jam|pukul|\d+)/i.test(t);
  if (!hasDelayOrConstraint) return false;

  const hasExplicitTarget = /(?:jadi|ke|pindah\s+ke|geser\s+ke|mundur\s+ke|maju\s+ke)\s*(?:jam|pukul)?\s*\d{1,2}(?:[.:]\d{2})?/i.test(t);
  return !hasExplicitTarget;
}

const LIST_TOPIC_REGEX = /\b(tugas|todo|to-?dos?|to\s*do\s*list|todolist|pengingat|reminder|reminders|acara|agenda|jadwal|events?|deadline|backlog)\b/i;
const LIST_VIEW_REGEX = /\b(list|daftar|daftarin|daftarkan|tampil(?:kan|in)?|liat|lihat|show|rekap|cek|check|semua|apa(?:n|k)?(?:\s*aja)?|isinya|isi|sisa|berapa|ada\s+apa)\b/i;
const LIST_DATE_CUE_REGEX = /\b(hari\s+ini|hr\s+ini|besok|esok|lusa|minggu\s+ini|minggu\s+depan|senin|selasa|rabu|kamis|jumat|jum'?at|sabtu|minggu|tanggal\s*\d|tgl\s*\d)\b/i;
const LIST_MUTATION_REGEX = /\b(hapus|apus|del|delete|selesai|selesaikan|kelar|beres|done|tambah|tambahin|tambahkan|catat|simpan|buat|bikin|jadwalin|ubah|ganti|koreksi|update|undur|mundur(?:in)?|maju(?:in)?|geser|tunda|pindah(?:in)?|inget(?:in|kan)?|remind(?:er)?)\b/i;

export function isListRequest(text = "") {
  if (!text) return false;
  const clean = text.trim().replace(/^@\S+\s*/, "").toLowerCase();
  if (!clean) return false;
  if (/\b(rekap|digest|summary)\b/.test(clean)) return true;
  if (!LIST_TOPIC_REGEX.test(clean)) return false;
  const hasView = LIST_VIEW_REGEX.test(clean);
  const hasMutableVerb = LIST_MUTATION_REGEX.test(clean);
  if (hasMutableVerb) return hasView;
  return hasView || LIST_DATE_CUE_REGEX.test(clean);
}

export function isNoFluffRequest(text = "") {
  if (!text) return false;
  const clean = text.toLowerCase();
  return (
    clean.includes("no fluff") ||
    clean.includes("tanpa basa-basi") ||
    clean.includes("tanpa basa basi") ||
    clean.includes("gausah tool call") ||
    clean.includes("gausah footnote") ||
    clean.includes("biar bisa di copy") ||
    clean.includes("biar gampang di copy") ||
    clean.includes("buat di-copy")
  );
}

export function isExplicitPrivateRequest(text = "") {
  if (!text) return false;
  const t = text.toLowerCase();
  if (/\b(?:di-?)?japr+i+/i.test(t)) return true;
  if (/\b(?:di-?)?p+c+\b/i.test(t)) return true;
  if (/\b(?:di-?)?d+m+\b/i.test(t)) return true;
  if (/\b(?:di-?)?p+m+\b/i.test(t)) return true;
  if (/\b(?:di-?)?wa\b/i.test(t) || /\bwhatsapp\b/i.test(t)) return true;
  if (/\b(?:saluran|jalur|chat|pesan|ruang|kontak|nomor|inbox)\s+(?:pribadi|private)\b/i.test(t)) return true;
  if (/\b(?:lewat|via|melalui)\s+(?:pribadi|private|dm|pc|japri|wa)\b/i.test(t)) return true;
  if (/\bjangan\s+(?:di\s+|d)?grup\b/i.test(t)) return true;
  if (/\bdirect\s*message\b/i.test(t)) return true;
  return false;
}

export function isActionIntent(text = "") {
  if (!text) return false;
  return /\b(tambah|catat|buat|bikin|ingat|remind|jadwal|ubah|ganti|koreksi|update|hapus|delete|batal|cancel|selesai|done|mark|undo|simpan|brankas|cari|kirim|bagi|pc|japri|pm|dm|chat|wa|whatsapp|saluran\s+pribadi|jalur\s+pribadi|bangunin|telp|telepon|call|minta\s+akses|beri\s+akses|backlog|lihat|cek|tampil|hitung|python|script|plot|grafik|skill|macro|kristal|pelajari|baca|url|link|web|artikel|note|catatan|memo|health|server|mc|menkrep|minecraft|mabar|spek|spesifikasi|uptime|ram|cpu|disk|load|pdf|gabung|merge|split|pisah|render|kompres|compress|convert|konversi|docx|excel|xlsx|ocr|scan|digest|proposal|propose|approve|reject|rollback|versi|version|kontak|contact|orang|person|pasangan|direktori)/i.test(text);
}

export function isGreetingIntent(text = "") {
  if (!text) return false;
  const t = text.trim().replace(/^@\S+\s*/, "").trim();
  return (
    /^(p+|halo+|helo+|hello+|hai+|hi+|hey+|hei+|woi+|woy+|oi+|oy+|we+|euy+|uy+|alo+|yo+|wasap+|wassup+|what'?s\s*up|sup|howdy|hola|tes+|test|assalam\w*|salam\w*|samlekom|mikum|shalom|sampurasun|punten|permisi|kula\s*nuwun|pagi|siang|sore|malam|morning|afternoon|evening|selamat\s+(pagi|siang|sore|malam|datang)|met\s+(pagi|siang|sore|malam)|mustard|john|bot)\b/i.test(t) ||
    /^(bro|bang|kak|om|mas|mbak|pak|bu)\s+(john|mustard|bot|halo|hai|hey|hei|p|pagi|siang|sore|malam|yo|wasap|wassup)\b/i.test(t) ||
    /(siapa\s+(kamu|lu|anda)|nama\s+(kamu|lu|anda)|kamu\s+siapa|lu\s+siapa|perkenal|kenalan|dew\s*dew|john\s+mustard)/i.test(t)
  );
}

export function hasExplicitRescheduleIntent(text = "") {
  if (!text) return false;
  return /\b(undur|mundur(?:in)?|geser|tunda|ganti\s+jam|reschedule|pindah(?:in)?\s+jam)\b/i.test(text);
}

export function isFollowUpReminderIntent(text = "") {
  if (!text) return false;
  return /\b(inget(?:in|kan)?\s+lagi|remind\s+lagi|ping\s+lagi|ingatkan\s+nanti|ingetin\s+nanti|nanti\s+ingetin\s+lagi|tolong\s+ingetin\s+lagi)\b/i.test(text);
}

export function isQuotedEventReminder(quoted) {
  if (!quoted || !quoted.content) return false;
  const c = typeof quoted.content === "string" ? quoted.content : (quoted.content?.text || "");
  return /\[Pengingat Acara & Agenda\]|\[ACARA\]|#acara/i.test(c);
}

export function isAmbiguousEventReply(text = "", quoted = null) {
  if (!isQuotedEventReminder(quoted)) return false;
  if (hasExplicitRescheduleIntent(text)) return false;
  if (isFollowUpReminderIntent(text)) return false;
  return /(?:jam|pukul|\b\d{1,2}[.:]\d{2}\b|nanti\s+malem|nanti\s+sore|besok|nanti\s+aja|entar\s+aja)/i.test(text || "");
}

