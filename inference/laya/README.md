# Laya fast/bulk trial

Opt-in POST `/v1/classify` with `model: "laya"` and `processing: "fast"` (default) or `"bulk"`. Existing clients still use Jev. Both lanes use the same preloaded Laya 0.3.4 Router; `tier: "smart"` independently reviews uncertain answers. Laya accuracy/calibration has not been established by the Jev evaluation. Each result's existing `model` field identifies its actual checkpoint and lane; mixed-language batches can return `model: "mixed"` at the top level.

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

Text ≤2,000 characters, 2–16 labels ≤100 characters each, instructions ≤400 characters. The combined model input must also fit the selected checkpoint's context (512 English, 1,024 multilingual); long labels/instructions may hit the smaller question budget. Reject instead of truncate.

Modal app `classifier-laya-router-trial-west` colocates its compute and ingress in `us-west`, near west-coast Worker execution, and uses private proxy authentication. This avoids Modal's former east-to-global inter-region hop, but it is not a GPU replica in every region and does not promise the same client round-trip worldwide. Pools are isolated. Large flashes are shed, not absorbed into an unbounded backlog. Accepted payloads are only held in memory, never stored as durable jobs.

## Cost

At [Modal list prices](https://modal.com/pricing), checked 2026-09-20, base allocation is $0.80/hour L4 + 2 × $0.0473/hour CPU + 4 × $0.008/hour memory. The narrow-region 1.75× multiplier makes the colocated deployment approximately **$1.6216/hour per lane**.

- Warm fast: about **$38.92/day or $1,168 per 30-day month**.
- Bulk: about **$1.62 per allocated hour**, including startup/idle tails; another ~$1,168/month if continuously active.
- Both continuously active: about **$77.83/day or $2,335/month**. Fleet caps are not a hard dollar budget; CPU overage, other infrastructure, reviews, taxes and credits are separate.

Laya's explicit retail token rate is zero during the trial. Smart reviews retain existing prices. Provider-token spend is not Modal GPU hosting spend: inspect Modal usage for the actual bill. Account analytics marks combined provider cost unknown when Modal is involved.

## Model-card compliance

Checked against the [upstream model card](https://huggingface.co/convaiinnovations/laya) on 2026-09-20. This trial uses its recommended **preloaded Router**. English and multilingual inputs follow the SDK's unchanged routing heuristic. All three checkpoints are resident; typed-decisions is loaded but the default upstream Router does not automatically select it, and this API adds no checkpoint override. Language detection is heuristic, not an accuracy guarantee. Mixed-language rows are grouped by selected checkpoint, questions share one forward pass per checkpoint, and results are restored to input order. Fast and bulk use identical routing.

The image sets `USE_TF=0` to avoid the documented Transformers/TensorFlow initialization issue. We pin checkpoint revision `1c5edc17a7acd8701df6fc341c0d179f1c62c982`, bake all checkpoints into the image, and attach the locally loaded agents to `Router(max_loaded=3)` before preloading. HF/Transformers offline mode prevents downloads at startup or inference; language switches do not rebuild or evict models. CUDA failure aborts startup instead of silently serving on CPU. The adapter uses Laya's own sequence/marker construction, collation, option-count temperature buckets and probability decoding. Its intentional change is rejecting oversized inputs instead of silently truncating them.

The published fine-tuned benchmark wins are **not general zero-shot accuracy claims for this API**. Choice confidence is entropy-based certainty, not the winning label's probability. Shipped confidence can be overconfident; no classifier.dev-specific temperature fitting has been performed. Smart's existing confidence threshold is experimental with Laya and cannot catch confidently wrong answers. Evaluate and calibrate on representative, consented data before expanding this trial or trusting score thresholds.

## Operate and stop

Deploy the backend from the repository root:

```sh
uvx --from modal modal deploy inference/laya/deploy.py
```

Worker configuration lives in `wrangler.example.toml`; production deploys from main. Worker secrets `LAYA_MODAL_KEY` and `LAYA_MODAL_SECRET` contain a dedicated Modal proxy credential. Do not place them in source or logs.

To pause new requests, set `LAYA_ENABLED = "false"` in the canonical config and deploy. **Disabling the Worker route does not stop the warm GPU bill.** To stop both trial pools immediately:

```sh
uvx --from modal modal app stop classifier-laya-router-trial-west
```

Existing Jev remains available. Redeploy `deploy.py` and re-enable the Worker flag to resume. Do not scale up to hide overload without revisiting costs.

Watch model labels `laya-0.3.4-<checkpoint>-<lane>` in existing classifier analytics for successes and latency; rejected calls use `laya-0.3.4-routed-<lane>`. Account token usage aggregates under the routed lane model at the explicit zero trial rate. Compare with Modal allocation/invocation metrics. Measure client round-trip separately from the response's server processing time. Never add caller text or raw IP to diagnostic logs.

## Quota admission rollout

`QuotaCoordinator` keeps each caller's existing fast/smart tier counters and fast/bulk Laya counters in one object. A warm Laya request checks and writes both quotas in one durable operation. Anonymous fast calls first pass a local Cloudflare burst shield, then exact admission overlaps inference; an exact refusal aborts the in-flight Modal request and is still authoritative. Jev still shares its tier allowance with Laya, and a Laya lane still shares its allowance across tiers. Decision and question costs remain separate. A tier refusal spends nothing; a lane refusal retains the tier debit. Combined Laya admission fails closed if either counter is unavailable; Jev retains its existing fail-open behavior.

Deploy the transfer-aware `RateLimiter`, coordinator binding and migration with `QUOTA_COORDINATOR_ENABLED = "false"` first. After that deployment completes, enable the flag in a second deployment. On first use, each old object freezes its counters and forwards later requests. The coordinator imports the frozen snapshot without resetting the minute or day allowance. Interrupted imports retry the same snapshot. Only opaque Durable Object IDs, scope names and counters are stored. Migration adds latency on the first call, not every call.

Rollback by disabling `QUOTA_COORDINATOR_ENABLED` while retaining the new classes, bindings and forwarding code. **Do not roll back to code predating the transfer protocol:** its old counters are frozen and no longer authoritative. The disabled path continues to follow transferred counters. Neither successful admission nor forwarding uses unconfirmed storage writes.

Run `node inference/laya/latency.mjs <output.json>` before and after deployment from the same client. It records 20 sequential synthetic requests, separates the first call, and reports end-to-end, Worker, quota, Modal and backend timings. Do not equate backend compute time or the Worker-to-Modal span with client latency. The Worker targets Oregon (`aws:us-west-2`); Modal ingress and compute use `us-west`. Existing Durable Objects and databases are not relocated by these settings. Measure other client regions independently.

## Evidence

`live-checks.json` records synthetic direct-backend checks: both lanes accepted valid input, rejected invalid/oversized context, rejected unauthenticated requests, shed a 24-request concurrent flash with 429 rather than 5xx, and recovered. This is a bounded smoke test, not a sustained throughput or global latency guarantee.

`sdk-check.json` compares the batched adapter with official `Router.predict` on an L4 using English, Hindi and Spanish. Routing, answers, token counts and ordering match; checkpoint identities remain resident. Small BF16 batch-shape differences are checked within a 0.01 score tolerance. `public-smoke.mjs` checks the actual classifier.dev path, including 128-row bulk and mixed-language result models; it writes a local report to ignored `eval/data/laya-public-checks.json`.

Local regression checks include worker routing/order/failures/quota/billing, CLI forwarding, Python/Go forwarding, and asynchronous backend admission. For authenticated backend rechecks, pass a mode-600 JSON file containing the two Worker secret names to `smoke.py`; never commit that file.
