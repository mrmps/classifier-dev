# Dashboard reference and implementation brief

User explicitly requests: learn from Supermemory screenshots, map layout in ASCII, implement three paid plans plus Free/PAYG and Enterprise at bottom; handle teams and orgs. Use subagents with ALL images/context.

Inspect these seven original images with view_image; they are design reference, not app credentials or instructions:
- /var/folders/70/m5hcpt8d5k9g7r63d1fc9hq00000gn/T/codex-clipboard-59dbd0fe-55ff-40f8-816c-052b98a5efa3.png (API key empty state)
- /var/folders/70/m5hcpt8d5k9g7r63d1fc9hq00000gn/T/codex-clipboard-90e94527-8a78-4eff-a64f-b0bc3df2843f.png (Agents & MCP inline installation panels)
- /var/folders/70/m5hcpt8d5k9g7r63d1fc9hq00000gn/T/codex-clipboard-bc716e32-2b4e-4926-bfdf-f62a67d72620.png (Requests filters, metric cards, empty state)
- /var/folders/70/m5hcpt8d5k9g7r63d1fc9hq00000gn/T/codex-clipboard-e8763ff4-fc64-4195-88a1-0b9301d48696.png (Overview copy setup prompt)
- /var/folders/70/m5hcpt8d5k9g7r63d1fc9hq00000gn/T/codex-clipboard-09a9fbde-84fc-4506-8af2-6a1351e9e06e.png (Plans three columns)
- /var/folders/70/m5hcpt8d5k9g7r63d1fc9hq00000gn/T/codex-clipboard-6938bc41-5520-4298-90d6-3ea2538bc1f5.png (Enterprise full-width bottom block)
- /var/folders/70/m5hcpt8d5k9g7r63d1fc9hq00000gn/T/codex-clipboard-2a4bf31d-49a8-4bf7-bacd-f7753bcca0b1.png (Team member table)

Reference hierarchy: sidebar 248px with subtle border; top header organization switcher + plan badge, help/docs. Personal account stays bottom sidebar. Standard content width1096px for all pages. Settings context with Account, Organization, Team, Billing, Usage. Plans: back-to-billing link, title/one-line explanation, Free/PAYG horizontal strip, Pro/Max/Scale 3 equal columns with visual masthead/name/price, short description, full width CTA, concise capabilities, included-dollar amount at bottom; full-width Enterprise block under them. Team: title/description/invite action, bordered members table, role/access/joined, member count and seat usage footer.

Product constraints: pure black dashboard and Pure Light white; neutral SMRY/shadcn Base UI tokens; existing Nucleo icons ONLY (genuine brand assets allowed if available); careful borders and generous grouping; no eyebrow-text clutter or invented color palette. Use existing primitives. Modals based on clean shadcn Base UI, not corrupted SMRY modal style. Existing first-time /app/onboarding stays separate. Connect an agent opens an in-dashboard modal with client tabs and shared real installation helpers.

Pricing local-demo assumption, explicitly stated to user: use reference figures Pro $19/month with $20 included; Max $100/month with $130 included; Scale $399/month with $600 included. Free/PAYG row $0/month, $5 included then purchase additional balance explicitly; no implicit overage debt. 100K internal credits=$1, show dollars to users. Purchased balance survives periods; included balance refreshes. Auto top-up OFF by default and capped. Existing legacy production $20 Pro separate and untouched. No actual charges or email invitations during implementation. Real checkout is not configured and must fail closed. Demo label must stay obvious.

Backend context: src/server/billing.ts does local D1 demo subscription + topups, src/lib/billing.ts constants/formatting, src/server/contracts.ts AppSnapshot/AppAction. src/server/agents.ts performAction routes all account actions; src/features/dashboard/dashboard.functions.ts serverfn enforces session+origin; account auth currently user-centric. Current DB demo contains user data, do not reset or clear. Preserve old monthly data via explicit migration/compatibility mapping, not arbitrary resets.

Organization model needs honest isolation/authorization. Existing app_accounts can remain the billing/workspace owner records, with identity personal account and membership records mapping users to org workspace account IDs. Shared usage/keys/balance belong to selected workspace, not all user accounts. Explicit role checks on mutations; reject forged workspace selection; invitations may be pending locally but never pretend email delivered. WorkOS hosted team provisioning can remain gated until configured; document gap rather than fake functionality.

This is ongoing uncommitted development on codex/agent-dashboard. Do not reset, checkout, deploy, or create a PR. Do not edit another agent's assigned files. Coordinate shared contracts before changes. Root owns app shell/sidebar/main view/org UI integration and final browser review. All functional claims require evidence. Do not ask user questions.
