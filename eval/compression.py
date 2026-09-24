#!/usr/bin/env python3
# /// script
# requires-python = ">=3.12"
# dependencies = ["datasets==5.0.1", "numpy==2.5.3", "scipy==1.18.1", "scikit-learn==1.9.1", "zstandard==0.25.0"]
# ///
"""Compression classification experiment. Run with: uv run eval/compression.py.

All tuning uses held-back training rows. Each family gets one final test run.
Raw predictions, validation sweeps, split hashes and environment are saved.
"""
import argparse
import gzip
import hashlib
import importlib.metadata
import json
import os
import platform
import random
import subprocess
import time
import zlib
from pathlib import Path

import numpy as np
import zstandard as zstd
from datasets import load_dataset
from scipy.special import softmax
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.pipeline import FeatureUnion
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, f1_score, log_loss, roc_auc_score
from sklearn.model_selection import train_test_split

DATASETS = {
    "agnews": ("fancyzhx/ag_news", None, "text", "test"),
    "banking77": ("legacy-datasets/banking77", None, "text", "test"),
    "sst2": ("stanfordnlp/sst2", None, "sentence", "validation"),
    "emotion": ("dair-ai/emotion", "split", "text", "test"),
}


def normalize(text):
    return " ".join(text.lower().split())


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def load_split(name, seed, n, train_cap, val_n):
    repo, config, field, test = DATASETS[name]
    ds = load_dataset(repo, config)
    labels = ds["train"].features["label"].names
    heldout = [(normalize(r[field]), int(r["label"])) for r in ds[test]]
    rng = random.Random(seed)
    rng.shuffle(heldout)
    evaluation = heldout[:n]
    seen = {x for x, _ in heldout}
    pool = []
    duplicates = 0
    for r in ds["train"]:
        x, y = normalize(r[field]), int(r["label"])
        if x in seen:
            duplicates += 1
            continue
        seen.add(x)
        pool.append((x, y))
    rng.shuffle(pool)
    pool = pool[:train_cap + val_n]
    train, val = train_test_split(pool, test_size=val_n, random_state=seed,
                                  stratify=[r[1] for r in pool])
    assert not ({r[0] for r in train} & {r[0] for r in val})
    assert not ({r[0] for r in train + val} & {r[0] for r in heldout})
    assert set(y for _, y in train) == set(range(len(labels)))
    meta = {"repo": repo, "hf_fingerprints": {k: v._fingerprint for k, v in ds.items()},
            "train_n": len(train), "validation_n": len(val), "test_n": len(evaluation),
            "removed_duplicates_or_eval_overlaps": duplicates,
            "hashes": {k: digest(v) for k, v in [("train", train), ("validation", val), ("test", evaluation)]},
            "labels": labels}
    return train, val, evaluation, meta


class Dictionaries:
    def __init__(self, rows, classes, codec, size, shards=1, seed=42, trained=True, level=3, reduction="min"):
        self.codec, self.models, self.bytes = codec, [], 0
        self.reduction = reduction
        rng = random.Random(seed)
        for label in range(classes):
            texts = [x.encode() for x, y in rows if y == label]
            rng.shuffle(texts)
            models = []
            for i in range(shards):
                samples = texts[i::shards]
                if not samples:
                    raise ValueError("empty class shard")
                if codec == "zstd":
                    if trained:
                        # Do not silently change the algorithm if training fails.
                        dictionary = zstd.train_dictionary(size, samples, threads=0)
                    else:
                        dictionary = zstd.ZstdCompressionDict(b"\n".join(samples)[-size:], dict_type=zstd.DICT_TYPE_RAWCONTENT)
                    self.bytes += len(dictionary.as_bytes())
                    models.append(zstd.ZstdCompressor(level=level, dict_data=dictionary))
                else:
                    dictionary = b"\n".join(samples)[-size:]
                    self.bytes += len(dictionary)
                    models.append(zlib.compressobj(level=6, wbits=-15, zdict=dictionary))
            self.models.append(models)

    def score(self, text):
        x = text.encode()
        scores = []
        for models in self.models:
            lengths = []
            for model in models:
                if self.codec == "zstd":
                    lengths.append(len(model.compress(x)))
                else:
                    c = model.copy()
                    lengths.append(len(c.compress(x) + c.flush()))
            scores.append(-float(np.mean(lengths)) if self.reduction == "mean" else -min(lengths))
        return np.asarray(scores, dtype=float)


class GzipKNN:
    def __init__(self, rows, classes, k=5, cap=1000, seed=42):
        rng = random.Random(seed)
        rows = list(rows)
        rng.shuffle(rows)
        # Balanced memory avoids a majority-class prior from subsampling.
        self.samples = []
        for label in range(classes):
            self.samples += [(x.encode(), y) for x, y in rows if y == label][:max(1, cap // classes)]
        self.lengths = [len(gzip.compress(x, mtime=0)) for x, _ in self.samples]
        self.tie_keys = [hashlib.sha256(x).hexdigest() for x, _ in self.samples]
        self.classes, self.k = classes, k
        self.bytes = sum(len(x) for x, _ in self.samples)

    def score(self, text):
        x = text.encode()
        cx = len(gzip.compress(x, mtime=0))
        distances = [(len(gzip.compress(z + b" " + x, mtime=0)) - min(cx, cz)) / max(cx, cz)
                     for (z, _), cz in zip(self.samples, self.lengths)]
        nearest = np.lexsort((self.tie_keys, distances))[:self.k]
        votes = np.full(self.classes, 0.01)
        for i in nearest:
            votes[self.samples[i][1]] += 1
        return np.log(votes)


class Lexical:
    def __init__(self, rows, classes):
        self.vectorizer = FeatureUnion([
            ("word", TfidfVectorizer(ngram_range=(1, 2), sublinear_tf=True, min_df=2)),
            ("char", TfidfVectorizer(analyzer="char", ngram_range=(3, 5), sublinear_tf=True, min_df=2, max_features=100000)),
        ])
        x = self.vectorizer.fit_transform([x for x, _ in rows])
        self.classifier = LogisticRegression(C=4, max_iter=500).fit(x, [y for _, y in rows])
        self.bytes = None

    def score(self, text):
        return self.classifier.predict_log_proba(self.vectorizer.transform([text]))[0]


def scores_for(model, rows, temp=1):
    scores, times = [], []
    for text, _ in rows:
        start = time.perf_counter_ns()
        score = model.score(normalize(text))
        softmax(score / temp)
        predictions([score], [text])
        scores.append(score)
        times.append((time.perf_counter_ns() - start) / 1e6)
    return np.asarray(scores), times


def predictions(scores, texts):
    # Exact ties use a reproducible text hash instead of always selecting class 0.
    out = []
    for score, text in zip(scores, texts):
        ties = np.flatnonzero(score == score.max())
        index = int(hashlib.sha256(text.encode()).hexdigest(), 16) % len(ties)
        out.append(int(ties[index]))
    return np.asarray(out)


def temperature(scores, gold):
    choices = np.geomspace(.05, 100, 100)
    losses = [log_loss(gold, softmax(scores / t, axis=1), labels=np.arange(scores.shape[1])) for t in choices]
    return float(choices[np.argmin(losses)])


def metrics(scores, rows, times, temp):
    gold = np.asarray([y for _, y in rows])
    pred = predictions(scores, [x for x, _ in rows])
    prob = softmax(scores / temp, axis=1)
    conf = prob.max(axis=1)
    correct = pred == gold
    ece = 0.
    for i in range(10):
        mask = (conf >= i / 10) & ((conf < (i + 1) / 10) if i < 9 else (conf <= 1))
        if mask.any():
            ece += mask.mean() * abs(correct[mask].mean() - conf[mask].mean())
    result = {"accuracy": float(correct.mean()), "macro_f1": float(f1_score(gold, pred, labels=np.arange(scores.shape[1]), average="macro", zero_division=0)),
              "ece": float(ece), "nll": float(log_loss(gold, prob, labels=np.arange(scores.shape[1]))),
              "brier": float(np.mean(np.sum((prob - np.eye(scores.shape[1])[gold]) ** 2, axis=1))),
              "tie_rate": float(np.mean((scores == scores.max(axis=1, keepdims=True)).sum(axis=1) > 1)),
              "p50_ms": float(np.median(times)), "p95_ms": float(np.percentile(times, 95)),
              "serial_items_per_s": float(1000 / np.mean(times)), "n": len(rows)}
    if scores.shape[1] == 2:
        result["auroc"] = float(roc_auc_score(gold, prob[:, 1]))
    n, p, z = len(rows), float(correct.mean()), 1.96
    center = (p + z * z / (2 * n)) / (1 + z * z / n)
    radius = z * np.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
    result["accuracy_wilson_95"] = [float(center - radius), float(center + radius)]
    mask = conf >= .9
    result["confidence_at_least_90pct"] = {
        "n": int(mask.sum()), "coverage": float(mask.mean()),
        "accuracy": float(correct[mask].mean()) if mask.any() else None,
    }
    return result, [{"text_sha256": hashlib.sha256(x.encode()).hexdigest(), "gold": int(y),
                      "prediction": int(p), "probabilities": ps.tolist(), "ms": ms}
                     for (x, y), p, ps, ms in zip(rows, pred, prob, times)]


def run_dataset(name, args, outdir):
    train, val, test, meta = load_split(name, args.seed, args.n, args.train_cap, args.validation_n)
    classes = len(meta["labels"])
    configs = [("deflate", {"codec": "deflate", "size": s}) for s in [4096, 32768]]
    configs += [("zstd", {"codec": "zstd", "size": s, "trained": trained})
                for s in [1024, 4096, 16384] for trained in [True, False]]
    configs += [("zstd", {"codec": "zstd", "size": s, "level": 9})
                for s in [65536, 262144]]
    configs += [("zstd", {"codec": "zstd", "size": 16777216, "level": 9, "trained": False})]
    configs += [("zstd-mixture", {"codec": "zstd", "size": s, "shards": shards})
                for s in [1024, 4096] for shards in [4, 8]]
    configs += [("zstd-mixture", {"codec": "zstd", "size": 16777216, "shards": shards,
                                  "trained": False, "level": 9, "reduction": reduction})
                for shards in [3, 5] for reduction in ["min", "mean"]]
    configs += [("gzip-knn", {"k": k}) for k in [1, 5]]
    configs += [("tfidf-logistic", {})]
    if args.families:
        configs = [(family, config) for family, config in configs if family in args.families]
    best, sweep = {}, []
    for family, config in configs:
        start = time.perf_counter()
        try:
            if family == "gzip-knn":
                model = GzipKNN(train, classes, seed=args.seed, **config)
            elif family == "tfidf-logistic":
                model = Lexical(train, classes)
            else:
                model = Dictionaries(train, classes, seed=args.seed, **config)
        except zstd.ZstdError as exc:
            sweep.append({"family": family, "config": config, "training_error": str(exc)})
            continue
        fit_s = time.perf_counter() - start
        scores, times = scores_for(model, val)
        pred = predictions(scores, [x for x, _ in val])
        acc = float(accuracy_score([y for _, y in val], pred))
        entry = {"family": family, "config": config, "validation_accuracy": acc,
                 "fit_s": fit_s, "dictionary_or_sample_bytes": model.bytes}
        sweep.append(entry)
        print(name, family, config, f"validation={acc:.3f}", flush=True)
        if family not in best or acc > best[family][0]["validation_accuracy"]:
            best[family] = entry, model, scores
    report = {"dataset": meta, "validation_sweep": sweep, "selected": {}}
    for family, (entry, model, scores) in best.items():
        temp = temperature(scores, [y for _, y in val])
        test_scores, times = scores_for(model, test, temp)
        summary, rows = metrics(test_scores, test, times, temp)
        # OOD-like inputs must yield a finite score for every allowed class.
        for text in ["", "🙂 café 你好", "x" * 50000]:
            edge = model.score(text)
            assert edge.shape == (classes,) and np.isfinite(edge).all()
        report["selected"][family] = {**entry, "temperature": temp, **summary}
        (outdir / f"{name}-{family}-predictions.json").write_text(json.dumps(rows))
        print(name, family, "TEST", json.dumps(summary), flush=True)
    (outdir / f"{name}.json").write_text(json.dumps(report, indent=2))
    return report


def predict_jevbench(state, question, labels):
    if not isinstance(state, str):
        state = json.dumps(state, ensure_ascii=False, sort_keys=True)
    x = normalize(state + "\n" + question["instructions"]).encode()
    cx = len(gzip.compress(x, mtime=0))
    criteria = question.get("criteria") or {}
    if isinstance(criteria, list):
        criteria = {str(i): description for i, description in enumerate(criteria)}
    scores = []
    for label in labels:
        key = {"yes": "true", "no": "false"}.get(label, label) if question["type"] == "noul" else label
        description = criteria.get(key)
        if description is None:
            description = ""
        z = normalize(label.replace("_", " ") + ": " + str(description)).encode()
        cz = len(gzip.compress(z, mtime=0))
        # Symmetric NCD: both concat directions, normalized for label length.
        joint = min(len(gzip.compress(x + b" " + z, mtime=0)), len(gzip.compress(z + b" " + x, mtime=0)))
        scores.append(-(joint - min(cx, cz)) / max(cx, cz))
    scores = np.asarray(scores)
    ties = np.flatnonzero(scores == scores.max())
    # Choose by label name hash so option permutation does not change ties.
    index = min(ties, key=lambda i: hashlib.sha256(x + labels[i].encode()).hexdigest())
    return labels[index], len(ties) > 1


def jevbench(root, outdir):
    results = {}
    for tier in ["easy", "original", "hard"]:
        path = root / "datasets" / "public" / f"{tier}.jsonl"
        rows = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
        predictions_out = []
        if any(r["expected"] is None or r.get("provenance", {}).get("exclude_reason") for r in rows):
            raise ValueError("This diagnostic requires fully scored public cohorts")
        for row in rows:
            start = time.perf_counter_ns()
            prediction, tie = predict_jevbench(row["state"], row["question"], row["labels"])
            predictions_out.append({"id": row["id"], "group": row.get("group"), "family": row["family"],
                                    "gold": str(row["expected"]), "prediction": prediction,
                                    "tie": tie, "chance": 1 / len(row["labels"]),
                                    "ms": (time.perf_counter_ns() - start) / 1e6})
        family_scores = {}
        for family in sorted({r["family"] for r in predictions_out}):
            group = [r for r in predictions_out if r["family"] == family]
            family_scores[family] = {"n": len(group), "accuracy": np.mean([r["gold"] == r["prediction"] for r in group])}
        results[tier] = {"n": len(rows), "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                         "accuracy": float(np.mean([r["gold"] == r["prediction"] for r in predictions_out])),
                         "uniform_chance": float(np.mean([r["chance"] for r in predictions_out])),
                         "p50_ms": float(np.median([r["ms"] for r in predictions_out])), "families": family_scores}
        (outdir / f"jevbench-{tier}-predictions.json").write_text(json.dumps(predictions_out, indent=2))
    results["source_commit"] = subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip()
    results["method"] = "Zero-shot symmetric gzip NCD against label and rubric; no training or calibration. Public diagnostic, not an official score."
    (outdir / "jevbench.json").write_text(json.dumps(results, indent=2))
    print("JEVBENCH", json.dumps(results), flush=True)
    return results


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--datasets", nargs="+", choices=DATASETS, default=list(DATASETS))
    ap.add_argument("--families", nargs="+", choices=["deflate", "zstd", "zstd-mixture", "gzip-knn", "tfidf-logistic"])
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--n", type=int, default=500)
    ap.add_argument("--train-cap", type=int, default=10000)
    ap.add_argument("--validation-n", type=int, default=600)
    ap.add_argument("--out", type=Path, default=Path(__file__).parent / "data" / "compression")
    ap.add_argument("--jevbench", type=Path)
    args = ap.parse_args()
    if min(args.n, args.train_cap, args.validation_n) <= 0:
        ap.error("sample counts must be positive")
    args.out.mkdir(parents=True, exist_ok=False)
    metadata = {"args": {k: str(v) if isinstance(v, Path) else v for k, v in vars(args).items()},
                "platform": platform.platform(), "processor": platform.processor(),
                "python": platform.python_version(), "zlib": zlib.ZLIB_RUNTIME_VERSION,
                "thread_environment": {k: os.environ.get(k) for k in ["OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS"]},
                "timing": "Serial local warm inference: normalization, compression/features, probabilities, tie-breaking. Excludes training, network and data loading.",
                "versions": {k: importlib.metadata.version(k) for k in ["datasets", "numpy", "scipy", "scikit-learn", "zstandard"]},
                "script_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    (args.out / "manifest.json").write_text(json.dumps(metadata, indent=2))
    summary = {"manifest": metadata, "datasets": {}}
    for name in args.datasets:
        summary["datasets"][name] = run_dataset(name, args, args.out)
    if args.jevbench:
        summary["jevbench"] = jevbench(args.jevbench, args.out)
    (args.out / "summary.json").write_text(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
