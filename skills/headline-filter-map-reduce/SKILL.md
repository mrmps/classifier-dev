---
name: headline-filter-map-reduce
description: Filter hundreds or thousands of headlines, search results or feed items against a written brief before opening any of them, using a two-stage cascade that spends a fast model on everything and a reasoning model only on the borderline band. Use when a monitoring run, feed sweep or search returns more items than are worth reading. Triggers on "which of these are relevant", "filter this feed", "go through these headlines", "anything here about X", "catch me up on".
license: MIT
---

# Filter a feed before you read it

Reading 500 headlines to keep 8 costs more context than the 8 are worth, and
fetching the articles costs more still. Classify the titles first: one call
labels every item against your brief and returns a calibrated confidence, so
you open only what survives.

`classifier.dev` is keyless and free. It never writes text — the summary at the
end of the run is still yours to write.

## When not to use it

Skip it under about 20 items, which you can judge for less than the round trip.
Skip it when relevance depends on the body rather than the title: classify a
snippet or first paragraph instead, or accept that a vague title is a coin flip.
It is not a search engine; it ranks what you already have.

## Step 1: one item per line

```python
import re, html, urllib.request
x = urllib.request.urlopen(urllib.request.Request(
    "https://lobste.rs/rss", headers={"user-agent": "feedfilter/1.0"})).read().decode()
titles = [html.unescape(" ".join(t.split()))
          for t in re.findall(r"<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</title>", x, re.S)][1:]
open("headlines.txt", "w").write("\n".join(titles) + "\n")
```

Dedupe before you classify — the same story lands in four feeds, and you pay
per item.

## Step 2: the brief goes in `instructions`

    npm i -g classifier-dev@0.1.3

```
BRIEF="Relevant means the item is about the cost, hardware or energy of running
AI models: chips, accelerators, inference cost, data centre power. Model
releases, funding rounds and policy are not relevant."

classify relevant,"not relevant" -i "$BRIEF" --json < headlines.txt > stage1.ndjson
```

Two labels, not twenty. The brief belongs in `instructions`, where it is read as
criteria; labels put there instead become categories you have to maintain. Say
what is *out* as well as what is in — the two "not relevant" sentences above are
what keep funding-round headlines off the list.

The CLI batches 1,000 per request, four requests at a time. `--count` prints a
histogram instead of rows; `--review 0.5` prints only the items the model was
unsure about, which is the list to skim yourself:

```
relevant       0.09  Apple M6 Pro Achieves the Highest Single-Core CPU Score in Geekbench 7
not relevant   0.49  Cache-to-Cache: Direct Semantic Communication Between LLMs (2025)
relevant       0.35  Saving another 100TB of RAM
```

## Step 3: cascade the middle band

Act on the ends, spend the reasoning model on the middle.

- **0.9 and above** — act. Drop the `not relevant`, queue the `relevant`.
- **0.5 to 0.9** — re-ask with `--smart`, which re-runs answers under 0.7 on a
  reasoning model and marks them `escalated`.
- **below 0.5** — do not drop these on a filter. Read them, or ask a person.

```
jq -r 'select(.confidence>=0.5 and .confidence<0.9) | .text' stage1.ndjson > band.txt
classify relevant,"not relevant" -i "$BRIEF" --smart --json < band.txt > stage2.ndjson
```

## A real run

514 titles pulled from 20 public feeds (Lobsters, Ars Technica, BBC, the
Guardian, MIT News, Slashdot and others), against the brief above:

```
stage 1  514 items, fast tier                          0.7 s
         501 not relevant, 13 relevant
         476 rejected at confidence >= 0.9             never read
          28 in the 0.5-0.9 band
          10 under 0.5
stage 2   28 items, smart tier                        10.4 s
          15 escalated, 2 answers flipped
```

Eight items came back relevant after the cascade; with the ten under 0.5 that
the gate keeps, you read 18 of 514. The two flips are worth seeing: "A low-carbon
computing platform from your retired phones" went from relevant 0.65 to not
relevant 0.66, and a nanoscale-computing paper went the other way. Both were
genuinely arguable, which is why they were in the band.

The cascade costs what it saves: 1.4 ms an item on stage 1, 370 ms an item on
stage 2. Running all 514 on `--smart` would have taken minutes for the same
eight items.

## Step 4: the reduce

The survivors are few enough to read, but a histogram tells you the shape before
you start. `--count` over the 18 kept items, against four sub-topics:

```
11  something else
 3  inference cost and pricing
 2  data centre power and energy
 2  AI chips and accelerators
```

Eleven in `something else` says the brief is broader than the sub-topics, not
that the filter failed. Keep a catch-all in every reduce: without one, those
eleven spread over the other three and the histogram lies.

## Two things that will bite you

**Bias the filter toward keeping.** You never see what you dropped. Drop only
high-confidence rejects; keep everything under 0.5 whichever way it was labelled.
The run above drops 476 of 514 and still keeps every uncertain item.

**`confidence` is not the label score.** One headline came back
`label: relevant` with `scores: {relevant: 0.52}` and `confidence: 0.04` — the
model preferred `relevant` by a hair and knew that hair was worthless. Gate on
`confidence`; reruns move it by a point or two, so leave margin.

Single item, straight from the shell:

    curl "https://classifier.dev/relevant,not+relevant/Nvidia+cuts+H200+price+as+inference+demand+shifts?verbose=1"
    {"label": "relevant", "confidence": 0.88, "scores": {...}}

## Done looks like

Every item has a label and a confidence; the high-confidence rejects were never
opened; the band went through a second pass; and you read a shortlist you can
name a reason for, item by item.
