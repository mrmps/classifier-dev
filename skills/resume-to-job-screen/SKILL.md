---
name: resume-to-job-screen
description: Score resumes against a job description one explicit competency at a time, with a keyless classification API, ordered labels (no evidence, mentions, demonstrated, strong) and an expected value taken from the returned score distribution, producing a weighted ranked shortlist with every number shown. Use on "screen these CVs", "rank these applicants against the JD", "who is worth an interview", "build a shortlist". A reading aid only: it never decides, and it scores evidence in the text, never who the candidate is.
license: MIT
---

# Screen resumes against a job description, one competency at a time

`classifier.dev` picks one of your labels for a text and returns the whole score
distribution with it. No key. That gives you a defensible first pass: each
competency scored on its own, every number visible, the ranking reproducible.
It writes nothing and decides nothing.

## What this must not be used for

- Never classify or infer a protected characteristic: age, sex, race, religion,
  disability, pregnancy, nationality, marital status, or a proxy for one such
  as graduation year, name, photo, or a gap in employment. Do not put such a
  label in `labels` or a hint in `instructions`.
- Never auto-reject. The output ranks and shows evidence; a person reads every
  resume before anyone is turned down, and decides.
- Do not use it where local law regulates automated decisions in hiring (the EU
  AI Act treats hiring as high risk; New York City Local Law 144 requires a bias
  audit and notice). Confirm what applies before it touches a real applicant.
- Do not score "culture fit", "communication skills" or "attitude" from a
  resume. The text does not carry them, so the answer is noise with a number.

Strip names, addresses, dates of birth, photos and school names from the text
before sending. You are scoring evidence of work, and nothing else improves the
answer.

## Step 1 — write competencies from the JD, not a summary of it

Pull three to six competencies out of the JD that a resume could actually show.
Each needs a sentence, not a keyword: `Python services running in production,
not notebooks or scripts` beats `Python`. Attach a weight to each; they sum
to 1.

## Step 2 — one call per competency, ordered labels

The same four labels for every competency, in order, with a leading digit so
the scores map is easy to turn into a number:

```
curl -s https://classifier.dev/v1/classify \
  -H 'content-type: application/json' \
  -d '{
  "labels": ["0 no evidence in the resume",
             "1 mentions the area without detail",
             "2 did this on the job",
             "3 owned or led this, with scale or outcomes"],
  "instructions": "Score only this competency: designing and operating distributed systems, queues, sharding, on-call. Judge evidence in the resume text, never the person.",
  "inputs": ["Senior engineer, 6 years. Python and Go services on AWS, built a sharded job queue handling 3M jobs a day, on-call rotation owner.",
             "Backend developer, 4 years. Django and Flask internal tools, some Celery, familiar with Kubernetes."]
}'
```

Real output, with the expected value computed from `scores`:

```
label 3  confidence 1.00  scores {0:0.00, 1:0.00, 2:0.00, 3:1.00}  EV 3.00
label 1  confidence 0.56  scores {0:0.32, 1:0.67, 2:0.01, 3:0.00}  EV 0.69
```

One call per competency, up to 1,000 resumes each. Keep the requests identical
apart from `instructions`: same labels, same order, or the numbers stop
comparing.

## Step 3 — score the expected value, not the winning label

```python
def ev(result):          # the mean of the distribution, 0.00 to 3.00
    return sum(int(label[0]) * s for label, s in result["scores"].items())

total = sum(weight[c] * ev(per_competency[c][i]) for c in competencies)
```

The argmax label throws away the distribution. The second candidate above sits
between 0 and 1 at 0.56 confidence: as a label that is a coin flip, as an
expected value, 0.69, a stable "barely anything here". Take the EV and the
near-ties stop mattering.

## Step 4 — the shortlist, with the working shown

Five real resumes, three competencies weighted 0.40 production Python, 0.35
distributed systems, 0.25 leading engineers. Three calls, 15 classifications:

```
cand  python  distrib  leading  total
A     3.00    2.99     2.72     2.93
E     2.94    2.99     2.33     2.80
C     0.00    0.74     2.99     1.01
B     1.58    0.52     0.04     0.82
D     0.25    0.32     0.00     0.21
```

C is the row that proves the method: an engineering manager, three years out of
code, who would have ranked well on any "senior, 11 years" keyword filter and
ranks third here because the Python column is 0.00. Hand the table to the
hiring manager with the per-competency numbers, not the total alone.

## The confidence gate

Per competency, per candidate:

- **0.9 and above** — take the score into the ranking.
- **0.5 to 0.9** — take it, and mark the cell. The EV is usually still right;
  the label is what is uncertain.
- **Under 0.5** — do not let that cell move the ranking. A person reads that
  section of the resume and scores it, or you drop the competency as unscorable
  from a resume.

Anyone near the cut line is read by a person anyway. The ranking orders the
reading; it does not replace it.

## Pitfalls

- **A resume is a claim.** The model scores what is written, so someone who
  writes well outscores someone who did more and wrote less. That is exactly
  why this ranks a reading order rather than deciding.
- **Keep the raw output.** Save every request and response. If a candidate asks
  why they were not progressed you need the numbers, and under some hiring laws
  you must be able to produce them.
- **Re-run the whole batch when you change a label.** Scores from different
  label sets are not comparable, and a mixed table is worse than no table.
- Limits per IP: 3,000 classifications a minute, 20,000 a day. A 429 carries
  `Retry-After`.
