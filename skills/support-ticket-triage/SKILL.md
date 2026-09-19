---
name: support-ticket-triage
description: Triage support tickets, emails or contact-form posts into an owning team, an urgency and a refund-or-cancellation flag with three batched calls to a keyless classification API, gate the answers on calibrated confidence so only the unsure ones reach a person, and emit a CSV a helpdesk can import. Use on "triage these tickets", "who owns this one", "which of these are refunds", "sort the support inbox", or any queue arriving faster than anyone reads it.
license: MIT
---

# Triage a ticket queue in three calls

`classifier.dev` sorts text into labels you choose. No key. One POST carries up
to 1,000 tickets and returns, per ticket, a label, a score for every label and a
calibrated confidence. It does not write replies. You keep the policy; it makes
asking the same question of a whole queue cheap.

## When not to use this

- Fewer than about twenty tickets, already in front of you. You have paid the
  reading cost; decide yourself.
- The answer needs account history or order state the ticket text does not
  contain. Look that up first and paste it into the input text.
- Drafting replies, summarising or redacting. This returns labels only.

## Step 1 — ask three questions, not one

Do not build one label set of `billing-urgent-refund` compounds. Run the same
inputs through three calls with three label sets, so a confident team answer is
not dragged down by an unsure urgency answer.

Write labels as sentences about the world. Codes classify badly. Measured on the
ten tickets below: urgency labelled `critical outage / high / normal / low` had
mean confidence 0.54 with one answer at or above 0.9. The same tickets against
`work stopped for many people`, `one customer blocked or money at risk`,
`routine request, answer today or tomorrow`, `no deadline in the message` had
mean confidence 0.68. Same model, same tickets, better questions.

Always include an escape label (`sales or spam`, `none of these`). Every call
returns one of your labels, so text that fits nothing is still sorted somewhere.

## Step 2 — run the three calls

```
curl -s https://classifier.dev/v1/classify \
  -H 'content-type: application/json' \
  -d '{
  "labels": ["refund or cancellation", "not a refund or cancellation"],
  "instructions": "Say refund or cancellation only when the customer asks for money back or asks to end the subscription.",
  "inputs": ["Charged twice for order 4821, please refund one",
             "App crashes on the reports tab since yesterday",
             "I want to cancel before the next renewal on the 14th"]
}'
```

Real output, trimmed to the fields you act on:

```
[{"label": "refund or cancellation",     "confidence": 1},
 {"label": "not a refund or cancellation","confidence": 1},
 {"label": "refund or cancellation",     "confidence": 1}]
```

For a real queue, write each field's request to a file and post it with
`-d @team.json`. Concatenate subject and body into one input, subject first,
trimmed to 32,000 characters.

## Step 3 — gate each field on its own confidence

Confidence is calibrated: measured, answers at or above 0.9 were right 82 to
92% of the time, answers under 0.5 right 29 to 64%. So:

- **0.9 and above** — write the field and route the ticket.
- **0.5 to 0.9** — write the field, mark the row for review, do not let it
  trigger anything irreversible (no auto-refund, no auto-close).
- **Under 0.5** — leave the field empty and put the ticket in a person's queue.

Gate per field. On the run below the team field cleared 0.9 on 8 of 10 and the
refund flag on 10 of 10, while urgency cleared it on 2. Gating the whole row on
its weakest field would have sent 8 of 10 tickets to a human for no reason.

## Worked example — ten tickets, real output

Three calls, 30 classifications, 426ms of API time in total. `p1` to `p4` are
the urgency labels above.

```
id,team,team_c,urgency,urg_c,refund,ref_c,queue
T-001,billing and payments,0.97,p2,0.89,yes,1,billing and payments
T-002,technical bug,1,p2,0.58,no,1,technical bug
T-003,how-to question,0.58,p2,0.52,yes,1,triage-review
T-004,account and login,0.9,p1,1,no,1,account and login
T-005,how-to question,1,p3,0.71,no,1,how-to question
T-006,technical bug,0.71,p4,0.88,no,1,triage-review
T-007,shipping and delivery,0.99,p2,0.71,no,1,shipping and delivery
T-008,billing and payments,0.99,p3,0.24,no,1,billing and payments
T-009,sales or spam,1,p4,0.94,no,1,sales or spam
T-010,technical bug,1,p2,0.37,no,1,technical bug
```

T-003 ("I want to cancel my subscription before the next renewal") is the row
worth studying: the team answer is a coin flip at 0.58 because cancelling is
both a how-to and a billing action, while the refund flag is 1.0. A person gets
the row, and still gets the flag.

Import that CSV as a bulk update keyed on your helpdesk's ticket id, or emit the
same columns as JSON lines. Keep the raw confidences in the file: they let you
re-tune the thresholds next week without re-running anything.

## Pitfalls

- **Strip quoted replies.** A message carrying the last five in the thread
  classifies as whatever the thread was about, not what was just asked.
- **Anger is not urgency.** T-006 is an angry message with nothing blocked; the
  urgency labels above place it at `no deadline in the message`, 0.88. Say so
  in `instructions` or tone will dominate.
- **Read the unsure pile weekly.** Every ticket under 0.5 is either a label you
  have not written yet or a genuine edge case.
- **Not language, no score.** A ticket that is only a stack trace comes back with
  `confidence: null` and an `unscored` reason. Treat null as review.

## Limits

3,000 classifications a minute and 20,000 a day per IP; a batch of 400 counts
as 400, and three passes over 1,000 tickets is 3,000. A 429 carries
`Retry-After`. For a shell pipeline, `npm i -g classifier-dev@0.1.3` then
`classify "billing and payments","technical bug" --review 0.9 < tickets.txt`
prints only the rows a person still needs to read.
