// Generated from the design prototype by tools/port.py (pricing.html). Edit the prototype, then re-run the port.
export const PRICING_TOP = String.raw`<section class="sec" id="plans" aria-label="Plans">
  <div class="rail">
    <div class="cells cells--4 plans">
      <div class="cell plan">
        <div class="plan__head"><h3 class="cell__title plan__name">Free</h3><p class="cell__body">For trying the API and shipping a first integration</p></div>
        <p class="plan__price"><span class="t-figure"><data value="plan.free.price">$0</data></span><span>always free</span></p>
        <a class="btn btn--soft plan__btn" href="/auth/sign-up">Start for free</a>
        <ul class="plan__list"><li><svg class="i" aria-hidden="true"><use href="#i-coins"/></svg><span><data value="plan.free.credit">$5</data> signup credit</span></li><li><svg class="i" aria-hidden="true"><use href="#i-user"/></svg><span><data value="plan.free.seats">1</data> workspace seat</span></li><li><svg class="i" aria-hidden="true"><use href="#i-globe"/></svg>Public access without an account</li><li><svg class="i" aria-hidden="true"><use href="#i-zap"/></svg>Fast and Smart classification</li></ul>
      </div>
      <div class="cell plan plan--pick">
        <div class="plan__head"><h3 class="cell__title plan__name">Pro</h3><p class="cell__body">For developers and personal agents in production</p></div>
        <p class="plan__price"><span class="t-figure"><data value="plan.pro.price">$20</data></span><span>per month</span></p>
        <a class="btn btn--accent plan__btn" href="/auth/sign-up?returnTo=/app/plans">Choose Pro</a>
        <ul class="plan__list"><li><svg class="i" aria-hidden="true"><use href="#i-wallet"/></svg><span><data value="plan.pro.included">$20</data> of usage each month</span></li><li><svg class="i" aria-hidden="true"><use href="#i-users"/></svg><span><data value="plan.pro.seats">3</data> workspace seats</span></li><li><svg class="i" aria-hidden="true"><use href="#i-gauge"/></svg><span><data value="plan.pro.rate">10×</data> rate limits</span></li><li><svg class="i" aria-hidden="true"><use href="#i-chart-column"/></svg>Usage by connection and agent</li></ul>
      </div>
      <div class="cell plan">
        <div class="plan__head"><h3 class="cell__title plan__name">Scale</h3><p class="cell__body">For teams running classification in production</p></div>
        <p class="plan__price"><span class="t-figure"><data value="plan.scale.price">$200</data></span><span>per month</span></p>
        <a class="btn btn--soft plan__btn" href="/auth/sign-up?returnTo=/app/plans">Choose Scale</a>
        <ul class="plan__list"><li><svg class="i" aria-hidden="true"><use href="#i-wallet"/></svg><span><data value="plan.scale.included">$200</data> of usage each month</span></li><li><svg class="i" aria-hidden="true"><use href="#i-infinity"/></svg>Unlimited workspace seats</li><li><svg class="i" aria-hidden="true"><use href="#i-gauge"/></svg><span><data value="plan.scale.rate">100×</data> rate limits</span></li><li><svg class="i" aria-hidden="true"><use href="#i-chart-column"/></svg>Usage by connection and agent</li></ul>
      </div>
      <div class="cell plan">
        <div class="plan__head"><h3 class="cell__title plan__name">Enterprise</h3><p class="cell__body">For capacity, infrastructure or a contract</p></div>
        <p class="plan__price"><span class="t-figure">Custom</span></p>
        <a class="btn btn--soft plan__btn" href="mailto:contact@classifier.dev">Contact sales</a>
        <ul class="plan__list"><li><svg class="i" aria-hidden="true"><use href="#i-server"/></svg>Volume-based capacity</li><li><svg class="i" aria-hidden="true"><use href="#i-box"/></svg>Dedicated deployment</li><li><svg class="i" aria-hidden="true"><use href="#i-lock"/></svg>Private inference options</li><li><svg class="i" aria-hidden="true"><use href="#i-target"/></svg>Accuracy measured on your data</li></ul>
      </div>
    </div>
    <div class="band" aria-hidden="true"></div>
    <div class="usage">
      <div class="usage__side">
        <span class="side-ico"><svg class="i" aria-hidden="true"><use href="#i-gauge"/></svg></span>
        <h3 class="cell__title">Usage</h3>
        <p class="cell__body">The same rates on every plan. Included usage is spent first, then top-ups, which never expire.</p>
        <p class="usage__foot">Output tokens are free. Top-ups go from <data value="topup.min">$5</data> to <data value="topup.max">$1,000</data>.</p>
      </div>
      <div class="cells rates">
        <div class="cell rate"><p class="rate__fig"><data value="rate.input">$0.042</data></p><p class="rate__tag">per million input tokens</p></div>
        <div class="cell rate"><p class="rate__fig"><data value="rate.smart">$2</data></p><p class="rate__tag">per 1,000 Smart mode reviews</p></div>
        <div class="cell rate"><p class="rate__fig"><data value="rate.long">$0.084</data></p><p class="rate__tag">per million tokens in long documents</p></div>
        <div class="cell rate"><p class="rate__fig"><data value="rate.web">$2.20</data></p><p class="rate__tag">per 1,000 web pages, plus classification</p></div>
      </div>
    </div>
  </div>
  <div class="rail"><div class="cells cells--2 plimits"><div class="cell"><h3 class="cell__title">Rate limits</h3><p class="cell__body">Counted in classifications and shared across a workspace’s keys and agents. Free access is limited per IP.</p></div><div class="cell"><div class="dtable btable"><table><thead><tr><th scope="col">Plan</th><th scope="col" class="n">Fast</th><th scope="col" class="n">Smart</th></tr></thead><tbody><tr><td>Free</td><td class="n"><data value="lim.free.fast">3,000/min · 20,000/day</data></td><td class="n"><data value="lim.free.smart">200/min · 2,000/day</data></td></tr><tr><td>Pro</td><td class="n"><data value="lim.pro.fast">30,000/min · 200,000/day</data></td><td class="n"><data value="lim.pro.smart">2,000/min · 20,000/day</data></td></tr><tr><td>Scale</td><td class="n"><data value="lim.scale.fast">300,000/min · 2,000,000/day</data></td><td class="n"><data value="lim.scale.smart">20,000/min · 200,000/day</data></td></tr></tbody></table></div></div></div></div>
</section>
<section class="sec" id="enterprise" aria-labelledby="ent-t">
  <div class="rail">
    <div class="sec-head"><div class="sec-head__copy"><h2 class="t-title" id="ent-t">Enterprise</h2><p class="t-body">By arrangement, for more capacity, private infrastructure or a contract. Say which you need and roughly how many classifications a day.</p></div><div class="sec-head__acts"><a class="btn btn--ink btn--sm" href="https://cal.com/michaelsf/coffee" target="_blank" rel="noopener">Book a call</a><a class="btn btn--soft btn--sm" href="mailto:contact@classifier.dev">contact@classifier.dev</a></div></div>
    <div class="cells cells--4 pent"><div class="cell"><h3 class="cell__title">Dedicated deployment</h3><p class="cell__body">The service in your own cloud account: AWS, GCP or another.</p></div><div class="cell"><h3 class="cell__title">Private inference</h3><p class="cell__body">End-to-end encrypted, so the texts are readable only inside your deployment.</p></div><div class="cell"><h3 class="cell__title">Higher accuracy</h3><p class="cell__body">A model tuned to your labels and your data, measured on your data before you commit.</p></div><div class="cell"><h3 class="cell__title">Lower latency</h3><p class="cell__body">Served closer to your traffic, on capacity that is yours.</p></div></div>
  </div>
</section>`;
