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
100 requests/sec. A temporary HTTPS Quick Tunnel then completed 6,000/6,000
mixed requests offered at 100/sec with no retries or errors:

| Remote HTTPS traffic | p50 | p95 | p99 |
| --- | --- | --- | --- |
| Interactive | 224 ms | 391 ms | 640 ms |
| Bulk | 236 ms | 457 ms | 761 ms |

The HTTPS overload/recovery checks passed with 192 long requests, below the
gateway's 200-in-flight cap. A heavier 256-request probe hit a transport error;
both failed and passing probes are retained in [HTTPS evidence](evidence/https.json).
Quick Tunnels have no uptime guarantee; Salad and a production gateway remain
unqualified. These finite load tests do not establish a production SLA.

A proposed tensor-count optimization passed quality but failed to establish a
performance win in a same-GPU ABBA comparison; it was discarded. Full aggregate
measurements, rejected experiments, errors, hashes and quality losses are in
[measurements.json](evidence/measurements.json). Raw receipts remain in the
research workspace's `jeff-adaptive-20261005/receipts` directory.

## Latency-first serving

A separate latency screen on the same RTX PRO 6000 used one request per batch,
zero intentional waits, four logical CPU cores, and exclusively interactive traffic.
On the same loaded model/GPU, two 600-request runs at 25 requests/sec measured
18.65/18.84 ms p95 inference and 26.19/26.20 ms p95 localhost HTTP latency.
A 1,000-request run at 50/sec completed without errors:

| Stage at 50 requests/sec | p50 | p95 | p99 |
| --- | --- | --- | --- |
| Inference stage | 12.06 ms | 19.86 ms | 24.90 ms |
| Entire localhost HTTP request | 14.58 ms | 28.01 ms | 35.15 ms |

The inference stage includes collation, device transfer and result conversion;
it is not CUDA-event-only kernel timing. These are evenly spaced arrivals, not a
burst guarantee. The low-contention, sequential 512-request measurement was
13.89 ms p50/24.73 ms p95 for complete HTTP requests. Turning off the original
2 ms wait removes about 2 ms at that operating point; most of the earlier
224 ms remote median was the network path, not batching.

Use the same image with these additional settings for this profile:

```sh
-e JEFF_MAX_BATCH=1 -e JEFF_BATCH_WAIT_MS=0 -e JEFF_BULK_WAIT_MS=0
```

Keep capacity available and avoid running long bulk requests ahead of interactive
work. Zero intentional wait does not prevent queueing when requests arrive faster
than the GPU completes them. For a latency guarantee, reserve interactive capacity,
route long/bulk work to separate capacity, and scale or reject overload promptly.
The full 8,192-token API limit remains unchanged; the measurements do not establish
20 ms latency for every input length. All 5,943 predictions passed the same four
quality-retention gates. The full general panel had 21.77 ms p95 inference and a
581 ms HTTP outlier, retained in the evidence; the 20 ms inference target is not
universal across workloads.

Serve through a persistent TLS connection to a GPU near the request source. A
readiness check doing no inference still took 180–190 ms on four of five reused
connection samples (one reused request spiked to 313 ms); model tuning cannot remove that transport delay. Direct regional
routing remains to be provisioned. A remote client should expect network round-trip
plus server time, not localhost latency. Evidence is in
[latency.json](evidence/latency.json).

## Run on a new NVIDIA GPU

The image includes the pinned weights, native code, CUDA-enabled Python packages
and compiler headers. The host needs an NVIDIA container runtime and a driver
compatible with CUDA 13. It does not need a separate CUDA toolkit. Blackwell
has been exercised; other GPUs require the same quality and load checks.

```sh
JEFF_IMAGE=ghcr.io/mrmps/classifier-dev/jeff-serving@sha256:0b3c46aaa8f9d756e1374294413f47c908bb736abc561f58b9e48bfad3cd568b
# Supply a random JEFF_API_KEY of at least 24 characters through your secret manager.
docker run --rm --gpus 'device=0' -p 8080:8080 \
  -e JEFF_API_KEY -e JEFF_GRAPHS=off \
  -v jeff-cache:/cache "$JEFF_IMAGE"
```

The [image receipt](evidence/image.json) links the successful build and anonymous
registry verification. To build locally, run `docker build -t jeff-serving gpu/jeff`
and substitute `jeff-serving` for the image above. The CPU build verifies imports,
recipe hashes and every weight file;
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

## Temporary remote HTTPS check

For a temporary endpoint, install the Linux AMD64 binary from the pinned
[cloudflared 2026.9.3 release](https://github.com/cloudflare/cloudflared/releases/tag/2026.9.3),
verify SHA-256 `77e26d8d900e0b8469f416239d14b5f296525fdf79fee6f511ef55609e3fbac2`,
and run on the GPU host:

```sh
cloudflared tunnel --no-autoupdate --url http://127.0.0.1:8080
```

Use the printed HTTPS URL with the same application bearer key. Keep the process
running. The URL changes on restart; this adds no production DNS configuration.
[Quick Tunnel limits](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)
include 200 in-flight requests and no uptime guarantee. The tested remote
admission/recovery profile stays below that gateway limit while increasing work
per request so network arrival smoothing does not hide server overload:

```sh
python gpu/jeff/e2e.py --url https://YOUR-TUNNEL.trycloudflare.com \
  --overload-requests 192 --overload-state-words 4000 \
  --overload-timeout-ms 10000 --out results/e2e-https.json
```

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
