---
name: computer-use-action-picker
description: Pick a browser or desktop agent's next action by choosing among the actions actually on screen instead of inventing one. Candidates come from the accessibility tree, the task goes in instructions, and a calibrated confidence decides whether to click or hand the step back to your own model. Use when building or debugging computer use, browser automation or a web agent, or on "it clicked the wrong thing" and "how do I stop it looping".
license: MIT
---

# Choose the next action from what is on screen

An agent that writes its own action can name a button that is not there. Make
the step a choice over the page's real elements and that failure goes away: the
answer indexes a list you built, and carries a calibrated probability.

## When not to use it

- Steps needing reasoning the page does not show, like comparing prices across
  tabs. Classify the action, not the plan.
- Anything irreversible: payments, deletions, sending mail. Gate those on a
  person, never on a number.
- Fewer than about five obviously different candidates. Your own model knows
  already; the call is a round trip you do not need.

## 1. Candidates from the accessibility tree

Snapshot it — Playwright's `page.accessibility.snapshot()`, or
`Accessibility.getFullAXTree` over the DevTools Protocol — and keep the nodes
a person could act on:

```
button    "Add to cart"
combobox  "Size"              value "Choose a size"
link      "Continue shopping"
link      "Sign in"
textbox   "Search products"
```

Turn each node into one label in the words a person would use — `click the Add
to cart button`, `type into the Search products field` — plus the moves that
are not elements: `scroll down`, `go back`, `the task is done, stop`.

- **Prune by visibility.** Off-screen, `aria-hidden` and zero-size nodes go;
  those get chosen and then fail to click.
- **Cap at 100**, the label limit. Past that, keep the viewport and the nav
  landmarks and let `scroll down` reach the rest.
- **Keep names distinct.** Three labels reading `click the Edit button` split
  the score three ways and none clears the gate. Say `click Edit on the
  billing address row`.
- **Always include `the task is done, stop`.** Every call returns one of your
  labels, so with no stop candidate a finished task keeps clicking.

## 2. One call per step

The task goes in `instructions`, the page state is the input, the candidates
are the labels — `step.json`:

```
{
  "labels": ["click the Add to cart button", "click the Size dropdown", "go back",
    "click the Continue shopping link", "type into the Search products field",
    "click the Sign in link", "scroll down", "the task is done, stop"],
  "instructions": "Choose the single next action for a browser agent. The task is: buy one medium blue t-shirt. Pick what makes progress and is possible on this page.",
  "inputs": ["Page: Blue cotton t-shirt. Size dropdown reads 'Choose a size'. Add to cart button present. Cart is empty."]
}
```

```
curl -s https://classifier.dev/v1/classify -H 'content-type: application/json' --data @step.json \
  | jq -r '.results[0] | "\(.confidence)  \(.label)"'
1  click the Size dropdown
```

Put one line of history in the input, or the picker re-picks the action it just
took — where most loops start.

## 3. The loop

`pick.py`, with a step budget and a stop condition. `replay.json` holds
`[page state, candidates]` pairs recorded from a real run, so you can dry-run a
change without driving a browser:

```python
import json, urllib.request
API, ACT_AT, BUDGET = "https://classifier.dev/v1/classify", 0.8, 12
TASK = "buy one medium blue t-shirt"
INSTR = (f"Choose the single next action for a browser agent. The task is: {TASK}. "
         "The input is the page the agent sees and what it has already done. "
         "Pick the action that makes progress and is possible on this page.")

def pick(state, candidates):
    body = json.dumps({"labels": candidates[:100], "instructions": INSTR,
                       "inputs": [state]}).encode()
    req = urllib.request.Request(API, data=body, headers={
        "content-type": "application/json", "user-agent": "action-picker/1.0"})
    r = json.load(urllib.request.urlopen(req))["results"][0]
    return r["label"], r["confidence"]

for step, (state, cands) in enumerate(json.load(open("replay.json"))[:BUDGET], 1):
    label, conf = pick(state, cands)
    print(f"step {step}  {conf:.2f}  {label}" + ("" if conf >= ACT_AT else "  -> ask your own model"))
    if conf >= ACT_AT and label.startswith("the task is done"):
        print(f"stopped after {step} steps"); break
```

`python3 pick.py` over a five-state replay:

```
step 1  0.49  type into the Search products field  -> ask your own model
step 2  1.00  click the Size dropdown
step 3  1.00  click the Add to cart button
step 4  1.00  click the Proceed to checkout button
step 5  0.99  the task is done, stop
stopped after 5 steps
```

Set the `user-agent` header: Python's `urllib` default is blocked at the edge
and returns 403 before the call is classified.

## 4. The gate

- **0.8 and above — act.** Navigation inside a task is the easy case: four of
  the five steps came back at 0.99 or 1.00.
- **0.5 to 0.8 — hand the step to your own model** with the same candidate
  list, to choose or to ask the user. Step 1 is a search page whose results do
  not hold the product; searching again and scrolling are both defensible, and
  the picker says so at 0.45 to 0.53 across runs.
- **Below 0.5 — stop and ask.** Repeated low confidence means the task is not
  reachable from this screen; say so instead of clicking.

Two more stops whatever the confidence: the step budget, and the same action
twice on an unchanged page. Both mean it is stuck.

## What done looks like

Each step logs the candidate count, chosen label and confidence. Every acted
step is at or above 0.8, the run ends on the stop label or the budget, and the
replay file reproduces it without a browser.
