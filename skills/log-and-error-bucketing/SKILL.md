---
name: log-and-error-bucketing
description: Turn a stream of log lines or error messages into a histogram of causes — timeouts, auth, quota, bad input, upstream, unknown — by deduplicating to templates, redacting, and classifying one exemplar each, so a million lines cost a few hundred calls. Use when an incident dump, CI log or error table is too big to read. Triggers on "what is failing here", "bucket these errors", "group these exceptions", "top causes".
license: MIT
---

# Bucket a log stream by cause

A log is mostly the same twenty lines with different numbers in them. Read it by
collapsing it to those twenty, labelling each by cause and weighting them by how
often they occurred. The labelling step below is `classifier.dev`: keyless HTTP,
your bucket names, a calibrated confidence, no text generated.

## What leaves the machine

Log lines carry tokens, emails and account numbers. One redacted line per
template goes out, nothing else: no file, no host name, no context.

```python
import re
PATTERNS = [(r"(?i)\b(?:bearer|basic)\s+[\w.\-+/=]{8,}", "<CRED>"),
    (r"(?i)\b[\w.-]*(?:key|token|secret|password|pwd)[\w.-]*\s*[=:]\s*[^\s\"',&]{6,}", "<CRED>"),
    (r"\b[A-Za-z0-9+/]{32,}={0,2}\b", "<BLOB>"), (r"\b[0-9a-f]{16,}\b", "<BLOB>"),
    (r"[\w.+-]+@[\w-]+\.[\w.]{2,}", "<EMAIL>"), (r"\b(?:\d[ -]?){13,16}\b", "<CARD>"),
    (r"\b\d{3}-\d{2}-\d{4}\b", "<SSN>"), (r"\b\d{7,}\b", "<NUM>")]

def redact(t):
    for p, tag in PATTERNS:
        t = re.sub(p, tag, t)
    return t

def sendable(t):                      # never send a mostly-redacted line
    kept = len(re.sub(r"<[A-Z]+>", "", redact(t)))
    return kept >= 25 and kept >= 0.5 * len(t)
```

Two lines through it, classified:

```
ERROR [api] auth failed: authorization: <CRED> upstream returned 401
   -> authentication or permission denied   1.00
WARN retry: <CRED> quota exhausted for project <NUM>
   -> quota or rate limit exceeded          1.00
```

The credential and the project id are gone; the cause still reads at 1.00. A
line that is mostly placeholders afterwards is one nobody could bucket, so
`sendable` keeps it at home.

## When not to use it

If the logs may not leave the building, keep the workflow and change the
classifier: the shape is dedupe, label, weight, gate, and anything returning a
calibrated confidence fits — your own model over the same bucket names, or a
local zero-shot model. `classifier.dev` is the keyless example because it needs
no account; it states that it stores no input text and passes it to the model
that answers (https://classifier.dev/privacy).

Skip it as well for logs that already carry an error code (group by the code,
free and exact), for triage you can read in a second, and for finding one rare
line: this counts what is common.

## Step 1: collapse to templates, keep the counts

```python
import collections
def norm(line):
    s = re.sub(r"\b\d{1,3}(\.\d{1,3}){3}(:\d+)?", "<ip>", line)
    s = re.sub(r"\b[0-9a-f]{8,}\b", "<hex>", s)
    s = re.sub(r"\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b", "<day>", s)
    return " ".join(re.sub(r"\d+", "<n>", s).split())

groups = collections.OrderedDict()
for line in lines:                    # ERROR and WARN only
    groups.setdefault(norm(line), []).append(line)
exemplars = [redact(v[0]) for v in groups.values() if sendable(v[0])]
```

Send the first real line of each group, redacted, not the masked template:
`<n>` and `<ip>` read less like language than the line they came from.

On 1,926 error and warning lines from the public loghub samples (ZooKeeper,
OpenStack, Apache) this gave **21 templates**: one classification per 92 lines.
The weekday mask earns its place — without it the same Apache error from a
Sunday and a Monday are two templates, and the list is 25.

## Step 2: name the buckets, then classify

POST the exemplars as `inputs`, your bucket names as `labels`, the sentence
below as `instructions`; 21 templates came back in 268 ms. The CLI does it too,
fetched at a pinned version and left uninstalled:

```
L='timed out waiting for something,authentication or permission denied,quota or rate limit exceeded,bad or malformed input from the caller,an upstream or dependent service failed,resource exhausted: memory disk or connections,unknown or other'
npx --yes classifier-dev@0.1.3 "$L" -i "Bucket the log line by the underlying cause of the failure it reports." --count < redacted.txt
```

That is one vote per template: 17 of the 21 landed in `unknown or other`. CLI
labels are comma-separated, so no label may contain a comma.

## Step 3: read the shape

Weighted by group size, those seven buckets put 1,805 of the 1,926 lines in
`unknown or other`, mostly at 0.4 to 0.7 confidence. That is not a broken model:
**a fat `unknown` bucket at middling confidence means your labels are missing a
cause.** These lines were peer churn and worker lifecycle. Add two labels, rerun the
same 21:

```
   1138  a worker or child process started, exited or restarted
    711  a network connection to a peer dropped or was reset
     41  unknown or other
     32  authentication or permission denied
      3  an upstream or dependent service failed
```

`unknown` fell from 1,805 lines to 41, in 254 ms. Four of the 21 templates are
still under 0.5: read those yourself.

## Step 4: the gates

- **0.9 and above** — file the template under that cause.
- **0.5 to 0.9** — file it, but show the exemplar in the report, or re-ask on
  `--smart` (`"tier": "smart"`).
- **below 0.5** — leave it in `unknown`; `--review 0.5` prints those rows.
- **`confidence: null` with an `unscored` reason** — no comparable provider
  score is available, so leave the row for review. Scores do not validate the
  input: include `noise or separator` and `unknown or other` when those inputs
  are possible.

## Done looks like

A table of causes with line counts, each traceable to a template and a redacted
line; the sub-0.5 and unscored rows listed apart.
