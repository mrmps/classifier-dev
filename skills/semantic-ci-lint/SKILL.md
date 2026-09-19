---
name: semantic-ci-lint
description: Check every changed hunk of a pull request against conventions written in prose (naming, error handling, logging, docs) with a keyless classifier, and comment only on findings above a confidence threshold. Use when a convention cannot be expressed as a lint rule, when someone says "enforce our conventions in CI" or "check the PR against the style guide", or when the same review comment keeps being typed by hand.
license: MIT
---

# Lint the conventions a linter cannot express

"Log ids, never a person's name" and "never swallow a failure" are rules a
team writes down and then enforces by memory. A classifier can check them: one
label and a calibrated confidence per hunk, no prose, cheap on every push.

## One convention per call

The `instructions` field carries the convention in your own words; each call
asks about one convention. Four conventions in a single
`instructions` line put a hunk that logs a person's address and name at
`follows the convention` 0.27. The same hunk against the logging convention
alone came back `breaks the convention`, and with the whole hunk and its file
path in the input, 1.0.

Keep three labels: follows, breaks, and `the convention does not apply to this
hunk` - the third stops unrelated hunks being forced into a verdict.

## The script

`.github/semantic-lint.py` reads the output of `git diff -U0`:

```python
import json, re, sys, urllib.request

CONVENTIONS = [
    ("logging", "One convention only: a log line may carry ids and counts, never "
                "a person's name, address or anything else that identifies them."),
    ("errors", "One convention only: a failure is raised as a typed error class "
               "and is never swallowed by an empty or logging-only catch block."),
]
LABELS = ["follows the convention", "breaks the convention",
          "the convention does not apply to this hunk"]
BREAKS, COMMENT_AT, NOTE_AT = LABELS[1], 0.9, 0.5

def hunks(diff):
    out, path, buf, line = [], None, [], 0
    for raw in diff.splitlines():
        if raw.startswith("+++ b/"):
            path = raw[6:]
        elif raw.startswith("@@"):
            if buf: out.append((path, line, "\n".join(buf))); buf = []
            m = re.search(r"\+(\d+)", raw)
            line = int(m.group(1)) if m else 0
        elif raw.startswith("+"):
            buf.append(raw[1:])
        elif buf:
            out.append((path, line, "\n".join(buf))); buf = []
    if buf: out.append((path, line, "\n".join(buf)))
    return [h for h in out if h[0] and h[2].strip()]

def judge(texts, rule):
    req = urllib.request.Request("https://classifier.dev/v1/classify",
        data=json.dumps({"labels": LABELS, "instructions": rule,
                         "inputs": [t[:32000] for t in texts]}).encode(),
        headers={"content-type": "application/json", "user-agent": "ci-lint/1"})
    return json.load(urllib.request.urlopen(req))["results"]

chunks = hunks(open(sys.argv[1], encoding="utf-8").read())
texts = [f"{p}:{n}\n{t}" for p, n, t in chunks]   # whole hunk, with its path
found = []
for name, rule in CONVENTIONS:
    for (p, n, _), r in zip(chunks, judge(texts, rule) if texts else []):
        if r["label"] == BREAKS and (r["confidence"] or 0) >= NOTE_AT:
            found.append((p, n, name, r["confidence"]))
for p, n, name, c in found:
    print(f"{'BREAKS' if c >= COMMENT_AT else 'unsure'}  {name:8} {p}:{n}  {c}")
sure = [f for f in found if f[3] >= COMMENT_AT]
if sure:
    with open("comment.md", "w") as f:
        f.write("Convention check\n\n")
        for p, n, name, c in sure:
            f.write(f"- `{p}` line {n}: breaks the **{name}** convention ({c})\n")
```

On a diff that logs a person's details and swallows a refund failure:

    BREAKS  logging  src/api/orders.ts:42  1
    BREAKS  errors   src/api/orders.ts:61  1

Against this repository's last three commits, 46 hunks and two conventions, it
printed nothing.

## The workflow

```yaml
name: conventions
on: pull_request
permissions:
  contents: read
  pull-requests: write
jobs:
  conventions:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - name: hunks
        run: git diff -U0 ${{ github.event.pull_request.base.sha }}...HEAD > diff.txt
      - name: judge
        run: python3 .github/semantic-lint.py diff.txt | tee -a $GITHUB_STEP_SUMMARY
      - name: comment
        if: hashFiles('comment.md') != ''
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: gh pr comment ${{ github.event.pull_request.number }} --body-file comment.md
```

`fetch-depth: 0` is required or the base commit is missing from the clone. The
job never fails the build; an advisory job stays switched on.

## Thresholds

Comment at 0.9 and above, where answers were right 82 to 92% of the time. Put
findings between 0.5 and 0.9 in the job summary, where they cost nobody a
notification. Below 0.5, say nothing. A bot that is wrong twice gets muted, so
the threshold guards the job more than the diff.

Latency is free in CI, so `"tier": "smart"` is worth it: it re-asks answers
under 0.7 of a reasoning model. Six hunks took 1.8 seconds with one
escalation, against about 110ms on `fast`.

## Pitfalls

- **Send the whole hunk, added lines only.** One changed line scored 0.57
  where the hunk with its path scored 1.0; unchanged context drags the verdict
  towards the old code.
- **Write each convention as one sentence naming the wrong thing.** Vague
  rules ("keep it clean") produce vague scores.
- **Count your classifications.** Hunks times conventions is the bill: 46
  hunks and two conventions is 92, against a limit of 3,000 a minute.

## When not to use this

Skip conventions a real linter already enforces; eslint and ruff are exact and
free. Skip generated files and vendored directories. Where a wrong comment on
a pull request costs more than the convention is worth, write to the job
summary and drop the comment step.
