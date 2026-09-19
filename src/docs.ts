import { vsJevText } from "./vsjev";
import { roadmapDoc } from "./newsletter";

export const DOCS = `classifier.dev

Zero-shot text classification over plain HTTP. You send text and a list of
labels, you get back the label that fits and how sure the model is. There is no
API key and no account, so the example below works the moment you paste it.


If you are an agent or a code generator, the machine-readable description of
this API lives at https://classifier.dev/openapi.json (OpenAPI 3.1), with a
short index at https://classifier.dev/llms.txt


AGAINST THE MODEL IT RUNS ON

${vsJevText(false)}


WHEN THIS IS WORTH A NETWORK CALL

  If you are a language model, you can already classify any text you can see,
  for free. The question is whether you want the text in your context at all.

  This is worth calling when reading the input is the expensive part:

  Filtering before reading. You have forty search results and want the six worth
  opening. Judging them yourself means pulling all forty into context first,
  which is the cost you were trying to avoid. One call returns forty labels and
  you read only the survivors.

  Cascade pre-filtering. Drop the obvious no's cheaply, then spend real
  reasoning on what is left.

  Streams nobody reads line by line. Log lines, error buckets, inbound tickets,
  the changed files in a large diff.

  Deterministic routing. A pipeline branch that must take the same path for the
  same input on every run, instead of drifting with a model's reasoning.

  All four are the same move: classify ten thousand things without reading
  them yourself. A thousand inputs go in one request and come back in about a
  second. Below about five items, skip it. You have already paid the context
  cost, so just decide.


CLI

  The same API from the shell, one line per input, in input order:

    npm i -g classifier-dev
    classify bug,feature,praise < feedback.txt
    classify relevant,"not relevant" --review 0.7 < snippets.txt   # the unsure ones
    classify db,web,ml --count < titles.txt                        # a histogram

  Plain lines, JSON or NDJSON in; label, confidence and text out. Batches of a
  thousand per request, four at a time, and rows stream as they land, so piping
  to head returns at once on a large file. Retries rate limits and upstream
  failures on its own. classify --help has the rest. Source in cli/ at
  https://github.com/mrmps/classifier-dev


MCP

  The same tools inside Claude, ChatGPT, Codex, Cursor or any MCP client, over
  Streamable HTTP with no key:

    https://classifier.dev/mcp          classify_texts, classify_multi_label, count_labels, review_uncertain
    https://classifier.dev/mcp/docs     list_docs, read_doc, search_docs

    claude mcp add --transport http classifier https://classifier.dev/mcp
    codex mcp add classifier --url https://classifier.dev/mcp

  Listed in the official MCP registry as dev.classifier/classifier and
  dev.classifier/docs: https://registry.modelcontextprotocol.io/v0/servers?search=dev.classifier

  Claude.ai: Customize > Connectors > Add custom connector > paste the URL.
  ChatGPT: Settings > Security and login > Developer mode, then create an app
  with the URL and "No Authentication". Step by step for every client, plus
  what each tool does: https://classifier.dev/mcp-setup


AGENT SKILL

  Install this as a skill and your agent will remember to reach for it:

    npx skills add https://classifier.dev

  It is served straight from this domain over RFC 8615 well-known discovery,
  so there is no repository in the middle:

    /.well-known/agent-skills/index.json   the discovery document
    /skill.md                              the skill itself, readable as-is

  Agents without a skills runtime can simply fetch /skill.md and follow it.


USAGE

  GET  https://classifier.dev/{labels}/{text}
  GET  https://classifier.dev/?labels={a,b}&text={text}
  POST https://classifier.dev  {"input":"...","labels":["...","..."]}
  POST https://classifier.dev  {"inputs":["...", ...up to 1000],"labels":[...]}


EXAMPLES

  curl https://classifier.dev/spam,not+spam/Win+a+free+iPhone+now
  spam

  curl classifier.dev -d '{"input":"the checkout button does nothing","labels":["bug","feature","praise"]}'
  {"tier":"fast","model":"jev-1.13.0","modelsUsed":["jev-1.13.0"],
   "results":[{"label":"bug","confidence":1,"scores":{"bug":1,"feature":0,"praise":0},"ms":260,"model":"jev-1.13.0"}],
   "usage":{"classifications":1,"escalated":0,"ms":260}}

  curl "classifier.dev/entailment,neutral,contradiction/Only+12+of+40+sites+were+inspected.+Every+site+was+inspected."
  contradiction

  Spaces can be written as + or %20, and labels are separated by commas.

  The same request as query parameters, for code that builds URLs:

  curl "https://classifier.dev/?labels=spam,not+spam&text=Win+a+free+iPhone+now"
  spam

  input, q, classes and categories are read as text and labels too, and the
  two forms mix: /spam,not+spam?text=... is the same call. Every option below
  works on both. A malformed GET answers with a URL that would have worked.

  In the path form a raw comma, slash or plus sign is a separator. A label
  that contains one is written percent-encoded, %2C, %2F or %2B, so
  /C%2B%2B,python/... reads the label C++. In the query form + is a space and
  %2B a plus sign, and a comma inside a label is written %252C.


PARAMETERS

  labels        Two to one hundred categories. Required.
  input         The text to classify, up to 32,000 characters.
  inputs        Up to one thousand strings classified in a single call.
  tier          Either fast (the default) or smart, in any case. Anything
                else is a 400 with code bad_tier, never a silent fast.
  instructions  Extra criteria, such as "judge the reviewer's overall verdict".
  verbose       On GET requests, ?verbose=1 returns JSON instead of a bare label.
                Sending Accept: application/json does the same.
  multi         Return every category that applies instead of just one.
  max_labels    Cap how many multi-label answers come back.

  Results come back in input order. Each carries the label, a confidence from
  0 to 1, a score for every label, and the model that answered.

  Batch responses also carry modelsUsed. The top-level model is "mixed" when
  different results were answered by different models, such as a smart-tier
  batch where only some inputs were escalated.


CONFIDENCE

  The model behind this is a decision model, not a language model prompted
  to classify. It returns a calibrated probability for every label, so the
  confidence is a real forecast of whether the label is right. Measured:

    six-way emotion, 400 items      confidence >= 0.9   right 82% of the time
                                    confidence <  0.5   right 29% of the time
    four-way news topic, 400 items  confidence >= 0.9   right 92% of the time
                                    confidence <  0.5   right 64% of the time

  Use it. Act on high-confidence answers, and route the rest to a person, a
  reasoning model, or the smart tier, which does exactly that for you.

  Two things confidence does not measure.

  It is not out-of-distribution detection. It says which of your labels fits
  best, not whether any of them fit. "The weather is nice today" against
  bug / feature / praise comes back "praise", with a confidence that looks
  like any other answer's. If none-of-the-above is a real outcome, add it as
  a label: the same text against those three plus "none of these" picks
  "none of these". That works; hoping for a low score does not.

  It is withheld for input that is not language. A forced choice on
  "asdkjfhaskdjfh" still lands somewhere, so the label ships with confidence
  and scores null and an unscored field explaining why.


MULTI-LABEL

  One article, fifty tags, the ones that fit:

    curl classifier.dev -d '{"input":"...","labels":["ml","databases",...],
                             "multi":true,"max_labels":10}'
    {"results":[{"labels":["databases","serverless","rust","caching", ...],
                 "scores":{"databases":0.98,"serverless":0.98,...,"gaming":0.01}}]}

  On GET, add ?multi=1 and the labels come back one per line.

  Every label is judged independently as a yes/no probability, and the answer
  lists those at or above 0.7, most likely first. The full score map is
  returned so you can set your own threshold: on a seven-task set, 0.7 gave
  recall 0.99 and precision 0.81 (F1 0.887); 0.5 gave recall 1.00 and precision
  0.74. max_labels keeps the top N. One request, about 200ms.


TIERS

  fast     Every answer comes from the decision model, in one round trip.
           Measured: four-way news topic 87.7%, six-way emotion 60.5%, which is
           the same accuracy as a 3.4-second reasoning model on the news topics
           at two milliseconds per item.

  smart    Same first pass, then every single-label answer below 0.7 confidence
           is re-asked of a fast reasoning model and replaced. Measured:
           emotion 61.8% to 63.7%, news topics 87.5% to 90.0%, by re-asking
           30% and 12% of the items. Those results carry escalated: true and
           the reasoning model's name; the confidence and scores shown are
           still the decision model's, since they are why it was escalated.
           usage.escalated counts them. A few seconds per escalated item, so
           a batch on smart is slower in proportion to how uncertain it is.
           If the reasoning model cannot be reached, the fast answer stands
           without escalated, and usage.escalation_failed says how many.

           Multi-label answers ignore the tier: the reasoning model was
           measured re-judging them and made them worse.

  The models are not fixed. They are benchmarked as candidates appear and
  swapped when a measurement, not a launch post, says to. If the decision
  model is unavailable, requests of up to twenty inputs fall back to a chain of
  language models on different providers; JSON responses always report which
  model actually answered.


LIMITS

  Limits are counted per IP address in classifications, not requests, so a
  batch of a thousand inputs spends a thousand of them. The fast tier allows
  3,000 per minute and 20,000 per day; the smart tier 200 per minute and 2,000
  per day.

  Each input is capped at 32,000 characters, and a request may carry up to a
  thousand inputs. Every classification response carries RateLimit-Limit and
  RateLimit-Policy, and RateLimit-Remaining once the limiter has been consulted
  (every 200 and every 429; a request rejected before that, such as a 400,
  never reached it). The older X-RateLimit-Limit and X-RateLimit-Remaining pair
  is sent as well. Exceeding a limit returns 429 with a Retry-After header.
  Nothing is slowed down or silently dropped.


ERRORS

  A POST that fails answers JSON with a message and a stable code:

    {"error": "Provide at least 2 labels; got 1 (\"spam\").", "code": "too_few_labels"}

  The GET forms answer plain text instead, an error: line and, on a 400, the
  usage: and try: lines with a URL that would have worked; add ?verbose=1 or
  send Accept: application/json for the JSON object, which then carries usage
  and try as fields.

  400   bad_json, no_input, too_many_inputs, too_few_labels, too_many_labels,
        empty_label, duplicate_labels, empty_input, input_too_long, bad_tier
  404   not_found
  429   rate_limit_minute, rate_limit_day, with Retry-After
  502   typesafe or typesafe_<status> when the decision model failed;
        openrouter_<status>, chain_exhausted or timeout when the fallback
        chain did; batch_unavailable for more than twenty inputs while the
        decision model is down; upstream_other. Retry with backoff.

  The full list, in the shape a client can validate against, is
  components.schemas.Error in https://classifier.dev/openapi.json

  If you need more than this, or you want a classifier tuned to your own data,
  the fastest path is a short call: https://cal.com/michaelsf/coffee


${roadmapDoc()}

PRIVACY

  The text you send is never stored or logged here. It is forwarded to the
  model provider for the classification and nothing else. What is recorded is
  a keyed fingerprint of the label set, never the labels themselves, plus
  which tier ran, which model answered, the latency, the response status and
  a coarse country. The usage counts on this service are built from those.


Built by @michael_chomsky — https://x.com/michael_chomsky
`;

export const BENCHMARK = `classifier.dev/benchmark

Every number here comes from a real run, and the cost column is what the
providers actually billed. Measured 2026-09-17. The eval code is in the
repository (eval/), so all of this is re-runnable.


AGAINST THE MODEL IT RUNS ON

${vsJevText(true)}


SINGLE LABEL

Two public test sets, 400 items each. AG News is four-way topic; emotion is
six-way and genuinely hard, because sadness, fear and anger blur.

  model                              AG News   emotion   ms/item   $/1k
  ---------------------------------------------------------------------
  jev-1.13 (classifier-fast)          87.7%     60.5%       2      0.005
  qwen3.7-flash, reasoning            87.5%       *      3,445     0.040
  ling-3.0-flash                      82.0%     57.0%     731      0.002
  granite-4.0-h-micro (before)        63.2%     52.5%     594      0.002

The ms/item for jev is amortised: 400 items ride in one request that returns
in about 650ms. The others are one call per item.

The last row is what this service was quietly serving until 2026-09-17. Its
primary model had been delisted upstream, every request 404'd against it and
fell through to granite, and nothing in the deployed numbers said so.


CALIBRATION

Accuracy by the confidence the model attached to its own answer.

                        n     accuracy          n     accuracy
  confidence         AG News             emotion
  ---------------------------------------------------------------
  [0.9, 1.0]        323      91.6%       200      82.0%
  [0.7, 0.9)         27      85.2%        79      49.4%
  [0.5, 0.7)         28      64.3%        52      36.5%
  [0.0, 0.5)         22      63.6%        69      29.0%

For comparison, the previous model's logprob "confidence" put 348 of 400 news
items at or above 0.9 and was right on 68% of them.


ESCALATION (the smart tier)

Only the items Jev put under 0.7 confidence are re-asked. What matters is how a
second model does on exactly those, not overall.

                                emotion, 122 uncertain    news, 49 uncertain
  model                          acc      -> whole set     acc    -> whole set
  ------------------------------------------------------------------------------
  jev alone                     36.9%        61.8%        65.3%      87.5%
  gemini-3.8-flash  (smart)     43.4%        63.7%        85.7%      90.0%
  qwen3.8-flash                 36.1%        61.5%        79.6%      89.2%
  qwen3.7-flash                 ~37%         61.0%        ~66%       87.7%
  deepseek-v4-flash             36.9%        61.8%        34.7%      83.8%
  mercury-2.5                   26.2%        58.5%        38.8%      84.3%
  claude-fable-5.1              71.3%        72.3%        91.8%      90.7%
  gpt-6-astra                   54.9%        67.2%        69.4%      88.0%

Most cheap models are no better than Jev on the cases Jev finds hard; the
frontier models are, at about $2 per thousand escalations. The smart tier
calls gemini-3.8-flash, the fast model that helped on both sets: about $0.70
per thousand escalated items, 2.3 seconds each.


MULTI LABEL

Seven hand-written tasks, 12 to 50 labels each, 3 runs. Macro P/R/F1.

  configuration                          P      R      F1     latency   $/1k
  --------------------------------------------------------------------------
  jev, one yes/no per label, >= 0.7    0.81   0.99   0.887     232ms   0.053
  ling-3.0 sweep + second pass          0.90   0.74   0.799   1,538ms   0.008
  mercury-2.5 sweep + second pass       0.92   0.72   0.797     945ms   0.038
  granite-4.0 sweep + second pass       0.71   0.46   0.546   1,575ms   0.017
  jev candidates re-judged by qwen3.7   0.43 (parse failures) 23,000ms

Read eval/README.md before quoting these: n=7, one annotator, no held-out
split. Gaps of 0.03 are noise; the gaps above are not.


THROUGHPUT

Twelve concurrent requests of 300 inputs each against the decision model:
3,600 classifications in 2.7 seconds wall clock, no throttling. A single
request of 1,000 short inputs returns in about 1.5 seconds.


CAVEATS

Public benchmarks are likely present in training data, so treat the accuracy
figures as optimistic. Use them to rank the models; they will not predict what
you see on your own task. The calibration table is the one to trust, because it
says how much to believe a given answer.

If you want help measuring your own data, the offer of a call stands:
https://cal.com/michaelsf/coffee


Built by @michael_chomsky — https://x.com/michael_chomsky
`;
