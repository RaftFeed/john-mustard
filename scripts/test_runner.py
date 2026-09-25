import os
import urllib.request
import json
import subprocess
import time
import sys

def run_test():
    env = os.environ.copy()
    env["PORT"] = "8008"
    p = subprocess.Popen([sys.executable, "runner/server.py"], env=env)
    time.sleep(1)
    try:
        # Test 1: Math calculation
        req = urllib.request.Request(
            "http://127.0.0.1:8008/run",
            data=json.dumps({"code": "print(2**10)"}).encode("utf-8"),
            headers={"Content-Type": "application/json"}
        )
        res = json.loads(urllib.request.urlopen(req).read())
        assert res["stdout"].strip() == "1024", f"Unexpected stdout: {res}"

        # Test 2: Chart image capture
        code = "import os; open(os.environ['CHART_PATH'], 'wb').write(b'fakepng'); print('chart ready')"
        req = urllib.request.Request(
            "http://127.0.0.1:8008/run",
            data=json.dumps({"code": code}).encode("utf-8"),
            headers={"Content-Type": "application/json"}
        )
        res = json.loads(urllib.request.urlopen(req).read())
        assert res["stdout"].strip() == "chart ready"
        assert res["image_base64"] is not None

        # Test 3: Timeout handling
        req = urllib.request.Request(
            "http://127.0.0.1:8008/run",
            data=json.dumps({"code": "import time; time.sleep(15)"}).encode("utf-8"),
            headers={"Content-Type": "application/json"}
        )
        res = json.loads(urllib.request.urlopen(req).read())
        assert res["exit_code"] == 124
        assert "timed out" in res["stderr"]

        # Test 4: PDF Merge & Render Image
        import pymupdf as fitz
        import base64
        doc1 = fitz.open()
        doc1.new_page().insert_text((50, 50), "PDF 1")
        b1_b64 = base64.b64encode(doc1.tobytes()).decode("utf-8")
        doc1.close()

        doc2 = fitz.open()
        doc2.new_page().insert_text((50, 50), "PDF 2")
        b2_b64 = base64.b64encode(doc2.tobytes()).decode("utf-8")
        doc2.close()

        # Merge
        req = urllib.request.Request(
            "http://127.0.0.1:8008/pdf",
            data=json.dumps({
                "action": "merge",
                "files": [{"data_base64": b1_b64}, {"data_base64": b2_b64}]
            }).encode("utf-8"),
            headers={"Content-Type": "application/json"}
        )
        res = json.loads(urllib.request.urlopen(req).read())
        assert res["status"] == "success"
        assert res["page_count"] == 2
        merged_b64 = res["data_base64"]

        # Render Image
        req = urllib.request.Request(
            "http://127.0.0.1:8008/pdf",
            data=json.dumps({
                "action": "render_image",
                "files": [{"data_base64": merged_b64}],
                "page_number": 1,
                "format": "png"
            }).encode("utf-8"),
            headers={"Content-Type": "application/json"}
        )
        res = json.loads(urllib.request.urlopen(req).read())
        assert res["status"] == "success"
        assert res["mimetype"] == "image/png"
        assert len(res["data_base64"]) > 0

        # Split
        req = urllib.request.Request(
            "http://127.0.0.1:8008/pdf",
            data=json.dumps({
                "action": "split",
                "files": [{"data_base64": merged_b64}],
                "pages": "1"
            }).encode("utf-8"),
            headers={"Content-Type": "application/json"}
        )
        res = json.loads(urllib.request.urlopen(req).read())
        assert res["status"] == "success"
        assert res["page_count"] == 1

        # Extract Text (Slides / PDF)
        req = urllib.request.Request(
            "http://127.0.0.1:8008/pdf",
            data=json.dumps({
                "action": "extract_text",
                "files": [{"data_base64": merged_b64}]
            }).encode("utf-8"),
            headers={"Content-Type": "application/json"}
        )
        res = json.loads(urllib.request.urlopen(req).read())
        assert res["status"] == "success"
        assert "PDF 1" in res["text"]

        # Test 5: Document Convert (/convert) - DOCX
        import io, docx
        doc_x = docx.Document()
        doc_x.add_paragraph("Laporan Keuangan Q3 John Mustard")
        buf_x = io.BytesIO()
        doc_x.save(buf_x)
        docx_b64 = base64.b64encode(buf_x.getvalue()).decode("utf-8")

        req = urllib.request.Request(
            "http://127.0.0.1:8008/convert",
            data=json.dumps({
                "files": [{"filename": "laporan.docx", "data_base64": docx_b64}],
                "target_format": "pdf"
            }).encode("utf-8"),
            headers={"Content-Type": "application/json"}
        )
        res = json.loads(urllib.request.urlopen(req).read())
        assert res["status"] == "success"
        assert "Laporan Keuangan Q3" in res["text"]
        assert len(res["data_base64"]) > 0

        # Test 6: OCR endpoint (/ocr)
        req = urllib.request.Request(
            "http://127.0.0.1:8008/ocr",
            data=json.dumps({
                "files": [{"filename": "sample.pdf", "data_base64": merged_b64}]
            }).encode("utf-8"),
            headers={"Content-Type": "application/json"}
        )
        res = json.loads(urllib.request.urlopen(req).read())
        assert res["status"] == "success"
        assert res["page_count"] == 2
        assert "PDF 1" in res["text"]

        print("ALL RUNNER TESTS PASSED")
    finally:
        p.terminate()

if __name__ == "__main__":
    run_test()
