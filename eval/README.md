# Eval

Four harnesses. `vs_jev.py` (`npm run vs-jev`) measures the deployed service
against Jev called directly, on the public single-label sets — the one number
the home page leads with, see "Against Jev" below. `single.py` runs public single-label test sets (AG News,
dair-ai/emotion) through Jev or any OpenRouter model, prints accuracy, latency,
cost and a calibration table, and caches raw results; `escalate.py` reads two
caches and reports what replacing low-confidence answers with a second model
buys. Both are documented in their docstrings. The rest of this file is about
the multi-label set.

## Against Jev

    npm run vs-jev                          # ag_news + emotion, 400 each, fast + smart
    npm run vs-jev -- --dataset emotion --tier smart --fresh

Both tiers of the deployed worker, measured live over the public API with no
key, against `single.py`'s cached Jev run (or a fresh one when
`TYPESAFE_API_KEY` is set). Reports accuracy overall and on the items Jev put
under 0.7 confidence — the only items the smart tier touches — plus agreement
with Jev, how many were re-asked, latency and cost. Writes the summary to
`src/vs-jev.json` (tracked; `src/vsjev.ts` imports it), so the table on the
site is the measurement, not a transcription of it. The raw per-item runs stay
under `data/results/`, ignored like the rest of `data/`.

## Multi-label

Two harnesses over the same seven cases.

`npm run eval` measures the **deployed worker**, end to end:

    npm run eval                    # fast tier, 2 runs per case
    npm run eval -- --tier both     # fast and smart
    npm run eval -- --cases         # per-case F1
    npm run eval -- --max-labels 10

`npm run bench` measures **one model at a time**, running the same pipeline
offline against OpenRouter, so a candidate can be scored before it ships:

    export OPENROUTER_API_KEY=sk-or-...
    npm run bench                                    # today's primary vs the challenger
    npm run bench -- --models a,b,c --runs 3 --cases

It transcribes `classifyOne()` — same prompt, same 12-label chunking, same
second pass over the survivors — so if that changes, change `bench.py` too.
It reports cost per 1,000 classifications from OpenRouter's own accounting.

## Why bench.py exists

`run.py` can only see whatever model the tier resolves to, and a tier is a
fallback chain. `inclusionai/ling-2.6-flash` was delisted upstream; every fast
request 404'd against it and was answered by the next model in the chain, which
scored **0.546** against the 0.800 the docs advertised. Nothing in the deployed
numbers said so. Measured 2026-09-17, 7 cases x 3 runs:

    model                            P     R     F1      ms    $/1k
    inclusionai/ling-3.0-flash    0.90  0.74  0.799    1538   0.008
    inception/mercury-2.5         0.92  0.72  0.797     945   0.038
    mistralai/mistral-nemo        0.90  0.63  0.729    2098   0.016
    ibm-granite/granite-4.2-8b    0.76  0.69  0.704    1008   0.036
    ibm-granite/granite-4.0-h-micro 0.71 0.46 0.546    1575   0.017   <- was serving

Only `granite-4.0-h-micro` and `deepseek-v4-flash` return logprobs, so the fast
tier now names two chains: those two lead the single-label chain, which is the
only one that can carry a confidence score, and `ling-3.0-flash` leads the
multi-label chain, where there is no score to lose and it is both the most
accurate and the cheapest thing measured.

Then TypeSafe's Jev was measured (2026-09-17) and replaced the LLM chains for
both modes: F1 0.887 multi-label in 232ms, and on single-label public sets
87.7% on AG News / 60.5% on emotion against 82.0% / 57.0% for ling-3.0-flash.
The LLM chains stay as the fallback. `npm run single` is the single-label
evidence that was missing above.

Macro precision, recall and F1 over `cases.py`, plus median latency. Every task
is weighted equally regardless of label count, so the 50-tag case cannot
dominate. F1 is computed per observation and then averaged, so it is not exactly
the harmonic mean of the reported P and R.

## Read this before quoting a number

These are the numbers in the project README. They are honest measurements of a
weak experiment, and the weaknesses are worth more than the third decimal place.

**Tuned on the set it reports.** The chunk size and the second-pass design were
both chosen using these seven cases, then scored on the same seven. That is
train-on-test, and it biases the results optimistically. There is no held-out
split.

**One person wrote the inputs and the gold labels.** No independent annotator
and no inter-annotator agreement. Tagging is genuinely arguable — whether
`backend` belongs on the article is a judgement call — and on the 50-tag case,
disagreeing about two labels moves F1 by roughly 0.08, which is most of the gap
between configurations. Some of that case's weak score is likely contestable
gold rather than model error.

**n=7, no confidence intervals, no significance testing.** The label sets are
invented rather than taxonomies anyone uses in production.

**Run-to-run variance is large.** The same configuration on byte-identical input
measured 0.73 and 0.60 before this set existed; the fast tier silently falls
back between models on roughly one call in twelve. Two runs per case averages
over that without eliminating it, and the smart tier is measured at one run
because it is rate-limited to 10/min.

## So what does it support

Gaps far larger than the noise floor: a single call over all labels (0.686)
losing to the sweep-plus-second-pass cascade (0.777), and that losing to running
the second pass on the smart tier (0.868). Likewise the two rejected designs,
per-label binary at 0.612 and strict pruning at 0.556.

It does not support fine distinctions. Anything within about 0.03 is a coin
flip — the shipped configuration was picked over its nearest rival on error
profile, not on a 0.004 difference in F1.

## Making it stronger

In rough order of value: add cases from a real taxonomy with labels assigned
before any model output is seen; split into tune and report halves; raise n past
about thirty so confidence intervals mean something.

## Compression classifiers

`compression.py` tests whether gzip/DEFLATE or Zstd can replace a learned text
classifier. It compares gzip NCD nearest neighbors, per-class DEFLATE and Zstd
dictionaries, Zstd dictionary mixtures, and a word/character TF-IDF logistic
regression control. It does not change the Worker or call a paid model API.

```sh
git clone https://github.com/fstandhartinger/jevbench.git /tmp/compression-jevbench
git -C /tmp/compression-jevbench checkout 2fa63fa3226cb369795525ed011800f57dcbd894
OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 uv run --python 3.12 eval/compression.py \
  --out eval/data/compression-reproduction --jevbench /tmp/compression-jevbench
```

Run from the repository root. The output directory must be new. `uv` installs
the script's pinned dependencies; Hugging Face downloads are cached. Omit
`--jevbench` to run only the supervised datasets. `--datasets`, `--families`,
`--seed`, `--train-cap`, `--validation-n`, and `--n` bound additional experiments.

The default uses seed 0 and 500 evaluation rows, matching the sampling protocol
of [dhruvmehra/jevbench](https://github.com/dhruvmehra/jevbench). Each dataset has
up to 10,000 training rows and 600 separate validation rows. Training is shuffled
and deduplicated after excluding exact normalized matches anywhere in the
held-out split. Classifier settings and probability temperature are chosen only
on validation rows, then frozen for evaluation. This excludes exact duplicates,
not semantic paraphrases or SST-2's related review fragments. Test rows remain
in their original benchmark sample, including any duplicates within that split.

Gzip nearest neighbors deliberately retain at most 1,000 balanced examples; its
accuracy is a bounded-compute baseline, not an estimate of full-data gzip kNN.
DEFLATE uses raw zlib preset dictionaries (the same compression algorithm as
gzip, without gzip framing). Zstd tries trained dictionaries and raw class
text, with minimum or mean length over random shards. Compression length is
only a score: softmax temperature is fitted on validation labels. Dictionaries
store information from labeled examples; this is supervised learning, not a
zero-shot or memory-free model. Oversized dictionary training failures are
recorded in the validation sweep, never silently replaced by another method.

Every run produces `summary.json`, per-dataset validation sweeps and selected
settings, per-item predictions/probabilities, split hashes, dataset fingerprints,
and software versions. Timing covers serial local normalization, scoring,
probabilities and tie-breaking; it excludes training, loading, serving and
network overhead. Empty, Unicode and long inputs are exercised for every
selected supervised model. The output manifest identifies the script by hash.

The optional Benchmark Heaven diagnostic uses symmetric gzip NCD between the
state/instructions and each label/criterion. The prediction function accepts
only those inference fields; expected answers and author rationales cannot
enter it. This has no labeled support set and returns labels without invented
calibrated probabilities. Its three public cohorts total 231 decisions. These
are public diagnostic accuracies, not an official JevBench score: private,
sealed, and imported tasks are absent. A supervised banking/news classifier
cannot be submitted as if it solves arbitrary typed decisions.

The compression idea comes from [Nathan Barry's gzip language-model experiment](https://nathan.rs/posts/gzip-lm/)
and [FTCC's class-dictionary approach](https://github.com/cyrilou242/ftcc).
The TF-IDF control matters: [Gzip versus bag-of-words for text classification](https://arxiv.org/abs/2307.15002)
examines whether compression's gains survive comparison with conventional text
features.

### Measured results (Apple M5 Max)

Generated from [compression-results.json](compression-results.json). All rows
use 500 held-out items per dataset; percentages are accuracy. Each family selects
its settings on validation data. These are exploratory measurements on one seed,
not evidence that small differences are statistically significant.

| Up to 10k training rows | Gzip kNN (≤1k memory) | DEFLATE | Zstd mixture | TF-IDF + logistic |
|---|---:|---:|---:|---:|
| agnews | 61.8% | 76.6% | 84.8% | 88.8% |
| banking77 | 54.8% | 82.0% | 80.6% | 90.8% |
| sst2 | 54.8% | 65.6% | 71.8% | 79.6% |
| emotion | 29.8% | 40.6% | 56.2% | 85.2% |

Larger-training follow-up (same evaluation items, separately held-back validation):

| Dataset | Training rows | Zstd mixture | p50 | TF-IDF + logistic | p50 |
|---|---:|---:|---:|---:|---:|
| agnews | 119,239 | 90.0% | 0.246 ms | 91.2% | 0.593 ms |
| sst2 | 66,378 | 70.0% | 0.034 ms | 85.0% | 0.432 ms |

The larger news mixture retains 28.25 MB of class text across 20 dictionaries;
this is not a tiny parameter-free model. It is competitive here, but the lexical
control is more accurate on every measured dataset. More data does not resolve
the sentiment weakness.

Reproduce the larger run by adding `--datasets agnews sst2 --families zstd
zstd-mixture tfidf-logistic --train-cap 120000` and choosing a new output directory.

On Benchmark Heaven’s public cohorts, zero-shot gzip scores **45.8% easy**,
**36.1% original**, and **42.3% hard**. All 231 labels were checked against the
upstream scorer and were invariant to reversing the option order. No official
score or leaderboard submission is claimed. The audit fixed ordinal gold labels
being compared as integers against strings, and removed class-order bias when
gzip neighbor distances tie.

The checked-in JSON combines the two generated `summary.json` files and the
audit record. Raw item predictions stay under `eval/data/`. Across the default
and larger runs, 13,000 probability vectors and accuracies were independently
checked; the default run’s 8,000 dictionary/lexical predictions reproduced exactly.
