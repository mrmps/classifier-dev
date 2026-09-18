#!/usr/bin/env python3
"""What the smart tier buys: Jev answers below a confidence threshold are
replaced by the reasoning model's answer. Reads the caches single.py writes.

    python3 escalate.py --dataset ag_news --smart openrouter-qwen_qwen3.7-flash
"""
import argparse
import json
from pathlib import Path

RESULTS = Path(__file__).parent / "data" / "results"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", default="ag_news")
    ap.add_argument("--fast", default="jev")
    ap.add_argument("--smart", default="openrouter-qwen_qwen3.7-flash")
    args = ap.parse_args()
    fast = json.load(open(RESULTS / f"{args.dataset}-{args.fast}.json"))
    smart = json.load(open(RESULTS / f"{args.dataset}-{args.smart}.json"))
    rows, f, s = fast["rows"], fast["out"], smart["out"]
    n = len(rows)
    acc = lambda outs: sum(o["label"] == r["gold"] for r, o in zip(rows, outs)) / n
    print(f"{args.dataset}: fast alone {acc(f):.3f}   smart alone {acc(s):.3f}")
    print("threshold  escalated   acc    (fast answer kept when confidence >= threshold)")
    for th in [0.5, 0.6, 0.7, 0.8, 0.9, 1.01]:
        merged = [so if fo["confidence"] < th else fo for fo, so in zip(f, s)]
        k = sum(fo["confidence"] < th for fo in f)
        print(f"   {th:4.2f}     {k:4} ({k / n:4.0%})   {acc(merged):.3f}")


if __name__ == "__main__":
    main()
