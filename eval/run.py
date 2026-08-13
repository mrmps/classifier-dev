#!/usr/bin/env python3
"""Multi-label eval for classifier.dev.  Run: npm run eval

Reports macro precision, recall and F1 over eval/cases.py, plus median latency.

Read eval/README.md before trusting a number from this. The short version: the
cases and their gold labels were written by one person, the shipped
configuration was tuned on this same set, and n=7. Large gaps mean something;
anything inside roughly +/-0.03 does not.
"""
import argparse
import json
import statistics
import sys
import time
import urllib.request

from cases import CASES

ENDPOINT = "https://classifier.dev"
# Python's stdlib User-Agent is blocked at the edge; send a real one.
HEADERS = {"content-type": "application/json", "user-agent": "classifier-eval/1.0"}


def classify(labels, text, **extra):
    body = {"labels": labels, "input": text, "multi": True, **extra}
    for attempt in range(4):
        try:
            started = time.time()
            req = urllib.request.Request(
                ENDPOINT, data=json.dumps(body).encode(), headers=HEADERS
            )
            payload = json.load(urllib.request.urlopen(req, timeout=120))
            return payload["results"][0].get("labels", []), (time.time() - started) * 1000
        except Exception:
            if attempt == 3:
                raise
            time.sleep(3 * (attempt + 1))


def prf(got, gold):
    g, w = set(got), set(gold)
    hit = len(g & w)
    p = hit / len(g) if g else 0.0
    r = hit / len(w) if w else 1.0
    return p, r, (2 * p * r / (p + r) if p + r else 0.0)


def evaluate(extra, runs, show_cases):
    ps, rs, fs, ms = [], [], [], []
    for name, labels, text, gold in CASES:
        case_f = []
        for _ in range(runs):
            got, elapsed = classify(labels, text, **extra)
            p, r, f = prf(got, gold)
            ps.append(p); rs.append(r); fs.append(f); ms.append(elapsed)
            case_f.append(f)
            time.sleep(0.4)
        if show_cases:
            print(f"      {name:26} F1={statistics.mean(case_f):.2f}")
    return statistics.mean(ps), statistics.mean(rs), statistics.mean(fs), statistics.median(ms)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tier", choices=["fast", "smart", "both"], default="fast")
    ap.add_argument("--runs", type=int, default=2, help="runs per case (smart is capped at 10/min)")
    ap.add_argument("--max-labels", type=int, default=0)
    ap.add_argument("--cases", action="store_true", help="print per-case F1")
    args = ap.parse_args()

    tiers = ["fast", "smart"] if args.tier == "both" else [args.tier]
    extra_base = {"max_labels": args.max_labels} if args.max_labels else {}

    print(f"{len(CASES)} cases, {args.runs} run(s) each\n")
    print(f"{'tier':8} {'P':>5} {'R':>5} {'F1':>6} {'ms':>7}")
    for tier in tiers:
        runs = 1 if tier == "smart" and args.runs > 1 else args.runs
        p, r, f, ms = evaluate({**extra_base, "tier": tier}, runs, args.cases)
        print(f"  {tier:6} {p:5.2f} {r:5.2f} {f:6.3f} {int(ms):7}")
        sys.stdout.flush()
        if tier == "smart" and len(tiers) > 1:
            time.sleep(40)


if __name__ == "__main__":
    main()
