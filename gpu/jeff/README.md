# Shared Jeff Fast inference

One GPU and one loaded model serve interactive and bulk requests together. Each
request is encoded once. The scheduler anchors on the oldest eligible request,
groups similar token lengths, and dispatches up to eight requests within an
8,192 padded-token budget. An individual request can use the full 8,192-token
context. Inputs exceeding that limit are rejected, never truncated.

Interactive requests wait up to 2 ms to form a batch; bulk requests wait up to
10 ms. These are batching waits, **not response deadlines**: requests also wait
for work already running. An aged bulk request becomes the anchor after four
interactive batches. The admission limit is 128 active callers; expired work
already executing cannot be interrupted, so at most one additional GPU batch
and one encoder operation can remain in flight. All queues are in memory.

## Measured result — 2026-10-05

On an RTX PRO 6000 Blackwell, the selected graph-free profile completed 18,000
HTTP requests at 100 requests/second with zero errors: a two-minute 50/50 mix
and a one-minute mix with 90% bulk traffic. Server threads were restricted to
four logical CPUs. These are **localhost HTTP** measurements, not internet SLAs.

| Traffic | Interactive p50 / p95 / p99 | Bulk p50 / p95 / p99 |
| --- | --- | --- |
| 50% interactive, 50% bulk | 32.7 / 77.9 / 368.4 ms | 41.2 / 119.0 / 666.4 ms |
| 10% interactive, 90% bulk | 30.0 / 64.1 / 514.9 ms | 42.9 / 119.9 / 655.8 ms |

The two-minute run delivered 52,890 real input tokens/second and peaked at
3.21 GiB reserved CUDA memory. Saturation screening reached 181–186 requests/sec
with adaptive batching versus 60–63 with batch 1, but higher queue depth raised
latency. Those controls used different identical GPUs on the same host. Open-loop
overload at 200–300 requests/sec produced 429s and occasional deadline errors;
do not advertise saturation throughput together with the 100-rps latency.

All 5,943 source-development predictions passed retention gates against both
native Jeff and the published fixed-batch recipe. Native macro deltas were
−0.0925 percentage points on broad and +0.2608 on general. All input tensors,
counts and graft boundaries matched the original preparation in 1,712 batch
comparisons. These point gates are not statistical noninferiority or a new
JevBench result. Weights, BF16 precision and context handling are unchanged.

Cold startup took 148–161 seconds in the initial profiles; a cached start took
84 seconds. New shapes can still stall compilation, contributing to p99. The
source panels cover 102–4,034 rendered tokens, below the supported maximum.
A remote SSH path handled 10 requests/sec at 333 ms p95 but failed heavily at
100 requests/sec; a public gateway still needs separate qualification.

A proposed tensor-count optimization passed quality but failed to establish a
performance win in a same-GPU ABBA comparison; it was discarded. Full aggregate
measurements, rejected experiments, errors, hashes and quality losses are in
[measurements.json](evidence/measurements.json). Raw receipts remain in the
research workspace's `jeff-adaptive-20261005/receipts` directory.

## Run on a new NVIDIA GPU

The image includes the pinned weights, native code, CUDA-enabled Python packages
and compiler headers. The host needs an NVIDIA container runtime and a driver
compatible with CUDA 13. It does not need a separate CUDA toolkit. Blackwell
has been exercised; other GPUs require the same quality and load checks.

```sh
docker build -t jeff-serving gpu/jeff
# Supply a random JEFF_API_KEY of at least 24 characters through your secret manager.
docker run --rm --gpus 'device=0' -p 8080:8080 \
  -e JEFF_API_KEY -e JEFF_GRAPHS=off \
  -v jeff-cache:/cache jeff-serving
```

Use the image digest produced by the **Jeff serving image** workflow for remote
deployment. Its CPU build verifies imports, recipe hashes and every weight file;
GPU readiness and numerical checks are separate. See [Salad deployment](SALAD.md)
for the IPv6 gateway, account scope, GPU selection and secret injection. The
Salad template is not evidence of a completed Salad deployment.

Public `GET /healthz` reports process health. `GET /readyz` returns 503 until
model loading and inference warmup succeed. Authenticated `GET /metrics` exposes
queue depth, batch counts, actual/padded token counters and CUDA memory. Warmup
does not eliminate compilation for every possible future input shape. Cache
volumes reduce repeat compilation, but replacement GPU hosts can be cold.

`POST /v1/decide` accepts this body with `Authorization: Bearer <JEFF_API_KEY>`:

```json
{"id":"example-1","priority":"interactive","timeout_ms":5000,
 "request":{"state":"The light is green.","question":{
 "type":"choice","instructions":"Which color is the light?",
 "criteria":{"green":"Green","red":"Red"}}}}
```

Response fields are `id`, native `answer`, keyed `probabilities`, real rendered
`input_tokens`, actual `batch_size`, and `timing` in milliseconds. Supported
question types are native Jeff `choice`, `noul` and `score`; images are rejected.
Responses use 400 for invalid schema, 413 for body/context limits, 429 for full
admission, 504 for deadlines, and 503 for unavailable inference. A GPU failure
removes readiness. The service does not log request text, IDs or authentication
headers; the caller controls any reverse-proxy logging.

Configuration: `JEFF_MAX_BATCH` (1–8), `JEFF_MAX_BATCH_TOKENS` (at least 8192),
`JEFF_BATCH_WAIT_MS`, `JEFF_BULK_WAIT_MS`, `JEFF_MAX_QUEUE`, and `JEFF_GRAPHS`.
Graph policies are `on` (partitioned dynamic capture), `off` (compiled kernels
without CUDA graphs), and `static` (dynamic capture and graph partitioning
disabled). Changing graph policy, GPU or batching requires requalification.

## Reproduce checks and load measurements

Client scripts need Python 3.12 and the pinned `aiohttp` dependency. Export the
same `JEFF_API_KEY`; create an empty results directory. Use a ready, otherwise
idle server and never overwrite evidence files.

```sh
python gpu/jeff/e2e.py --url http://HOST:8080 --out results/e2e.json --min-observed-batch 2
python gpu/jeff/load_test.py --url http://HOST:8080 \
  --input broad.jsonl --input general.jsonl --mode open --rate 100 \
  --requests 6000 --timeout-ms 5000 --label mixed-100 --out results/mixed-100.json
```

Input JSONL uses `id`, `state`, `question`, `question_type`, and
`options: [{"id": "...", "description": "..."}]`. IDs must be unique across
files. The default deterministic traffic mix is 50% interactive/50% bulk.
Open-loop measurements include dispatch lag, errors and drain time, with no
client concurrency cap. Use `--mode closed --concurrency 32` separately to find
saturation; its response-dependent arrivals are not an offered-rate SLA test.
`--export-predictions FILE` saves a complete single pass for the existing quality
evaluator. No response cache or synthetic padding tokens count as throughput.

`parity.py` compares all input tensors, masks, option counts and graft splits
against the immutable preparation code for complete source panels. It requires
the GPU runtime and pinned recipe/checkpoint. Quality evidence additionally
requires actual HTTP predictions and the existing independent development
gates, as specified in [acceptance criteria](ACCEPTANCE.md).

## Model and provenance

This is a serving implementation of the published
[Jeff Fast recipe](https://huggingface.co/opensporks/Jeff-Fast-Qwen3.5-0.8B), built
from [Jeff's original weights](https://huggingface.co/mstrasser/Jeff-Qwen3.5-0.8B)
and [native implementation](https://github.com/firelex/jeff). It retains
855,344,192 parameters, BF16, the published graft16 and original temperature.
`recipe.lock.json` pins immutable revisions and checksums. The downloaded recipe
preserves its upstream notices: model weights are Apache-2.0, native code MIT;
dataset terms are separate. This is not an official Jeff release.
