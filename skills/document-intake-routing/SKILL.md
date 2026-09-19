---
name: document-intake-routing
description: Label each page of an intake packet with a document type and a page role before extraction runs, so only confident pages reach an extractor and the rest reach a person. Use when a mailroom, loan file, claim packet or vendor upload arrives as one long PDF. Triggers on "route these scanned forms", "which form type is each page", "split this intake packet", "sort these scans by form type".
license: MIT
---

# Route an intake packet page by page

A packet is one PDF holding several documents: a cover sheet, two forms, a pile
of attachments, some blank backs. Extraction fails on it because it is pointed
at the wrong page. Classify pages first, then extract what you are sure of.
The classifier below is `classifier.dev`: keyless HTTP, a label per page, a
calibrated confidence, no generated text.

## What leaves the machine

Each request carries page text and your label names: no file, no image, no
file name. The service states it stores no input text and forwards it to the model
that answers (https://classifier.dev/privacy) — still a third party, and page
one of a tax or loan packet is where the name, SSN and account number sit.
Redact first, every time:

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

def sendable(t):                     # never send a mostly-redacted page
    kept = len(re.sub(r"<[A-Z]+>", "", redact(t)))
    return kept >= 25 and kept >= 0.5 * len(t)
```

On a filled page:

```
Name as shown on your income tax return: Jane Q. Public. Social security
number <SSN>. Account <CARD>. Email <EMAIL> W-9 Request for Taxpayer Form ...
```

That page classified the same either way: type 1.00 raw and 1.00 redacted, role
0.97 against 0.91. Redaction costs almost nothing. It catches shapes, not names:
`Jane Q. Public` survives it.

## When not to use it

If these packets are confidential under the policy you work under, do not call
out at all. The workflow is a classifier plus two thresholds, and anything
giving a calibrated confidence fits: your own model over the same labels, or a
local zero-shot model. `classifier.dev` is the keyless example because it needs
no setup. Same steps, other call, no network.

Skip it too for a one-document PDF you already know, for pulling fields out
(extraction, not classification), and for image-only scans: OCR first, since a
page with no text layer classifies as nothing.

## Step 1: one text per page

    pip install pdfplumber==0.11.4

```python
import pdfplumber
with pdfplumber.open("packet.pdf") as pdf:
    raw = [" ".join((p.extract_text() or "").split()) for p in pdf.pages]
pages = [(i, redact(t[:1200])) for i, t in enumerate(raw, 1) if sendable(t)]
```

1,200 characters is enough. `pdftotext -f N -l N packet.pdf -` does the same in
the shell. Empty pages drop out here: a whitespace-only input fails the whole
batch with `empty_input`.

## Step 2: two passes over the same pages

One question per pass: a combined set ("W-9 instructions page") multiplies the
labels and splits the probability mass.

```python
import json, urllib.request
FORMS = ["IRS Form W-9 request for taxpayer identification number",
         "IRS Form W-4 employee withholding certificate", "commercial invoice",
         "bank statement", "none of these"]
ROLES = ["cover or transmittal page", "filled form page with input fields",
         "instructions or attachment page", "blank or nearly empty page"]

def classify(labels, instructions=""):
    body = {"labels": labels, "inputs": [t for _, t in pages],
            "instructions": instructions}
    req = urllib.request.Request("https://classifier.dev/v1/classify",
        json.dumps(body).encode(),
        {"content-type": "application/json", "user-agent": "intake/1.0"})
    return json.load(urllib.request.urlopen(req))["results"]

forms = classify(FORMS, "Identify this page's document type.")
roles = classify(ROLES)
```

One request per pass, up to 1,000 pages each; tens of types is normal, 100 is
the ceiling. Set a `user-agent`: Python's default is blocked at the edge.

Name the document, not your code for it: the same 11 pages against
`DOC_TYPE_01 ... DOC_TYPE_06, OTHER` all came back `DOC_TYPE_01`, at 0.47, 0.34,
0.30, 0.26 — one bucket, nothing usable. Carry `none of these` too, since every
call returns one of your labels; unrelated prose against five types picked it
at 0.94.

## Step 3: the gate

- **0.9 and above** — route to the extractor for that type.
- **0.5 to 0.9** — extract, but queue for review, or re-ask with
  `"tier": "smart"`, which re-runs answers under 0.7 on a reasoning model.
- **below 0.5**, or `confidence: null` (an `unscored` page has no language) —
  do not extract; send the page to a person.

## A worked run

`fw9.pdf` (6 pp) and `fw4.pdf` (5 pp) from `irs.gov/pub/irs-pdf/`, redacted,
both passes over 11 pages, 240 ms and 184 ms (types cut short):

```
fw9.pdf p1  W-9 1.00 | cover or transmittal page          0.37
fw9.pdf p2  W-9 1.00 | instructions or attachment page    0.98
fw4.pdf p1  W-4 1.00 | filled form page with input fields 0.49
```

Every type came back at 0.98 or above. The roles are the interesting column:
both first pages sit at 0.37 and 0.49, because a form page that is also the
front of a document is genuinely both. Those two go to a person, found without
reading the packet.

## Done looks like

Every page was redacted first and carries a type, a role and two confidences;
pages group into documents by runs of one type; the extractor sees only what is
above 0.9, a person the rest.
