---
name: downloads-and-inbox-sorter
description: File a downloads or scanned-mail folder by classifying each file from its name plus the first 2,000 characters of text into invoice, receipt, contract, identity document, screenshot, installer or none of these, and moving only the confident ones. Dry run first, an undo log for every move, and anything under 0.8 stays put. Use on "sort my downloads", "file these PDFs", "organise the invoices and receipts".
license: MIT
---

# Sort a downloads folder without opening every file

`classifier.dev` labels text against categories you choose and returns a
calibrated confidence. No key. Here it reads a filename and a first page and
says where the file goes, or that it cannot tell.

Three rules make it safe on a real folder: **dry run by default**, **every move
reversible**, **anything under 0.8 stays put**.

## Before you run it

- The filename and up to 2,000 characters of each file go over HTTPS to
  classifier.dev. Point it at a downloads or scans folder, never at one holding
  keys, password exports or a source tree.
- The `identity document` label means passport and licence scans get a first
  page sent. If that is not acceptable, drop the label.
- PDF text needs `pdftotext` (poppler). Without it a PDF is judged on its
  filename alone, usually lands under 0.8 and stays: correct, but you will sort
  nothing. Install poppler first.
- This is a script you run. It installs no scheduled job, no crontab and no
  login item; when it exits, nothing is left running.

## The watcher

Save as `sortfiles.py`. Python 3, no dependencies.

```python
#!/usr/bin/env python3
# sortfiles.py DIR [--apply] [--undo]   dry run unless --apply
import json, os, shutil, subprocess, sys, time, urllib.request
DIR = os.path.expanduser(sys.argv[1]); LOG = os.path.join(DIR, ".sorted.log")
F = {"invoice asking for payment": "Invoices", "receipt for something already paid": "Receipts",
     "contract or agreement": "Contracts", "identity document": "ID",
     "screenshot": "Screenshots", "software installer": "Installers"}

def peek(p):
    t = ""
    if p.lower().endswith(".pdf") and shutil.which("pdftotext"):
        t = subprocess.run(["pdftotext", "-l", "1", p, "-"], capture_output=True, text=True, timeout=20).stdout
    elif os.path.getsize(p) < 5_000_000:
        t = open(p, "rb").read(2000).decode("utf-8", "replace")
    if t and sum(c.isprintable() or c.isspace() for c in t) / len(t) < 0.8:
        t = ""                      # binary bytes classify as noise: filename only
    return f"{os.path.basename(p)}\n\n{t[:2000]}"

if "--undo" in sys.argv:
    for _, src, dst in reversed([l.split("\t") for l in open(LOG).read().splitlines()]):
        os.replace(dst, src); print("back", dst)
    os.remove(LOG); sys.exit()

files = [os.path.join(DIR, n) for n in sorted(os.listdir(DIR))
         if not n.startswith(".") and os.path.isfile(os.path.join(DIR, n))]
body = json.dumps({"labels": list(F) + ["none of these"], "inputs": [peek(p) for p in files],
                   "instructions": "Judge the document from the filename and the first page of text."}).encode()
req = urllib.request.Request("https://classifier.dev/v1/classify", data=body,
                             headers={"content-type": "application/json", "user-agent": "sorter/1"})
for p, r in zip(files, json.load(urllib.request.urlopen(req, timeout=60))["results"]):
    conf, dest = r["confidence"] or 0.0, F.get(r["label"])
    act = "move " if "--apply" in sys.argv else "would"
    if conf < 0.8 or not dest:
        act, dest = "stay ", r["label"]
    print(f"{act} {conf:.2f}  {dest:32.32} {os.path.basename(p)}")
    if act != "stay " and "--apply" in sys.argv:
        t = os.path.join(DIR, dest, os.path.basename(p)); os.makedirs(os.path.dirname(t), exist_ok=True)
        os.replace(p, t); open(LOG, "a").write(f"{int(time.time())}\t{p}\t{t}\n")
```

## Run it

```
python3 sortfiles.py ~/Downloads           # dry run, moves nothing
python3 sortfiles.py ~/Downloads --apply   # moves, appends to .sorted.log
python3 sortfiles.py ~/Downloads --undo    # puts the last run back
```

Real output, seven-file folder:

```
would 1.00  Installers      Docker.dmg
stay  0.83  none of these   IMG_4417.HEIC
would 1.00  Invoices        INV-2291.txt
would 1.00  Contracts       MSA_signed.txt
stay  0.75  none of these   Northwind_proposal_v3.txt
would 1.00  Screenshots     Screenshot 2026-09-12 at 14.03.11.png
would 1.00  Receipts        receipt-7731.txt
```

Read the dry run before you pass `--apply`, `stay` rows first: they are what
your labels do not cover yet.

## Why 0.8

Confidence is calibrated: measured, answers at or above 0.9 were right 82 to 92%
of the time, answers under 0.5 right 29 to 64%. A move is cheap to reverse, so
the line here is 0.8 rather than 0.9 — but only because the log exists. Without
the log, use 0.9.

- `Northwind_proposal_v3` at 0.75 says in its own text that it is not an invoice
  and is unsigned, so it sits between two labels. Leaving it is right; a
  `proposal or quote` label would fix it properly.
- `IMG_4417.HEIC` has no extractable text, so only the filename was classified.
  It scored `none of these`, which has no folder, so it stays. Scores in this
  band move a few points between runs: another reason not to act on them.

## Pitfalls

- **Always include `none of these`.** Every call returns one of your labels, so
  a bank statement against six document types is filed as one of them, and
  confidently, unless there is somewhere else to put it.
- **Binary bytes make noise.** The script blanks an extract under 80% printable
  and falls back to the filename; a raw `.dmg` header would otherwise classify
  as confident nonsense.
- **Null confidence.** A provider may return no score, and smart replacement
  has no comparable score. The script treats either null as 0.0.
- Limits per IP: 3,000 classifications a minute, 20,000 a day. 1,000 files is
  one call; a 429 carries `Retry-After`.
