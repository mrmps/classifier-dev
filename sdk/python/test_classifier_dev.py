"""Tests for the Python client against a stand-in server. `python3 test_classifier_dev.py` or pytest."""
import json, os, subprocess, sys, threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from classifier_dev import Client, ClassifierError, classify

HERE = os.path.dirname(os.path.abspath(__file__))
REQUESTS = []


class H(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["content-length"])))
        REQUESTS.append((self.path, {k.lower(): v for k, v in self.headers.items()}, body))
        if "boom" in body["labels"]:
            self.send_response(429); self.send_header("Retry-After", "7"); self.send_header("content-type", "application/json"); self.end_headers()
            self.wfile.write(b'{"error":"Rate limit","code":"rate_limit_minute"}'); return
        if "bad-http" in body["labels"]:
            self.send_response(502); self.send_header("content-type", "application/json"); self.end_headers(); self.wfile.write(b"not json"); return
        if "list-http" in body["labels"]:
            self.send_response(502); self.send_header("content-type", "application/json"); self.end_headers(); self.wfile.write(b"[]"); return
        if "malformed" in body["labels"]:
            out = {"results": [1 for _ in body["inputs"]]}
            self.send_response(200); self.send_header("content-type", "application/json"); self.end_headers(); self.wfile.write(json.dumps(out).encode()); return
        if "nullscores" in body["labels"]:
            out = {"results": [{"label": "nullscores", "confidence": None, "scores": None} for _ in body["inputs"]]}
            self.send_response(200); self.send_header("content-type", "application/json"); self.end_headers(); self.wfile.write(json.dumps(out).encode()); return
        if "bad-labels" in body["labels"]:
            out = {"results": [{"label": "bad-labels", "labels": "oops", "confidence": 0.5, "scores": {}} for _ in body["inputs"]]}
            self.send_response(200); self.send_header("content-type", "application/json"); self.end_headers(); self.wfile.write(json.dumps(out).encode()); return
        if "bad-scores" in body["labels"]:
            out = {"results": [{"label": "bad-scores", "confidence": 0.5, "scores": {"bad-scores": "certain"}} for _ in body["inputs"]]}
            self.send_response(200); self.send_header("content-type", "application/json"); self.end_headers(); self.wfile.write(json.dumps(out).encode()); return
        if "bad-confidence" in body["labels"]:
            out = {"results": [{"label": "bad-confidence", "confidence": 2, "scores": {}} for _ in body["inputs"]]}
            self.send_response(200); self.send_header("content-type", "application/json"); self.end_headers(); self.wfile.write(json.dumps(out).encode()); return
        if "bad-bool-score" in body["labels"]:
            out = {"results": [{"label": "bad-bool-score", "confidence": 0.5, "scores": {"bad-bool-score": True}} for _ in body["inputs"]]}
            self.send_response(200); self.send_header("content-type", "application/json"); self.end_headers(); self.wfile.write(json.dumps(out).encode()); return
        if "bad-bool-confidence" in body["labels"]:
            out = {"results": [{"label": "bad-bool-confidence", "confidence": True, "scores": {}} for _ in body["inputs"]]}
            self.send_response(200); self.send_header("content-type", "application/json"); self.end_headers(); self.wfile.write(json.dumps(out).encode()); return
        if "html" in body["labels"]:
            self.send_response(502); self.send_header("content-type", "text/html"); self.end_headers()
            self.wfile.write(b"<html>bad gateway</html>"); return
        if "short" in body["labels"]:
            out = {"results": [{"label": "short", "confidence": 0.5}]}
        else:
            out = {"tier": "fast", "model": "m", "results": [
                ({"labels": [body["labels"][0]], "confidence": None, "scores": {}} if body.get("multi") else
                 {"label": body["labels"][0], "confidence": 0.9, "scores": {}})
                for _ in body["inputs"]
            ], "usage": {}}
        self.send_response(200); self.send_header("content-type", "application/json"); self.end_headers(); self.wfile.write(json.dumps(out).encode())

    def log_message(self, *a): pass


def serve():
    srv = HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f"http://127.0.0.1:{srv.server_port}"


def test_roundtrip_and_error():
    srv, url = serve()
    try:
        c = Client(base_url=url)
        res = c.classify(["a", "b"], ["x", "y"])
        assert [r.label for r in res.results] == ["x", "x"] and res.results[0].confidence == 0.9
        path, headers, body = REQUESTS[-1]
        assert path == "/v1/classify" and body == {"inputs": ["a", "b"], "labels": ["x", "y"]}
        assert headers["user-agent"].startswith("classifier-dev-python/"), "urllib's default User-Agent is refused at the edge"
        try:
            c.classify(["a"], ["boom", "y"]); assert False
        except ClassifierError as e:
            assert e.code == "rate_limit_minute" and e.retry_after == 7 and e.status == 429
    finally:
        srv.shutdown()


def test_options_reach_the_wire():
    srv, url = serve()
    try:
        Client(base_url=url, api_key="k").classify(["a"], ["x", "y"], tier="smart", instructions="be strict", multi=True, max_labels=2)
        path, headers, body = REQUESTS[-1]
        assert body == {"inputs": ["a"], "labels": ["x", "y"], "tier": "smart", "instructions": "be strict", "multi": True, "max_labels": 2}
        assert headers["authorization"] == "Bearer k"
    finally:
        srv.shutdown()


def test_laya_options_reach_the_wire():
    srv, url = serve()
    try:
        Client(base_url=url).classify(["a"], ["x", "y"], model="laya", processing="bulk")
        assert REQUESTS[-1][2]["model"] == "laya"
        assert REQUESTS[-1][2]["processing"] == "bulk"
    finally:
        srv.shutdown()


def test_every_failure_is_a_classifier_error():
    """The README promises one exception type; a refused socket or a timeout used to escape as URLError."""
    try:
        Client(base_url="http://127.0.0.1:1").classify(["x"], ["a", "b"]); assert False
    except ClassifierError as e:
        assert e.code == "network" and e.status == 0
    srv, url = serve()
    try:
        c = Client(base_url=url)
        try:
            c.classify(["x"], ["html", "b"]); assert False
        except ClassifierError as e:
            assert e.status == 502 and e.code == "http_502", "a non-JSON error body still yields a code"
        try:
            c.classify(["x", "y"], ["short", "b"]); assert False
        except ClassifierError as e:
            assert e.code == "bad_response" and "1 results for 2 inputs" in e.message
    finally:
        srv.shutdown()
    for bad in [([], ["a", "b"]), (["x"] * 1001, ["a", "b"]), (["x"], ["a"])]:
        try:
            Client().classify(*bad); assert False
        except ValueError:
            pass


def run_cli(args, stdin, url):
    env = {**os.environ, "CLASSIFIER_ENDPOINT": url, "PYTHONPATH": HERE}
    return subprocess.run([sys.executable, "-c", "from classifier_dev import _cli; _cli()", *args], input=stdin, capture_output=True, text=True, env=env)


def test_cli():
    srv, url = serve()
    try:
        p = run_cli(["bug,praise"], "crash\nlove it\n", url)
        assert p.returncode == 0 and p.stdout == "bug\t0.90\tcrash\nbug\t0.90\tlove it\n", (p.stdout, p.stderr)
        p = run_cli(["bug,praise"], "", url)
        assert p.returncode == 0 and p.stdout == "" and p.stderr == "", "an empty stdin is an empty answer, not a traceback"
        before = len(REQUESTS)
        p = run_cli(["bug,praise"], "\n".join(f"line {i}" for i in range(1500)) + "\n", url)
        assert p.returncode == 0 and len(p.stdout.splitlines()) == 1500 and len(REQUESTS) - before == 2, "1,500 lines go in two requests"
        p = run_cli(["boom,praise"], "x\n", url)
        assert p.returncode == 1 and p.stdout == "" and p.stderr == "classify-py: Rate limit\n"
        p = run_cli(["onlyone"], "x\n", url)
        assert p.returncode == 2 and "two labels" in p.stderr
        p = run_cli([], "", url)
        assert p.returncode == 2 and p.stderr.startswith("usage:")
    finally:
        srv.shutdown()


def test_structured_response_and_options():
    srv = HTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        c = Client(base_url=f"http://127.0.0.1:{srv.server_port}")
        try:
            c.classify(["x"], ["malformed", "b"]); assert False
        except ClassifierError as e:
            assert e.code == "bad_response" and "result 0" in e.message
        result = c.classify(["x"], ["nullscores", "b"]).results[0]
        assert result.scores is None, "scores:null must remain distinguishable from an empty score map"
        for labels in [["bad-labels", "b"], ["bad-scores", "b"], ["bad-confidence", "b"], ["bad-bool-score", "b"], ["bad-bool-confidence", "b"]]:
            try:
                c.classify(["x"], labels); assert False
            except ClassifierError as e:
                assert e.code == "bad_response"
        for labels in [["bad-http", "b"], ["list-http", "b"]]:
            try:
                c.classify(["x"], labels); assert False
            except ClassifierError as e:
                assert e.status == 502
        try:
            c.classify(["x"], ["a", "b"], max_labels=0); assert False
        except ValueError as e:
            assert "max_labels" in str(e)
        c.classify(["x"], ["a", "b"], max_labels=1)
        for bad in ["x", [1]]:
            try:
                c.classify(bad, ["a", "b"]); assert False
            except ValueError:
                pass
    finally:
        srv.shutdown()


if __name__ == "__main__":
    test_roundtrip_and_error(); test_options_reach_the_wire(); test_every_failure_is_a_classifier_error(); test_cli(); test_structured_response_and_options(); print("ok")
