export const DOCS = `classifier.dev — zero-shot text classification. No key. No signup.


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


PARAMETERS

  labels        2-26 categories. Required.
  input         text, up to ~8000 tokens
  inputs        up to 20 strings, classified in one call
  tier          fast (default) | smart
  instructions  extra criteria, e.g. "judge the reviewer's verdict, not the plot"
  verbose       GET only: append ?verbose=1 for JSON instead of a bare label


TIERS

  fast   ling-2.6-flash, one output token, ~450ms p50
         97.1% on 1k-token article sentiment; beat gpt-4o-mini at 1/15th the cost

  smart  qwen3.7-flash with native reasoning, ~2.4s
         80.0% on ANLI R3 — frontier gpt-5.6-sol scores 79.2% at 11x the price

  Most tasks saturate: every model scores 95%+ and paying more buys nothing.
  Use fast until you measure otherwise. Full numbers: classifier.dev/benchmark


RATE LIMITS   per IP, no key required

  fast    60 requests / minute
  smart   10 requests / minute
  batch   20 inputs per request, each counts as one classification

  Every response carries X-RateLimit-Limit. A 429 carries Retry-After.
  Nothing is throttled silently and nothing is queued.

  Need more, a private deployment, or a task-specific classifier?
  https://cal.com/michaelsf/coffee


NOTES

  Free while in beta. No logging of your text — only counts, label names,
  latency and tier. Deleted after 30 days.

  Labels are semantic: "urgent bug" classifies better than "p0".
  Order does not matter. 2-26 labels.

  Built by smry.ai
`;

export const BENCHMARK = `classifier.dev/benchmark — measured, not quoted.

Every number is a real run against the live API with billed cost from
OpenRouter usage accounting. Dated 2026-08-12.


HARD TASKS   ANLI R3 (3-class, adversarial, chance 33%) and WiC (binary, chance 50%)

  model                         ANLI    WiC    $/1M calls   p50
  ------------------------------------------------------------------
  classifier-smart              80.0%   82.0%   $148        586ms
  gpt-5.6-sol (frontier)        79.2%   84.0%   $1,646      348ms
  deepseek-v4-flash             74.2%   84.0%   $83         756ms
  gpt-oss-120b (low)            72.5%   74.0%   $48         645ms
  classifier-fast               60.8%   67.0%   $2          452ms

  n=120 (ANLI) and n=100 (WiC), so roughly +/-9 points. Treat smart and
  frontier as parity, not a ranking.


SATURATED TASKS   1k-token article sentiment, n=140

  model                  accuracy   $/1M calls   p50
  ---------------------------------------------------
  classifier-fast         97.1%      $9.82       455ms
  qwen3.7-flash           97.9%      $29.45      635ms
  llama-3.1-8b            96.2%      $19.50      350ms
  gpt-4o-mini             95.0%      $143.44     408ms
  gemini-2.5-flash-lite   94.9%      $96.29      251ms

  This is why the default is fast. On tasks like this, 14x the price
  bought two points less accuracy.


WHAT MOVED THE NUMBERS

  +15 pts   enabling a model's native reasoning (60.8% -> 75.8% on ANLI)
  -15 pts   prompting chain-of-thought into a model not trained to reason
   +4 pts   few-shot examples
   -3 pts   naive batching without per-item keys in the output
    0 pts   trimming an 830-token rubric to 30 tokens (saved 25% of cost, free)

  Reasoning is a model property, not a prompt. That is the whole difference
  between the two tiers.


THROUGHPUT   classifier-fast, 1k-token inputs

  concurrency   req/s   p50    errors
  ----------------------------------
  8             15.0    451ms  0
  16            29.0    458ms  0
  32            49.7    472ms  0
  64            64.2    495ms  0

  Scales close to linearly with no latency penalty.


CAVEATS

  Public benchmarks are likely in training data, so absolute accuracy is
  optimistic. Use these to rank, not to predict your task.

  Measure on your own data. If you want help doing that:
  https://cal.com/michaelsf/coffee
`;
