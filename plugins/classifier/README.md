# classifier.dev plugin

One plugin, installable in Claude Code, ChatGPT and Codex, that gives the
agent classifier.dev's tools and skill:

- The MCP server at `https://classifier.dev/mcp`: `classify_texts`,
  `classify_dimensions`, `classify_multi_label`, `count_labels` and
  `review_uncertain`. Keyless, stateless, every tool read-only.
- The docs server at `https://classifier.dev/mcp/docs`: `list_docs`,
  `read_doc`, `search_docs` and `get_examples`.
- The `bulk-classify` skill, the same document served at
  https://classifier.dev/skill.md, which tells the agent when a network call
  beats reading the inputs itself.

## Install

Claude Code, from this repository as a marketplace:

    claude plugin marketplace add mrmps/classifier-dev
    claude plugin install classifier@classifier-dev

Codex, the same way:

    codex plugin marketplace add https://github.com/mrmps/classifier-dev
    codex plugin add classifier

ChatGPT: search the directory for classifier.dev once it is listed, or with
developer mode on add `https://classifier.dev/mcp` as a connector with
"No Authentication" (see https://classifier.dev/mcp-setup).

## Layout

    .claude-plugin/plugin.json   Claude Code manifest
    .codex-plugin/plugin.json    ChatGPT and Codex manifest, with the directory listing
    .mcp.json                    the two servers, shared by both manifests
    skills/bulk-classify/        the skill; a test keeps it equal to src/SKILL.md
    assets/                      logo and composer icon for the ChatGPT directory
    marketplace-review.md        listing copy and the review test cases, per directory

`claude plugin validate --strict plugins/classifier` checks the Claude manifest
and the skill. The version in both manifests and in the two marketplace files
moves together; `test/plugin.test.ts` fails when they disagree.
