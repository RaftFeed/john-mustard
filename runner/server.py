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

        else:
            return jsonify({
                "status": "error",
                "error": f"Aksi '{action}' tidak dikenal. Pilih: merge, split, render_image, images_to_pdf, compress."
            }), 400

    except Exception as e:
        return jsonify({"status": "error", "error": f"Gagal memproses PDF: {str(e)}"}), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    host = os.environ.get("HOST", "0.0.0.0")
    # ponytail: dev server ok for internal micro-runner
    app.run(host=host, port=port, threaded=True)
