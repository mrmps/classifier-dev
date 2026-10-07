"""Measure file-to-parsed-response latency; never cache images or retry failures."""

import argparse
import base64
from datetime import datetime, timezone
import hashlib
import http.client
import json
import math
import os
from pathlib import Path
import time
from urllib.parse import urlsplit


def quantiles(values):
    ordered = sorted(values)
    return {f"p{p}": round(ordered[max(0, math.ceil(len(ordered) * p / 100) - 1)], 3)
            for p in (50, 95, 99, 100)} if ordered else {}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--rounds", type=int, default=20)
    parser.add_argument("--cold", action="store_true", help="New TCP/TLS connection for every request")
    parser.add_argument("--target-ms", type=float, default=120)
    parser.add_argument("--client", required=True, help="Client location and network, including VPN if present")
    args = parser.parse_args()
    endpoint = urlsplit(args.url)
    cases = json.loads(args.manifest.read_text())
    headers = {"content-type": "application/json"}
    if os.environ.get("CLASSIFIER_API_KEY"):
        headers["authorization"] = "Bearer " + os.environ["CLASSIFIER_API_KEY"]
    connection_type = http.client.HTTPSConnection if endpoint.scheme == "https" else http.client.HTTPConnection
    rows = []
    connection = None
    for repeat in range(args.rounds):
        for case in cases:
            started = time.perf_counter_ns()
            try:
                image = (args.manifest.parent / case["image"]).read_bytes()
                payload = {"model": "imajev-4b", "state": case.get("state", ""),
                           "images": ["data:" + case.get("mime", "image/jpeg") + ";base64," + base64.b64encode(image).decode()],
                           "questions": case["questions"], "share_data": False}
                body = json.dumps(payload, separators=(",", ":")).encode()
                encoded = time.perf_counter_ns()
                if connection is None:
                    connection = connection_type(endpoint.hostname, endpoint.port, timeout=30)
                connection.request("POST", endpoint.path or "/v1/systemone", body, headers)
                response = connection.getresponse()
                result = json.loads(response.read())
                finished = time.perf_counter_ns()
                correct = all(result.get("answers", {}).get(q, {}).get("choice") == gold
                              for q, gold in case.get("expected", {}).items())
                rows.append({"case": case["id"], "round": repeat, "status": response.status,
                             "correct": response.status == 200 and correct,
                             "e2e_ms": (finished - started) / 1e6,
                             "encode_ms": (encoded - started) / 1e6, "request_bytes": len(body),
                             "image_sha256": hashlib.sha256(image).hexdigest(),
                             "server_timing": response.getheader("server-timing"),
                             "usage": result.get("usage"), "answers": result.get("answers"),
                             "error": result.get("error")})
            except Exception as error:
                rows.append({"case": case["id"], "round": repeat, "status": 0, "correct": False,
                             "e2e_ms": (time.perf_counter_ns() - started) / 1e6, "error": str(error)})
                if connection:
                    connection.close()
                connection = None
            if args.cold and connection:
                connection.close()
                connection = None
    if connection:
        connection.close()
    summary = {"url": args.url, "client": args.client, "target_ms": args.target_ms,
               "recorded_at": datetime.now(timezone.utc).isoformat(), "connection": "new-per-request" if args.cold else "reused",
               "includes": ["file-read", "base64", "json-encode", "dns/connect-if-needed", "upload",
                            "authentication", "image-decode", "inference", "download", "json-decode"],
               "requests": len(rows), "errors": sum(row["status"] != 200 for row in rows),
               "correct": sum(row["correct"] for row in rows),
               "all_ms": quantiles([row["e2e_ms"] for row in rows]),
               "first_request_ms": rows[0]["e2e_ms"] if rows else None,
               "warm_ms": quantiles([row["e2e_ms"] for row in rows[1:]]) if not args.cold else None}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({"summary": summary, "requests": rows}, indent=2) + "\n")
    print(json.dumps(summary, indent=2))
    raise SystemExit(0 if rows and all(row["correct"] and row["e2e_ms"] < args.target_ms for row in rows) else 1)


if __name__ == "__main__":
    main()
