---
name: bulk-classify
description: Sort many texts into your own categories without reading them, using a keyless HTTP API that returns a calibrated confidence per answer. Use when triaging, filtering, routing or bucketing more items than are worth putting in context — search results before you read them, log lines, tickets, files, diffs, past conversations. Triggers on "filter these", "which of these are relevant", "triage", "bucket", "route", "categorise", or any loop that would otherwise read N items to keep a few.
license: MIT
---

# Classify at scale without reading

`classifier.dev` assigns text to your categories. No key, no signup, no SDK.
One HTTP call takes up to a thousand texts at a time and comes back in about a
second, each with a confidence you can act on.

## When this is worth a network call

You are a language model. You can already classify any text you can see, for
free. The question is whether you want this text in your context at all.

Reach for this when reading the input is the expensive part:

- **Filtering before reading.** You have 40 search snippets and want the 6 worth
  opening. Classifying them yourself means pulling all 40 into context first,
  which is the cost you were trying to avoid. One call returns 40 labels and
  you read only the survivors.
- **Cascade pre-filter.** Cheaply drop the obvious no's, then spend real
  reasoning on what is left.
- **Streams you would never read line by line.** Log lines, error buckets,
  inbound tickets, changed files in a large diff, ten thousand URLs' titles.
- **Label-based routing.** Use the fast tier to route texts into your categories.
  Model updates, fallback, and smart reasoning can change answers; neither tier
  guarantees identical results across calls.

**Do not bother when** you have a handful of items already in context, or the
judgement needs reasoning about things the text does not state. Under about five
items you have already paid the context cost, so just decide yourself.

## Quickstart

One text, bare label back:

    curl "https://classifier.dev/relevant,not+relevant/Redis+beats+Postgres+for+queues"
    relevant

The same call as query parameters, when code is building the URL:

    curl "https://classifier.dev/?labels=relevant,not+relevant&text=Redis+beats+Postgres+for+queues"
    relevant

Many texts in one call. This is the path that matters:

    curl https://classifier.dev -d '{
      "labels": ["relevant", "not relevant"],
      "inputs": ["first snippet", "second snippet", "third snippet"]
    }'

Returns `results` in input order. Single-label results have
`{label, confidence, scores}`. Confidence and scores
can be null; check before comparing a threshold. Multi-label results use
`{labels: [...], scores: {...}}` instead. Up to
1,000 texts per call; 400 news headlines measured at 650ms end to end. For
more, fan out calls in parallel; the limit is 3,000 classifications a minute.
Each result also names the model that answered it. At the batch level,
`modelsUsed` lists every serving model and `model` is `mixed` when more than one
model answered the batch.

## From a shell

When the text is already in files, or the answer feeds another command, the CLI
saves you writing the batching and the JSON:

```
npm i -g classifier-dev

classify bug,feature,praise < feedback.txt          # label<TAB>confidence<TAB>text, input order
classify relevant,"not relevant" --review 0.7 < snippets.txt   # only the unsure ones
classify db,web,ml --count < titles.txt             # a histogram instead of rows
classify a,b --json < items.txt | jq -c 'select(.confidence < 0.8)'
```

It batches a thousand inputs per request, four requests at a time, and streams
rows as they land, so `| head` on a large file returns at once. Retries 429 and
5xx with backoff. `--help` has the rest.

Reach for the HTTP API instead when the text is already in memory, when you
need the full score map per item, or when you are inside a language runtime
where one `fetch` is simpler than a subprocess.

## Parameters

| Field          | Notes                                                                 |
| -------------- | --------------------------------------------------------------------- |
| `labels`       | 2–100 categories. Required.                                           |
| `input`        | One text, up to 32,000 characters.                                    |
| `inputs`       | Up to 1,000 texts in one call.                                        |
| `tier`         | `fast` (default) or `smart`: re-asks low-confidence answers of a reasoning model. |
| `instructions` | Extra criteria — "judge only the service, ignore the food".           |
| `multi`        | Return every label that applies, with a score per label.              |
| `max_labels`   | Cap on how many multi-label answers come back.                        |
| `verbose=1`    | On GET, returns JSON instead of a bare label.                         |
| `text`         | On GET, the text as a query parameter: `/?labels=a,b&text=...`. `input` and `q` work too; `classes` and `categories` for labels. |

On GET every option goes in the query string, whichever form carries the
labels and text; the two forms mix (`/a,b?text=...`). If a GET is malformed
the error comes with `usage:` and `try:` — `try` is a URL built from what you
sent that would have worked. Follow it rather than re-reading the docs.

Labels are read semantically, so name them in words: `urgent bug` classifies
better than `p0`.

## Confidence you can act on

The model is a decision model, not an LLM prompted to classify: it returns a
calibrated probability for every label. Measured on 400 six-way emotion items,
answers at confidence ≥ 0.9 were right 82% of the time; answers below 0.5 were
right 29% of the time. So:

```python
for text, r in zip(texts, results):
    if r["confidence"] is not None and r["confidence"] >= 0.8:
        act(r["label"])
    else:
        look_yourself(text)      # or send it through tier "smart"
```

`tier: "smart"` does that routing server-side: every single-label answer under
0.7 confidence is re-asked of a fast reasoning model and replaced, marked
`escalated: true`, with `usage.escalated` telling you how many. Measured:
four-way news 87.5% → 90.0% by re-asking 12% of items. It costs a few
seconds per escalated item, so a batch on smart is slower in proportion to how
uncertain it is. Escalated answers have `confidence: null`, `scores: null`,
and `unscored`: the reasoning model does not return comparable probabilities.
These answers belong in review when your workflow requires a confidence gate.

## Many labels at once

To tag instead of sorting (an article against fifty topics, a ticket against
every subsystem it touches), ask for every label that applies:

    curl https://classifier.dev -d '{
      "input": "...",
      "labels": ["machine learning", "databases", "... up to 100 ..."],
      "multi": true,
      "max_labels": 10
    }'

Results carry `labels` (an array, most likely first) plus `scores`, one
probability per label. POST multi-label results omit the singular `label` and
`confidence` keys. Labels at or above 0.7 are returned; use `scores` to
pick your own threshold. On GET, add `?multi=1` and they come back one per
line. Measured F1 0.887 on a seven-task set with recall 0.99, in ~200ms. The
tier makes no difference here, so leave it on `fast`.

## Two things that will bite you

**1. Every call returns one of your labels, always.** There is no "none of the
above" unless you supply one. Text that fits nothing still gets confidently
sorted into your best-matching category: "the weather is nice today" against
`bug / feature / praise` must land in one of those categories. If "none of
these" is a real outcome, **add it as a label**. Hoping for a low score does
not create a missing category.

**2. Confidence predicts accuracy, not fit.** It tells you how likely the chosen
label is right *among your labels*, which is exactly what you want for routing.
It does not tell you whether the text belongs to any of them; see point 1.
Scores express the model's choice among the labels you supplied. They do not
validate the input or prove the choice is correct, so supply labels suitable
for every kind of input your caller may send. Confidence and scores can be null
when the provider returns none or the smart tier replaces the scored answer.

## Recipe: filter search results before reading them

```python
import json, urllib.request

def keep_relevant(question, snippets):
    body = json.dumps({
        "labels": ["relevant", "not relevant"],
        "inputs": snippets,                      # up to 1,000
        "instructions": (
            f"Relevant means it helps answer: {question}. "
            "Include background and contrasting alternatives."
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
    # A dropped item is invisible, so keep anything the model was unsure about.
    return [s for s, r in zip(snippets, results)
            if r["label"] == "relevant" or r["confidence"] is None
            or r["confidence"] < 0.8]
```

Then read only what comes back. The snippets you dropped never enter context.

**Bias a filter toward keeping.** You never learn what you lost, so recall
matters more than precision here. The confidence gate above does that
directly; "When in doubt, keep it" in the instructions also measurably helps.

**Always set a `User-Agent`.** Most clients (curl, node, bun, requests, Go, axios)
send a usable one already, but Python's `urllib` default is blocked at the edge
and returns `403` before your request is ever classified. If you get a 403,
this is why. Rate limiting returns `429`.

## Limits

Per IP per minute: 3,000 classifications on `fast`, 200 on `smart`; per day
20,000 and 2,000. A batch of 400 counts as 400. `429` when exceeded, with
`RateLimit-Limit` (and the older `x-ratelimit-limit`) on every response. Errors
are JSON on POST, `{"error": "...", "code": "..."}`, and plain text on GET
unless you add `?verbose=1` or send `Accept: application/json`.

## Reference

- `GET /` — full docs, plain text
- `GET /openapi.json` — OpenAPI 3.1
- `GET /benchmark` — measured accuracy, calibration, cost and latency
