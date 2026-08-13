# Multi-label eval

    npm run eval                    # fast tier, 2 runs per case
    npm run eval -- --tier both     # fast and smart
    npm run eval -- --cases         # per-case F1
    npm run eval -- --max-labels 10

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
