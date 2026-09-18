#!/usr/bin/env python3
"""Single-label eval on public datasets: Jev (TypeSafe) vs the OpenRouter models.

    export TYPESAFE_API_KEY=... OPENROUTER_API_KEY=...
    python3 single.py --dataset ag_news --n 400 --backend jev
    python3 single.py --dataset emotion --n 400 --backend openrouter:ibm-granite/granite-4.0-h-micro

Backends
  jev                 one TypeSafe request per --pack items (default 400), a Choice per item
  jev-single          one TypeSafe request per item — to check packing costs nothing
  openrouter:<model>  the worker's single-label prompt, one call per item, 8-way concurrent

Results are cached under eval/data/results/<dataset>-<backend>.json so the
escalation analysis (escalate.py) can combine backends without re-spending.
"""
import argparse
import json
import os
import statistics
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).parent
DATA = HERE / "data"

DATASETS = {
    # name: (hf dataset, config, split)
    "ag_news": ("fancyzhx/ag_news", "default", "test"),
    "emotion": ("dair-ai/emotion", "split", "test"),
}

LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def load(name, n):
    path = DATA / f"{name}.json"
    if path.exists():
        d = json.load(open(path))
    else:
        ds, cfg, split = DATASETS[name]
        rows, feats = [], {}
        for off in range(0, n, 100):
            u = (f"https://datasets-server.huggingface.co/rows?dataset={ds}&config={cfg}"
                 f"&split={split}&offset={off}&length={min(100, n - off)}")
            d = json.load(urllib.request.urlopen(urllib.request.Request(u, headers={"user-agent": "bench/1.0"}), timeout=60))
            feats = {f["name"]: f["type"] for f in d["features"]}
            rows += [r["row"] for r in d["rows"]]
        d = {"features": feats, "rows": rows}
        DATA.mkdir(exist_ok=True)
        json.dump(d, open(path, "w"))
    labels = d["features"]["label"]["names"]
    rows = [{"text": r["text"], "gold": labels[r["label"]]} for r in d["rows"][:n]]
    return labels, rows


def post(url, body, headers, timeout=180):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=headers)
    t = time.time()
    try:
        p = json.load(urllib.request.urlopen(req, timeout=timeout))
    except urllib.error.HTTPError as e:
        p = json.loads(e.read() or b"{}")
        p.setdefault("error", f"http {e.code}")
    return p, (time.time() - t) * 1000


# ---------------------------------------------------------------- TypeSafe

def jev(rows, labels, pack):
    key = os.environ["TYPESAFE_API_KEY"]
    out = [None] * len(rows)
    tokens = 0
    for start in range(0, len(rows), pack):
        chunk = rows[start:start + pack]
        if pack == 1:
            state = chunk[0]["text"]
            qs = {"c": {"type": "choice", "instructions": "Which category does the text belong to?",
                        "criteria": {l: None for l in labels}}}
        else:
            state = [{"id": f"i{k}", "text": r["text"]} for k, r in enumerate(chunk)]
            qs = {f"i{k}": {"type": "choice", "instructions": f"Which category does item `i{k}` belong to?",
                            "criteria": {l: None for l in labels}} for k in range(len(chunk))}
        p, ms = post("https://api.typesafe.ai/v1/systemone",
                     {"state": state, "model": "jev-latest", "questions": qs},
                     {"authorization": f"Bearer {key}", "content-type": "application/json"})
        if "answers" not in p:
            sys.exit(f"typesafe error: {p}")
        tokens += p["usage"]["input_tokens"]
        for k, r in enumerate(chunk):
            a = p["answers"]["c" if pack == 1 else f"i{k}"]
            out[start + k] = {"label": a["choice"], "confidence": a["confidence"],
                              "scores": a["probabilities"], "ms": ms / len(chunk)}
    return out, tokens * 0.042 / 1e6


# ---------------------------------------------------------------- OpenRouter, worker prompt

PROVIDERS = {
    "ibm-granite/granite-4.0-h-micro": "Cloudflare",
    "inclusionai/ling-3.0-flash": "Novita",
    "deepseek/deepseek-v4-flash": "StreamLake",
    "qwen/qwen3.7-flash": "Alibaba",
}


def build_prompt(labels):
    return "\n".join([
        "You are a classifier. Assign the input to exactly one category.",
        "\nCATEGORIES\n" + "\n".join(f"{LETTERS[i]} = {l}" for i, l in enumerate(labels)),
        f"\nAnswer with a single character: {', '.join(LETTERS[:len(labels)])}.",
    ])


def openrouter_one(model, labels, text, reasoning):
    key = os.environ["OPENROUTER_API_KEY"]
    body = {
        "model": model,
        "messages": [{"role": "system", "content": build_prompt(labels)},
                     {"role": "user", "content": f"{text}\nANSWER:"}],
        "max_tokens": 2000 if reasoning else 1,
        "temperature": 0,
        "usage": {"include": True},
    }
    if reasoning:
        body["reasoning"] = {"effort": "low"}
    else:
        body["reasoning"] = {"enabled": False}
        body["logprobs"] = True
        body["top_logprobs"] = 8
    if PROVIDERS.get(model):
        body["provider"] = {"only": [PROVIDERS[model]], "allow_fallbacks": False}
    for attempt in range(4):
        p, ms = post("https://openrouter.ai/api/v1/chat/completions", body,
                     {"authorization": f"Bearer {key}", "content-type": "application/json"})
        if p.get("choices"):
            break
        time.sleep(0.5 * 2 ** attempt)
    else:
        return {"label": None, "confidence": None, "ms": ms, "cost": 0}
    content = p["choices"][0]["message"].get("content") or ""
    valid = LETTERS[:len(labels)]
    letter = next((c for c in reversed(content.upper()) if c in valid), None)
    conf = None
    top = ((p["choices"][0].get("logprobs") or {}).get("content") or [{}])[0].get("top_logprobs")
    if top:
        import math
        mass = {}
        for t in top:
            c = t["token"].strip().upper()[:1]
            if c in valid:
                mass[c] = mass.get(c, 0) + math.exp(t["logprob"])
        tot = sum(mass.values())
        if tot and letter:
            conf = mass.get(letter, 0) / tot
    return {"label": labels[valid.index(letter)] if letter else None, "confidence": conf,
            "ms": ms, "cost": float(p.get("usage", {}).get("cost") or 0)}


def openrouter(rows, labels, model):
    reasoning = model.startswith("qwen/qwen3.7") or "deepseek-v4-flash-0731" in model
    with ThreadPoolExecutor(8) as pool:
        out = list(pool.map(lambda r: openrouter_one(model, labels, r["text"], reasoning), rows))
    return out, sum(o.pop("cost") for o in out)


# ---------------------------------------------------------------- report

def report(name, backend, rows, out, cost):
    acc = sum(o["label"] == r["gold"] for r, o in zip(rows, out)) / len(rows)
    ms = statistics.median(o["ms"] for o in out)
    print(f"{name:10} {backend:44} acc={acc:.3f}  median_ms/item={ms:7.1f}  $/1k={cost / len(rows) * 1000:.4f}")
    confs = [o["confidence"] for o in out if o["confidence"] is not None]
    if len(confs) == len(out):
        print("           confidence bucket   n    acc   (calibration: acc should track the bucket)")
        for lo, hi in [(0, .5), (.5, .7), (.7, .9), (.9, 1.01)]:
            b = [(r, o) for r, o in zip(rows, out) if lo <= o["confidence"] < hi]
            if b:
                a = sum(o["label"] == r["gold"] for r, o in b) / len(b)
                print(f"             [{lo:.1f},{min(hi, 1):.1f})      {len(b):4}  {a:.3f}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", choices=DATASETS, default="ag_news")
    ap.add_argument("--n", type=int, default=400)
    ap.add_argument("--backend", default="jev")
    ap.add_argument("--pack", type=int, default=400)
    args = ap.parse_args()

    labels, rows = load(args.dataset, args.n)
    if args.backend == "jev":
        out, cost = jev(rows, labels, args.pack)
    elif args.backend == "jev-single":
        out, cost = jev(rows, labels, 1)
    elif args.backend.startswith("openrouter:"):
        out, cost = openrouter(rows, labels, args.backend.split(":", 1)[1])
    else:
        sys.exit("unknown backend")

    (DATA / "results").mkdir(parents=True, exist_ok=True)
    safe = args.backend.replace("/", "_").replace(":", "-")
    json.dump({"labels": labels, "rows": rows, "out": out, "cost": cost},
              open(DATA / "results" / f"{args.dataset}-{safe}.json", "w"))
    report(args.dataset, args.backend, rows, out, cost)


if __name__ == "__main__":
    main()
