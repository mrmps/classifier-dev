import { FOOT, HOME_CSS, META, NAV } from "./home";
import { BILLING_PLANS, formatCreditsUsd } from "./lib/billing";
import retailRates from "./retail-rates.json";
import { esc, page } from "./ui";

const feature = (text: string) => `<li>${esc(text)}</li>`;

export function pricingHtml() {
  const pro = BILLING_PLANS.pro;
  const tokenRows = retailRates.models
    .map(
      (rate) => `<tr><th scope="row">${rate.provider === "typesafe" ? "Jev" : rate.provider === "openrouter" ? "Gemini escalation" : esc(rate.model)}</th>
        <td>${Number(rate.inputUsdPerMillion) === 0 ? "Free" : `$${Number(rate.inputUsdPerMillion)}`}</td>
        <td>${Number(rate.cachedInputUsdPerMillion) === 0 ? "Free" : `$${Number(rate.cachedInputUsdPerMillion)}`}</td>
        <td>${Number(rate.outputUsdPerMillion) === 0 ? "Free" : `$${Number(rate.outputUsdPerMillion)}`}</td></tr>`,
    )
    .join("");
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
.plan-summary{display:grid;grid-template-columns:max-content 1fr;gap:12px 26px;padding-block:28px}
.plan-summary dt{color:var(--dim);font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase}
.plan-summary dd{margin:0;color:var(--fg);font-size:15px;font-weight:600}
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
.enterprise-note{padding-block:28px;border-block:1px solid var(--rule);color:var(--muted)}
.enterprise-note a{color:var(--accent);font-weight:600;text-decoration:none}
.pricing-section>*+*{margin-top:16px}
.pricing-section>h2{font-size:20px;color:var(--bright);text-transform:lowercase}
.pricing-section>p{max-width:72ch;color:var(--muted)}
.pricing-table{overflow-x:auto;border:1px solid var(--line)}
.pricing-table table{min-width:620px}.pricing-table th,.pricing-table td{padding:13px 16px;text-align:start}
.pricing-table thead th{color:var(--dim);background:transparent;font-size:12px;text-transform:uppercase}
.pricing-table tbody tr+tr{border-top:1px solid var(--rule)}
.pricing-table tbody th{color:var(--fg);font-weight:500;border:0}.pricing-table td{font-variant-numeric:tabular-nums}
.pricing-note{font-size:12px;color:var(--dim)}
@media(hover:hover){.plan-action:hover,.enterprise-note a:hover{color:var(--bright)}}
@media(max-width:760px){.pricing>*+*{margin-top:44px}.plan-grid{grid-template-columns:1fr}.plan{min-height:0;padding:24px 20px}.plan+.plan{border-inline-start:0;border-block-start:1px solid var(--line)}.plan-kicker{min-height:0}.plan-price{margin-top:24px}.plan-action{margin-top:8px}}
@media(max-width:480px){.pricing-intro{padding-block-start:8px}.plan-summary{grid-template-columns:1fr;gap:5px}.plan-summary dd+dt{margin-top:14px}}
`,
    body: `${NAV("pricing")}<div class="page"><main class="doc pricing" id="main">
  <header class="pricing-intro"><h1>pricing</h1><p>simple plans with upfront usage</p></header>
  <dl class="plan-summary"><dt>Every plan</dt><dd>fast + smart classification · REST, MCP + CLI</dd><dt>Upgrade</dt><dd>more included usage + a shared workspace</dd></dl>
  <section class="plan-grid" aria-label="Plans">
    <article class="plan"><h2>Free</h2><p class="plan-kicker">for trying the API and shipping a first integration</p><p class="plan-price">$0 <small>always free</small></p>
      <ul>${feature(`${formatCreditsUsd(BILLING_PLANS.free.includedCredits)} signup credit`)}${feature("1 workspace seat")}${feature("Public access without an account")}${feature("Fast + Smart classification")}</ul>
      <a class="plan-action" href="/auth/sign-up">Get started</a></article>
    <article class="plan featured"><h2>${esc(pro.name)}</h2><p class="plan-kicker">for developers and personal agents in production</p>
      <p class="plan-price">$${pro.priceCents / 100} <small>/ month</small></p>
      <ul>${feature(`${formatCreditsUsd(pro.includedCredits)} of usage each month`)}${feature(`${pro.seatLimit} workspace seats`)}${feature("Usage by connection and agent")}${feature("No automatic top-ups")}</ul>
      <a class="plan-action" href="/auth/sign-up?returnTo=/app/plans">Choose Pro</a></article>
    <article class="plan"><h2>Enterprise</h2><p class="plan-kicker">for teams that need capacity, infrastructure or a contract</p><p class="plan-price">Custom</p>
      <ul>${feature("Volume-based capacity")}${feature("Dedicated deployment")}${feature("Private inference options")}${feature("Measured accuracy on your data")}</ul>
      <a class="plan-action" href="mailto:contact@classifier.dev">Contact sales</a></article>
  </section>
  <p class="enterprise-note">need custom limits or enterprise features? <a href="mailto:contact@classifier.dev">get in touch</a></p>
  <section class="pricing-section" aria-label="Token prices"><h2>Token prices</h2>
    <p>Prices per million tokens. Fast uses Jev at cost. Smart adds Gemini at cost plus 20% only when it escalates.</p>
    <div class="pricing-table"><table><thead><tr><th scope="col">Model</th><th scope="col">Input</th><th scope="col">Cached input</th><th scope="col">Output</th></tr></thead><tbody>${tokenRows}</tbody></table></div>
    <p class="pricing-note">Smart requests without escalation cost the same as Fast. Gemini output includes reasoning tokens. Metered usage stops when your balance reaches zero. Laya lanes are free during the trial, subject to shared capacity limits.</p>
  </section>
  <section class="pricing-section" aria-label="Included on every plan"><h2>Included on every plan</h2>
    <p>Classify with your own labels through REST, MCP or the CLI. Inputs are not stored, and billing data stays separate from classification analytics.</p>
  </section>
  <section class="pricing-section" aria-label="Legacy Pro"><h2>Legacy pro</h2>
    <p>Existing <code>classifier_pro_</code> keys keep their 10× public rate limits. <a class="inline" href="/login?returnTo=/app/plans">Log in with your billing email</a> to manage your existing subscription in your workspace. You don’t need to subscribe again.</p>
  </section>
  ${FOOT}
</main></div>`,
  });
}
