#!/usr/bin/env python3
# /// script
# requires-python = ">=3.12"
# dependencies = ["numpy==2.5.3", "scipy==1.18.1", "scikit-learn==1.9.1", "zstandard==0.25.0"]
# ///
"""TF-IDF + compression on JevBench's public typed decisions.

uv run --python 3.12 eval/jevbench_hybrid.py --jevbench /path/to/jevbench

Zero-shot only: no labeled examples, learned weights, retrieval corpus, or
calibration. Each TF-IDF vocabulary/IDF uses only the current request. Fixed
scoring rules are evaluated side by side; no winner is trained on the answers.
"""
import argparse
import gzip
import hashlib
import importlib.metadata
import json
import platform
import time
import zlib
from pathlib import Path

import numpy as np
import zstandard as zstd
from sklearn.feature_extraction.text import TfidfVectorizer

FEATURES = ["word_cosine", "word_window_cosine", "char_cosine", "gzip_ncd",
            "deflate_gain", "zstd_gain", "label_word_cosine"]


def normalized(text):
    return " ".join(text.lower().split())


def centered(values):
    v = np.asarray(values, dtype=float)
    std = v.std(axis=0)
    return np.where(std < 1e-10, 0, (v - v.mean(axis=0)) / np.maximum(std, 1e-10))


def inference_text(task):
    state = task["state"]
    if not isinstance(state, str):
        state = json.dumps(state, ensure_ascii=False, sort_keys=True)
    return normalized(state + "\n" + task["question"]["instructions"])


def option_texts(task):
    q = task["question"]
    criteria = q.get("criteria") or {}
    if isinstance(criteria, list):
        criteria = {str(i): value for i, value in enumerate(criteria)}
    options = []
    for label in task["labels"]:
        key = {"yes": "true", "no": "false"}.get(label, label) if q["type"] == "noul" else label
        options.append(normalized(label.replace("_", " ") + ": " + str(criteria.get(key) or "")))
    return options


def features(task):
    text, options = inference_text(task), option_texts(task)
    words = text.split()
    chunks = [" ".join(words[i:i + 160]) for i in range(0, len(words), 80)] or [""]
    docs = [text] + options + chunks + [x.replace("_", " ") for x in task["labels"]]
    vectors = TfidfVectorizer(ngram_range=(1, 2), token_pattern=r"(?u)\b\w+\b").fit_transform(docs)
    n = len(options)
    word = (vectors[1:n+1] @ vectors[0].T).toarray().ravel()
    window = (vectors[1:n+1] @ vectors[n+1:n+1+len(chunks)].T).toarray().max(axis=1)
    label = (vectors[-n:] @ vectors[0].T).toarray().ravel()
    chars = TfidfVectorizer(analyzer="char", ngram_range=(3, 5), max_features=30000).fit_transform([text] + options)
    char = (chars[1:] @ chars[0].T).toarray().ravel()
    x = text.encode()
    cx = len(gzip.compress(x, mtime=0))
    raw = zlib.compressobj(level=6, wbits=-15, zdict=x[-32768:])
    zd = zstd.ZstdCompressor(level=3, dict_data=zstd.ZstdCompressionDict(x, dict_type=zstd.DICT_TYPE_RAWCONTENT))
    zplain = zstd.ZstdCompressor(level=3)
    values = []
    for option in options:
        y = option.encode()
        cy = len(gzip.compress(y, mtime=0))
        joint = min(len(gzip.compress(x + b" " + y, mtime=0)), len(gzip.compress(y + b" " + x, mtime=0)))
        c = raw.copy()
        conditioned = len(c.compress(y) + c.flush())
        plain = zlib.compressobj(level=6, wbits=-15)
        unconditioned = len(plain.compress(y) + plain.flush())
        values.append([-(joint - min(cx, cy)) / max(cx, cy),
                       (unconditioned - conditioned) / max(len(y), 1),
                       (len(zplain.compress(y)) - len(zd.compress(y))) / max(len(y), 1)])
    a = np.asarray(values)
    return np.column_stack([word, window, char, a, label])


def pick(scores, task):
    scores = np.asarray(scores)
    ties = np.flatnonzero(scores == scores.max())
    # JevBench's distribution scorer resolves ties by label name.
    return int(min(ties, key=lambda i: task["labels"][i]))


def methods(f):
    word, window, char, gz, df, zs, label = f.T
    tfidf = centered((centered(window) + centered(char)) / 2)
    out = {
        "tfidf-word": centered(word), "tfidf-window": centered(window),
        "tfidf-char": centered(char), "tfidf-label": centered(label),
        "tfidf": tfidf, "gzip": centered(gz),
        "deflate": centered(df), "zstd": centered(zs),
    }
    for lexical in ["tfidf-word", "tfidf-window", "tfidf-char", "tfidf-label", "tfidf"]:
        for compressor in ["gzip", "deflate", "zstd"]:
            for weight in [.25, .5, .75]:
                out[f"{lexical}+{compressor}:{weight:g}"] = weight * out[lexical] + (1-weight) * out[compressor]
    out["all-four"] = (tfidf + out["gzip"] + out["deflate"] + out["zstd"]) / 4
    return {name: np.round(scores, 10) for name, scores in out.items()}


def summarize(rows):
    def score(group):
        return {"n": len(group), "correct": sum(r["correct"] for r in group),
                "accuracy": sum(r["correct"] for r in group) / len(group)}
    return {**score(rows),
            "by_tier": {t: score([r for r in rows if r["tier"] == t]) for t in sorted({r["tier"] for r in rows})},
            "by_family": {f: score([r for r in rows if r["family"] == f]) for f in sorted({r["family"] for r in rows})}}


def paired_interval(a, b, seed=0):
    groups = sorted({r["group"] for r in a})
    delta = {g: [int(x["correct"]) - int(y["correct"]) for x, y in zip(a, b) if x["group"] == g] for g in groups}
    rng = np.random.default_rng(seed)
    samples = []
    for _ in range(5000):
        chosen = rng.choice(groups, len(groups), replace=True)
        differences = [v for g in chosen for v in delta[g]]
        samples.append(np.mean(differences))
    return {"accuracy_difference": float(np.mean([int(x["correct"]) - int(y["correct"]) for x, y in zip(a, b)])),
            "scenario_bootstrap_95": np.percentile(samples, [2.5, 97.5]).tolist()}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--jevbench", required=True, type=Path)
    ap.add_argument("--out", type=Path, default=Path(__file__).parent / "data" / "jevbench-zero-shot")
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=False)
    tasks, source_hashes = [], {}
    for tier in ["easy", "original", "hard"]:
        path = args.jevbench / "datasets" / "public" / f"{tier}.jsonl"
        source_hashes[tier] = hashlib.sha256(path.read_bytes()).hexdigest()
        for line in path.read_text().splitlines():
            row = json.loads(line)
            assert row["expected"] is not None and not row.get("provenance", {}).get("exclude_reason")
            row["tier"] = tier
            tasks.append(row)
    outputs, elapsed = {}, []
    for task in tasks:
        view = {k: task[k] for k in ["state", "question", "labels"]}
        start = time.perf_counter_ns()
        f = features(view)
        scores = methods(f)
        predicted = {name: view["labels"][pick(values, view)] for name, values in scores.items()}
        elapsed.append((time.perf_counter_ns() - start) / 1e6)
        assert f.shape == (len(view["labels"]), len(FEATURES)) and np.isfinite(f).all()
        reversed_view = {**view, "labels": list(reversed(view["labels"]))}
        reversed_features = features(reversed_view)
        assert np.allclose(f, reversed_features[::-1], atol=1e-12)
        reversed_scores = methods(reversed_features)
        for name, prediction in predicted.items():
            assert prediction == reversed_view["labels"][pick(reversed_scores[name], reversed_view)], (task["id"], name)
            outputs.setdefault(name, []).append({"id": task["id"], "group": task.get("group") or task["id"],
                "tier": task["tier"], "family": task["family"], "gold": str(task["expected"]),
                "prediction": prediction, "correct": prediction == str(task["expected"]),
                "labels": view["labels"], "scores": scores[name].tolist()})
    published_path = args.jevbench / "results/v1.2/jevbench-v1.2-per-task.json"
    published = json.loads(published_path.read_text())["systems"]["jev-1.13.0"]["public_tasks"]
    reference = [{**r, "correct": published[r["id"]][0] == "c"} for r in outputs["tfidf"]]
    report = {"manifest": {"source_sha256": source_hashes,
              "script_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              "platform": platform.platform(), "python": platform.python_version(), "features": FEATURES,
              "versions": {p: importlib.metadata.version(p) for p in ["numpy", "scipy", "scikit-learn", "zstandard"]},
              "all_methods_p50_ms": float(np.median(elapsed)), "all_methods_p95_ms": float(np.percentile(elapsed, 95)),
              "option_reversal_predictions_checked": sum(len(v) for v in outputs.values()),
              "note": "Public zero-shot diagnostic only; no gold answers or labeled examples enter prediction. IDF is computed per request. All methods are fixed; multiple exploratory comparisons, no official sealed evaluation. Timing includes every method together, excluding verification and loading."},
              "uniform_chance": float(np.mean([1/len(t["labels"]) for t in tasks])),
              "methods": {name: summarize(rows) for name, rows in outputs.items()},
              "versus_tfidf": {name: paired_interval(rows, outputs["tfidf"]) for name, rows in outputs.items() if name != "tfidf"},
              "published_jev_reference": {"source_sha256": hashlib.sha256(published_path.read_bytes()).hexdigest(),
                                          "note": "Published Jev 1.13.0 outcomes on these exact public IDs; not rerun.", **summarize(reference)},
              "oracle_choose_tfidf_or_gzip": {"note": "Diagnostic only: uses gold answers to pick the correct method. Not a deployable model or a bound on other hybrids.",
                                             "accuracy": float(np.mean([a["correct"] or b["correct"] for a,b in zip(outputs["tfidf"],outputs["gzip"])]))}}
    for name, rows in outputs.items():
        (args.out / f"{name}-predictions.json").write_text(json.dumps(rows, indent=2))
        print(name, json.dumps(report["methods"][name]), flush=True)
    (args.out / "summary.json").write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    main()
