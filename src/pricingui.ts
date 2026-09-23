import { FOOT, HOME_CSS, META, NAV } from "./home";
import { BILLING_PLANS, formatCreditsUsd } from "./lib/billing";
import { INPUT_PRICE_PER_MILLION, ESCALATION_PRICE_PER_THOUSAND, LONG_CONTEXT_PRICING } from "./lib/classification-pricing";
import { LONG_CONTEXT_JOB_MAX_TOKENS } from "./long-context";
import { esc, page } from "./ui";

const feature = (text: string) => `<li>${esc(text)}</li>`;

export function pricingHtml(signedIn = false) {
  const pro = BILLING_PLANS.pro;
  const description =
    "Simple plans with upfront usage for classifier.dev workspaces.";
  return page({
    title: "Pricing · classifier.dev",
    head: META("classifier.dev pricing", description, "/pricing"),
    css: `${HOME_CSS}
.pricing{max-width:980px}
.pricing>*+*{margin-top:56px}
.pricing-intro{padding-block:22px 34px;border-block-end:1px solid var(--rule)}
.pricing-intro h1{font-size:30px;line-height:1.15;letter-spacing:-.025em;text-transform:lowercase}
.pricing-intro p{margin-top:8px;color:var(--muted);font-size:15px}
.plan-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border:1px solid var(--line)}
.plan{display:flex;min-width:0;min-height:430px;flex-direction:column;padding:28px 26px}
.plan+.plan{border-inline-start:1px solid var(--line)}
.plan h2{font-size:19px;color:var(--bright);text-transform:lowercase}
.plan.featured h2,.plan.featured .plan-price{color:var(--accent)}
.plan-kicker{min-height:40px;margin-top:8px;color:var(--muted);font-size:12px}
.plan-price{margin-top:34px;color:var(--bright);font-size:34px;font-weight:500;letter-spacing:-.035em;font-variant-numeric:tabular-nums}
.plan-price small{font-size:12px;font-weight:500;letter-spacing:0;color:var(--muted)}
.plan ul{display:flex;flex-direction:column;gap:12px;margin:26px 0;padding:0;list-style:none;color:var(--fg)}
.plan li{position:relative;padding-inline-start:16px}.plan li::before{content:"·";position:absolute;inset-inline-start:0;color:var(--dim)}
.plan-action{display:inline-flex;align-items:center;min-height:44px;margin-top:auto;color:var(--accent);font-weight:600;text-decoration:none;
  text-transform:lowercase;transition-property:color,scale;transition-duration:.1s;transform-origin:left center}
.plan-action::before{content:"[ ";color:var(--accent)}.plan-action::after{content:" ]";color:var(--accent)}
.plan-action:active{scale:.96}
.pricing-section>*+*{margin-top:16px}
.pricing-section>h2{font-size:20px;color:var(--bright);text-transform:lowercase}
.pricing-section>p{max-width:72ch;color:var(--muted)}
.pricing-table{overflow-x:auto;border:1px solid var(--line)}
.pricing-table table{min-width:620px}.pricing-table th,.pricing-table td{padding:13px 16px;text-align:start}
.pricing-table thead th{color:var(--dim);background:transparent;font-size:12px;text-transform:uppercase}
.pricing-table tbody tr+tr{border-top:1px solid var(--rule)}
.pricing-table tbody th{color:var(--fg);font-weight:500;border:0}.pricing-table td{font-variant-numeric:tabular-nums}
.rate-limits table{min-width:0;width:100%}.rate-limits th,.rate-limits td{padding:12px 10px;white-space:normal}
.pricing-note{font-size:12px;color:var(--dim)}
@media(hover:hover){.plan-action:hover{color:var(--bright)}}
@media(max-width:760px){.pricing>*+*{margin-top:44px}.plan-grid{grid-template-columns:1fr}.plan{min-height:0;padding:24px 20px}.plan+.plan{border-inline-start:0;border-block-start:1px solid var(--line)}.plan-kicker{min-height:0}.plan-price{margin-top:24px}.plan-action{margin-top:8px}}
@media(max-width:480px){.pricing-intro{padding-block-start:8px}}
`,
    body: `${NAV("pricing", signedIn)}<div class="page"><main class="doc pricing" id="main">
  <header class="pricing-intro"><h1>pricing</h1><p>simple plans with upfront usage</p></header>
  <section class="plan-grid" aria-label="Plans">
    <article class="plan"><h2>Free</h2><p class="plan-kicker">for trying the API and shipping a first integration</p><p class="plan-price">$0 <small>always free</small></p>
      <ul>${feature(`${formatCreditsUsd(BILLING_PLANS.free.includedCredits)} signup credit`)}${feature("1 workspace seat")}${feature("Public access without an account")}${feature("Fast + Smart classification")}</ul>
      <a class="plan-action" href="/auth/sign-up">Get started</a></article>
    <article class="plan featured"><h2>${esc(pro.name)}</h2><p class="plan-kicker">for developers and personal agents in production</p>
      <p class="plan-price">$${pro.priceCents / 100} <small>/ month</small></p>
      <ul>${feature(`${formatCreditsUsd(pro.includedCredits)} of usage each month`)}${feature(`${pro.seatLimit} workspace seats`)}${feature("10× rate limits")}${feature("Usage by connection and agent")}</ul>
      <a class="plan-action" href="/auth/sign-up?returnTo=/app/plans">Choose Pro</a></article>
    <article class="plan"><h2>Enterprise</h2><p class="plan-kicker">for teams that need capacity, infrastructure or a contract</p><p class="plan-price">Custom</p>
      <ul>${feature("Volume-based capacity")}${feature("Dedicated deployment")}${feature("Private inference options")}${feature("Measured accuracy on your data")}</ul>
      <a class="plan-action" href="mailto:contact@classifier.dev">Contact sales</a></article>
  </section>
  <section class="pricing-section" aria-label="Usage prices"><h2>Usage prices</h2>
    <div class="pricing-table rate-limits"><table><thead><tr><th scope="col">Usage</th><th scope="col">Price</th></tr></thead><tbody>
      <tr><th scope="row">Input tokens</th><td>$${INPUT_PRICE_PER_MILLION.toFixed(3)} / million</td></tr>
      <tr><th scope="row">Smart escalation</th><td>+$${ESCALATION_PRICE_PER_THOUSAND.toFixed(2)} / 1,000</td></tr>
      <tr><th scope="row">Jev long context (original context tokens)</th><td>$${(LONG_CONTEXT_PRICING.inputNanodollars / 1000).toFixed(3)} / million</td></tr>
    </tbody></table></div>
    <p>Smart starts with Fast and reviews uncertain answers. You pay the extra charge only for answers that are successfully reviewed. No escalation means no extra charge.</p>
    <p>For example, 1 million input tokens with 50 Smart escalations cost <strong>$0.142</strong>.</p>
    <p class="pricing-note">Output tokens are free. Input usage includes the text, labels and instructions processed by the base classifier. Retries, fallback routing and Smart model tokens add no separate charges. Paid requests already admitted can finish and leave a negative balance. New requests require a positive available balance. No automatic top-ups.</p>
    <p>Jev long context starts automatically above 32,000 characters with the default model or explicit Jev. It costs 2 × Jev's $${INPUT_PRICE_PER_MILLION.toFixed(3)} rate: <strong>$${(LONG_CONTEXT_PRICING.inputNanodollars / 1000).toFixed(3)} per million original context tokens</strong>, counted with cl100k_base once across inputs. Dimensions and actual screening or final-call usage do not multiply this price. 250,000 context tokens cost $${(250000 * LONG_CONTEXT_PRICING.inputNanodollars / 1e9).toFixed(3)}.</p>
    <p>Requires paid workspace balance or an active paid subscription; anonymous access and free signup credit do not qualify. Fast only, up to 250,000 original context tokens, 20 documents and 32 decisions within a 1 MB request. Each document × dimension or multi-label category counts as a decision.</p>
    <p>For larger documents, long-context jobs screen ordered uploads up to <strong>${(LONG_CONTEXT_JOB_MAX_TOKENS / 1e6).toFixed(0)} million original tokens</strong> at the same rate. A full job costs $${(LONG_CONTEXT_JOB_MAX_TOKENS * LONG_CONTEXT_PRICING.inputNanodollars / 1e9).toFixed(2)}. The workspace reserves its stated maximum at creation, then pays only for the tokens uploaded when final judgment succeeds. Jobs expire after 24 hours; unfinished jobs are refunded.</p>
    <p class="pricing-note">Final Jev reads selected evidence. Eligible chunks can be omitted when the final budget fills; usage.long_context reports selection. No usable evidence returns 422 long_context_no_evidence without charge. Explicit chunklaya remains a separate legacy opt-in. <a href="/docs">Read the long-context limits</a>.</p>
  </section>
  <section class="pricing-section" aria-label="Included on every plan"><h2>Included on every plan</h2>
    <p>Fast and Smart classification with your own labels through REST, MCP or the CLI.</p>
  </section>
  <section class="pricing-section" aria-label="Rate limits"><h2>Rate limits</h2>
    <div class="pricing-table rate-limits"><table><thead><tr><th scope="col">Plan</th><th scope="col">Fast</th><th scope="col">Smart</th></tr></thead><tbody>
      <tr><th scope="row">Free</th><td>3,000/min · 20,000/day</td><td>200/min · 2,000/day</td></tr>
      <tr><th scope="row">Pro</th><td>30,000/min · 200,000/day</td><td>2,000/min · 20,000/day</td></tr>
    </tbody></table></div>
    <p class="pricing-note">Limits count classifications and are shared across workspace keys and agents. Public access is limited per IP. Laya trial limits apply to every plan.</p>
    <p>Free access shares daily capacity and allows four requests at once per IP. A funded workspace has its own allowance and supports larger Smart requests. Signup credit alone uses the free limits.</p>
    <p class="pricing-note">See <a href="/developers">request limits and retry guidance</a>. Usage is reserved before a request and unused funds are released afterward. Anonymous proxy networks require a funded key.</p>
  </section>
  ${FOOT}
</main></div>`,
  });
}
