---
name: bulk-classify
description: Sort many texts into your own categories without reading them, using a keyless HTTP API. Use when triaging, filtering, routing or bucketing more items than are worth putting in context — search results before you read them, log lines, tickets, files, diffs. Triggers on "filter these", "which of these are relevant", "triage", "bucket", "route", "categorise", or any loop that would otherwise read N items to keep a few.
license: MIT
---

# Classify at scale without reading

`classifier.dev` assigns text to one of your categories. No key, no signup, no
SDK — one HTTP call.

## When this is worth a network call

You are a language model. You can already classify any text you can see, for
free. So the question is never "can I classify this" — it is **do I want this
text in my context at all**.

Reach for this when reading the input is the expensive part:

- **Filtering before reading.** You have 40 search snippets and want the 6 worth
  opening. Classifying them yourself means pulling all 40 into context first,
  which is the cost you were trying to avoid. One batch call returns 40 labels
  and you read only the survivors.
- **Cascade pre-filter.** Cheaply drop the obvious no's, then spend real
  reasoning on what is left.
- **Streams you would never read line by line.** Log lines, error buckets,
  inbound tickets, changed files in a large diff.
- **Deterministic routing.** A pipeline branch that must take the same path for
  the same input on every run, rather than drifting with your reasoning.

**Do not bother when** you have a handful of items already in context, or the
judgement needs reasoning about things the text does not state. Under about five
items you have already paid the context cost — just decide yourself.

## Quickstart

One text, bare label back:

    curl "https://classifier.dev/relevant,not+relevant/Redis+beats+Postgres+for+queues"
    relevant

Many texts, one call — **this is the path that matters**:

    curl https://classifier.dev -d '{
      "labels": ["relevant", "not relevant"],
      "inputs": ["first snippet", "second snippet", "third snippet"]
    }'

Returns `results` in input order. Up to 20 texts per call, ~1.3s for 20.
Fan out several calls in parallel for more.

## Parameters

| Field          | Notes                                                          |
| -------------- | -------------------------------------------------------------- |
| `labels`       | 2–26 categories. Required.                                       |
| `input`        | One text. Up to ~8,000 tokens.                                   |
| `inputs`       | Up to 20 texts in one call.                                      |
| `tier`         | `fast` (default, ~450ms) or `smart` (~2.4s, better on nuance).   |
| `instructions` | Extra criteria — "judge only the service, ignore the food".      |
| `verbose=1`    | On GET, returns JSON instead of a bare label.                    |

Labels are read semantically, so name them in words: `urgent bug` classifies
better than `p0`.

## Many labels at once

To tag rather than sort — an article against fifty topics, a ticket against every
subsystem it touches — ask for every label that applies:

    curl https://classifier.dev -d '{
      "input": "...",
      "labels": ["machine learning", "databases", "... up to 100 ..."],
      "multi": true,
      "max_labels": 10
    }'

Results carry `labels` (an array) instead of `label`. On GET, add `?multi=1` and
they come back one per line. Passing more than 26 labels switches this on by
itself, so you do not have to remember the flag.

**Use `tier: "smart"` when you care about the answer.** It matters far more here
than for single labels — measured F1 0.87 against 0.78 on a seven-task set — at
roughly 12s instead of 1.5s. For tagging, that trade is usually right.

`max_labels` is worth setting when you want the *best* N rather than everything
plausible: on the fifty-tag article it took precision to 1.00.

Multi-label answers carry no confidence — a score describes a single token, and
a list of labels is not a single token.

## Two things that will bite you

**1. Every call returns one of your labels, always.** There is no "none of the
above" unless you supply one. Text that fits nothing still gets confidently
sorted into your best-matching category. If "none of these" is a real outcome,
**add it as a label** — `["bug", "feature request", "neither"]`. This works, and
it is the only reliable escape hatch.

**2. `confidence` is not a fit score.** It measures how sure the model is of the
token it emitted, not whether your text belongs to any label. A well-formed
sentence matching none of your categories can still score 1.0 — measured:
`"can I get a SOC2 report?"` returned `pricing question` at **0.998** with
`security concern` available. Do not gate on a confidence threshold; use an
explicit escape-hatch label instead. When the input is not natural language at
all, the score is withheld and an `unscored` field explains why.

## Recipe: filter search results before reading them

```python
import json, urllib.request

def keep_relevant(question, snippets):
    body = json.dumps({
        "labels": ["relevant", "not relevant"],
        "inputs": snippets[:20],
        "instructions": (
            f"Relevant means it helps answer: {question}. "
            "Include background and contrasting alternatives. "
            "When in doubt, keep it."
        ),
    }).encode()
    req = urllib.request.Request(
        "https://classifier.dev",
        data=body,
        headers={
            "content-type": "application/json",
            # Send a real User-Agent. Python's stdlib default is a known-bot
            # signature and gets a 403 at the edge before it reaches the API.
            "user-agent": "my-agent/1.0",
        },
    )
    results = json.load(urllib.request.urlopen(req))["results"]
    return [s for s, r in zip(snippets, results) if r["label"] == "relevant"]
```

Then read only what comes back. The snippets you dropped never enter context.

**Bias a filter toward keeping.** A dropped item is invisible — you never learn
what you lost — so recall matters more than precision here. Adding "When in
doubt, keep it" to the instructions is measurably worth it: on a ten-snippet
research filter it took signal kept from 4/6 to 6/6 while still dropping all
4 pieces of noise. Adding a third "possibly relevant" label did *not* help;
the plain instruction did.

**Always set a `User-Agent`.** Most clients (curl, node, bun, requests, Go, axios)
send a usable one already, but Python's `urllib` default is blocked at the edge
and returns `403` before your request is ever classified. If you get a 403, this
is why — it is not rate limiting, which returns `429`.

## Limits

Per IP per minute: 60 classifications on `fast`, 10 on `smart`. A batch of 20
counts as 20. `429` when exceeded, with `x-ratelimit-limit` on every response.
Errors are JSON on POST and plain text on GET.

## Reference

- `GET /` — full docs, plain text
- `GET /openapi.json` — OpenAPI 3.1
- `GET /benchmark` — measured accuracy, cost and latency
