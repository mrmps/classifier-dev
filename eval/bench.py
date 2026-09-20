#!/usr/bin/env python3
"""Model-vs-model bench for the multi-label pipeline.  Run: npm run bench

eval/run.py measures the *deployed* worker end to end and can only see whichever
model the tier happens to resolve to. This runs the same pipeline offline
against OpenRouter so a candidate model can be scored before it ships:

    python3 bench.py --models jev,inclusionai/ling-3.0-flash

`jev` is TypeSafe's model, the one in production (needs TYPESAFE_API_KEY); the
rest are OpenRouter ids run through the LLM fallback pipeline.

The pipeline here is a transcription of classifyOne() in src/index.ts — same
prompt, same 12-label chunking, same second pass over the survivors. If that
changes, change this too, or the numbers stop describing production.

The caveats in eval/README.md all still apply: n=7, one annotator, tuned on the
set it reports. Gaps inside roughly +/-0.03 are noise.
"""
import argparse
import json
import math
import os
import statistics
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from cases import CASES

API = "https://openrouter.ai/api/v1/chat/completions"
MULTI_CHUNK = 12  # mirrors src/index.ts

# provider is pinned exactly as the worker pins it: one provider, no fallbacks,
# so a measurement describes a specific machine rather than a lottery.
KNOWN_PROVIDERS = {
    "ibm-granite/granite-4.0-h-micro": "Cloudflare",
    "ibm-granite/granite-4.2-8b": "DeepInfra",
    "inclusionai/ling-3.0-flash": "Novita",
    "mistralai/mistral-nemo": "DeepInfra",
    "inception/mercury-2.5": "Inception",
    "deepseek/deepseek-v4-flash": "Baidu",
    "qwen/qwen3.8-flash": "Alibaba",
}


def build_multi_prompt(labels, instructions=None, max_labels=None, strict=False):
    parts = [
        "You are a multi-label classifier reviewing a shortlist. Keep only the categories the input clearly and substantively addresses."
        if strict
        else "You are a multi-label classifier. Select EVERY category that applies to the input, and only those.",
        "Drop any category that is merely adjacent, implied, or a stretch. Keep the ones a careful human tagger would defend."
        if strict
        else "A category applies if the input meaningfully touches it, even briefly or in passing. Do not restrict yourself to the single main topic.",
        f"\nCRITERIA\n{instructions}" if instructions else "",
        "\nCATEGORIES\n" + "\n".join(f"{i + 1} = {l}" for i, l in enumerate(labels)),
        f"\nSelect at most {max_labels}, the most clearly applicable ones." if max_labels else "",
        "\nAnswer with the numbers that apply, separated by commas, like: 2,5,9",
        "If none apply, answer exactly: none",
        "Answer with numbers only. Do not explain.",
    ]
    return "\n".join(p for p in parts if p)


def parse_numbers(answer, n, max_labels=None):
    seen, out = set(), []
    token = ""
    for ch in answer + " ":
        if ch.isdigit():
            token += ch
            continue
        if token:
            v = int(token)
            if 1 <= v <= n:
                seen.add(v)
            token = ""
    out = sorted(seen)
    return out[:max_labels] if max_labels and len(out) > max_labels else out


class Stats:
    def __init__(self):
        self.cost = 0.0
        self.calls = 0
        self.errors = 0


def call_model(key, model, provider, text, labels, stats, max_labels=None, timeout=120):
    """One OpenRouter call, shaped like callModel() in src/index.ts."""
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": build_multi_prompt(labels, None, max_labels)},
            {"role": "user", "content": f"{text}\nANSWER:"},
        ],
        "max_tokens": min(16 + len(labels) * 2, 160),
        "temperature": 0,
        "reasoning": {"enabled": False},
        "usage": {"include": True},
    }
    if provider:
        body["provider"] = {"only": [provider], "allow_fallbacks": False}

    last = ""
    for attempt in range(3):
        req = urllib.request.Request(
            API,
            data=json.dumps(body).encode(),
            headers={
                "authorization": f"Bearer {key}",
                "content-type": "application/json",
                "http-referer": "https://classifier.dev",
                "x-title": "classifier.dev bench",
            },
        )
        try:
            payload = json.load(urllib.request.urlopen(req, timeout=timeout))
        except urllib.error.HTTPError as e:
            payload = json.loads(e.read() or b"{}")
        except Exception as e:  # noqa: BLE001 - transport failures retry like the worker's
            payload = {"error": {"message": str(e)}}

        err = payload.get("error", {}).get("message")
        if not err and payload.get("choices"):
            stats.calls += 1
            stats.cost += float(payload.get("usage", {}).get("cost") or 0)
            answer = payload["choices"][0].get("message", {}).get("content") or ""
            if "none" in answer.lower() and not any(c.isdigit() for c in answer):
                return []
            return [labels[i - 1] for i in parse_numbers(answer, len(labels), max_labels)]
        last = err or "empty response"
        if not any(s in last.lower() for s in ("429", "rate", "timeout", "overload", "provider returned error")):
            break
        time.sleep(0.4 * 2**attempt)
    stats.errors += 1
    raise RuntimeError(last)


def jev_classify(text, labels, stats, max_labels=None, threshold=0.7, shared_rubric=False):
    """One TypeSafe request: a yes/no per label, read off the probabilities. Mirrors jev.ts."""
    key = os.environ.get("TYPESAFE_API_KEY") or sys.exit("set TYPESAFE_API_KEY to bench jev")
    started = time.time()
    if shared_rubric:
        state = [{
            "id": "i0",
            "text": text,
            "rubric": "A category applies if the text meaningfully touches it, even briefly.",
        }]
        qs = {
            f"l{i}": {
                "type": "noul",
                "instructions": f'Does the category "{l}" apply to `i0` under its `rubric`?',
            }
            for i, l in enumerate(labels)
        }
    else:
        state = [{"id": "i0", "text": text}]
        qs = {
            f"l{i}": {
                "type": "noul",
                "instructions": f'Does the category "{l}" apply to item `i0`? '
                "A category applies if the text meaningfully touches it, even briefly.",
            }
            for i, l in enumerate(labels)
        }
    req = urllib.request.Request(
        "https://api.typesafe.ai/v1/systemone",
        data=json.dumps({"state": state, "model": "jev-latest", "questions": qs}).encode(),
        headers={"authorization": f"Bearer {key}", "content-type": "application/json"},
    )
    payload = json.load(urllib.request.urlopen(req, timeout=120))
    stats.calls += 1
    stats.cost += payload["usage"]["input_tokens"] * 0.042 / 1e6
    probs = {l: payload["answers"][f"l{i}"]["noul"] for i, l in enumerate(labels)}
    picked = sorted((l for l in labels if probs[l] >= threshold), key=lambda l: -probs[l])
    return picked[:max_labels] if max_labels else picked, (time.time() - started) * 1000


def classify_one(key, model, provider, text, labels, stats, max_labels=None):
    """Transcription of classifyOne(): sweep in chunks, then verify the survivors."""
    if model in ("jev", "jev-shared"):
        return jev_classify(text, labels, stats, max_labels, shared_rubric=model == "jev-shared")
    started = time.time()
    if len(labels) <= MULTI_CHUNK:
        got = call_model(key, model, provider, text, labels, stats, max_labels)
        return got, (time.time() - started) * 1000

    groups = math.ceil(len(labels) / MULTI_CHUNK)
    size = math.ceil(len(labels) / groups)
    chunks = [labels[i : i + size] for i in range(0, len(labels), size)]

    with ThreadPoolExecutor(max_workers=len(chunks)) as pool:
        parts = list(pool.map(lambda c: call_model(key, model, provider, text, c, stats), chunks))

    hit = {l for part in parts for l in part}
    picked = [l for l in labels if l in hit]

    if len(picked) > 2:
        try:
            keep = set(call_model(key, model, provider, text, picked, stats, max_labels))
            narrowed = [l for l in picked if l in keep]
            if narrowed:
                picked = narrowed
        except RuntimeError:
            pass  # verification is an improvement, not a requirement
    if max_labels and len(picked) > max_labels:
        picked = picked[:max_labels]
    return picked, (time.time() - started) * 1000


def prf(got, gold):
    g, w = set(got), set(gold)
    hit = len(g & w)
    p = hit / len(g) if g else 0.0
    r = hit / len(w) if w else 1.0
    return p, r, (2 * p * r / (p + r) if p + r else 0.0)


def evaluate(key, model, runs, show_cases, max_labels=None):
    provider = KNOWN_PROVIDERS.get(model)
    stats = Stats()
    ps, rs, fs, ms = [], [], [], []
    per_case = []
    for name, labels, text, gold in CASES:
        case_f = []
        for _ in range(runs):
            try:
                got, elapsed = classify_one(key, model, provider, text, labels, stats, max_labels)
            except RuntimeError as e:
                print(f"      {name:26} FAILED: {e}", file=sys.stderr)
                got, elapsed = [], float("nan")
            p, r, f = prf(got, gold)
            ps.append(p); rs.append(r); fs.append(f)
            if elapsed == elapsed:  # not NaN
                ms.append(elapsed)
            case_f.append(f)
            time.sleep(0.3)
        per_case.append((name, statistics.mean(case_f)))
        if show_cases:
            print(f"      {name:26} F1={statistics.mean(case_f):.2f}")
    return {
        "p": statistics.mean(ps),
        "r": statistics.mean(rs),
        "f1": statistics.mean(fs),
        "ms": statistics.median(ms) if ms else float("nan"),
        "cost": stats.cost,
        "calls": stats.calls,
        "errors": stats.errors,
        "cases": per_case,
        "provider": provider or "any",
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", default="jev,inclusionai/ling-3.0-flash")
    ap.add_argument("--runs", type=int, default=2)
    ap.add_argument("--max-labels", type=int, default=0)
    ap.add_argument("--cases", action="store_true", help="print per-case F1")
    ap.add_argument("--json", metavar="PATH", help="also write raw results here")
    args = ap.parse_args()

    key = os.environ.get("OPENROUTER_API_KEY", "")
    if not key and any(m not in ("jev", "jev-shared") for m in args.models.split(",")):
        sys.exit("set OPENROUTER_API_KEY")

    models = [m.strip() for m in args.models.split(",") if m.strip()]
    cap = args.max_labels or None
    print(f"{len(CASES)} cases, {args.runs} run(s) each, multi-label pipeline\n")
    print(f"{'model':40} {'P':>5} {'R':>5} {'F1':>6} {'ms':>7} {'$/1k':>8} {'err':>4}")
    out = {}
    for model in models:
        if args.cases:
            print(f"  {model}")
        res = evaluate(key, model, args.runs, args.cases, cap)
        out[model] = res
        per_1k = res["cost"] / (len(CASES) * args.runs) * 1000
        print(
            f"  {model:38} {res['p']:5.2f} {res['r']:5.2f} {res['f1']:6.3f} "
            f"{int(res['ms']):7} {per_1k:8.3f} {res['errors']:4}"
        )
        sys.stdout.flush()
    if args.json:
        with open(args.json, "w") as fh:
            json.dump(out, fh, indent=2)


if __name__ == "__main__":
    main()
