# Changelog

All notable changes to the `classify` CLI. Semver; the API it talks to is
versioned separately at https://classifier.dev.

## Unreleased

- Public smart batches are capped at 200 inputs and run through one worker;
  partner-key smart calls keep the configured batch size and concurrency.
- `CLASSIFY_BATCH` rejects values outside 1–1,000 instead of creating invalid batches.

## 0.1.2 — 2026-09-19

- A daily quota error exits immediately with the API's explanation instead of
  sleeping for 24 hours. Minute limits still retry after the server's delay.
- After the last failed attempt, the error is reported immediately instead of
  silently waiting through one more retry delay.
- Once the first line identifies NDJSON, malformed later lines fail before any
  request is sent; they no longer turn the whole file into plain text and lose
  the selected fields and IDs.
- An empty pipe on stdin prints nothing and exits 0, instead of the help text
  on stdout with exit 2: `grep ... | classify a,b | sort` stays empty when the
  grep matched nothing. The help still appears when stdin is a terminal.
- stdout is left to drain before the process ends, so `| head -c` and CI
  runners with small pipes see the whole output rather than a truncated one.

## 0.1.1 — 2026-09-19

- `--max` without `--multi` printed `undefined` and `NaN`: the API reads
  `max_labels` as multi-label, so `--max` now implies `--multi`. `--max` also
  rejects `0`, negatives, fractions and words instead of ignoring them.
- An API answer with fewer results than inputs, no results, or the wrong shape
  is an error (exit 1) instead of silently fewer rows.
- `--review` now applies to `--count` and to a single positional text; before
  it was silently ignored in both. `--multi` on a single text prints labels
  comma-joined, like every other row.
- A missing confidence prints `-`, not `NaN`, and `--review` keeps it.
- Retries say why and how long on stderr (only rate limits did). A timed-out
  request is retried once rather than five times, so a dead endpoint fails in
  minutes, not a quarter of an hour.
- `--smart` reports on stderr when the smart tier could not re-ask uncertain
  answers (`usage.escalation_failed`), and warns that it has no effect with
  `--multi`.
- Plain lines that start with `{` are plain text unless the first parses as
  JSON; broken NDJSON names the line.
- Update check: a failed registry lookup is cached for the day too, so being
  offline costs one attempt rather than one per run; prereleases are never
  suggested.
- Environment variables share one prefix: `CLASSIFY_ENDPOINT` and
  `CLASSIFY_API_KEY` (the old `CLASSIFIER_*` names still work). Help documents
  the `--id` output column and every env var.

## 0.1.0 — 2026-09-18

First release.

- `classify <labels> "<text>"` prints the label; `classify <labels> < file`
  prints `label<TAB>confidence<TAB>text` per line, in input order.
- Input as plain lines, a JSON array, or NDJSON, with `--field` and `--id`.
- Rows stream as they are classified, in input order, so `| head` on a large
  file returns at once instead of waiting for the whole run.
- A counter on stderr while a long run is in flight, shown only when stdout is
  redirected so it cannot collide with the rows.
- Requests time out after 180s (`CLASSIFY_TIMEOUT`); 429 and 5xx retry with
  backoff, honouring `retry-after`.
- Closing the pipe (`| head`) and Ctrl-C both exit quietly.
- `--review <t>` to print only uncertain answers, `--count` for a histogram,
  `--json` for NDJSON, `--quiet` for labels only.
- `--multi`/`--max`, `--smart`, `--instructions`.
- Batches of 1,000 per request, four in flight, 429s honoured with Retry-After.
- Once-a-day update hint on stderr (`CLASSIFY_NO_UPDATE_CHECK=1` disables).
