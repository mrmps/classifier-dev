---
name: knowledge-graph-relation-typing
description: Type candidate (subject, sentence, object) triples against a fixed relation schema and flag triples that contradict each other, batched, with a calibrated confidence per edge so only confident edges are written. Use when building a knowledge graph, entity table or fact store from text. Triggers on "type these relations", "what relation is this", "build a knowledge graph", "do these facts conflict", "check these triples".
license: MIT
---

# Type relations, catch contradictions

Extraction gives you candidates: two entities and the sentence they appeared in.
Which relation that sentence states, out of a fixed schema, is a classification;
so is whether a new triple contradicts a stored one. Both are one batched call
to `classifier.dev`, keyless, with a calibrated confidence to gate the write on.
It returns labels only; spans and sentences come from your own extraction.

## When not to use it

Not for finding the entities (extraction, not classification) and not for open
relation discovery: every input lands on one of your labels, so a relation you
never wrote down cannot be found here. Under five triples, decide yourself.

## Step 1: one input per triple

```python
inputs = [f"SUBJECT: {s}\nOBJECT: {o}\nSENTENCE: {sent}" for s, o, sent in triples]
SCHEMA = ["SUBJECT works for OBJECT", "SUBJECT founded OBJECT",
          "SUBJECT is headquartered or located in OBJECT",
          "SUBJECT acquired OBJECT", "SUBJECT is owned by OBJECT",
          "SUBJECT is married to OBJECT", "SUBJECT is a child of OBJECT",
          "SUBJECT studied at OBJECT", "SUBJECT created or authored OBJECT",
          "SUBJECT is a member of OBJECT",
          "no relation between SUBJECT and OBJECT is stated in this sentence"]
```

Labels are read as language, so write each schema name as the sentence it means:
`SUBJECT acquired OBJECT`, not `acquired_by` or `rel_17`. With `instructions`:
*"Pick the relation the sentence states between SUBJECT and OBJECT in that
direction. Only the sentence counts."* Up to 1,000 triples per request.

Ten triples from Wikipedia leads, one call, 305 ms; eight of them:

```
1.00  is headquartered or located in  Cloudflare -> San Francisco
0.99  acquired                        Cloudflare -> Replicate
0.95  founded                         Matthew Prince -> Cloudflare
0.98  no relation stated              Instagram -> Facebook
0.91  is married to                   Marie Curie -> Pierre Curie
0.72  works for                       Marie Curie -> University of Paris
0.76  is a member of                  Cloudflare -> New York Stock Exchange
0.44  works for                       Ada Lovelace -> analytical engine
```

The last two rows teach the most. `Cloudflare -> NYSE` is a listing, absent from
the schema, so the model took the nearest label at 0.76: a relation you keep
meeting in the 0.5-0.9 band is one you are missing. The 0.44 row is the gate
working — nothing gets written.

## Step 2: gate the write

- **0.9 and above** — write the edge.
- **0.5 to 0.9** — hold it in a review queue, or re-ask with `"tier": "smart"`.
  That queue is where missing relations show up.
- **below 0.5** — drop it. Do not store a guess in a graph that later steps
  will treat as fact.

## Keeping the schema small

Up to 100 labels are allowed; confidence, not the limit, stops you first.
Near-synonyms split the probability between them. On the same
`Matthew Prince -> Cloudflare` triple the 11-label schema above answered
`founded` at **0.95**; a 31-label version that also carried `co-founded` and
`is a founding investor in` answered `founded` at **0.57** — the same answer,
pushed into the review band by its own synonyms.

Splitting on *meaning* works the other way: `is a professor at` in the larger
schema typed `Marie Curie -> University of Paris` at 0.92 against 0.72 for
`works for`. Add a label for a distinct edge, never for a rewording.

## The direction trap

Swapping subject and object does not reliably flip the answer: the headquarters
sentence asked as `San Francisco -> Cloudflare` came back
`is headquartered or located in` at 0.93. The model reads the sentence, not the
argument order. When direction matters, write the candidate as a proposition:

```python
LABELS = ["the sentence states this",
          "the sentence states the reverse of this",
          "the sentence does not state this"]
inputs = [f"STATEMENT: {prop}\n\nSENTENCE: {sent}" for prop, sent in pairs]
```

All six test propositions came back right: `Instagram is owned by Meta
Platforms` → states this, 0.97; the reverse → states the reverse, 1.00;
`Cloudflare founded Matthew Prince` → the reverse, 0.94.

## Step 3: contradictions between triples

Compare only pairs sharing a subject and a relation, or the count goes
quadratic.

```python
inputs = [f"FACT A: {a}\nFACT B: {b}" for a, b in candidate_pairs]
LABELS = ["the two facts are consistent", "the two facts contradict each other",
          "the two facts are about different things"]
```

Eight pairs, 164 ms, with `instructions` = *"Two facts contradict only if they
cannot both be true of the same entity."*

```
1.00  contradict        founded in 2009       | founded in 2011
0.99  contradict        headquartered in SF   | headquartered in Austin
0.99  consistent        headquartered in SF   | has an office in Austin
0.86  consistent        Prince founded it     | Zatlyn founded it
0.94  different things  Curie won a Nobel     | Lovelace was a mathematician
0.80  contradict        Cloudflare acquired X | X acquired Cloudflare
```

All eight were right, six at 0.9 or above. The co-founders at `consistent` 0.86
is the case to watch: a schema where one founder excludes another must say so in
`instructions`.

## Done looks like

Every candidate carries a relation and a confidence; only edges at 0.9 or above
are in the graph; the 0.5-0.9 queue is reviewed for missing relations; every
contradiction above 0.9 is resolved or marked disputed.
