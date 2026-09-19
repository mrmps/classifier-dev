#!/usr/bin/env python3
"""classifier.dev against the model it runs on.  Run: npm run vs-jev

The fast tier is Jev; the smart tier is Jev plus a reasoning model re-asking the
answers Jev was unsure about. So the honest question for this service is not
"is it accurate" but "is it better than calling Jev yourself". This measures
exactly that, on the same public sets as single.py, and prints the table the
home page carries.

    python3 vs_jev.py                       # ag_news + emotion, 400 items each
    python3 vs_jev.py --dataset emotion --n 100 --tier smart

Jev alone comes from single.py's cache (eval/data/results/<dataset>-jev.json),
or is re-measured when TYPESAFE_API_KEY is set. classifier.dev is measured
live, over the public API with no key, and cached under
<dataset>-classifier-<tier>.json in the same shape so escalate.py can read it.
"""
import argparse
import json
import os
import statistics
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from single import DATASETS, jev, load

HERE = Path(__file__).parent
RESULTS = HERE / "data" / "results"
UNSURE = 0.7  # the smart tier re-asks below this; mirrors ESCALATE_BELOW in src/index.ts


def post(url, body, timeout=300):
    req = urllib.request.Request(url, data=json.dumps(body).encode(),
                                 headers={"content-type": "application/json", "user-agent": "classifier-dev-eval/vs_jev"})
    t = time.time()
    try:
        res = urllib.request.urlopen(req, timeout=timeout)
        return json.load(res), dict(res.headers), (time.time() - t) * 1000
    except urllib.error.HTTPError as e:
        p = json.loads(e.read() or b"{}")
        p.setdefault("error", f"http {e.code}")
        return p, dict(e.headers), (time.time() - t) * 1000
    except (urllib.error.URLError, OSError, ValueError) as e:
        # A reset or a timeout is the network's problem, not the answer's; the
        # caller retries it like a 5xx.
        return {"error": f"network: {e}"}, {}, (time.time() - t) * 1000


def classifier(rows, labels, tier, endpoint, chunk):
    """One request per `chunk` items; a 429 waits for Retry-After and resumes."""
    out = [None] * len(rows)
    usage = {"classifications": 0, "escalated": 0, "escalation_failed": 0}
    for start in range(0, len(rows), chunk):
        inputs = [r["text"] for r in rows[start:start + chunk]]
        for attempt in range(8):
            p, h, ms = post(endpoint, {"inputs": inputs, "labels": labels, "tier": tier})
            if "results" in p:
                break
            wait = int(h.get("retry-after") or h.get("Retry-After") or 0) or 5 * 2 ** attempt
            print(f"  {tier}: {p.get('error')} — waiting {wait}s", file=sys.stderr)
            time.sleep(wait)
        else:
            sys.exit(f"classifier.dev {tier}: gave up at item {start}: {p}")
        if len(p["results"]) != len(inputs):
            sys.exit(f"classifier.dev {tier}: {len(p['results'])} results for {len(inputs)} inputs")
        for k in usage:
            usage[k] += p.get("usage", {}).get(k, 0)
        for k, r in enumerate(p["results"]):
            out[start + k] = {"label": r["label"], "confidence": r["confidence"], "scores": r.get("scores"),
                              "escalated": bool(r.get("escalated")), "model": r.get("model"), "ms": ms / len(inputs)}
        print(f"  {tier}: {start + len(inputs)}/{len(rows)}  {ms:.0f}ms  escalated so far {usage['escalated']}", file=sys.stderr)
    return out, usage


def cached(name):
    path = RESULTS / f"{name}.json"
    return json.load(open(path)) if path.exists() else None


def measure(dataset, n, tiers, endpoint, chunk, fresh):
    labels, rows = load(dataset, n)
    runs = {}

    base = None if fresh else cached(f"{dataset}-jev")
    if base and len(base["out"]) >= n:
        runs["jev"] = {"out": base["out"][:n], "cost": base["cost"] * n / len(base["out"]), "usage": {}}
    elif os.environ.get("TYPESAFE_API_KEY"):
        out, cost = jev(rows, labels, 400)
        runs["jev"] = {"out": out, "cost": cost, "usage": {}}
        json.dump({"labels": labels, "rows": rows, "out": out, "cost": cost}, open(RESULTS / f"{dataset}-jev.json", "w"))
    else:
        sys.exit(f"no cached Jev run for {dataset} with {n} items; set TYPESAFE_API_KEY to measure one")

    for tier in tiers:
        name = f"{dataset}-classifier-{tier}"
        c = None if fresh else cached(name)
        if c and len(c["out"]) >= n and c.get("n") == n:
            runs[tier] = c
            continue
        print(f"{dataset}: classifier.dev {tier}, {n} items", file=sys.stderr)
        out, usage = classifier(rows, labels, tier, endpoint, chunk)
        runs[tier] = {"labels": labels, "rows": rows, "out": out, "cost": 0.0, "usage": usage, "n": n,
                      "measured": time.strftime("%Y-%m-%d"), "endpoint": endpoint}
        RESULTS.mkdir(parents=True, exist_ok=True)
        json.dump(runs[tier], open(RESULTS / f"{name}.json", "w"))
    return labels, rows, runs


def summarise(rows, runs):
    """Accuracy overall and on the items Jev alone was unsure about."""
    jev_out = runs["jev"]["out"]
    unsure = [i for i, o in enumerate(jev_out) if (o["confidence"] or 0) < UNSURE]
    sure = [i for i in range(len(rows)) if i not in set(unsure)]
    rows_out = {}
    for name, run in runs.items():
        out = run["out"]
        right = [out[i]["label"] == rows[i]["gold"] for i in range(len(rows))]
        rows_out[name] = {
            "acc": sum(right) / len(rows),
            "acc_unsure": sum(right[i] for i in unsure) / len(unsure) if unsure else None,
            "acc_sure": sum(right[i] for i in sure) / len(sure) if sure else None,
            "agree_with_jev": sum(out[i]["label"] == jev_out[i]["label"] for i in range(len(rows))) / len(rows),
            # Where this run and Jev alone answered differently, and how many of
            # those were items one side had already flagged as unsure.
            "disagreements": len(disagree := [i for i in range(len(rows)) if out[i]["label"] != jev_out[i]["label"]]),
            "disagreements_unsure": sum(1 for i in disagree
                                        if (out[i]["confidence"] or 0) < UNSURE or (jev_out[i]["confidence"] or 0) < UNSURE),
            "escalated": sum(1 for o in out if o.get("escalated")),
            "ms_item": statistics.median(o["ms"] for o in out),
            "cost_per_1k": run["cost"] / len(rows) * 1000,
        }
    return {"n": len(rows), "unsure": len(unsure), "rows": rows_out}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", choices=list(DATASETS) + ["all"], default="all")
    ap.add_argument("--n", type=int, default=400)
    ap.add_argument("--tier", choices=["fast", "smart", "both"], default="both")
    ap.add_argument("--endpoint", default=os.environ.get("CLASSIFY_ENDPOINT", "https://classifier.dev"))
    ap.add_argument("--chunk", type=int, default=100, help="inputs per request; the smart tier allows 200/min")
    ap.add_argument("--fresh", action="store_true", help="ignore every cache, re-measure")
    args = ap.parse_args()
    tiers = ["fast", "smart"] if args.tier == "both" else [args.tier]
    datasets = list(DATASETS) if args.dataset == "all" else [args.dataset]

    summary = {}
    for ds in datasets:
        labels, rows, runs = measure(ds, args.n, tiers, args.endpoint, args.chunk, args.fresh)
        summary[ds] = summarise(rows, runs)

    names = {"jev": "jev alone (TypeSafe API, your key)", "fast": "classifier.dev fast", "smart": "classifier.dev smart"}
    print()
    for ds, s in summary.items():
        print(f"{ds}: {s['n']} items, {s['unsure']} of them Jev put under {UNSURE:.1f} confidence")
        print(f"  {'':38} {'accuracy':>8}  {'on the unsure':>13}  {'agrees w/ jev':>13}  {'re-asked':>8}  {'ms/item':>7}  {'$/1k':>6}")
        for k in ["jev"] + tiers:
            r = s["rows"].get(k)
            if not r:
                continue
            print(f"  {names[k]:38} {r['acc']:7.1%}  {r['acc_unsure']:12.1%}  {r['agree_with_jev']:12.1%}  {r['escalated']:8}  {r['ms_item']:7.1f}  {r['cost_per_1k']:6.3f}")
        print()
    # eval/data is gitignored (it holds the raw per-item runs), so the summary
    # the worker imports lives in src/, where it is tracked and deployed.
    doc = {"measured": time.strftime("%Y-%m-%d"), "summary": summary}
    for path in (RESULTS / "vs-jev-summary.json", HERE.parent / "src" / "vs-jev.json"):
        json.dump(doc, open(path, "w"), indent=1)
        print(f"written {path}")


if __name__ == "__main__":
    main()
