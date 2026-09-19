---
name: context-compaction-keep-or-drop
description: Label each context chunk keep, drop or replace-with-a-pointer and pass the survivors through byte for byte instead of summarising, with key-shaped chunks decided locally and never sent, and a checksum row per chunk. Use when a session runs out of room, or on "compact" or "trim the history".
license: MIT
---

# Compact by deciding, not by summarising

A summary rewrites the one line you needed into a sentence about it. Label
each chunk instead and pass the keepers through unchanged: verbatim in,
verbatim out.

## What leaves the machine

Never the transcript. Per chunk, a header line and at most its first 2,000
characters, redacted, and only if it passes a local rule:

- **Decided here, never sent.** A chunk holding bearer text, a key, token,
  secret or password word, an armoured block or NAME=value lines is labelled
  by rule: kept if it is part of the live step, dropped if not, as `local`.
- **Redacted, then sent.** The rest has bearer headers, fields named for a
  key, token, secret or password, runs of 40 characters or more and mail
  addresses replaced by a placeholder. Past two placeholders it falls back to
  the rule above.

      in   curl -H 'authorization: Bearer tok_9f2a7c31d4' https://api.example.com/charges
      out  curl -H 'authorization: Bearer [redacted]' https://api.example.com/charges

The service states that it stores no input text, and forwards it to the model
provider that answers: https://classifier.dev/privacy. Read that against your
policy. **If the transcript is confidential, put none of it on a
network**: ask the agent's own model the same three labels with the same
thresholds. Only who answers changes.

## Chunk, classify, ledger

A chunk is one tool result, message or file read, with a header naming it and
how to fetch it again. Every chunk gets a ledger row, and the assertion
fails if one is lost.

```python
import hashlib, json, re, urllib.request

LABELS = ["keep in context, the current task needs the exact text",
          "drop, it is noise or already superseded",
          "replace with a pointer, it can be fetched again if needed"]
KEEP, DROP, POINTER = LABELS

SENSITIVE = re.compile(r"\b(bearer|api[_-]?key|token|secret|password)\b"
                       r"|-{5}BEGIN|^[A-Z_]{3,}=\S+$", re.I | re.M)
REDACT = [(re.compile(r"\b(bearer|basic)\s+[^\s'\"]+", re.I), r"\1 [redacted]"),
          (re.compile(r"([\w.-]*(?:key|token|secret|password)[\w.-]*)\s*[=:]\s*\S+", re.I), r"\1=[redacted]"),
          (re.compile(r"\b[A-Za-z0-9_-]{40,}\b"), "[redacted]"),
          (re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.]+\b"), "[redacted]")]

digest = lambda t: hashlib.sha256(t.encode("utf-8")).hexdigest()[:12]

def local(chunk):                    # decided here, never sent
    t = chunk["head"]
    for rx, to in REDACT: t = rx.sub(to, t)
    if SENSITIVE.search(chunk["head"]) or t.count("[redacted]") > 2:
        return (KEEP if chunk["live"] else DROP), t
    return None, t

def classify(texts, task):
    body = json.dumps({"labels": LABELS, "inputs": [t[:2000] for t in texts],
        "instructions": f"The current task is: {task}. Judge each chunk only "
                        "by whether its exact text is needed to finish it."}).encode()
    req = urllib.request.Request("https://classifier.dev/v1/classify", data=body,
        headers={"content-type": "application/json", "user-agent": "compact/1"})
    return json.load(urllib.request.urlopen(req))["results"]

def compact(chunks, task):
    held = [local(c) for c in chunks]
    send = [i for i, (v, _) in enumerate(held) if v is None]
    got = dict(zip(send, classify([held[i][1] for i in send], task) if send else []))
    kept, ledger = [], []
    for i, (c, (v, _)) in enumerate(zip(chunks, held)):
        score = "local"
        if v is None:
            s = got[i]["scores"]
            v = DROP if s[DROP] >= 0.9 else POINTER if s[POINTER] >= 0.5 else KEEP
            score = s[v]                                # unsure keeps
        ledger.append({"id": c["id"], "sha": digest(c["text"]), "score": score,
                       "verdict": v.split(",")[0], "refetch": c["refetch"]})
        if v == KEEP: kept.append(c["text"])        # verbatim, not rewritten
        elif v == POINTER:
            kept.append(f"[{c['id']} {digest(c['text'])} refetch: {c['refetch']}]")
    assert len(ledger) == len(chunks)
    return kept, ledger
```

Four of ten rows, task "fix a double charge in the retry path":

    Bash#14      e8428025c464  drop                    0.9
    Bash#19      0652466c0d6d  keep in context         local
    Grep#8       a09ee1f0a8ae  replace with a pointer  0.62
    Read#7       7ddbe075eee8  drop                    local
    10 chunks in, 8 sent, 6 kept

`Bash#19` was a worker environment block, `Read#7` a scratch file with a
bearer header: both decided by rule, neither left the machine.

## Two thresholds, deliberately different

The classifier returns labels, scores and a calibrated confidence, and writes
nothing. The usual rule is act at 0.9 and above, look again from 0.5 to 0.9,
escalate below. Here the reversible and irreversible outcomes get different
bars: **drop at 0.9 and above only**, since dropping is the one move you
cannot undo from inside the session; **pointer at 0.5 and above**, since it
keeps the id, checksum and refetch command; **the rest is kept**. Threshold on
`scores[label]`, not `confidence`, which is the top label's.

## Pitfalls

- **Name the labels in full.** Shortened to `keep` and `drop`, these chunks
  scored an install log 0 to drop where the full ones gave 0.9.
- **Non-language chunks come back unsure**: a minified bundle and a hash
  scored under 0.4 on every label and were kept; give each a header.

## When not to use

Skip it when you are not near the limit, when the harness already compacts, or
when everything in context is cheap to refetch. If losing anything is
unacceptable, use the pointer and keep verdicts only.
