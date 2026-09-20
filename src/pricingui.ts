import { FOOT, HOME_CSS, META, NAV } from "./home";
import { BILLING_PLANS, formatCreditsUsd } from "./lib/billing";
import retailRates from "./retail-rates.json";
import { esc, page } from "./ui";

const CHECK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>`;

const feature = (text: string) => `<li>${CHECK}<span>${esc(text)}</span></li>`;

export function pricingHtml() {
  const pro = BILLING_PLANS.pro;
  const tokenRows = retailRates.models
    .map(
      (rate) => `<tr><th scope="row">${rate.provider === "typesafe" ? "Jev" : "Gemini escalation"}</th>
        <td>${Number(rate.inputUsdPerMillion) === 0 ? "Free" : `$${Number(rate.inputUsdPerMillion)}`}</td>
        <td>${Number(rate.cachedInputUsdPerMillion) === 0 ? "Free" : `$${Number(rate.cachedInputUsdPerMillion)}`}</td>
        <td>${Number(rate.outputUsdPerMillion) === 0 ? "Free" : `$${Number(rate.outputUsdPerMillion)}`}</td></tr>`,
    )
    .join("");
  const description =
    "Start free, then move to Pro when you need more usage and a shared workspace.";
  return page({
    title: "Pricing · classifier.dev",
    head: META("classifier.dev pricing", description, "/pricing"),
    css: `${HOME_CSS}
.pricing{max-width:1180px}
.pricing>*+*{margin-top:72px}
.pricing-hero{max-width:760px;padding-block:28px 12px}
.pricing-hero>*+*{margin-top:18px}
.pricing-hero h1{font-size:clamp(34px,6vw,64px);line-height:1.04;letter-spacing:-.045em}
.pricing-hero p{max-width:62ch;color:var(--muted);font-size:16px;line-height:1.6}
.pricing-hero .actions{display:flex;flex-wrap:wrap;gap:12px;margin-top:26px}
.pricing-button{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding-inline:16px;
  border-radius:var(--r);color:var(--fg);font-weight:600;text-decoration:none;box-shadow:inset 0 0 0 1px var(--line-strong);
  transition-property:background-color,color,scale;transition-duration:.1s}
.pricing-button.primary{color:var(--ink);background:var(--accent);box-shadow:none}
.pricing-button:active{scale:.96}
.plan-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
.plan{display:flex;min-width:0;flex-direction:column;padding:24px;background:var(--surface);border:1px solid var(--line);
  border-radius:calc(var(--r) + 6px)}
.plan.featured{border-color:var(--accent);box-shadow:0 20px 56px -40px var(--accent)}
.plan-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
.plan h2{font-size:18px;color:var(--bright)}
.plan-badge{padding:3px 8px;border-radius:999px;color:var(--accent);background:color-mix(in srgb,var(--accent) 12%,transparent);
  font-size:12px;font-weight:600;white-space:nowrap}
.plan-price{margin-top:22px;color:var(--bright);font-size:34px;font-weight:700;letter-spacing:-.04em;font-variant-numeric:tabular-nums}
.plan-price small{font-size:13px;font-weight:500;letter-spacing:0;color:var(--muted)}
.plan-copy{min-height:52px;margin-top:8px;color:var(--muted)}
.plan ul{display:flex;flex-direction:column;gap:12px;margin:24px 0;padding:0;list-style:none;color:var(--muted)}
.plan li{display:flex;align-items:flex-start;gap:9px}.plan li svg{width:16px;height:16px;flex:none;margin-top:3px;color:var(--accent)}
.plan .pricing-button{width:100%;margin-top:auto}
.pricing-section>*+*{margin-top:16px}
.pricing-section>h2{font-size:22px;color:var(--bright)}
.pricing-section>p{max-width:70ch;color:var(--muted)}
.pricing-table{overflow-x:auto;border:1px solid var(--line);border-radius:calc(var(--r) + 4px)}
.pricing-table table{min-width:620px}.pricing-table th,.pricing-table td{padding:13px 16px;text-align:start}
.pricing-table thead th{color:var(--muted);background:var(--surface)}
.pricing-table tbody tr+tr{border-top:1px solid var(--rule)}
.pricing-table tbody th{color:var(--fg);font-weight:500;border:0}.pricing-table td{font-variant-numeric:tabular-nums}
.pricing-note{font-size:12px;color:var(--dim)}
@media(hover:hover){.pricing-button:hover{background:var(--fg);color:var(--bg)}.pricing-button.primary:hover{background:var(--accent-hover);color:var(--ink)}}
@media(max-width:820px){.pricing>*+*{margin-top:52px}.plan-grid{grid-template-columns:1fr}.plan-copy{min-height:0}}
@media(max-width:640px){.pricing-hero{padding-block-start:12px}.pricing-hero h1{font-size:36px}.plan{padding:20px}}
`,
    body: `${NAV("pricing")}<div class="page"><main class="doc pricing">
  <header class="pricing-hero"><h1>Pricing that grows with your workload.</h1>
    <p>Try the API without an account. Create a workspace when you want usage credits, API keys and billing in one place.</p>
    <div class="actions"><a class="pricing-button primary" href="/auth/sign-up">Get started</a><a class="pricing-button" href="/login">Log in</a></div>
  </header>
  <section class="plan-grid" aria-label="Plans">
    <article class="plan"><div class="plan-head"><h2>Free</h2></div><p class="plan-price">$0 <small>/ month</small></p>
      <p class="plan-copy">Explore classifier.dev and ship a first integration without a card.</p>
      <ul>${feature(`${formatCreditsUsd(BILLING_PLANS.free.includedCredits)} signup credit`)}${feature("1 workspace seat")}${feature("Fast and Smart classification")}${feature("REST, MCP and CLI access")}</ul>
      <a class="pricing-button" href="/auth/sign-up">Start free</a></article>
    <article class="plan featured"><div class="plan-head"><h2>${esc(pro.name)}</h2><span class="plan-badge">For production</span></div>
      <p class="plan-price">$${pro.priceCents / 100} <small>/ month</small></p>
      <p class="plan-copy">For individual developers and personal agents running regular workloads.</p>
      <ul>${feature(`${formatCreditsUsd(pro.includedCredits)} of usage each month`)}${feature(`${pro.seatLimit} workspace seats`)}${feature("Usage by connection and agent")}${feature("No automatic top-ups")}</ul>
      <a class="pricing-button" href="/auth/sign-up?returnTo=/app/plans">Choose Pro</a></article>
    <article class="plan"><div class="plan-head"><h2>Enterprise</h2></div><p class="plan-price">Custom</p>
      <p class="plan-copy">For teams that need more capacity, private infrastructure or a contract.</p>
      <ul>${feature("Volume-based capacity")}${feature("Dedicated deployment")}${feature("Private inference options")}${feature("Measured accuracy on your data")}</ul>
      <a class="pricing-button" href="mailto:contact@classifier.dev">Contact sales</a></article>
  </section>
  <section class="pricing-section" aria-label="Token prices"><h2>Token prices</h2>
    <p>Prices per million tokens. Fast uses Jev at cost. Smart adds Gemini at cost plus 20% only when it escalates.</p>
    <div class="pricing-table"><table><thead><tr><th scope="col">Model</th><th scope="col">Input</th><th scope="col">Cached input</th><th scope="col">Output</th></tr></thead><tbody>${tokenRows}</tbody></table></div>
    <p class="pricing-note">Smart requests without escalation cost the same as Fast. Gemini output includes reasoning tokens. Usage stops when your balance reaches zero.</p>
  </section>
  <section class="pricing-section" aria-label="Included on every plan"><h2>Included on every plan</h2>
    <p>Classify with your own labels through REST, MCP or the CLI. Inputs are not stored, and billing data stays separate from classification analytics.</p>
  </section>
  <section class="pricing-section" aria-label="Legacy Pro"><h2>Legacy pro</h2>
    <p>Existing <code>classifier_pro_</code> keys keep their 10× public rate limits. New workspaces use the plans above; email <a class="inline" href="mailto:contact@classifier.dev">contact@classifier.dev</a> for help with a legacy subscription.</p>
  </section>
  ${FOOT}
</main></div>`,
  });
}
