# Changelog

All notable changes to the `classify` CLI. Semver; the API it talks to is
versioned separately at https://classifier.dev.

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
