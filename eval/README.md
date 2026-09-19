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
