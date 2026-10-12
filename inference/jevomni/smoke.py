#!/usr/bin/env python3
"""Acceptance test for the Jev-Omni System One door.

    JEVOMNI_URL=https://<pod>-8000.proxy.runpod.net JEVOMNI_TOKEN=... python3 smoke.py

Shells out to curl rather than using urllib: the RunPod proxy sits behind
Cloudflare, which answers Python-urllib's default user agent with 403 while
letting curl through. A 403 from the proxy is therefore not evidence that the
pod is down - check the pod's status before believing it.
"""
import base64, json, os, struct, subprocess, sys, time, zlib

URL = os.environ.get("JEVOMNI_URL", "").rstrip("/")
TOK = os.environ.get("JEVOMNI_TOKEN", "")
if not URL or not TOK:
    sys.exit("set JEVOMNI_URL and JEVOMNI_TOKEN")


def red_png(w=64, h=64):
    """A solid red PNG built by hand, so the test needs no image library."""
    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xffffffff)
    raw = b"".join(b"\x00" + bytes([220, 30, 30]) * w for _ in range(h))
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


PNG = "data:image/png;base64," + base64.b64encode(red_png()).decode()


def call(path, body=None, token=TOK, method="POST"):
    cmd = ["curl", "-s", "-m", "150", "-w", "\n%{http_code}", URL + path]
    if method == "POST":
        cmd += ["-X", "POST", "-H", "Content-Type: application/json",
                "--data-binary", json.dumps(body or {})]
    if token:
        cmd += ["-H", "Authorization: Bearer " + token]
    started = time.monotonic()
    out = subprocess.run(cmd, capture_output=True, text=True).stdout
    raw, _, code = out.rpartition("\n")
    try:    payload = json.loads(raw)
    except Exception: payload = raw[:200]
    return int(code or 0), payload, time.monotonic() - started


def choice(ident, labels):
    return {"type": "choice", "instructions": f"Which category does item `{ident}` belong to?",
            "criteria": {label: None for label in labels}}


def noul(ident, label):
    return {"type": "noul", "instructions": f'Does the category "{label}" apply to `{ident}` under its `rubric`?'}


results = []


def check(name, ok, detail=""):
    results.append(ok)
    print(f"{'PASS' if ok else 'FAIL'}  {name:<40} {detail}")


def answer(payload, qid):
    return (payload.get("answers") or {}).get(qid, {}) if isinstance(payload, dict) else {}


status, body, _ = call("/health", method="GET")
check("health reachable", status == 200 and body.get("ok") is True, f"{status} {body}")

for name, token in [("401 without bearer", None), ("401 with wrong bearer", "wrong-token")]:
    status, _, _ = call("/v1/systemone", {"state": [{"id": "a", "text": "x"}],
                                          "questions": {"q": noul("a", "y")}}, token=token)
    check(name, status == 401, str(status))

status, body, dt = call("/v1/systemone", {"state": [{"id": "t", "text": "I was double charged and want a refund."}],
                                          "questions": {"t": choice("t", ["billing", "technical", "account"])}})
got = answer(body, "t")
check("text choice", status == 200 and got.get("choice") == "billing",
      f"{got.get('choice')} @ {got.get('confidence', 0):.4f}  {dt * 1000:.0f}ms")

status, body, dt = call("/v1/systemone", {"state": [{"id": "n", "text": "My account was breached, I need help immediately."}],
                                          "questions": {"n": noul("n", "urgent")}})
got = answer(body, "n")
check("noul probability", status == 200 and isinstance(got.get("noul"), float),
      f"noul={got['noul']:.3f}  {dt * 1000:.0f}ms" if isinstance(got.get("noul"), float) else str(body)[:140])

status, body, dt = call("/v1/systemone", {"model": "jevomni", "media": [PNG],
                                          "state": [{"id": "img", "text": "Describe the dominant colour of the attached image."}],
                                          "questions": {"img": choice("img", ["red", "green", "blue", "yellow"])}})
got = answer(body, "img")
check("image decision", status == 200 and got.get("choice") == "red",
      f"{got.get('choice')} @ {got.get('confidence', 0):.4f}  {dt * 1000:.0f}ms" if status == 200 else str(body)[:160])

for name, body in [
    ("two media refused", {"media": [PNG, PNG], "state": [{"id": "a", "text": "x"}],
                           "questions": {"a": choice("a", ["red", "blue"])}}),
    ("1-option choice refused", {"state": [{"id": "a", "text": "x"}], "questions": {"a": choice("a", ["only"])}}),
    ("33 questions refused", {"state": [{"id": "a", "text": "x"}],
                              "questions": {f"q{i}": choice("a", ["x", "y"]) for i in range(33)}}),
    ("bad data url refused", {"media": ["data:image/png;base64,!!!"], "state": [{"id": "a", "text": "x"}],
                              "questions": {"a": choice("a", ["red", "blue"])}}),
    ("empty state refused", {"state": [], "questions": {"a": choice("a", ["x", "y"])}}),
]:
    status, payload, _ = call("/v1/systemone", body)
    kind = payload.get("error", {}).get("type") if isinstance(payload, dict) else None
    check(name, status == 400 and kind == "jevomni_input", f"{status} {kind}")

status, body, dt = call("/v1/systemone", {
    "state": [{"id": "p1", "text": "Refund my duplicate charge."},
              {"id": "p2", "text": "The settings screen crashes on launch."}],
    "questions": {"p1": choice("p1", ["billing", "technical"]), "p2": choice("p2", ["billing", "technical"])}})
check("packed items resolve separately",
      status == 200 and answer(body, "p1").get("choice") == "billing"
      and answer(body, "p2").get("choice") == "technical",
      f"p1={answer(body, 'p1').get('choice')} p2={answer(body, 'p2').get('choice')}  {dt * 1000:.0f}ms")

print(f"\n{sum(results)}/{len(results)} passed")
sys.exit(0 if all(results) else 1)
