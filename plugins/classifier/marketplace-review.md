# Directory submission packet

Prepared source and reviewer fixtures for classifier.dev. This file is not proof
of submission, approval or listing in any directory. Build self-contained
bundles with `npm run package:plugins`; see [installation paths](README.md).

## Shared listing details

- Name: classifier.dev; publisher: Michael Ryaboy, contact@classifier.dev
- Repository: https://github.com/mrmps/classifier-dev (MIT)
- Website and support: https://classifier.dev and https://classifier.dev/contact
- Privacy: https://classifier.dev/privacy; terms: https://classifier.dev/terms
- Product MCP: https://classifier.dev/mcp
- Documentation MCP: https://classifier.dev/mcp/docs
- Transport: stateless Streamable HTTP; JSON responses; no session ID;
  GET returns 405, POST carries JSON-RPC.
- Authentication: public tools support noauth. Workspace attribution and paid
  features require a workspace key configured separately. Hosted workspace
  OAuth is not available; do not advertise an account-linking flow.
- API schema: https://classifier.dev/openapi.json
- Skill: https://classifier.dev/skill.md
- Logos: `assets/logo.png` and `assets/icon.svg` in the Codex bundle.
- Reviewer data: synthetic fixtures below; no account required for public calls.

### Listing copy

Classify batches of text into your own labels. Five classification tools cover
single labels, multiple dimensions, multi-label tagging, category counts and
uncertain answers. Confidence can be absent; never invent a score. A second MCP
server provides API documentation. Public calls need no API key and are subject
to service limits. Workspace usage requires separate credential configuration.

Synchronous classification text, labels, instructions and results are retained
for training and operator review by default. Set `share_data: false` to opt out;
see the privacy policy. The bundled skill tells agents to opt out when the user
has not chosen to contribute the data.

### Tool annotations and scope

Classification tools are **not read-only or idempotent**: default training
retention and quota/billing accounting are side effects. `openWorldHint` is true
because classification can involve external model services or URL retrieval.
Docs tools are read-only. All tools are non-destructive. Verify current
annotations and schemas with `tools/list` during submission; do not override
them with blanket no-side-effect claims.

### Starter prompts

1. Sort these reviews into positive, negative and mixed, then count each.
2. Triage these tickets by team and urgency and flag the unsure ones.
3. Which of these headlines are about AI regulation? Show only those.

## Platform artifacts and review boundaries

| Platform | Artifact / connection | Submission or availability |
| --- | --- | --- |
| ChatGPT / Codex | `dist/plugins/codex/classifier`; public MCP custom app for developer testing | [Plugin submission](https://developers.openai.com/plugins/deploy/submission). Publication and any identity/domain verification are separate from this PR. |
| Claude Code | Repository's `.claude-plugin/marketplace.json`; `dist/plugins/claude/classifier` | Direct repository marketplace install works independently of an official listing. [Submit a plugin](https://platform.claude.com/plugins/submit). |
| Claude app / Desktop | Public remote MCP connector, no OAuth fields | Custom connector or Claude directory submission; plan/admin controls apply. |
| Cursor / Agent Plugins clients | `dist/plugins/portable/classifier` | [Cursor publication](https://cursor.com/marketplace/publish); local import is available subject to team policy. |
| Grok Bot | Hosted MCP endpoint and Cursor-compatible portable package | Uses Cursor's plugin infrastructure. [Connect apps](https://cursor.com/help/grok-bot/connect-plugins) only shows available plugins; public review or team-admin setup remains necessary. |
| Grok Build | `dist/plugins/claude/classifier` via Claude compatibility | Local `--plugin-dir` or MCP installation; distinct from Grok Bot. |
| Muse Code | `dist/plugins/muse/classifier` | Native local bundle; experimental plugins may need enabling. Do not pass the multi-manifest source directory. |
| Muse consumer app | API schema, skill and the custom-connector prompt in README | [Muse Platform](https://muse.ai/platform) reviews functionality, security and legal requirements before directory availability. This is not a Muse Code plugin install. |
| Gemini CLI | `dist/plugins/gemini/classifier` | Local extension installation; uses `httpUrl` and bundled `skills/`. |

For OpenAI domain verification, the existing worker serves the configured
`OPENAI_APPS_CHALLENGE` at `/.well-known/openai-apps-challenge`. Only set a
challenge issued by the submission portal. Do not invent a verification token.

## Reviewer acceptance examples

Set `share_data: false` on every classification call below. Use actual tool
responses, preserve input order and treat null confidence as unavailable.
Model answers can vary; these are behavior checks, not accuracy guarantees.

1. `classify_texts`: five inputs such as "Charged twice", "App crashes",
   "Need a receipt", "Login fails", "Refund please"; labels `billing` and
   `technical support`. Expect five rows with one supplied label per input.
2. `classify_dimensions`: the same inputs as `items`, with dimensions
   `team: [billing, technical support]` and `urgency: [urgent, routine]`.
   Expect both named fields for each item.
3. `classify_multi_label`: inputs covering billing, shipping and returns;
   labels with those names. Expect a labels array and per-label scores for
   each input, not a fabricated singular confidence.
4. `count_labels`: classify the five inputs from example 1. Expect counts for
   both labels and a total of five, including any zero-count category.
5. `review_uncertain`: use example 1 with `below: 1`. Expect only unscored or
   below-threshold rows, retaining their original indices. Empty output is
   valid if every answer meets the threshold.
6. Docs: `list_docs`, then `read_doc` using a returned document ID. Expect
   nonempty documentation without an account or credential.

Negative cases:

- One label in `classify_texts`: JSON-RPC `-32602`, no classification result.
- Unknown tool name: JSON-RPC `-32602` listing available tools.
- An upstream refusal or limit: expose the returned error; never invent
  successful labels or claim installation is verified by configuration alone.

Run `npm run test:e2e:plugins` after the application build for repeatable
package-to-Worker verification; add `-- --live` for the public endpoints and
live inference. JSON evidence is saved under `captures/`. Native Claude and
Muse validators are listed in README. Host UI sessions, account linking and
public-directory review still need platform-specific verification.
