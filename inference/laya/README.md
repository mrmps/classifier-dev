# Laya and Kev on Beam

Both models are hosted by Beam on its shared inference endpoints. There is no
deployment of our own any more: the Modal app `classifier-laya-router-trial-west`,
its adapter, its image build and its smoke tests were removed when production
moved to Beam.

```sh
curl https://classifier.dev/v1/classify -H 'Content-Type: application/json' \
  -d '{"model":"laya","processing":"fast","input":"Please refund this charge","labels":["billing","technical"]}'
curl https://classifier.dev/v1/classify -H 'Content-Type: application/json' \
  -d '{"model":"kev","input":"Please refund this charge","labels":["billing","technical"]}'
```

## What Beam serves

| | `jev/laya` | `jev/kev` |
|---|---|---|
| Model | ModernBERT-large, trained decision head | Qwen2.5-0.5B, LoRA + pointer head |
| Context | 512 tokens (state plus one question) | 8,192 tokens (one packed sequence) |
| Questions per request | 32 upstream; we pack at most 16 items | 32 |
| Price | $0.021 per 1M input tokens, output free | same |

Beam caps every request at 32 named questions whatever the model, so a large
batch becomes several requests, run concurrently and reassembled in input
order by `runJevBatches`. Laya's item ceiling is 16, chosen from what Beam
actually accepts: 20 items of ordinary support text passed and 25 were
refused. A context refusal is translated to `max_tokens_exceeded`, which makes
the batch halve and retry, so an underestimate costs a round trip rather than
the request.

## Credential and configuration

`BEAM_API_KEY` is a Worker secret holding a Beam workspace token. It is the
only credential either model needs; requests are billed per token to that
workspace. `LAYA_ENABLED` must be `"true"`. There are no URLs to configure —
`src/jev.ts` owns the endpoint — and no `LAYA_MODAL_KEY`/`LAYA_MODAL_SECRET`
any more.

```sh
npx wrangler secret put BEAM_API_KEY
```

## Capacity and limits

| | Fast | Bulk |
|---|---|---|
| Request | One decision, up to four questions | Up to 1,000 questions |
| Per caller | 60 questions/min, 2,000/day | 1,000 questions/min, 20,000/day |

Lane quotas are a product decision about shared capacity, not a property of
Beam, and they are unchanged by the move. They apply to paid and operator keys
too, and count attempts. Neither lane has a pool to start, so cold-start 503s
are gone; a Beam refusal is returned as it happened rather than retried,
because the quota has already counted the attempt and a model at capacity will
not clear inside a backoff.

## Cost

Usage-priced, with no idle cost. At $0.021 per 1M input tokens and roughly 50
input tokens for a short single-label decision, a million such decisions cost
about **$1.05**. The Modal deployment this replaced was billed by allocation:
$1.6216/hour per lane after the narrow-region multiplier, about **$1,168 per
30-day month** for the warm fast lane alone, whether or not it served traffic.

Retail is zero during the trial, so the input-token spend is ours. Because
Beam reports token counts, account analytics now records a real provider cost
for these models instead of marking it unknown as it did for Modal.

## Measuring

`node inference/laya/latency.mjs <output.json>` records 20 sequential
synthetic requests from one client, separates the first call, and reports
end-to-end, Worker and quota timings. Do not equate the Worker-to-Beam span
with client latency, and measure other client regions independently: one
shared endpoint is not a replica in every region.
