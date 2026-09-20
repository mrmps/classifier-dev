# Launch token pricing

Decision: Jev at published inference cost; Gemini escalation at 20% above
published inference cost. A Smart request without escalation has no surcharge.
The versioned candidate card is `src/retail-rates.json`. It is not yet connected
to production billing. Provider pricing must be rechecked before activation.

## Rates

Verified September 20, 2026, in USD per million tokens:

| Component | Provider list rate | Customer rate |
| --- | ---: | ---: |
| Jev input | 0.042 | 0.042 |
| Jev output | 0 | 0 |
| Gemini input, excluding cache reads | 0.750 | 0.900 |
| Gemini output, including reported reasoning | 3.750 | 4.500 |
| Gemini cached input | 0.075 | 0.090 |

Sources: [TypeSafe](https://typesafe.ai/blog/introducing-system-one-models-and-jev),
[Gemini model](https://openrouter.ai/google/gemini-3.8-flash), and the
[live OpenRouter model catalog](https://openrouter.ai/api/v1/models), exact ID
`google/gemini-3.8-flash`. That Gemini price is advertised as 50% off; no expiry
was found. Do not assume the discount is permanent or silently change existing
reservations to a new rate version.

Charges include provider-reported shared instructions/labels, not merely caller
input text. Cache reads are a subset of prompt tokens, not additional input.
Reasoning tokens included in completion usage must not be added twice. Missing
measurements remain unknown. No flat per-request fee or Smart-mode fee is added.

All rates fit exact integer nanoUSD pricing. The wallet preserves sub-credit
remainders, so splitting a batch does not multiply rounding charges. Every
reservation must pin its rate version and a proven maximum exposure before
calling a provider.

## Economics of a fully consumed $20 plan

Assumptions: standard US domestic Stripe payments (2.9% + $0.30), Stripe Billing
(0.7%), and OpenRouter Standard platform fee (5.5% on inference credit cost).
Actual account contracts, payment methods and discounts may differ.

Sources: [Stripe](https://stripe.com/pricing),
[Autumn's explanation of Stripe fees](https://useautumn.com/pricing),
[OpenRouter](https://openrouter.ai/pricing).

Stripe costs $1.02 per $20 subscription under these assumptions. Gemini landed
cost is modeled as list inference cost multiplied by 1.055. The 20% list markup
leaves 12.08% of Gemini retail revenue before our payment and operating costs.

| Gemini share of redeemed retail dollars | Contribution after provider/platform/payment fees |
| ---: | ---: |
| 0% | -$1.02 |
| 25% | -$0.42 |
| 50% | +$0.19 |
| 75% | +$0.79 |
| 100% | +$1.40 |

Formula: `-1.02 + 20 * geminiRetailShare * (1 - 1.055 / 1.20)`.
This share refers to Gemini-priced dollars, NOT the fraction of requests using
Smart: many Smart requests do not escalate. Break-even is approximately 42.21%
Gemini-priced spend, before infrastructure, free usage, refunds, taxes, disputes
and any paid Autumn subscription. Unused allowance is not assumed for profitability.

At-cost Jev is deliberately subsidized: a fully consumed all-Jev plan cannot
cover payment processing, regardless of the markup on a model that customer
doesn't use. Do not describe the product as profitable at these launch prices.

## Signup and service costs

The approved $5 one-time personal grant costs up to $5 in Jev inference, or
approximately $4.40 in Gemini inference including modeled OpenRouter fees.
10,000 fully redeemed grants therefore represent approximately $44k–$50k,
before infrastructure. Existing anonymous free usage is additional subsidy.

Autumn's published Free limits at inspection are $8k monthly billing volume,
10k customers/entities and 10M API calls. Pro is $375/month, with 20M calls then
$5/M. These limits make aggregation necessary, but even the fixed subscription
fee can outweigh our thin contribution. Confirm the actual agreement and alert
before each allowance is reached; do not assume unlimited free metering.

Other demo plans presently include more usage dollars than their price. They
must not be launched unchanged with at-cost Jev economics; only the $20/$20
offer is approved here.

## Activation boundaries

- This card explicitly covers direct TypeSafe `jev-1.13.0` and Gemini only.
- The existing Fast fallback chains and disabled Vercel transport are not priced
  by this card. Resolve their customer-visible billing policy and bounds before
  enabling paid traffic; do not infer free usage or silently bill another rate.
- Explicit cache-write, search, audio and image services are not included.
- Provider retries/malformed answers can cost us without yielding a billable
  answer. Provider expense and customer charges need separate treatment; the
  contribution table assumes successful work and is not a measured net margin.
- A provider price increase must trigger review before activation of a revised
  version. Record the new effective version and update customer-facing prices.
- All customers will use the new pricing/limits after the verified cutover;
  there is no grandfathered plan in the approved target architecture.
- Analytics Engine is the chosen analytics backend. Neon remains the exact
  billing authority. Earlier PostHog/grandfathering proposals are superseded.
