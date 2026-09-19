---
name: soc-alert-triage
description: Rank a SIEM or EDR alert queue before a human opens it. Scores each alert likely true positive or likely false positive from its own fields — rule, process, command line, parent, user — with a calibrated confidence, so the sure ones disposition themselves and an analyst starts at the top of the rest. Defensive triage only. Use on "which of these are worth opening", "tune out the noise", "rank the queue".
license: MIT
---

# Triage an alert queue before anyone opens it

Noise is usually obvious from the alert record alone: a service installed by
`msiexec.exe` as SYSTEM is a package installer; the same rule on a service
pointing into a public directory is not. `classifier.dev` scores that over a
whole queue in one call, no key. It orders work for a defender; it closes
nothing, touches no host.

## When not to use it

- As the detection itself. It reads the alert record, not telemetry.
- When the answer needs context the record lacks — asset criticality, the
  change ticket, what the parent did an hour ago. Enrich first, classify after.
- On fewer than about twenty alerts. Read them.

## 1. Flatten each alert

One line per alert, same fields in the same order every time. Stable order is
what makes scores comparable across a queue.

    rule=NAME | proc=IMAGE | cmd=COMMAND LINE | parent=PARENT IMAGE | user=ACCOUNT

Send no host names or addresses unless the rule needs one.

Smoke-test one line with the GET form, which answers the bare label (add
`--data-urlencode "verbose=1"` for JSON with scores):

```
curl -s -G https://classifier.dev/ \
  --data-urlencode "labels=likely true positive,likely false positive" \
  --data-urlencode "text=rule=Encoded PowerShell | proc=powershell.exe | cmd=powershell -nop -w hidden -enc BASE64BLOB | parent=winword.exe | user=acct-temp3"
likely true positive
```

## 2. Two labels, not three

The obvious label set is true positive / false positive / needs analyst. Skip
it: a third label takes probability from both sides, so sure answers stop being
sure. On the six alerts below, adding `needs analyst` pulled every answer under
0.9 — the top fell from 0.95 to 0.86 — leaving nothing to act on. *Needs
analyst* is a band, not a label.

## 3. One call

`alerts.json`, up to 1,000 alerts a call:

```
{
  "labels": ["likely true positive", "likely false positive"],
  "instructions": "Each input is one alert: rule, process, command line, parent process and user. Judge only those fields. A false positive is a pattern that is routine for that parent and that user on a managed corporate workstation.",
  "inputs": [
    "rule=Encoded PowerShell | proc=powershell.exe | cmd=powershell -nop -w hidden -enc BASE64BLOB | parent=winword.exe | user=acct-temp3",
    "rule=Encoded PowerShell | proc=powershell.exe | cmd=powershell -ExecutionPolicy Bypass -File C:/ProgramData/SCCM/inventory.ps1 | parent=ccmexec.exe | user=SYSTEM",
    "rule=Service installed from user path | proc=sc.exe | cmd=sc create Updater binPath= C:/Users/Public/u.exe start= auto | parent=cmd.exe | user=bkowalski",
    "rule=Service installed from user path | proc=sc.exe | cmd=sc create GoogleUpdaterService binPath= C:/Program Files/Google/GoogleUpdater.exe start= demand | parent=msiexec.exe | user=SYSTEM",
    "rule=LSASS handle access | proc=procdump64.exe | cmd=procdump -ma lsass.exe out.dmp | parent=cmd.exe | user=helpdesk-jm",
    "rule=Mass file copy | proc=rclone.exe | cmd=rclone copy C:/Finance remote:backup --transfers 32 | parent=powershell.exe | user=svc-backup"
  ]
}
```

```
curl -s https://classifier.dev/v1/classify -H 'content-type: application/json' --data @alerts.json \
  | jq -r '.results | to_entries | sort_by(-.value.confidence)[] | "\(.value.confidence)  \(.value.label)  alert \(.key)"'
```

Output:

```
0.95  likely false positive  alert 3
0.92  likely true positive  alert 0
0.92  likely false positive  alert 1
0.85  likely true positive  alert 2
0.55  likely false positive  alert 5
0.14  likely true positive  alert 4
```

## 4. The bands

Confidence is calibrated: measured, answers at or above 0.9 were right 82 to
92% of the time; answers under 0.5, 29 to 64%.

- **0.9 and up — act.** False positives to a suppressed bucket, true positives
  promoted to a case. Read a 2% sample of the suppressed bucket weekly; that
  sample is how you learn the gate has drifted.
- **0.5 to 0.9 — analyst queue**, lowest confidence opened first. Alerts 2 and
  5 sit here, and alert 5 — `rclone` copying a finance directory to a remote
  target — is the one to open first.
- **Below 0.5 — escalate.** Alert 4 at 0.14: `procdump` against `lsass.exe`
  from a help desk account, and the model is guessing. Re-ask it with
  `"tier": "smart"` and put it at the top of the queue.

Confidence says whether the label is right, not whether the alert is serious;
weight by asset criticality yourself.

## 5. The weekly loop

Each week, write the verdicts analysts closed into `instructions` as
closed-case history. Nothing is retrained, no rule is edited; a sentence or two
of ground truth is the update.

```
jq '.instructions += " Closed cases from the last four weeks: rclone or another cloud-sync tool reaching a remote target from a backup service account was a true positive twice; procdump run by a helpdesk account during a ticketed session was closed as a false positive four times."' alerts.json > alerts-week2.json
```

Alerts 4 and 5, re-run with that sentence appended:

```
0.99  likely false positive  alert 4
0.91  likely true positive  alert 5
```

Both left the analyst band, in opposite directions. Keep `instructions` under
about six sentences — past that it reads as a policy document and the effect
flattens — and keep last week's file to diff the bands against.

## What done looks like

Every alert has a label, a confidence and a band: the 0.9 band dispositioned,
the middle band a ranked queue with the below-0.5 alerts on top, and last
week's instructions file next to this week's.
