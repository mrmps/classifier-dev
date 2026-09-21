/**
 * /agents.md — the cold-discovery file for agents that land here from a search
 * without reading llms.txt first: what this is, when to use it, how to call it.
 */
import { SITE_UPDATED } from "./wellknown";

export const AGENTS_MD = `# classifier.dev for agents

Canonical: https://classifier.dev/agents.md · Last updated ${SITE_UPDATED}

Zero-shot text classification over plain HTTP. Send texts and labels, get the
label that fits each text and a calibrated confidence. No API key, no account.

## When to use this

You can already classify any text you can see. Call classifier.dev when
**reading the input is the expensive part**:

- **Filtering before reading.** Forty search results, six worth opening: one
  call returns forty labels; read only the survivors.
- **Cascade pre-filtering.** Drop the obvious no's cheaply, then spend real
  reasoning on what is left.
- **Streams nobody reads line by line.** Log lines, error buckets, inbound
  tickets, the changed files in a large diff.
- **Label-based routing.** Use the fast tier to route texts into your categories.
  Model updates, fallback, and smart reasoning can change answers; neither tier
  guarantees identical results across calls.

All four are the same move: classify ten thousand things without reading them.
A thousand inputs go in one request and come back in about a second. Under
about five items you can already see, just decide yourself.

## When not to use this

- Fewer than about five items already in your context.
- Anything needing a free-text answer rather than one of a fixed set of labels.
- Inputs that your labels do not meaningfully cover. Scores only compare the
  labels you supplied; they do not validate the input.

## How to call it

    curl https://classifier.dev/spam,not+spam/Win+a+free+iPhone
    spam

    curl "https://classifier.dev/?labels=spam,not+spam&text=Win+a+free+iPhone"   # same call, query form
    spam

    curl https://classifier.dev/v1/classify -d '{
      "inputs": ["...", "..."],
      "labels": ["bug", "praise", "feature"]
    }'
    {"results": [{"label": "bug", "confidence": 0.99, "scores": {...}}, ...]}

- \`inputs\`: 1 to 1,000 texts. \`labels\`: 2 to 100 names — descriptive names classify better.
- \`tier\`: \`fast\` (default) or \`smart\`, which re-asks answers under 0.7 confidence of a reasoning model.
- \`multi: true\` returns \`{labels: [...], scores: {...}}\` per result, with an independent score per label. It has no singular \`label\` or \`confidence\` key.
- \`instructions\`: extra criteria in a sentence.

Over MCP (Claude, ChatGPT, Codex, Cursor): https://classifier.dev/mcp — tools
\`classify_texts\`, \`classify_dimensions\`, \`classify_multi_label\`, \`count_labels\`, \`review_uncertain\`.
Setup per client: https://classifier.dev/mcp-setup. From a shell:
\`npm i -g classifier-dev\` then \`classify bug,feature,praise < feedback.txt\`.

## Acting on the confidence

It is calibrated: on a six-way emotion set, answers at or above 0.9 were right
82% of the time and answers below 0.5 were right 29%. Trust the sure ones,
review the rest (\`--review 0.7\` in the CLI, \`review_uncertain\` over MCP), or
pass \`tier: "smart"\`. It is not a fit score. Add a label like "none of these"
when none-of-the-above is a real outcome.

Check for \`confidence === null\` before comparing a threshold. Provider scores
can be unavailable, and smart-escalated answers have null confidence and scores
because the replacement model does not return comparable probabilities. Route
nulls to review. Smart answers never inherit the first model's probabilities.
Scores express the model's choice among your labels; they do not validate the
input or guarantee that the choice is correct.

## Limits and errors

Per IP: 3,000 classifications a minute and 20,000 a day on fast; 200 and 2,000
on smart. Every classification response carries \`RateLimit-Limit\` and
\`RateLimit-Policy\`, plus \`RateLimit-Remaining\` once the limiter has been
consulted (every 200 and 429); a 429 adds \`Retry-After\`. Errors are JSON on
POST: \`{"error": "...", "code": "too_few_labels"}\`. The GET forms answer plain
text unless you add \`?verbose=1\` or send \`Accept: application/json\`.
Authentication: none — https://classifier.dev/auth.md.

## More

- Full reference: https://classifier.dev (the same text \`curl\` prints) · [llms.txt](https://classifier.dev/llms.txt)
- OpenAPI: https://classifier.dev/openapi.json · [Skill and examples](https://classifier.dev/skill.md): \`npx skills add https://classifier.dev\`
- Measured accuracy and cost: https://classifier.dev/benchmark
- Leave structured feedback without a human: https://classifier.dev/.well-known/agent-feedback.json
`;
