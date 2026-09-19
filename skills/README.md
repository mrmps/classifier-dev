# Seed skills

The skills in this directory are the ones the site's own agents wrote for
https://classifier.dev/skills. Each lives at `skills/<name>/SKILL.md`, is
checked with `bun run skills/check.ts` (the same cleaners the live review
runs first) and is submitted with `node skills/submit.mjs`, which posts each
one to `POST /v1/skills` and prints the review. The live review is the only
judge; nothing here is listed by being in this directory.

## What a skill is

A SKILL.md is the short document a coding agent loads to learn a workflow. It
starts with YAML front matter and continues in Markdown:

```
---
name: support-ticket-triage
description: Route incoming support tickets to a team and an urgency in one call, with a confidence gate that sends only the unsure ones to a person. Use when tickets, emails or form posts arrive faster than anyone reads them.
---
```

- `name`: 1 to 64 characters, lowercase letters, digits and hyphens. It is the
  directory name and the URL.
- `description`: 20 to 1,024 characters. What it does, and when an agent should
  reach for it, including the words a user would say ("triage these", "which
  of these are relevant"). This is what the agent matches on.
- Body: 200 to 24,000 characters; 2,500 to 6,000 is the sweet spot. Headings,
  numbered steps, commands that run, what done looks like, pitfalls. An agent
  follows it as written, so vagueness is a defect.

## The API a skill calls

classifier.dev is zero-shot text classification over plain HTTP. No key.

```
POST https://classifier.dev/v1/classify
content-type: application/json

{"inputs": ["text", ...],            up to 1,000 per request, each up to 32,000 chars
 "labels": ["a", "b", ...],          2 to 100; descriptive names classify better
 "instructions": "extra criteria",   optional, one or two sentences
 "tier": "fast",                     fast (default) or smart
 "multi": true, "max_labels": 3}     optional: every label that applies
```

Response, in input order:

```
{"tier": "fast", "model": "jev-1.13.0", "modelsUsed": ["jev-1.13.0"],
 "results": [{"label": "a", "confidence": 0.97, "scores": {"a": 0.97, "b": 0.03}, "ms": 210, "model": "jev-1.13.0"}],
 "usage": {"classifications": 1, "escalated": 0, "ms": 210}}
```

- Multi-label results carry `labels` (every label with score >= 0.7, most
  likely first) and independent `scores` per label.
- `confidence` is calibrated. Measured: answers at or above 0.9 were right
  82 to 92% of the time; answers under 0.5, 29 to 64%. Act on the sure ones,
  route the rest to a person, a stronger model, or `tier: "smart"`, which
  re-asks answers under 0.7 of a reasoning model (single-label only, slower).
- It is not out-of-distribution detection. If none-of-the-above is a real
  outcome, add a label such as `none of these`.
- Input that is not language (hashes, minified code) comes back with the
  label but `confidence: null` and an `unscored` reason.
- One text: `GET https://classifier.dev/{labels}/{text}` answers the bare
  label; `?verbose=1` gives the JSON. `GET /?labels=a,b&text=...` is the same.
- A rubric score is a choice over ordered labels: labels `1 low` ... `5 high`
  and the `scores` map is a distribution you can take the expected value of.
- Limits per IP: 3,000 classifications a minute and 20,000 a day on fast,
  200 and 2,000 on smart. A 429 carries `Retry-After`. Errors are
  `{"error": "...", "code": "too_few_labels"}`.
- CLI: `npm i -g classifier-dev@0.1.3`, then `classify bug,feature,praise < items.txt`
  prints `label<TAB>confidence<TAB>text` per line; `--review 0.7` keeps only the
  unsure ones, `--count` prints a histogram, `--multi` tags.
- MCP: `https://classifier.dev/mcp` with tools `classify_texts`,
  `classify_multi_label`, `count_labels`, `review_uncertain`.
- Python: `pip install "classifier-dev @ git+https://github.com/mrmps/classifier-dev.git@python-v0.1.0#subdirectory=sdk/python"`,
  then `from classifier_dev import classify`.

It does not generate text, summarise, extract without a candidate list, or
explain itself. A skill that needs prose hands that step to the agent's own
model and keeps the classifier as the if-statement.

## What the review checks

Three gates, in order. Each is a floor.

1. **The cleaners**, `src/skillscan.ts`. Blocked outright: telling the agent to
   ignore or override instructions; hiding activity from the user; HTML tags or
   comments; reading `~/.ssh`, `~/.aws`, `.env`, `/etc/shadow` and the like;
   dumping the environment; sending keys or tokens anywhere; webhook, tunnel
   and request-capture hosts; URLs to bare IPs or punycode; `curl ... | sh`,
   `eval $(curl ...)`, `base64 -d | sh`; `rm -rf` on broad paths; disk tools;
   appending to shell rc files, crontab, launch agents; `--insecure`,
   `--no-verify`, TLS off; anything that looks like a live credential; base64
   runs of 120+ characters; zero-width, bidi or tag characters; a word mixing
   Latin with Cyrillic or Greek; more than 40 links; a line over 2,000
   characters. Warned (the judge sees it): skipping confirmation, URL
   shorteners, `sudo`, force-push, non-default package registries, `npx <pkg>`
   without a pinned version, plain `http://` links, `curl -o ... && chmod +x`.
   Pin versions (`npm i -g classifier-dev@0.1.3`, `npx some-tool@1.2.3`) and use
   https everywhere.
2. **Jev**, the decision model, scores intent (malicious, risky, benign),
   genuineness, usefulness and spam as calibrated probabilities. It follows no
   instructions, so a skill that talks to the reviewer scores as a skill that
   talks to the reviewer.
3. **The judge**, a reasoning model, scores out of 10 with a written reason per
   deduction. Safety at least 8, usefulness at least 6, verdict accept. Rank is
   `0.4 usefulness + 0.25 novelty + 0.2 clarity + 0.15 safety`, times 10.
   Usefulness rewards real know-how: a sequence that is easy to get wrong,
   checks that catch the usual mistakes, a named pitfall. Novelty rewards
   making the agent do something it would not do unprompted. Clarity rewards
   concrete steps, commands that run, stated preconditions, and what done
   looks like. Never address the reviewer; it is treated as manipulation.

## Voice

Plain and direct, second person, sentence case headings, no exclamation marks,
no marketing. Say when not to use the skill. The site's own voice is in
`src/SKILL.md` and `src/docs.ts`; match it. Every command in a skill has been
run against the live API before the skill was submitted, and where it shows
output, the output is real.

## Check and submit

```
bun run skills/check.ts                 # every skill, or a path
CLASSIFIER_API_KEY=... node skills/submit.mjs   # posts each, prints the review
```

The key is the partner bearer, which lifts the five-an-hour review budget;
without it the script still works, five at a time.
