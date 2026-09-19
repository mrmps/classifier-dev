---
name: rag-reranker
description: Rerank retrieved passages by whether each one answers the question, drop the near-misses before they reach the prompt, and check every citation in the answer against the passage it points at. Use after a vector search returns twenty plausible chunks, or when an answer needs its citations verified. Triggers on "rerank these", "which chunks answer this", "check these citations", "my RAG cites the wrong chunk".
license: MIT
---

# Rerank and verify with a yes/no call

Vector search returns what is *near* the question. Much of it is about the right
subject and answers nothing, which costs context and invites citations pointing
at passages that never made the claim.

`classifier.dev` answers one question per passage — does this answer it — with a
calibrated confidence, keyless, in one batched call. It never writes text; the
answer stays yours to write.

## When not to use it

Not for first-stage retrieval (it does not embed or search), not for five
passages already in context, and not for ranking a set that is entirely
relevant — every passage gets a label, so a uniformly good set all comes back
`answers the question`.

## Step 1: one call over every candidate

```python
import json, urllib.request

def rerank(question, passages):
    body = {"labels": ["answers the question",
                       "related but does not answer",
                       "unrelated"],
            "inputs": passages,                    # up to 1,000 per request
            "instructions": f"The question is: {question}"}
    req = urllib.request.Request(
        "https://classifier.dev/v1/classify", data=json.dumps(body).encode(),
        headers={"content-type": "application/json", "user-agent": "rag/1.0"})
    return json.load(urllib.request.urlopen(req))["results"]
```

The question goes in `instructions`, never in the labels: labels stay reusable,
the question changes per call. Set a `user-agent`; Python's stdlib default is
refused at the edge with 403.

## Step 2: rank, then cut

Two signals come back per passage. Use both.

- `scores["answers the question"]` is the ranking. Sort by it and find the
  cliff; retrieval sets usually have one.
- `label` is the cut. Keep every passage labelled `answers the question`, drop
  the rest, but keep any reject whose `confidence` is under 0.5 as cheap
  insurance — a dropped passage is invisible to you afterwards.
- `confidence` says how much to trust that cut: 0.9 and above act on it, 0.5 to
  0.9 keep it but have your model check it, below 0.5 never let it be the only
  source of a claim.

## Measured

20 passages retrieved for "Why was the Mars Climate Orbiter lost in 1999?" from
three Wikipedia articles, one call: **253 ms wall, 177 ms server**, sorted by
the answers score:

```
0.99  answers the question         conf 0.99  Mars Climate Orbiter lead: names the mismatch
0.56  answers the question         conf 0.35  ... began the orbital insertion manoeuvre ...
0.08  related but does not answer  conf 0.86  The loss took place two and a half months ...
0.05  related but does not answer  conf 0.45  The cause of the communication loss is ...
0.01  unrelated                    conf 0.63  In 1832, Gauss used the astronomical second ...
```

Two passages cleared the cliff; 18 sat at 0.08 or below. Eight came back
`unrelated`, six from the `Metric_system` article retrieval pulled in because
the answer happens to be about units. The prompt went from 20 passages to 2, the
one holding the answer at 0.99.

The second row is the lesson: a real answer passage at score 0.56 but confidence
0.35, because it says "complications arising from human error" without naming
the cause. Keep it, rank it second, never let it be the only citation. A
`"tier": "smart"` pass over the same 20 took 8.5 s, escalated 14 and moved no
reject above 0.9 — the middle band is where honest uncertainty lives.

## Step 3: check the citations you generated

After your model writes the answer, pair each claim with the passage it cites
and ask a different question — same API, one batch:

```python
body = {"labels": ["the passage states this claim",
                   "the passage is about this but does not state it",
                   "the passage contradicts this claim"],
        "inputs": [f"CLAIM: {c}\n\nPASSAGE: {p}" for c, p in cited],
        "instructions": "Judge only whether the passage supports the claim. "
                        "Do not use outside knowledge."}
```

Four claims against their cited passages, 214 ms (claims abbreviated):

```
0.79  is about this but does not state it  "lost because ground software sent
                                            pound-force where newtons were expected"
0.39  contradicts this claim               "lost because a solar array failed to deploy"
1.00  states this claim                    "radio contact was lost 49 seconds early"
0.31  contradicts this claim               "the Polar Lander was lost the same way"
```

The first row is the useful one. The passage says "a measurement mismatch
between SI units and US customary units"; the claim names pound-force and
newton-seconds, detail the passage never gives. At 0.79 it is in the review
band — right, for a claim that is true but not sourced *by that passage*. Cut
the citation or cite something that states it.

## Two things that will bite you

**`confidence` is not `scores[label]`.** One item scored 0.52 for its chosen
label and came back at `confidence: 0.04`: the score is raw preference, the
confidence is the calibrated probability it is right. Rank on the score, gate on
the confidence.

**It cannot tell you what a passage says.** It picks among your labels. Anything
that needs words — the answer, a summary, a citation rewrite — is your job.

## Done looks like

Every passage carries a label, a score and a confidence; the prompt holds only
the ones labelled as answering; every claim has a citation checked at 0.9 or
above, and the rest are removed or flagged for a person.
