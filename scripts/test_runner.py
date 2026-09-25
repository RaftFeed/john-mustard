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

        print("ALL RUNNER TESTS PASSED")
    finally:
        p.terminate()

if __name__ == "__main__":
    run_test()
