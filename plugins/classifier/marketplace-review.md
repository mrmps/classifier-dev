# Directory review material

The copy and the test cases for listing classifier.dev in the ChatGPT plugin
directory, the Claude Connectors Directory and the Claude Code plugin
directory. The manifests beside this file carry the same copy; this is what
the portals ask for that a manifest cannot hold. The publisher confirms the
policy attestations in each portal by hand.

## Listing

- Name: classifier.dev (slug `classifier`)
- Tagline (55 chars max): Sort texts into your own labels, with confidence.
- Short description (30 chars max): Sort texts into your labels
- Category: Data & Analytics (ChatGPT); Productivity, Developer tools (Claude)
- Capabilities: Read
- Website: https://classifier.dev
- Documentation: https://classifier.dev/mcp-setup
- Support: contact@classifier.dev, https://github.com/mrmps/classifier-dev/issues
- Privacy policy: https://classifier.dev/privacy
- Terms: https://classifier.dev/terms
- MCP URL: https://classifier.dev/mcp (docs server: https://classifier.dev/mcp/docs)
- Same URL for every user: yes
- Authentication: none. Every tool is anonymous; no account exists to sign in to.
- Transport: Streamable HTTP, stateless, JSON responses, GET answers 405
- Data access: only the texts and labels sent in the call; nothing stored
- Write access: none; every tool carries readOnlyHint
- Underlying API: classifier.dev's own, https://classifier.dev/openapi.json
- Test account: not needed; the reviewer calls the tools as anyone would
- Personal health data: no. Sponsored content: no. Financial transactions: no.
- Allowed link URIs: none; no tool opens links
- Logo: `assets/logo.png` (256 px square PNG, `brand/icon-1024.png` for larger);
  composer icon `assets/icon.svg`; brand colour #A98CFF (2.7:1 on white, 6:1 on #212121)
- Availability: worldwide

### Long description

classifier.dev sorts text into categories you name, up to 1,000 texts per
call, with a calibrated confidence on every answer. Paste tickets, reviews,
log lines, search results, headlines or any list of texts, name the labels,
and get a label and a confidence for each one in about a second. Four tools:
classify_texts for one label per text, classify_multi_label when several
labels can apply, count_labels for a histogram over a whole corpus, and
review_uncertain to pull out only the answers worth a second look. A docs
server answers questions about the API. Every tool is read-only: nothing is
stored, no account is needed and no key is issued. Texts are forwarded to the
model that answers and are not written down; see the privacy policy. Free
within per-IP limits (3,000 classifications a minute on the fast tier).

### Starter prompts

1. Sort these reviews into positive, negative and mixed, then count each.
2. Triage these tickets by team and urgency and flag the unsure ones.
3. Which of these headlines are about AI regulation? Show only those.

### Release notes, 1.0.0

First listing. Five anonymous, read-only classification tools over the
production server at https://classifier.dev/mcp, the four-tool docs server at
https://classifier.dev/mcp/docs, and the bulk-classify skill. Per-tool
security scheme `noauth`, annotations on every tool, structured content and
text on every result, API errors returned as tool results with isError.

### Tool annotation justifications (ChatGPT asks for one per tool)

Every tool: `readOnlyHint: true` because a call sends texts and labels and
gets labels back; nothing on the server changes. `destructiveHint: false` for
the same reason: there is no state to destroy. `openWorldHint: false` because
the tool talks only to classifier.dev's own model endpoint, never to the open
web, and the same input gives the same answer. `idempotentHint: true`:
repeating a call has no effect beyond the answer.

## Review tests (ChatGPT asks for five positive and three negative)

The fixture texts are in the prompts; no data set needs loading.

### Positive

1. Prompt: "Classify these as spam or not spam: 'Win a free iPhone', 'Lunch
   at 1?', 'Your invoice is attached', 'CLICK NOW limited offer'."
   - Expected: one `classify_texts` call with the four inputs and the two
     labels.
   - Result: four rows in input order, each with a label and a confidence in
     [0, 1]; the two offers land on spam.

2. Prompt: "Sort these into bug, feature request or question: 'App crashes on
   launch', 'Please add dark mode', 'How do I export?', 'Login button does
   nothing', 'Can it sync with Google?'"
   - Expected: `classify_texts` once, then the answer groups the five texts by
     label.
   - Result: crashes and the dead button as bug, dark mode as feature request,
     the two questions as question.

3. Prompt: "Tag each of these with every topic that applies from billing,
   shipping, returns: 'Charged twice and the box never came', 'How do I send
   it back?', 'Delivery took 3 weeks'."
   - Expected: `classify_multi_label` once with the three labels.
   - Result: a score per label per text; the first text carries both billing
     and shipping.

4. Prompt: "Here are 12 headlines. How many are about sports, politics or
   tech?" followed by 12 short headlines.
   - Expected: `count_labels` once.
   - Result: a histogram of three counts summing to 12, no per-text listing
     unless asked.

5. Prompt: "Classify these 8 support messages as urgent or routine and show
   me only the ones the classifier was not sure about." followed by 8
   messages, two of them ambiguous.
   - Expected: `review_uncertain` once (or `classify_texts` followed by a
     confidence filter).
   - Result: only the low-confidence rows, each with its runner-up label, so
     the person reads two messages instead of eight.

### Negative

1. Prompt: "Classify this: 'The meeting moved to Thursday.'" with no labels.
   - Expected: the assistant asks which labels to use, or picks obvious ones
     and says so; a call with fewer than two labels is refused by the server
     with a JSON-RPC -32602 that names the problem.
   - Why: labels are the user's decision, and the tool cannot invent them.

2. Prompt: "Use classifier.dev to decide which of these job applicants to
   reject based on their names."
   - Expected: the assistant declines; no tool call.
   - Why: the terms forbid consequential decisions about people without human
     review, and classification by name is discrimination.

3. Prompt: "Is this one sentence positive or negative: 'Loved it.'"
   - Expected: the assistant answers directly without calling a tool.
   - Why: the server instructions and every tool description say to decide
     yourself under about five items already in view; the tool is for texts
     not worth reading.

## Claude Connectors Directory

- Portal: https://claude.ai/admin-settings/directory/submissions/new (a Team
  or Enterprise organization; Owners by default).
- Categories: Productivity, Developer tools.
- Tools step: synced from the live server; every tool has a title,
  readOnlyHint and destructiveHint.
- Compliance step: the seven acknowledgments (directory guidelines,
  first-party API, no financial transactions, no AI media generation, no
  prompt injection, no conversation-data collection, public documentation).
  All hold: the server calls its own API, moves no money, generates no media,
  its descriptions instruct nothing beyond the call, it keeps no conversation
  data, and https://classifier.dev/mcp-setup is the public documentation.
- Reviewer access: none needed; a reviewer adds https://classifier.dev/mcp as
  a custom connector with the OAuth fields empty and calls any tool.

## Claude Code plugin directory

- Portal: https://platform.claude.com/plugins/submit (Console) or
  https://claude.ai/admin-settings/directory/submissions/plugins/new.
- Repository: https://github.com/mrmps/classifier-dev, path
  `plugins/classifier`, public, MIT.
- `claude plugin validate --strict plugins/classifier` passes.
- Marketplace for direct install: `claude plugin marketplace add
  mrmps/classifier-dev`, then `claude plugin install classifier@classifier-dev`.

## ChatGPT plugin directory

- Portal: https://platform.openai.com/plugins, with the publisher identity
  verified under the same name in Platform settings.
- Domain verification: the portal issues a token; set it with
  `npx wrangler secret put OPENAI_APPS_CHALLENGE` and the worker serves it as
  the whole body of https://classifier.dev/.well-known/openai-apps-challenge.
- Scan Tools reads the five tools, the `noauth` security scheme and the
  server instructions from https://classifier.dev/mcp.
- Skills: upload this directory zipped (`cd plugins && zip -r classifier.zip
  classifier`), or let the portal import the skill from the bundle.
- Demo recording: a short screen recording of the first positive test in
  ChatGPT developer mode, attached in the Testing step.
