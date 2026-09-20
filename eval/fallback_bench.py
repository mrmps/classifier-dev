#!/usr/bin/env python3
"""Benchmark Smart-tier candidates only where Jev is uncertain.

Reads the cached Jev runs produced by ``single.py`` and sends the exact
production single-label prompt to each OpenRouter candidate. This measures
the population the Smart tier actually pays to re-ask,
not a model's aggregate score on easy cases Jev already answered confidently.

    OPENROUTER_API_KEY=... python3 eval/fallback_bench.py --models a,b,c
"""

import argparse
import json
import os
import re
import statistics
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).parent
RESULTS = HERE / "data" / "results"
DATASETS = ("ag_news", "emotion")
LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def prompt(labels):
    return "\n".join([
        "You are a classifier. Assign the input to exactly one category.",
        "\nCATEGORIES\n" + "\n".join(f"{LETTERS[i]} = {label}" for i, label in enumerate(labels)),
        f"\nAnswer with a single character: {', '.join(LETTERS[:len(labels)])}.",
    ])


def post(body):
    req = urllib.request.Request(
        "https://openrouter.ai/api/v1/chat/completions",
        data=json.dumps(body).encode(),
        headers={
            "authorization": f"Bearer {os.environ['OPENROUTER_API_KEY']}",
            "content-type": "application/json",
            "http-referer": "https://classifier.dev",
            "x-title": "classifier.dev fallback benchmark",
        },
    )
    started = time.time()
    try:
        with urllib.request.urlopen(req, timeout=45) as response:
            return json.load(response), (time.time() - started) * 1000
    except urllib.error.HTTPError as error:
        try:
            payload = json.loads(error.read() or b"{}")
        except json.JSONDecodeError:
            payload = {}
        payload.setdefault("http_status", error.code)
        return payload, (time.time() - started) * 1000
    except (TimeoutError, urllib.error.URLError):
        return {"http_status": 0}, (time.time() - started) * 1000


def classify(model, labels, text, effort):
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": prompt(labels)},
            {"role": "user", "content": f"{text}\nANSWER:"},
        ],
        "max_tokens": 2000,
        "temperature": 0,
        "reasoning": {"effort": effort},
        "usage": {"include": True},
    }
    last_ms = 0.0
    for attempt in range(3):
        payload, last_ms = post(body)
        choices = payload.get("choices") or []
        content = ((choices[0].get("message") or {}).get("content") if choices else None)
        if isinstance(content, str):
            match = re.match(r"^\s*([A-Z])\s*[.!?)]?\s*$", content, re.I)
            letter = match.group(1).upper() if match else None
            valid = LETTERS[:len(labels)]
            parsed = letter is not None and letter in valid
            return {
                "label": labels[valid.index(letter)] if parsed else None,
                "ms": last_ms,
                "cost": float((payload.get("usage") or {}).get("cost") or 0),
                "valid": parsed,
            }
        if attempt < 2:
            time.sleep(0.3 * 2 ** attempt)
    return {"label": None, "ms": last_ms, "cost": 0.0, "valid": False}


def evaluate(model, dataset, threshold, concurrency, effort):
    baseline = json.load(open(RESULTS / f"{dataset}-jev.json"))
    labels, rows, jev = baseline["labels"], baseline["rows"], baseline["out"]
    selected = [i for i, answer in enumerate(jev) if answer["confidence"] < threshold]
    with ThreadPoolExecutor(concurrency) as pool:
        answers = list(pool.map(lambda i: classify(model, labels, rows[i]["text"], effort), selected))

    merged = list(jev)
    for i, answer in zip(selected, answers):
        if answer["valid"]:
            merged[i] = answer

    accuracy = lambda output: sum(a["label"] == row["gold"] for a, row in zip(output, rows)) / len(rows)
    unsure_accuracy = sum(a["label"] == rows[i]["gold"] for i, a in zip(selected, answers)) / len(selected)
    valid = sum(a["valid"] for a in answers)
    cost = sum(a["cost"] for a in answers)
    return {
        "dataset": dataset,
        "n": len(rows),
        "escalated": len(selected),
        "valid": valid,
        "unsure_accuracy": unsure_accuracy,
        "merged_accuracy": accuracy(merged),
        "jev_accuracy": accuracy(jev),
        "median_ms": statistics.median(a["ms"] for a in answers),
        "cost": cost,
        "cost_per_1k_escalations": cost / len(selected) * 1000,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--models", required=True)
    parser.add_argument("--threshold", type=float, default=0.7)
    parser.add_argument("--concurrency", type=int, default=8)
    parser.add_argument("--effort", default="low")
    args = parser.parse_args()
    if not os.environ.get("OPENROUTER_API_KEY"):
        raise SystemExit("set OPENROUTER_API_KEY")

    print(f"{'model':38} {'set':8} {'n':>4} {'valid':>7} {'unsure':>7} {'merged':>7} {'ms':>7} {'$/1k':>8}", flush=True)
    output = {}
    for model in (item.strip() for item in args.models.split(",") if item.strip()):
        output[model] = []
        for dataset in DATASETS:
            result = evaluate(model, dataset, args.threshold, args.concurrency, args.effort)
            output[model].append(result)
            print(
                f"{model:38} {dataset:8} {result['escalated']:4} "
                f"{result['valid']:3}/{result['escalated']:<3} {result['unsure_accuracy']:7.3f} "
                f"{result['merged_accuracy']:7.3f} {result['median_ms']:7.0f} "
                f"{result['cost_per_1k_escalations']:8.3f}",
                flush=True,
            )
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
