const SUPERSCRIPTS = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "n": "ⁿ", "k": "ᵏ", "x": "ˣ", "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾"
};
const SUBSCRIPTS = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "a": "ₐ", "e": "ₑ", "i": "ᵢ", "j": "ⱼ", "k": "ₖ", "m": "ₘ", "n": "ₙ", "o": "ₒ", "p": "ₚ", "r": "ᵣ",
  "s": "ₛ", "t": "ₜ", "u": "ᵤ", "v": "ᵥ", "x": "ₓ"
};

export function formatRowsToMarkdown(rows, { maxRows = 100 } = {}) {
  if (!rows || rows.length === 0) return "[Tabel spreadsheet kosong]";

  const filtered = [];
  for (const r of rows) {
    if (r && /^\d+$/.test(r[0]) && r.length > 1) {
      filtered.push(r.slice(1));
    } else {
      filtered.push(r);
    }
  }

  if (filtered.length === 0) return "[Tabel spreadsheet kosong]";

  const header = filtered[0];
  const dataRows = filtered.slice(1);
  const displayed = dataRows.slice(0, maxRows);

  if (header.length > 10) {
    const lines = [`> *Tabel Data Spreadsheet* (Total ${dataRows.length} baris)`];
    displayed.forEach((r, idx) => {
      lines.push(`\n--- Baris ${idx + 1} ---`);
      header.forEach((colName, cIdx) => {
        const val = r[cIdx] ? r[cIdx].trim() : "";
        if (val) lines.push(`• *${colName.trim()}*: ${val}`);
      });
    });
    if (dataRows.length > maxRows) {
      lines.push(`\n_... (Dipotong ${dataRows.length - maxRows} baris tambahan karena batasan panjang)_`);
    }
    return lines.join("\n");
  }

  const cleanHeader = header.map((h, i) => h.replace(/[\r\n|]+/g, " ").trim() || `Kolom_${i + 1}`);
  const lines = [];
  lines.push("| " + cleanHeader.join(" | ") + " |");
  lines.push("| " + cleanHeader.map(() => "---").join(" | ") + " |");

  for (const r of displayed) {
    const padded = cleanHeader.map((_, i) => (r[i] ? r[i].replace(/[\r\n|]+/g, " ").trim() : ""));
    lines.push("| " + padded.join(" | ") + " |");
  }

  if (dataRows.length > maxRows) {
    lines.push(`\n_Menampilkan ${maxRows} dari total ${dataRows.length} baris data._`);
  }

  return lines.join("\n");
}

export function parseHtmlTableToMarkdown(htmlText, { maxRows = 100 } = {}) {
  const trMatches = [...htmlText.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  if (trMatches.length === 0) return null;

  const rows = [];
  for (const tr of trMatches) {
    const rowHtml = tr[1];
    const cellMatches = [...rowHtml.matchAll(/<(?:td|th)\b[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)];
    const row = cellMatches.map((c) => {
      return c[1]
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/[\r\n\t]+/g, " ")
        .replace(/[ \t]+/g, " ")
        .trim();
    });
    while (row.length > 0 && !row[row.length - 1]) {
      row.pop();
    }
    if (row.length > 0 && row.some(Boolean)) {
      rows.push(row);
    }
  }

  if (rows.length === 0) return null;
  return formatRowsToMarkdown(rows, { maxRows });
}

export function parseCsvToMarkdown(csvText, { maxRows = 100 } = {}) {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return null;

  const rows = lines.map((line) => {
    const cells = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        cells.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    cells.push(current.trim());
    return cells;
  });

  return formatRowsToMarkdown(rows, { maxRows });
}

export function stripHallucinatedToolChips(text = "") {
  if (!text) return "";
  return text.replace(/\n*\s*[_*~`]*↳\s*[`\w\s,_]+[_*~`]*\s*$/g, "").trim();
}

export function sanitizeLatexForWhatsApp(text = "") {
  if (!text || !text.includes("$")) return text;

  const replaceMath = (_, expr) => {
    let clean = expr.trim();
    clean = clean.replace(/\\log_2/g, "log₂").replace(/\\log/g, "log").replace(/\\ln/g, "ln");
    clean = clean.replace(/\\cdot/g, "·").replace(/\\times/g, "×").replace(/\\approx/g, "≈");
    clean = clean.replace(/\\leq/g, "≤").replace(/\\geq/g, "≥").replace(/\\neq/g, "≠");
    clean = clean.replace(/\\sqrt/g, "√").replace(/\\pm/g, "±").replace(/\\infty/g, "∞");
    clean = clean.replace(/\\sum/g, "Σ").replace(/\\prod/g, "Π").replace(/\\int/g, "∫");
    clean = clean.replace(/\\theta/g, "θ").replace(/\\lambda/g, "λ").replace(/\\pi/g, "π");
    clean = clean.replace(/\\alpha/g, "α").replace(/\\beta/g, "β").replace(/\\gamma/g, "γ");
    clean = clean.replace(/\\Omega/g, "Ω").replace(/\\Theta/g, "Θ").replace(/\\mathcal\{O\}/g, "O");

    // Superscripts
    clean = clean.replace(/\^\{([^}]+)\}|\^([0-9a-zA-Z+\-]+)/g, (_, p1, p2) => {
      const val = p1 || p2;
      return [...val].map((c) => SUPERSCRIPTS[c] || c).join("");
    });

    // Subscripts
    clean = clean.replace(/_\{([^}]+)\}|_([0-9a-zA-Z])/g, (_, p1, p2) => {
      const val = p1 || p2;
      return [...val].map((c) => SUBSCRIPTS[c] || c).join("");
    });

    clean = clean.replace(/[{}]/g, "").replace(/\\/g, "");
    return clean;
  };

  return text
    .replace(/\$\$([^$]+)\$\$/g, replaceMath)
    .replace(/\$([^$]+)\$/g, replaceMath);
}

export function formatForWhatsApp(text = "") {
  if (!text) return "";

  const codeBlocks = [];
  let s = text.replace(/```[\s\S]*?```|`[^`\n]+`/g, (match) => {
    const placeholder = `@@CODE_BLOCK_${codeBlocks.length}@@`;
    codeBlocks.push(match);
    return placeholder;
  });

  s = s.replace(/^[ \t]*#{1,6}[ \t]+(.*)$/gm, "*$1*");
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "*$1*");
  s = s.replace(/__([^_\n]+)__/g, "*$1*");
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1 ($2)");
  s = s.replace(/^[ \t]*[-*+][ \t]+/gm, "• ");
  s = s.replace(/^[ \t]*>[ \t]+(.*)$/gm, "_$1_");
  s = s.replace(/@@CODE_BLOCK_(\d+)@@/g, (_, idx) => codeBlocks[Number(idx)]);

  return s;
}
