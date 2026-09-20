# Laya fast/bulk trial

Opt-in POST `/v1/classify` with `model: "laya"` and `processing: "fast"` (default) or `"bulk"`. Existing clients still use Jev. Both lanes use the same English Laya 0.3.4 checkpoint; `tier: "smart"` independently reviews uncertain answers. Laya accuracy/calibration has not been established by the Jev evaluation.

```sh
curl https://classifier.dev/v1/classify -H 'Content-Type: application/json' \
  -d '{"model":"laya","processing":"fast","input":"Please refund this charge","labels":["billing","technical"]}'
node cli/classify.js billing,technical --model laya --processing bulk < tickets.txt
```

## Capacity and limits

| | Fast | Bulk |
|---|---|---|
| GPU pool | One warm L4; max one | Zero to one L4; idle shutdown after 60s |
| Request | One decision, up to four questions | Up to 1,000 questions; sequential chunks of at most 64 |
| Per caller | 60 questions/min, 2,000/day | 1,000 questions/min, 20,000/day |
| GPU admission | One request at a time; 20 questions/s, burst four | At most four requests in memory, one GPU forward at a time; queue wait at most 5s |

One single-label decision is one question. Multi-label asks one question per label. Lane quotas apply to paid/operator keys too, in addition to normal tier quotas, and count attempts (including failed inference and retries). Rejected work returns 429 with Retry-After; cold/unavailable bulk returns 503. No silent lane/model fallback. A cold 1,000-question attempt can spend that minute's quota; retries must respect the next window. Source CLI retries are bounded at three minutes per batch. SDK/CLI additions are in this repository, not a new package release.

Text ≤2,000 characters, 2–16 labels ≤100 characters each, instructions ≤400 characters. The combined model input must also fit 512 tokens; long labels/instructions may hit the smaller question budget. Reject instead of truncate.

Modal app `classifier-laya-trial` has global compute placement (no west-coast pin), one ingress in `us-east`, and private proxy authentication. This is not a GPU replica in every region, and does not promise 40–70ms worldwide. Pools are isolated. Large flashes are shed, not absorbed into an unbounded backlog. Accepted payloads are only held in memory, never stored as durable jobs.

## Cost

At [Modal list prices](https://modal.com/pricing), checked 2026-09-20, approximate allocation cost is $0.80/hour L4 + 2 × $0.0473/hour CPU + 4 × $0.008/hour memory = **$0.9266/hour per lane**.

- Warm fast: about **$22.24/day or $667 per 30-day month**.
- Bulk: about **$0.93 per allocated hour**, including startup/idle tails; another ~$667/month if continuously active.
- Both continuously active: about **$44.48/day or $1,334/month**. Fleet caps are not a hard dollar budget; CPU overage, other infrastructure, reviews, taxes and credits are separate.

Laya's explicit retail token rate is zero during the trial. Smart reviews retain existing prices. Provider-token spend is not Modal GPU hosting spend: inspect Modal usage for the actual bill. Account analytics marks combined provider cost unknown when Modal is involved.

## Operate and stop

Deploy the backend from the repository root:

```sh
uvx --from modal modal deploy inference/laya/deploy.py
```

Worker configuration lives in `wrangler.example.toml`; production deploys from main. Worker secrets `LAYA_MODAL_KEY` and `LAYA_MODAL_SECRET` contain a dedicated Modal proxy credential. Do not place them in source or logs.

To pause new requests, set `LAYA_ENABLED = "false"` in the canonical config and deploy. **Disabling the Worker route does not stop the warm GPU bill.** To stop both trial pools immediately:

```sh
uvx --from modal modal app stop ap-4YUdW6OcN20o37oO6AILE6
```

Existing Jev remains available. Redeploy `deploy.py` and re-enable the Worker flag to resume. Do not scale up to hide overload without revisiting costs.

Watch model labels `laya-0.3.4-english-fast` / `laya-0.3.4-english-bulk` in existing classifier analytics for successes, latency and 429/503 rates; compare with Modal allocation/invocation metrics. Measure client round-trip separately from the response's server processing time. Never add caller text or raw IP to diagnostic logs.

## Evidence

`live-checks.json` records synthetic direct-backend checks: both lanes accepted valid input, rejected invalid/oversized context, rejected unauthenticated requests, shed a 24-request concurrent flash with 429 rather than 5xx, and recovered. This is a bounded smoke test, not a sustained throughput or global latency guarantee.

Local regression checks include worker routing/order/failures/quota/billing, CLI forwarding, Python/Go forwarding, and asynchronous backend admission. For authenticated backend rechecks, pass a mode-600 JSON file containing the two Worker secret names to `smoke.py`; never commit that file.
