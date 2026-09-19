import json, threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from classifier_dev import Client, ClassifierError

class H(BaseHTTPRequestHandler):
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["content-length"])))
        if "boom" in body["labels"]:
            self.send_response(429); self.send_header("Retry-After", "7"); self.send_header("content-type", "application/json"); self.end_headers()
            self.wfile.write(b'{"error":"Rate limit","code":"rate_limit_minute"}'); return
        out = {"tier": "fast", "model": "m", "results": [{"label": body["labels"][0], "confidence": 0.9, "scores": {}} for _ in body["inputs"]], "usage": {}}
        self.send_response(200); self.send_header("content-type", "application/json"); self.end_headers(); self.wfile.write(json.dumps(out).encode())
    def log_message(self, *a): pass

def test_roundtrip_and_error():
    srv = HTTPServer(("127.0.0.1", 0), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
    c = Client(base_url=f"http://127.0.0.1:{srv.server_port}")
    res = c.classify(["a", "b"], ["x", "y"])
    assert [r.label for r in res.results] == ["x", "x"] and res.results[0].confidence == 0.9
    try:
        c.classify(["a"], ["boom", "y"]); assert False
    except ClassifierError as e:
        assert e.code == "rate_limit_minute" and e.retry_after == 7 and e.status == 429
    srv.shutdown()

if __name__ == "__main__":
    test_roundtrip_and_error(); print("ok")
