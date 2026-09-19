---
name: content-moderation-gate
description: Check user-generated text against a written policy before it is published. One multi-label call scores every policy category independently, the band sets severity, only the middle band reaches a human queue, and hard-block categories are held whatever the score says. Use when a comment box, feed or chat product needs "moderation", "policy enforcement", "flag bad posts", or an answer to "what do we do with the borderline ones".
license: MIT
---

# Gate a post against your policy

A keyword list misses anything written politely, and a model asked to "check
this post" returns a paragraph you cannot branch on. `classifier.dev` returns
a probability per category, so the branch is arithmetic.

## When not to use it

- As the only control. It gates publication; you still need reporting, appeals
  and someone who owns the policy.
- For images, audio, video or links: it reads text.
- For legal determinations or age verification.

## 1. Policy document to labels

One label per enforceable category, written as a moderator would say it rather
than as a section number: `harassment or threats aimed at a person` classifies,
`policy 3.2(b)` does not.

- Say what the category *is*, not what it is near: "unsafe advice that could
  injure someone who follows it" beats "dangerous content".
- Keep categories disjoint; overlapping labels split the score and both land in
  the middle.
- Add `none of these`, or a clean post lands in your nearest violation.
- Fix the list; changing it mid-week voids last week's numbers.

## 2. One call, multi-label

`policy.json`:

```
{
  "multi": true,
  "max_labels": 3,
  "labels": [
    "harassment or threats aimed at a person",
    "spam or commercial link bait",
    "unsafe advice that could injure someone who follows it",
    "sexual content involving a minor",
    "self-harm or suicidal intent",
    "none of these"
  ],
  "instructions": "Apply the policy to the post itself, not to the topic it discusses. Quoting or reporting a violation is not a violation. Judge the post, not the author.",
  "inputs": [
    "everyone in this thread should log off, you are all worthless and I know where you work",
    "MAKE $4000/WEEK FROM HOME >> click my profile link, limited spots",
    "just double the dose if it is not working after an hour, the label is only a guideline",
    "i do not see the point of any of this anymore and i have been thinking about ending it",
    "you clearly have no idea what you are talking about and your code is bad",
    "i reported a user yesterday for threatening another member, how long does moderation take",
    "the sauce needs more acid, try a splash of vinegar at the end"
  ]
}
```

```
curl -s https://classifier.dev/v1/classify -H 'content-type: application/json' --data @policy.json \
  | jq -r '.results | to_entries[] | "post \(.key)  " + (.value.scores | to_entries
      | map(select(.key != "none of these")) | max_by(.value) | "\(.value)  \(.key)")'
```

Real output (up to 1,000 posts a call):

```
post 0  0.98  harassment or threats aimed at a person
post 1  0.99  spam or commercial link bait
post 2  0.96  unsafe advice that could injure someone who follows it
post 3  0.98  self-harm or suicidal intent
post 4  0.69  harassment or threats aimed at a person
post 5  0.03  harassment or threats aimed at a person
post 6  0.06  unsafe advice that could injure someone who follows it
```

A real queue: four obvious, one arguable, two fine.

## 3. The gate

Take the **highest policy score** per post, ignoring `none of these`.

- **0.9 and above — act.** Severity follows the category: remove for
  harassment and unsafe advice, hold for spam, route self-harm to whatever
  support flow your product has rather than to a punishment.
- **0.5 to 0.9 — human queue.** Post 4 only. Staff moderators from how many
  posts land in this band per day.
- **Below 0.5 — publish**, keeping the score for when a report arrives.

**Hard block, above all of it.** If `sexual content involving a minor` clears
the floor you set — start at 0.2, not 0.5 — the post is held for a human and
this gate never publishes it, whatever else scored. Same for a credible threat
of violence if your policy names one: a low floor, a one-way door, and none of
the bands above.

## 4. Gate on `scores`, not `labels`

The `labels` array holds only categories at 0.7 and up, so post 4 reads clean
through it: `score=0.67  labels=[]`. Gate on `scores`, which carries every
category. `none of these` is a sanity check, not a gate: it ran from 0.20 on
the worst post to 0.56 on the cleanest and never reached 0.7.

## 5. Carve-outs go in `instructions`

The highest-value edit is saying that reporting a violation is not one. Post 5
scored `harassment` 0.03 with that sentence in `instructions` and 0.34 with it
removed, same batch.

Keep it to one or two sentences. Pasting the policy document in there flattens
every score toward the middle.

## 6. What you log

Counts and bands, never posts. One row per batch — day, label, band, count —
and one per held post: post id, category, score, band, moderator verdict. The
body stays in your own store under your own retention rule; it does not belong
in a metrics table or an alert email.

It is also the calibration check: if weekly agreement between moderators and
the 0.9 band falls under about 85%, rewrite the labels before you touch the
thresholds.

## Pitfalls

- **Scores near a band edge move between runs.** Post 4 came back 0.63, 0.64,
  0.65 and 0.71 over four runs while post 0 held at 0.98. The band is the
  decision; no rule should turn on 0.69 against 0.71.
- **Quoted abuse scores like abuse** unless `instructions` says it does not.
- **A 429 means hold the posts**, not publish them.

## What done looks like

Every post has a per-category score, a band and a decision. Hard-block
categories have their own floor and never auto-publish, the queue holds only
the middle band, and the week's agreement rate is on record.
