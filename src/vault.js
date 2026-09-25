import fs from "node:fs";
import path from "node:path";
import { getEmbedding } from "./llm.js";

export function detectCategory(filename = "", mime = "") {
  const lower = (filename + " " + mime).toLowerCase();
  if (lower.includes("ktp") || lower.includes("sim") || lower.includes("paspor")) return "id_cards";
  if (lower.includes("struk") || lower.includes("bukti") || lower.includes("transfer") || lower.includes("invoice") || lower.includes("nota") || lower.includes("receipt")) return "receipts";
  if (mime.includes("pdf") || mime.includes("document") || mime.includes("sheet") || mime.includes("presentation")) return "documents";
  return "media";
}

export async function analyzeWithVision(rotator, buffer, mimetype, caption = "") {
  const base64Data = buffer.toString("base64");
  const prompt = `Analisis file/dokumen ini.
Caption dari pengguna: "${caption}".
Berikan:
1. Ringkasan singkat dokumen ini (1-3 kalimat)
2. Informasi penting (angka, tanggal, nama instansi, nomor invoice/dokumen jika ada).
Gunakan bahasa Indonesia yang ringkas.`;

  try {
    const data = await rotator.execute(async (key) => {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${key}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { inlineData: { mimeType: mimetype, data: base64Data } },
                { text: prompt }
              ]
            }
          ]
        })
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    });

    return data.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text || "Dokumen tersimpan.";
  } catch (err) {
    console.warn("Vision analysis skipped / error:", err.message);
    return caption ? `Deskripsi: ${caption}` : "Dokumen berhasil disimpan di vault.";
  }
}

export async function ingestVaultFile(store, rotator, { buffer, filename, mimetype, caption = "", ownerId = "" }) {
  const category = detectCategory(filename, mimetype);
  const targetDir = path.join("vault", category);
  fs.mkdirSync(targetDir, { recursive: true });

  const safeName = `${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const targetPath = path.join(targetDir, safeName);
  fs.writeFileSync(targetPath, buffer);

  let summary = "";
  if (mimetype.startsWith("image/") || mimetype === "application/pdf") {
    summary = await analyzeWithVision(rotator, buffer, mimetype, caption);
  } else {
    summary = caption ? `Catatan: ${caption}` : `File ${filename}`;
  }

  let embedding = null;
  if (rotator) {
    try {
      const textToEmbed = `${filename} ${category} ${summary}`.trim();
      embedding = await getEmbedding(rotator, textToEmbed);
    } catch (embErr) {
      console.warn("[Vault] Semantic embedding calculation skipped:", embErr.message);
    }
  }

  const id = store.saveVaultFile({
    ownerId,
    filename,
    category,
    filepath: targetPath,
    mimetype,
    filesize: buffer.length,
    summary,
    embedding
  });

  return { id, filename, category, filepath: targetPath, summary };
}
