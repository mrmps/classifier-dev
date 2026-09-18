# classify

The [classifier.dev](https://classifier.dev) CLI. Sort text into your own labels
from the shell — up to a thousand lines per request, a calibrated confidence on
every answer, no API key.

    npm i -g classifier-dev        # installs `classify`
    npx classifier-dev --help      # or run it without installing

## Use

    classify spam,"not spam" "Win a free iPhone now"
    spam

    classify bug,feature,praise < feedback.txt
    bug       0.99    the checkout button does nothing
    praise    0.97    love the new dark mode
    feature   0.61    would be nice to export as CSV

One line per input, in input order: `label`, `confidence`, `text`, tab-separated.
`--json` gives NDJSON with everything the API returns; `--quiet` gives labels
only; `--count` gives a histogram.

## Built for agents

The confidence is calibrated (on a six-way emotion set, answers at ≥ 0.9 were
right 82% of the time; below 0.5, 29%), so the useful move is to trust the sure
ones and look at the rest yourself:

    classify relevant,"not relevant" -i "relevant means about GPU pricing" --review 0.7 < snippets.txt

prints only the inputs the model was unsure about. Or let the API do it:
`--smart` re-asks those of a reasoning model.

Input can be plain lines, a JSON array, or NDJSON; `--field` picks the text
field and `--id` carries an id through:

    cat issues.jsonl | classify bug,question,feature --field title --id number --json

10,000 lines are batched 1,000 per request, four at a time, and a rate limit
pauses and resumes rather than failing. Errors go to stderr with exit code 1.

## Options

    -m, --multi                every label that applies, plus a score per label
    -k, --max <n>              with --multi, at most n labels
    -s, --smart                re-ask uncertain answers of a reasoning model
    -i, --instructions <text>  extra criteria
    -r, --review <t>           print only inputs with confidence below t
    -c, --count                label histogram instead of rows
    -j, --json                 NDJSON output
    -q, --quiet                labels only
        --field <name>         text field for JSON / NDJSON input (default: text)
        --id <name>            id field to carry through
        --endpoint <url>       API base (env CLASSIFIER_ENDPOINT)
        --api-key <key>        bearer token for higher limits (env CLASSIFIER_API_KEY)

`classify --help` has examples. Set `CLASSIFY_NO_UPDATE_CHECK=1` to skip the
once-a-day version check.

## Versioning

Semver. `classify --version` prints it; the CLI mentions a newer release on
stderr once a day. Changes are in [CHANGELOG.md](./CHANGELOG.md); releases are
cut with `npm run release` (see `release.js`) and published from the
`cli-v*` tag.
