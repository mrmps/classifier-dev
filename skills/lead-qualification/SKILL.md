---
name: lead-qualification
description: Qualify inbound form submissions against your own ICP with a keyless classification API: one pass for ICP fit, one for buyer intent, then a route (sales, nurture, drop) gated on calibrated confidence. Covers turning an ICP document into labels and instructions, and a weekly loop over the low-confidence band that fixes the labels rather than the leads. Use on "qualify these leads", "is this in our ICP", "who should sales call first", "score the demo requests", "clean up the contact-form backlog".
license: MIT
---

# Qualify inbound leads against your ICP

`classifier.dev` answers one multiple-choice question about a text and returns a
calibrated confidence with it. No key. Two passes over the same submissions, fit
and intent, give you a route you can defend and a number saying how much to
trust it. It does not write the follow-up email; that stays yours.

## When not to use this

- Fewer than about twenty leads in front of you. Just read them.
- Scoring a person rather than a request. Job title and company are in scope;
  who the person is, is not.
- Enrichment. It classifies the text you give it. If headcount, sector and
  funding matter, look them up first and paste them into the input.

## Step 1 — turn the ICP document into labels

Find the sentences in the ICP doc that state a threshold: sector, headcount,
whether they have engineers, what they are replacing. Each becomes one label,
written as a full clause. Codes and single words classify badly.

```
"core ICP: a software or data company with 100 to 2,000 staff and its own engineering team"
"edge of ICP: right kind of company but too small, too large, or no engineering team"
"out of ICP: consumer, agency, reseller, student, or a company with no software to build"
"not enough in the form to tell"
```

The last two labels matter more than the first two. Every call returns one of
your labels, so with no `out of ICP` and no `not enough to tell`, a plumber and
a blank form both land in a bucket sales will call.

Put the tie-breaks from the ICP doc in `instructions`, one or two sentences:
`"Judge the company against the ICP, not the enthusiasm of the message."`

## Step 2 — run fit and intent as separate calls

One input per lead: form fields and message joined into one string, plus
whatever you already know about the company.

```
curl -s https://classifier.dev/v1/classify \
  -H 'content-type: application/json' \
  -d '{
  "labels": ["ready to buy: names budget, a contract, a renewal or a deadline",
             "actively evaluating: comparing vendors, asking for pricing, security or a trial",
             "early research: learning what the product is, no timeline",
             "not a buyer: job seeker, student, vendor pitch, reseller or a support request"],
  "instructions": "Intent is what the person asked for, not how senior they are.",
  "inputs": ["CTO at a 120-person payments company: trial ran out last week, who do I talk to about an annual contract",
             "no company given: is this free? just looking around",
             "agency, 35 staff: we build sites for clients, would we be able to resell this"]
}'
```

Real output:

```
1     ready to buy
0.57  early research
1     not a buyer
```

Up to 1,000 leads per call; post the fit request the same way. That middle row
lands anywhere from 0.5 to 0.7 across runs, which is the review band working.

## Step 3 — route on the pair, gate on the weaker confidence

Route from the two labels; let the lower of the two confidences decide whether a
person sees it first.

| fit | intent | route |
| --- | --- | --- |
| core | ready to buy or evaluating | sales, today |
| core | early research | nurture |
| edge | ready to buy | sales, with the form attached |
| edge | evaluating or research | nurture |
| out | anything | drop, except a support request, which goes to support |
| cannot tell | anything | nurture and ask one qualifying question |

- **Both at or above 0.9** — route it.
- **Either 0.5 to 0.9** — route it, flag the row, and let no irreversible step
  fire from it. Nothing is deleted out of this band.
- **Either under 0.5** — a person reads the lead before anything happens.

Dropping a lead is irreversible in practice, so only drop on `out of ICP` at or
above 0.9. Measured on eight real-shaped submissions, the plumber, the student
and the reseller came back `out of ICP` at 0.99, 1.0 and 1.0. The band under 0.9
is not where the mistakes are; it is where the missing labels are.

## Step 4 — the weekly loop over the unsure band

Pull every lead where either confidence fell under 0.9 and read twenty of them.
You are not correcting leads. You are looking for the sentence your ICP doc
never wrote down.

A real one: a Head of Data at an 1,800-person health insurer scored
`edge of ICP` at 0.31, with `scores` showing 0.48 edge against 0.40 core — a
genuine tie, because the ICP doc said "software or data company" and never said
what a large non-software enterprise with an in-house data team is. Adding
`"core ICP: any company over 500 staff with an in-house data or platform team"`
moved that lead to the new label at 0.62 on a re-run.

Then check the whole batch, not the lead you fixed. Adding a label splits the
probability mass: on that re-run another core lead slipped from 0.85 to 0.77,
two core labels now competing for it. Keep the previous output and diff.

## Pitfalls

- **Do not put the route in the labels.** A label such as `send to sales` bakes
  today's policy into the answer. Classify fit and intent; decide the route in
  your code, where changing it costs nothing.
- **A support request in the sales form is common.** Keep it in the intent
  labels or it will be qualified as a lead.
- **Confidence predicts accuracy among your labels, not fit to the world.** An
  empty message still gets a label; that is what `not enough to tell` is for.
- Per IP: 3,000 classifications a minute, 20,000 a day. A 429 carries
  `Retry-After`.
