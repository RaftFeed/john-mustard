import base64
import os
import subprocess
import sys
import tempfile
from flask import Flask, request, jsonify

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

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    host = os.environ.get("HOST", "0.0.0.0")
    # ponytail: dev server ok for internal micro-runner
    app.run(host=host, port=port, threaded=True)
