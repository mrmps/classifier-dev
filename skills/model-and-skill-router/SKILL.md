---
name: model-and-skill-router
description: Classify an incoming task by intent, difficulty and risk in three parallel calls to a keyless classifier, then route it to a cheap model, a strong model, a named skill or the user, from a routing table you maintain instead of a prompt. Use when deciding which model or skill should take a request, when someone says "route this", "which model should handle this" or "pick the right skill", or when a queue of tasks should not all get the same treatment.
license: MIT
---

# Route a task before you spend a model on it

Asking a strong model which model should answer costs a strong model call.
Three classifier calls run in parallel cost about 120ms and return numbers, so
the decision lives in a table you can read and correct rather than in a prompt
that drifts.

## Three questions

One question per call, each batching every waiting task: intent (six labels),
difficulty (an ordered rubric from 1 to 5) and risk (three labels), all set
out in the code below. `difficulty` and `risk` each need an `instructions`
line; `intent` does not. Keep `none of these` in the intent set: every call
returns one of your labels whether or not any fit.

## The router

```python
import json, sys, urllib.request
from concurrent.futures import ThreadPoolExecutor

INTENT = ["answer a question about existing code", "write or change code",
          "find the cause of a failure", "operate infrastructure or data",
          "research something outside the repository", "none of these"]
DIFFICULTY = ["1 mechanical", "2 easy", "3 moderate", "4 hard",
              "5 needs deep reasoning"]
RISK = ["safe to do unattended", "the user should confirm first",
        "irreversible or affects production"]

# The table you maintain: intent, difficulty, risk. First match wins.
ROUTES = [
    (lambda i, d, r: r == RISK[2],                 "ask the user"),
    (lambda i, d, r: d <= 2.0 and r == RISK[0],    "cheap model"),
    (lambda i, d, r: i == "unclear",               "ask the user"),
    (lambda i, d, r: i == INTENT[3],               "ask the user"),
    (lambda i, d, r: i == INTENT[2],               "strong model, debug skill"),
    (lambda i, d, r: i == INTENT[0] and d <= 3.5,  "cheap model, repo search skill"),
    (lambda i, d, r: True,                         "strong model"),
]

def ask(labels, inputs, instructions=None):
    body = {"labels": labels, "inputs": inputs}
    if instructions: body["instructions"] = instructions
    req = urllib.request.Request("https://classifier.dev/v1/classify",
        data=json.dumps(body).encode(),
        headers={"content-type": "application/json", "user-agent": "router/1"})
    return json.load(urllib.request.urlopen(req))["results"]

def route(tasks):
    with ThreadPoolExecutor(3) as pool:
        i_f = pool.submit(ask, INTENT, tasks)
        d_f = pool.submit(ask, DIFFICULTY, tasks,
            "Rate how much reasoning a coding agent needs to finish this request.")
        r_f = pool.submit(ask, RISK, tasks,
            "Judge the blast radius if a coding agent carried this out with no one "
            "watching. Production data, deploys and anything git cannot undo are "
            "the top label.")
    for task, i, d, r in zip(tasks, i_f.result(), d_f.result(), r_f.result()):
        ev = sum(float(k.split()[0]) * v for k, v in d["scores"].items())
        intent = i["label"] if (i["confidence"] or 0) >= 0.5 else "unclear"
        risk = r["label"] if (r["confidence"] or 0) >= 0.5 else RISK[1]
        dest = next(d for t, d in ROUTES if t(intent, ev, risk))
        yield task, dest, f'{intent} {i["confidence"]}', ev

for task, dest, why, ev in route([l.strip() for l in sys.stdin if l.strip()]):
    print(f"{dest:30} d={ev:.1f}  {why:38} {task[:44]}")
```

    python3 route.py < tasks.txt
    cheap model                 d=1.0  unclear 0.47              Fix the typo in the READ
    strong model, debug skill   d=4.1  find the cause of a fail  Why does the checkout fl
    strong model                d=2.5  write or change code 1    Add a --json flag to the
    ask the user                d=1.6  operate infrastructure 1  Delete the staging datab

## Read the rubric as an expected value

Ordered labels make the `scores` map a distribution. The debugging task above
had `5 needs deep reasoning` on top at 0.21 confidence, which alone says
nothing; the expected value across the five labels was 4.1, the number you
want. The typo scored `1 mechanical` at 0.98, expected value 1.0. Route on the
expected value, keep the argmax for display.

## Thresholds

The classifier returns labels, scores and calibrated confidence, no prose. Act
at 0.9 and above, where answers were right 82 to 92% of the time. Between 0.5
and 0.9 route up, to the stronger model or the more careful path: a bigger
model costs less than a wrong route. Below 0.5 treat the dimension as unknown,
which above turns intent into `unclear`. Ask the person only when the unknown
changes the destination; an unclear intent on a difficulty-1.0 task with no
risk still goes to the cheap model.

## Pitfalls

- **Do not fold the three questions into one multi-label call.** Asked that
  way, "Fix the typo in the README heading" came back as only `easy for a
  small model`: `a code change` scored 0.68, under the 0.7 multi-label floor,
  so the intent dimension vanished. Three calls, run at once.
- **A routing table is data.** Add a row when a route is wrong, rather than a
  sentence to a prompt.
- **Re-route after a plan changes.** The label describes the request as
  written; if the typo fix turns out to need a migration, the route is stale.
  One-word requests come back at low confidence and land in `unclear`.

## When not to use this

Skip it when only one model is available, when the task is in context and
cheap to simply do, or when one person is typing one request and waiting. It
earns its place on a queue, a webhook or a batch of issues, where tasks arrive
faster than anyone triages them.
