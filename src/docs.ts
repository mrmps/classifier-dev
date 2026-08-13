export const DOCS = `classifier.dev

Zero-shot text classification over plain HTTP. You send text and a list of
labels, you get back the label that fits. There is no API key to obtain and no
account to create, so the example below works if you paste it right now.


USAGE

  GET  https://classifier.dev/{labels}/{text}
  POST https://classifier.dev  {"input":"...","labels":["...","..."]}


EXAMPLES

  curl https://classifier.dev/spam,not+spam/Win+a+free+iPhone+now
  spam

  curl classifier.dev -d '{"input":"the checkout button does nothing","labels":["bug","feature","praise"]}'
  {"label":"bug","confidence":0.9971,"tier":"fast","model":"inclusionai/ling-2.6-flash","ms":431}

  curl "classifier.dev/entailment,neutral,contradiction/Only+12+of+40+sites+were+inspected.+Every+site+was+inspected.?tier=smart"
  contradiction

  Spaces can be written as + or %20, and labels are separated by commas.


PARAMETERS

  labels        Two to twenty-six categories, required.
  input         The text to classify, up to roughly 8,000 tokens.
  inputs        Up to twenty strings classified in a single call.
  tier          Either fast (the default) or smart.
  instructions  Extra criteria, such as "judge the reviewer's overall verdict".
  verbose       On GET requests, ?verbose=1 returns JSON instead of a bare label.


TIERS

  The fast tier runs ling-2.6-flash and emits a single token, so it answers in
  about 450ms. It scored 97.1% on 1k-token article sentiment, beating gpt-4o-mini
  at roughly a fifteenth of the cost.

  The smart tier runs qwen3.7-flash with its native reasoning enabled and takes
  around 2.4 seconds. It scored 80.0% on ANLI R3, where the frontier model
  gpt-5.6-sol scored 79.2% at eleven times the price.

  Most classification tasks saturate, meaning every model lands above 95% and
  paying more buys nothing, so start on fast and only move up if you measure a
  reason to. The full numbers are at https://classifier.dev/benchmark


LIMITS

  Requests are limited per IP address: 60 per minute on the fast tier and 10 per
  minute on the smart tier. A batch counts as one request no matter how many
  inputs it carries, so batching is the cheapest way to go faster.

  Each input is capped at about 8,000 tokens and each request at twenty inputs.

  Every response carries an X-RateLimit-Limit header and, where it can be
  determined, X-RateLimit-Remaining. Exceeding a limit returns 429 with a
  Retry-After header rather than a slow or silently dropped request.

  If you need more than this, or you want a classifier tuned to your own data,
  the fastest path is a short call: https://cal.com/michaelsf/coffee


PRIVACY

  The text you send is never stored or logged. What gets recorded is the label
  names, which tier ran, the latency, the response status and a coarse country,
  which is what makes the usage counts on this service possible.


Built by @micheal_chomsky — https://x.com/micheal_chomsky
`;

export const BENCHMARK = `classifier.dev/benchmark

Every number here comes from a real run against the live API, with cost taken
from OpenRouter usage accounting rather than a price list. Measured 2026-08-12.


HARD TASKS

ANLI R3 is three-class natural language inference collected adversarially
against models, so chance is 33% and there is real headroom. WiC is binary word
sense disambiguation, where chance is 50%.

  model                         ANLI    WiC    $/1M calls   p50
  ------------------------------------------------------------------
  classifier-smart              80.0%   82.0%   $148        586ms
  gpt-5.6-sol (frontier)        79.2%   84.0%   $1,646      348ms
  deepseek-v4-flash             74.2%   84.0%   $83         756ms
  gpt-oss-120b (low)            72.5%   74.0%   $48         645ms
  classifier-fast               60.8%   67.0%   $2          452ms

With 120 ANLI items and 100 WiC items the noise band is roughly nine points, so
the smart tier and the frontier model should be read as parity rather than as a
ranking.


SATURATED TASKS

1k-token article sentiment, 140 items.

  model                  accuracy   $/1M calls   p50
  ---------------------------------------------------
  classifier-fast         97.1%      $9.82       455ms
  qwen3.7-flash           97.9%      $29.45      635ms
  llama-3.1-8b            96.2%      $19.50      350ms
  gpt-4o-mini             95.0%      $143.44     408ms
  gemini-2.5-flash-lite   94.9%      $96.29      251ms

This is why the default is the fast tier. On a task like this, paying fourteen
times more returned two points less accuracy.


WHAT ACTUALLY MOVED THE NUMBERS

  +15 pts   turning on a model's native reasoning (60.8% to 75.8% on ANLI)
  -15 pts   prompting chain-of-thought into a model not trained to reason
   +4 pts   few-shot examples
   -3 pts   batching without per-item keys in the output
    0 pts   cutting an 830-token rubric to 30 tokens, which saved 25% of cost

Reasoning turns out to be a property of the model rather than of the prompt,
and that difference is the entire reason there are two tiers.


THROUGHPUT

The fast tier on 1k-token inputs, measured at increasing concurrency.

  concurrency   req/s   p50    errors
  ----------------------------------
  8             15.0    451ms  0
  16            29.0    458ms  0
  32            49.7    472ms  0
  64            64.2    495ms  0

Throughput scales close to linearly with almost no latency penalty.


CAVEATS

Public benchmarks are likely present in training data, so treat these accuracy
figures as optimistic and use them to rank models rather than to predict what
you will see on your own task.

If you want help measuring your own data, the offer of a call stands:
https://cal.com/michaelsf/coffee


Built by @micheal_chomsky — https://x.com/micheal_chomsky
`;
