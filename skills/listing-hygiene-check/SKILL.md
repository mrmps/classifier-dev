---
name: listing-hygiene-check
description: Sweep a marketplace or catalogue with a keyless classification API: one pass for category, one multi-label pass for prohibited, counterfeit and misstated-condition signals, one for review-abuse patterns, severity set by the calibrated confidence band, and a queue file only a person acts on. Use on "check these listings", "find counterfeits", "audit the catalogue", "are these reviews fake", or before a category goes live.
license: MIT
---

# Check listings and reviews for the usual abuse

`classifier.dev` tags text against labels you write and returns a score per
label. No key. Three passes over a catalogue export give a category, a set of
policy signals and a review-abuse read, each with a number. It removes nothing
and messages nobody. It fills a queue.

## When not to use this

- Enforcement. Nothing here suspends a seller, delists an item or answers a
  trademark claim. Those need a person, usually with counsel.
- Anything turning on the image, the invoice, the seller's history or a brand's
  authorised-seller list. This reads listing text only.
- Prohibited lists (knives, supplements, safety marks) differ by market. Write
  the labels per market, with whoever owns policy.

## Pass 1 — category, with an escape hatch

```
"labels": ["consumer electronics and accessories", "kitchen and home",
           "health and supplements", "knives and weapons", "none of these"]
```

Single label. Miscategorisation is an old listing trick, and a category that
disagrees with a signal is a strong review candidate. Keep `none of these`:
without it every listing lands in a category whatever it sells.

## Pass 2 — policy signals, multi-label

A listing can break two rules at once, so ask for every label that applies.

```
curl -s https://classifier.dev/v1/classify \
  -H 'content-type: application/json' \
  -d '{
  "labels": ["counterfeit or replica of a known brand",
             "restricted or prohibited item: weapons, drugs, live animals",
             "unapproved health or medical claim",
             "condition misstated: used or refurbished sold as new",
             "pushes the buyer to contact or pay off the platform",
             "no policy problem found"],
  "instructions": "Flag every signal the listing text actually shows. Do not flag a signal that is only implied by the category.",
  "multi": true, "max_labels": 3,
  "inputs": ["Aple AirPads Pro 1:1 Original Quality, sealed box, same chip as retail. Message us on WhatsApp for bulk pricing.",
             "Cast Iron Skillet 26cm, pre-seasoned, oven safe to 260C, made in Portugal, 2.9kg"]
}'
```

Real output. `labels` holds everything at or above 0.7, most likely first;
`scores` holds all six either way:

```
["pushes the buyer to contact or pay off the platform", "counterfeit or replica of a known brand"]
  counterfeit 0.79  restricted 0.01  health claim 0.03
  condition 0.21  off platform 0.93  no problem 0.22

["no policy problem found"]
  every risk score 0.03 or lower  no problem 0.72
```

Two labels fired on one listing: the misspelled brand and the off-platform
contact are separate violations with separate remedies.

## Pass 3 — review abuse, on the reviews

Reviews are their own corpus. Classify review text, `max_labels: 2`:

```
"labels": ["paid or incentivised review: free product, refund or discount for the review",
           "duplicated or templated text",
           "the seller writing as a customer",
           "solicits reviews off platform",
           "ordinary review, positive or negative"]
```

Measured on six real-shaped reviews: "Got this free in exchange for my honest
review" scored incentivised 0.98; one offering a discount code for any review
fired incentivised 0.98 and off-platform 0.96 together. A negative two-star
review scored ordinary, 0.93 — say in `instructions` that abuse is not a bad
rating, or the pass becomes a sentiment filter.

## Severity from the score band

Per signal, not per listing. Each label carries its own score:

- **0.9 and above** — high severity. Queue it at the top and suppress the
  listing from promoted placements pending a check, which is reversible.
- **0.5 to 0.9** — medium. Queue for review. Nothing changes for the seller.
- **Under 0.5** — log the score and move on.

Nothing is delisted, deleted or messaged by this. A person works the queue.

**Clear a listing on the risk scores, not the clean label.** Multi-label scores
are independent, and `no policy problem found` has no reason to be high: clean
listings came back at 0.72, 0.77 and 0.78, with every risk score at 0.04 or
lower. Auto-clear when `max(risk scores) < 0.5`, never on the clean label.

## The queue file

One JSON object per line, written by your code, never by the classifier:

```
{"id":"L-101","category":"consumer electronics and accessories","cat_conf":1.0,
 "signals":[["off platform",0.93],["counterfeit",0.79]],"severity":"high","action":"none yet"}
```

Keep every score, the ones under 0.5 included. When a reviewer overturns a flag
you need the number behind it to say whether the label or the threshold was
wrong.

## Pitfalls

- **`max_labels` truncates and 0.7 is the floor.** Four problems return three
  at `max_labels: 3`, and a signal at 0.6 is missing from `labels` entirely.
  The `scores` map has everything; your medium band lives there.
- **`labels` can be empty.** A plain chef's knife listing returned `[]`: no risk
  signal reached 0.7 and neither did `no policy problem found`, at 0.58. Code
  that reads `labels[0]` breaks here. Read `scores`.
- **Multi-label results have no `confidence` field.** Each label has its own
  score and the bands apply per score; reading `confidence` here is a KeyError.
- **Sellers adapt.** Re-read the 0.5 to 0.9 band monthly: evasions appear there
  as near-ties before they appear as confident hits.
- Limits per IP: 3,000 classifications a minute, 20,000 a day. Three passes
  over 1,000 listings is 3,000; a 429 carries `Retry-After`.
