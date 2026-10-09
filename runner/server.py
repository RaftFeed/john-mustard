import base64
import io
import os
import subprocess
import sys
import tempfile
from flask import Flask, request, jsonify

try:
    import pymupdf as fitz
except ImportError:
    try:
        import fitz
    except ImportError:
        fitz = None

try:
    from PIL import Image
except ImportError:
    Image = None

app = Flask(__name__)
CHART_FILE = os.path.join(tempfile.gettempdir(), "chart.png")

@app.route("/run", methods=["POST"])
def run_code():
    data = request.get_json(silent=True) or {}
    code = data.get("code", "")

    if os.path.exists(CHART_FILE):
        try:
            os.remove(CHART_FILE)
        except OSError:
            pass

    env = {
        **os.environ,
        "MPLBACKEND": "Agg",
        "CHART_PATH": CHART_FILE
    }

    try:
        res = subprocess.run(
            [sys.executable, "-c", code],
            capture_output=True,
            text=True,
            timeout=10,
            env=env
        )
        stdout = res.stdout
        stderr = res.stderr
        exit_code = res.returncode
    except subprocess.TimeoutExpired:
        stdout = ""
        stderr = "Execution timed out (10s)"
        exit_code = 124
    except Exception as e:
        stdout = ""
        stderr = str(e)
        exit_code = 1

    img_b64 = None
    if os.path.exists(CHART_FILE):
        try:
            with open(CHART_FILE, "rb") as f:
                img_b64 = base64.b64encode(f.read()).decode("utf-8")
            os.remove(CHART_FILE)
        except Exception:
            pass

    return jsonify({
        "stdout": stdout,
        "stderr": stderr,
        "exit_code": exit_code,
        "image_base64": img_b64
    })


@app.route("/pdf", methods=["POST"])
def process_pdf():
    """
    Unified polymorphic PDF & document manipulation endpoint.
    Actions supported:
      - merge: combine multiple PDF byte streams
      - split: extract page range ('1-3, 5', 'last') and optional rotation
      - render_image: render page to PNG/JPG image bytes
      - images_to_pdf: compile multiple images into a single multi-page PDF
      - compress: deflate and optimize streams
    """
    if fitz is None:
        return jsonify({"status": "error", "error": "PyMuPDF (fitz) tidak terpasang di runner."}), 500

    payload = request.get_json(silent=True) or {}
    action = str(payload.get("action", "")).strip().lower()

    if not action:
        return jsonify({
            "status": "error",
            "error": "Parameter 'action' wajib diisi (merge, split, render_image, images_to_pdf, compress)."
        }), 400

    raw_files = payload.get("files") or []
    if not isinstance(raw_files, list) or len(raw_files) == 0:
        return jsonify({"status": "error", "error": "Parameter 'files' harus berupa array file."}), 400

    def get_file_bytes(f_entry):
        if isinstance(f_entry, dict):
            if "data_base64" in f_entry and f_entry["data_base64"]:
                return base64.b64decode(f_entry["data_base64"])
            if "filepath" in f_entry and f_entry["filepath"] and os.path.exists(f_entry["filepath"]):
                with open(f_entry["filepath"], "rb") as fh:
                    return fh.read()
        elif isinstance(f_entry, str):
            # Assume base64 string or file path
            if os.path.exists(f_entry):
                with open(f_entry, "rb") as fh:
                    return fh.read()
            return base64.b64decode(f_entry)
        raise ValueError(f"Tidak dapat membaca konten file: {f_entry}")

    try:
        # 1. MERGE
        if action == "merge":
            master = fitz.open()
            for f in raw_files:
                b = get_file_bytes(f)
                sub = fitz.open(stream=b, filetype="pdf")
                master.insert_pdf(sub)
                sub.close()
            out_bytes = master.tobytes(deflate=True)
            master.close()
            return jsonify({
                "status": "success",
                "action": "merge",
                "data_base64": base64.b64encode(out_bytes).decode("utf-8"),
                "mimetype": "application/pdf",
                "page_count": len(fitz.open(stream=out_bytes, filetype="pdf")),
                "message": f"Berhasil menggabungkan {len(raw_files)} file PDF."
            })

        # 2. SPLIT / EXTRACT
        elif action == "split":
            b = get_file_bytes(raw_files[0])
            doc = fitz.open(stream=b, filetype="pdf")
            total_pages = len(doc)
            pages_expr = str(payload.get("pages") or payload.get("page_range") or "1").strip()
            rotate_deg = int(payload.get("rotate_deg", 0) or 0)

            indices = []
            for part in pages_expr.split(","):
                part = part.strip()
                if not part:
                    continue
                if "-" in part:
                    s, e = part.split("-", 1)
                    s_idx = max(0, int(s.strip()) - 1)
                    e_idx = min(total_pages - 1, int(e.strip()) - 1)
                    indices.extend(range(s_idx, e_idx + 1))
                elif part.lower() == "last":
                    indices.append(total_pages - 1)
                else:
                    idx = int(part) - 1
                    if 0 <= idx < total_pages:
                        indices.append(idx)

            seen = set()
            unique_indices = [x for x in indices if not (x in seen or seen.add(x))]
            if not unique_indices:
                unique_indices = [0]

            doc.select(unique_indices)
            if rotate_deg:
                for page in doc:
                    page.set_rotation(page.rotation + rotate_deg)

            out_bytes = doc.tobytes(deflate=True)
            page_count = len(doc)
            doc.close()

            return jsonify({
                "status": "success",
                "action": "split",
                "data_base64": base64.b64encode(out_bytes).decode("utf-8"),
                "mimetype": "application/pdf",
                "page_count": page_count,
                "message": f"Berhasil mengekstrak {page_count} halaman ({pages_expr}) dari PDF."
            })

        # 3. RENDER PAGE TO IMAGE
        elif action in ("render_image", "page_to_image"):
            b = get_file_bytes(raw_files[0])
            doc = fitz.open(stream=b, filetype="pdf")
            total_pages = len(doc)
            page_number = int(payload.get("page_number", 1) or 1)
            target_idx = max(0, min(total_pages - 1, page_number - 1))
            dpi = int(payload.get("dpi", 150) or 150)
            fmt = str(payload.get("format", "png")).strip().lower()
            if fmt not in ("png", "jpg", "jpeg"):
                fmt = "png"
            mimetype = "image/jpeg" if fmt in ("jpg", "jpeg") else "image/png"

            pix = doc[target_idx].get_pixmap(dpi=dpi)
            img_bytes = pix.tobytes(fmt if fmt != "jpg" else "jpeg")
            doc.close()

            return jsonify({
                "status": "success",
                "action": "render_image",
                "data_base64": base64.b64encode(img_bytes).decode("utf-8"),
                "mimetype": mimetype,
                "page_rendered": target_idx + 1,
                "total_pages": total_pages,
                "message": f"Berhasil merender halaman {target_idx + 1} ke format {fmt.upper()}."
            })

        # 4. IMAGES TO PDF
        elif action in ("images_to_pdf", "photos_to_pdf"):
            doc_master = fitz.open()
            for f in raw_files:
                b = get_file_bytes(f)
                img_pdf_bytes = fitz.open(stream=b).convert_to_pdf()
                sub = fitz.open("pdf", img_pdf_bytes)
                doc_master.insert_pdf(sub)
                sub.close()

            out_bytes = doc_master.tobytes(deflate=True)
            page_count = len(doc_master)
            doc_master.close()

            return jsonify({
                "status": "success",
                "action": "images_to_pdf",
                "data_base64": base64.b64encode(out_bytes).decode("utf-8"),
                "mimetype": "application/pdf",
                "page_count": page_count,
                "message": f"Berhasil mengonversi {len(raw_files)} gambar menjadi PDF ({page_count} halaman)."
            })

        # 5. COMPRESS
        elif action in ("compress", "optimize"):
            b = get_file_bytes(raw_files[0])
            orig_size = len(b)
            doc = fitz.open(stream=b, filetype="pdf")
            out_bytes = doc.tobytes(deflate=True, garbage=4, clean=True)
            new_size = len(out_bytes)
            doc.close()
            saved_pct = max(0.0, ((orig_size - new_size) / max(1, orig_size)) * 100.0)

            return jsonify({
                "status": "success",
                "action": "compress",
                "data_base64": base64.b64encode(out_bytes).decode("utf-8"),
                "mimetype": "application/pdf",
                "original_size": orig_size,
                "compressed_size": new_size,
                "saved_percent": round(saved_pct, 1),
                "message": f"Berhasil mengompres PDF dari {orig_size // 1024} KB ke {new_size // 1024} KB (hemat {saved_pct:.1f}%)."
            })

        # 6. EXTRACT TEXT (Google Slides & PDF)
        elif action in ("extract_text", "get_text", "read_slides"):
            b = get_file_bytes(raw_files[0])
            doc = fitz.open(stream=b, filetype="pdf")
            total = len(doc)
            pages_txt = []
            for idx, page in enumerate(doc):
                t = (page.get_text("text") or "").strip()
                if t:
                    pages_txt.append(f"--- Halaman/Slide {idx + 1} dari {total} ---\n{t}")
            doc.close()
            full_txt = "\n\n".join(pages_txt) if pages_txt else "[Dokumen/Slide tidak memuat teks layer digital]"
            return jsonify({
                "status": "success",
                "action": "extract_text",
                "text": full_txt[:15000],
                "page_count": total,
                "message": f"Berhasil mengekstrak teks dari {total} halaman/slide."
            })

        else:
            return jsonify({
                "status": "error",
                "error": f"Aksi '{action}' tidak dikenal. Pilih: merge, split, render_image, images_to_pdf, compress, extract_text."
            }), 400

    except Exception as e:
        return jsonify({"status": "error", "error": f"Gagal memproses PDF: {str(e)}"}), 500


@app.route("/convert", methods=["POST"])
def convert_document():
    """
    Office & document converter endpoint.
    Supports .docx, .xlsx, .pptx, .txt via headless LibreOffice (if installed)
    or native Python fallback (python-docx, zipfile/xml, PyMuPDF).
    """
    payload = request.get_json(silent=True) or {}
    files = payload.get("files") or []
    target_format = str(payload.get("target_format", "pdf")).strip().lower()
    if not files:
        return jsonify({"status": "error", "error": "Parameter 'files' tidak boleh kosong."}), 400

    f_entry = files[0]
    filename = f_entry.get("filename", "document.docx") if isinstance(f_entry, dict) else "document.docx"
    ext = os.path.splitext(filename)[1].lower()

    b = None
    if isinstance(f_entry, dict):
        if "data_base64" in f_entry and f_entry["data_base64"]:
            b = base64.b64decode(f_entry["data_base64"])
        elif "filepath" in f_entry and os.path.exists(f_entry["filepath"]):
            with open(f_entry["filepath"], "rb") as fh:
                b = fh.read()
    elif isinstance(f_entry, str):
        if os.path.exists(f_entry):
            with open(f_entry, "rb") as fh:
                b = fh.read()
        else:
            b = base64.b64decode(f_entry)

    if not b:
        return jsonify({"status": "error", "error": "Konten file tidak ditemukan."}), 400

    import shutil
    soffice_bin = shutil.which("soffice") or shutil.which("libreoffice") or os.environ.get("SOFFICE_PATH")
    if soffice_bin and (os.path.exists(soffice_bin) if os.path.isabs(soffice_bin) else True):
        try:
            with tempfile.TemporaryDirectory() as tmpdir:
                in_path = os.path.join(tmpdir, filename)
                with open(in_path, "wb") as fh:
                    fh.write(b)
                out_fmt = "pdf" if target_format in ("pdf", "document") else "txt"
                cmd = [soffice_bin, "--headless", "--convert-to", out_fmt, "--outdir", tmpdir, in_path]
                res = subprocess.run(cmd, capture_output=True, timeout=30)
                out_name = os.path.splitext(filename)[0] + ("." + out_fmt)
                out_path = os.path.join(tmpdir, out_name)
                if os.path.exists(out_path):
                    with open(out_path, "rb") as fh:
                        out_b = fh.read()
                    text_content = ""
                    if out_fmt == "pdf" and fitz:
                        d = fitz.open(stream=out_b, filetype="pdf")
                        text_content = "\n".join((page.get_text("text") or "").strip() for page in d)
                        d.close()
                    elif out_fmt == "txt":
                        text_content = out_b.decode("utf-8", errors="replace")
                    return jsonify({
                        "status": "success",
                        "engine": "libreoffice",
                        "filename": out_name,
                        "mimetype": "application/pdf" if out_fmt == "pdf" else "text/plain",
                        "data_base64": base64.b64encode(out_b).decode("utf-8"),
                        "text": text_content[:15000],
                        "message": f"Berhasil mengonversi '{filename}' ke format {out_fmt.upper()} via LibreOffice."
                    })
        except Exception:
            pass

    # Native Python Fallback
    try:
        if ext == ".docx":
            try:
                import docx
            except ImportError:
                return jsonify({"status": "error", "error": "python-docx tidak terpasang."}), 500
            doc = docx.Document(io.BytesIO(b))
            parts = []
            for p in doc.paragraphs:
                if p.text.strip():
                    parts.append(p.text.strip())
            for t in doc.tables:
                table_lines = []
                for row in t.rows:
                    row_txt = [c.text.strip().replace("\n", " ") for c in row.cells]
                    table_lines.append("| " + " | ".join(row_txt) + " |")
                if table_lines:
                    parts.append("\n".join(table_lines))
            full_text = "\n\n".join(parts) if parts else "[Dokumen DOCX kosong]"

            pdf_b64 = None
            if fitz and target_format == "pdf":
                pdf_doc = fitz.open()
                rect = fitz.Rect(54, 54, 595.28 - 54, 841.89 - 54)
                current_text = full_text
                page_count = 0
                while current_text and page_count < 100:
                    page = pdf_doc.new_page(width=595.28, height=841.89)
                    page_count += 1
                    tw = fitz.TextWriter(page.rect)
                    unused = tw.fill_textbox(rect, current_text, fontsize=11)
                    tw.write_text(page)
                    page.insert_text(fitz.Point(280, 815), f"- {page_count} -", fontsize=9)
                    if unused:
                        current_text = "\n".join(item[0] for item in unused).strip()
                    else:
                        break
                pdf_bytes = pdf_doc.tobytes(deflate=True)
                pdf_doc.close()
                pdf_b64 = base64.b64encode(pdf_bytes).decode("utf-8")

            return jsonify({
                "status": "success",
                "engine": "python_docx",
                "filename": os.path.splitext(filename)[0] + (".pdf" if target_format == "pdf" and pdf_b64 else ".txt"),
                "mimetype": "application/pdf" if target_format == "pdf" and pdf_b64 else "text/plain",
                "data_base64": pdf_b64 or base64.b64encode(full_text.encode("utf-8")).decode("utf-8"),
                "text": full_text[:15000],
                "message": f"Berhasil mengekstrak/mengonversi DOCX '{filename}' ({len(parts)} paragraf/tabel)."
            })

        elif ext in (".xlsx", ".xlsm"):
            import zipfile
            import xml.etree.ElementTree as ET
            with zipfile.ZipFile(io.BytesIO(b)) as zf:
                shared_strings = []
                if "xl/sharedStrings.xml" in zf.namelist():
                    root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
                    for si in root.findall(".//{*}si"):
                        t = "".join(node.text for node in si.findall(".//{*}t") if node.text)
                        shared_strings.append(t)

                sheet_files = [n for n in zf.namelist() if n.startswith("xl/worksheets/sheet") and n.endswith(".xml")]
                all_sheets_txt = []
                for s_file in sheet_files:
                    s_root = ET.fromstring(zf.read(s_file))
                    rows = []
                    for row in s_root.findall(".//{*}row"):
                        cols = []
                        for c in row.findall(".//{*}c"):
                            v = c.find(".//{*}v")
                            val = v.text if v is not None and v.text else ""
                            if c.attrib.get("t") == "s" and val.isdigit():
                                idx = int(val)
                                val = shared_strings[idx] if idx < len(shared_strings) else val
                            cols.append(val)
                        if any(cols):
                            rows.append("| " + " | ".join(cols) + " |")
                    if rows:
                        sheet_name = os.path.basename(s_file).replace(".xml", "")
                        all_sheets_txt.append(f"### Sheet: {sheet_name}\n" + "\n".join(rows[:100]))

                full_text = "\n\n".join(all_sheets_txt) if all_sheets_txt else "[Excel kosong]"
                return jsonify({
                    "status": "success",
                    "engine": "python_xlsx",
                    "filename": os.path.splitext(filename)[0] + ".txt",
                    "mimetype": "text/plain",
                    "data_base64": base64.b64encode(full_text.encode("utf-8")).decode("utf-8"),
                    "text": full_text[:15000],
                    "message": f"Berhasil mengekstrak data spreadsheet '{filename}'."
                })

        else:
            text_str = b.decode("utf-8", errors="replace")
            return jsonify({
                "status": "success",
                "engine": "plain_text",
                "filename": filename,
                "mimetype": "text/plain",
                "data_base64": base64.b64encode(b).decode("utf-8"),
                "text": text_str[:15000],
                "message": f"Berhasil membaca file teks '{filename}'."
            })
    except Exception as e:
        return jsonify({"status": "error", "error": f"Gagal konversi dokumen: {str(e)}"}), 500


@app.route("/ocr", methods=["POST"])
def ocr_document():
    """
    OCR endpoint for images and scanned PDFs.
    Uses PyMuPDF OCR (Tesseract binding) or tesseract CLI if present,
    with graceful fallback to digital text or informative report.
    """
    payload = request.get_json(silent=True) or {}
    files = payload.get("files") or []
    lang = str(payload.get("lang", "ind+eng")).strip()

    if not files:
        return jsonify({"status": "error", "error": "Parameter 'files' tidak boleh kosong."}), 400

    f_entry = files[0]
    filename = f_entry.get("filename", "scan.jpg") if isinstance(f_entry, dict) else "scan.jpg"
    ext = os.path.splitext(filename)[1].lower()

    b = None
    if isinstance(f_entry, dict):
        if "data_base64" in f_entry and f_entry["data_base64"]:
            b = base64.b64decode(f_entry["data_base64"])
        elif "filepath" in f_entry and os.path.exists(f_entry["filepath"]):
            with open(f_entry["filepath"], "rb") as fh:
                b = fh.read()
    elif isinstance(f_entry, str):
        if os.path.exists(f_entry):
            with open(f_entry, "rb") as fh:
                b = fh.read()
        else:
            b = base64.b64decode(f_entry)

    if not b:
        return jsonify({"status": "error", "error": "Konten file tidak ditemukan."}), 400

    if fitz is None:
        return jsonify({"status": "error", "error": "PyMuPDF tidak terpasang di runner."}), 500

    try:
        is_pdf = (ext == ".pdf") or b.startswith(b"%PDF")
        if is_pdf:
            doc = fitz.open(stream=b, filetype="pdf")
        else:
            img_doc = fitz.open(stream=b)
            pdf_bytes = img_doc.convert_to_pdf()
            doc = fitz.open("pdf", pdf_bytes)
            img_doc.close()

        total = len(doc)
        ocr_results = []
        engine_used = "tesseract_mupdf"

        for idx, page in enumerate(doc):
            extracted = ""
            try:
                tp = page.get_textpage_ocr(language=lang, dpi=150)
                extracted = tp.extractText().strip()
            except Exception:
                extracted = (page.get_text("text") or "").strip()
                engine_used = "digital_fallback"

            if extracted:
                ocr_results.append(f"--- Halaman {idx + 1} ---\n{extracted}")

        doc.close()
        full_text = "\n\n".join(ocr_results) if ocr_results else "[OCR tidak mendeteksi teks]"

        return jsonify({
            "status": "success",
            "ocr_engine": engine_used,
            "page_count": total,
            "text": full_text[:15000],
            "message": f"Selesai memproses OCR {total} halaman (engine: {engine_used})."
        })
    except Exception as e:
        return jsonify({"status": "error", "error": f"Gagal OCR dokumen: {str(e)}"}), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    host = os.environ.get("HOST", "0.0.0.0")
    # ponytail: dev server ok for internal micro-runner
    app.run(host=host, port=port, threaded=True)
