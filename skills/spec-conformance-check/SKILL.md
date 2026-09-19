---
name: spec-conformance-check
description: Check an artifact against a written spec one requirement at a time. Splits the spec into testable requirements, scores each met, partly met, not met or not applicable with a calibrated confidence, blocks on a confident not-met and sends the unsure rows to a person. Works on a PR description, an agent's answer, a generated test or an RFC. Use on "does this meet the spec", "did it do everything I asked", or a definition-of-done gate in CI.
license: MIT
---

# Check an artifact against a spec, one line at a time

Asking a model "does this meet the spec?" gets a paragraph that is generous,
unfalsifiable and different next time. Asking once per requirement gets a table
you can block a merge on, in one call: each input is one requirement plus the
artifact.

## When not to use it

- When the spec is executable: a test suite beats this, so run the tests.
- For behaviour the artifact does not describe. It reads the text in front of
  it, so a PR description that lies passes; point it at the diff too.
- For requirements nobody wrote down. Write them down first.

## 1. Split the spec into requirements

One testable claim a line, in the spec's own words:

```
The endpoint responds at GET /v1/health.
The response body is JSON and includes the running version string.
The endpoint checks the database before reporting healthy.
An unhealthy dependency makes the endpoint answer 503.
Responses are not cached by intermediaries.
The endpoint is rate limited per IP.
The mobile app shows a maintenance banner when health fails.
```

- **Split on "and".** "Returns JSON and is rate limited" scores as one blurred
  answer; two lines say which half is missing.
- **Keep the modal verb.** "should" and "must" split a note from a block.
- **Leave in requirements this artifact cannot satisfy.** Line 7 is about the
  mobile app, and `not applicable` is a real answer.

## 2. One input per requirement

The artifact goes into every input, after the requirement. The repetition is
the point: each answer judges one thing. `conform.py`:

```python
import json, sys, urllib.request

spec = [l.strip() for l in open("spec.txt") if l.strip()]
artifact = open("artifact.txt").read()
body = json.dumps({
    "labels": ["met", "partly met", "not met", "not applicable"],
    "instructions": "Each input is one requirement followed by the artifact under review. "
        "Decide whether the artifact, as written, meets that one requirement. Judge only "
        "what the artifact states; silence is not met. Use 'not applicable' when the "
        "requirement is outside what this artifact covers.",
    "inputs": [f"REQUIREMENT: {r}\n\nARTIFACT:\n{artifact}" for r in spec],
}).encode()
req = urllib.request.Request("https://classifier.dev/v1/classify", data=body,
    headers={"content-type": "application/json", "user-agent": "conformance/1.0"})

blocks = 0
for r, q in zip(json.load(urllib.request.urlopen(req))["results"], spec):
    c, label = r["confidence"], r["label"]
    block = label == "not met" and c >= 0.9
    gate = "BLOCK" if block else "ask" if c < 0.5 else "review" if c < 0.9 else "ok"
    blocks += block
    print(f"{label:<15}{c:.2f}  {gate:<7}{q}")
sys.exit(1 if blocks else 0)
```

Set the `user-agent`: Python's `urllib` default is blocked at the edge and
returns 403 before the call is classified.

## 3. A real run

`artifact.txt`, a PR description:

```
PR: add GET /v1/health
Returns 200 with {"ok": true, "version": "1.4.0"} and runs SELECT 1 against the
database before answering. Response is JSON with a cache-control: no-store
header. Three unit tests added. I did not get to the per-IP rate limit; the
endpoint is currently unlimited.
```

`python3 conform.py`:

```
met            1.00  ok     The endpoint responds at GET /v1/health.
met            1.00  ok     The response body is JSON and includes the running version string.
met            1.00  ok     The endpoint checks the database before reporting healthy.
not met        0.68  review An unhealthy dependency makes the endpoint answer 503.
met            0.99  ok     Responses are not cached by intermediaries.
not met        0.99  BLOCK  The endpoint is rate limited per IP.
not applicable 0.93  ok     The mobile app shows a maintenance banner when health fails.
```

Exit status 1, so it gates the merge. Requirement 4 is the row that matters:
the PR never mentions 503, so a `not met` in the review band means the model
cannot tell whether that is missing from the description or from the code — a
question for the author, not a block. It came back 0.68, 0.77 and 0.79 over
three runs: read the band, never the second decimal.

## 4. The gate

- **`not met` at 0.9 and above — block.** One row is enough; print it, not a
  summary.
- **0.5 to 0.9, any label — a person reads it.** Omissions and vague
  requirements both land here.
- **Below 0.5 — the requirement is the problem.** A line the model cannot
  place is compound or vague; rewrite it before arguing about the artifact.
- **`partly met` at any confidence — a person reads it.** It means the
  artifact started on the requirement and stopped short.

`"tier": "smart"` re-asks answers under 0.7 of a reasoning model at seconds
per row. Use it when several rows land there.

## Pitfalls

- **Silence reads as met unless you say otherwise.** "Judge only what the
  artifact states; silence is not met" in `instructions` stops a thin PR
  description passing a long spec.
- **A long artifact drowns a short requirement.** Past a few thousand
  characters, pass only the relevant section.
- **Confidence is about the label, not the requirement's weight.** A sure
  `not applicable` on a load-bearing line still needs a look.

## What done looks like

Every requirement has a label, a confidence and a gate, in spec order. The
command exits non-zero when a `not met` clears 0.9, the review band is a short
list of rows with names against them, and the spec file goes into the next run
unchanged.
