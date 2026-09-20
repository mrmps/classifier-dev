"""Tests for the Python client against a stand-in server. `python3 test_classifier_dev.py` or pytest."""
import json, os, subprocess, sys, threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from classifier_dev import Client, ClassifierError, classify, classify_dimensions, DimensionResult

HERE = os.path.dirname(os.path.abspath(__file__))
REQUESTS = []


class H(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["content-length"])))
        REQUESTS.append((self.path, {k.lower(): v for k, v in self.headers.items()}, body))
        if "dimensions" in body:
            items = body.get("items") or body.get("inputs") or ([body["input"]] if "input" in body else [])
            dims = body["dimensions"]
            results = []
            for _ in items:
                row = {}
                for name, dim in dims.items():
                    labels = dim if isinstance(dim, list) else dim["labels"]
                    row[name] = {"label": labels[0], "confidence": 0.85, "scores": {l: (0.85 if l == labels[0] else 0.15 / max(len(labels) - 1, 1)) for l in labels}, "model": "jev-test", "ms": 50}
                results.append({"dimensions": row})
            out = {"tier": body.get("tier", "fast"), "model": "jev-test", "modelsUsed": ["jev-test"], "results": results, "usage": {"items": len(items), "dimensions": len(dims), "classifications": len(items) * len(dims)}}
            self.send_response(200); self.send_header("content-type", "application/json"); self.end_headers(); self.wfile.write(json.dumps(out).encode()); return
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


def test_dimensions():
    srv, url = serve()
    try:
        c = Client(base_url=url)
        dims = {"team": ["billing", "platform"], "kind": {"labels": ["bug", "request"], "instructions": "be strict"}}
        res = c.classify_dimensions(["checkout broke"], dims)
        assert len(res.results) == 1
        assert "team" in res.results[0] and "kind" in res.results[0]
        assert res.results[0]["team"].label == "billing"
        assert res.results[0]["kind"].label == "bug"
        assert isinstance(res.results[0]["team"], DimensionResult)
        assert res.results[0]["team"].confidence == 0.85
        assert isinstance(res.results[0]["team"].scores, dict)
        assert res.usage["dimensions"] == 2

        # Wire body check
        _, _, body = REQUESTS[-1]
        assert body["items"] == ["checkout broke"]
        assert "dimensions" in body
        assert "labels" not in body, "dimensions and labels must not be combined"

        # Tier reaches the wire
        c.classify_dimensions(["x"], {"a": ["x", "y"]}, tier="smart")
        _, _, body = REQUESTS[-1]
        assert body["tier"] == "smart"

        # Batch: multiple items
        res = c.classify_dimensions(["a", "b", "c"], {"team": ["billing", "platform"]})
        assert len(res.results) == 3

        # Validation
        for bad_items, bad_dims in [
            ("string", {"a": ["x", "y"]}),        # items is a string
            ([], {"a": ["x", "y"]}),               # empty items
            (["x"], {}),                            # empty dimensions
            (["x"], "not a dict"),                  # dimensions not a dict
        ]:
            try:
                c.classify_dimensions(bad_items, bad_dims); assert False, f"should reject {bad_items!r}, {bad_dims!r}"
            except (ValueError, TypeError):
                pass
    finally:
        srv.shutdown()


if __name__ == "__main__":
    test_roundtrip_and_error(); test_options_reach_the_wire(); test_every_failure_is_a_classifier_error(); test_cli(); test_structured_response_and_options(); test_dimensions(); print("ok")
