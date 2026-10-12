# Jev-Omni on RunPod

`akhilaaa3/Jev-Omni` is a 12B multimodal decision model — Gemma 4 12B IT plus a
256-slot linear head over the last hidden state — behind the System One door in
`server.py`. It answers text, image, audio and video questions in the same
`{state, questions} -> {answers}` shape the rest of `src/jev.ts` speaks.

## The pod

| | |
|---|---|
| Pod | named `jevomni-systemone`; the id is in the RunPod account |
| GPU | NVIDIA A40 48GB, secure cloud (the datacenter is whatever had stock) |
| Cost | **$0.59/hr**, billed by the hour — $431/mo at 24/7 |
| Endpoint | `https://<pod-id>-8000.proxy.runpod.net/v1/systemone` |
| Credential | `JEVOMNI_TOKEN`, a bearer the server refuses to start without |
| Revision | `5addda86ddee081a68fb067477ea100c221b8917`, pinned |

The pod id is not written down here, and neither is the pod's public IP. The id
*is* the proxy hostname, so committing it publishes a reachable door to a GPU
that bills by the hour, and a bearer is the only thing behind it. It belongs in
the `JEVOMNI_URL` Worker secret beside `DGEMMA_URL` and `CHUNKLAYA_URL`, the way
every other service's endpoint here does. Read it from the account when needed:
`GET rest.runpod.io/v1/pods`.

`$0.59/hr` is what secure cloud actually charges. The GraphQL `lowestPrice`
field advertises `$0.35` for the same card and does not match the rented rate;
price the card from a create response, not from that field.

`provision.sh` is the whole setup and `restart.sh` restarts without
re-downloading the weights. Both read `JEVOMNI_TOKEN` from the environment and
neither contains it:

```sh
scp server.py requirements.txt provision.sh restart.sh root@<pod>:/root/
ssh root@<pod> "JEVOMNI_TOKEN=... setsid /root/provision.sh > /root/provision.log 2>&1 &"
```

They are in this repo on purpose. The dgemma pod's start script exists only
inside a RunPod template, so it cannot be reviewed, diffed or rebuilt from the
repository; this one should not repeat that.

The pod is provisioned over SSH onto a stock
`runpod/pytorch:1.0.2-cu1281-torch280-ubuntu2404` image rather than from the
`Dockerfile` here, because the account has no container registry. The Dockerfile
is the reproducible form of the same thing and wants a registry before it is
worth anything: a replacement pod today costs a 23GB weight download, not a
container pull.

The start command must carry `--no-access-log`. Uvicorn's access log records the
client address of every request, which `src/privacy.ts` exists to prevent us
from holding; through the proxy those are RunPod's own `100.64.x` hops, but the
pod has a public IP and they would be real caller addresses the moment it is
reached directly.

Two things the stock image gets wrong, both fixed on the running pod:

  - `pip` refuses to install without `--break-system-packages` (PEP 668).
  - `torchaudio` ships pinned to the image's torch 2.8 and `requirements.txt`
    pulls torch 2.14, so `libtorchaudio.so` fails to load with an undefined
    `torch::autograd::deleteNode` and takes the whole process down on import.
    No torchaudio release matched torch 2.14, so it is uninstalled. **Audio is
    therefore untested on this pod**; text, image and video do not touch it.

## Measured on the A40

Pod-side, two separately rented A40s (2026-10-09 CA-MTL-1, 2026-10-12 EU-SE-1)
agreeing to the millisecond and returning identical probabilities:

| | per decision | throughput |
|---|---|---|
| Short text (~15 tokens) | 79–83ms | ~12.9/s — ~1.11M/day |
| Image (64×64 PNG) | ~320ms | ~3/s |
| Long text (~2,000 tokens) | 761ms | 1.3/s — ~113k/day |
| Model load to first answer | 10.6–11.7s | |
| VRAM | 23.1GB of 46GB | |

Delivered through RunPod's proxy, which costs more than the inference does:

| | warm p50 | cold (incl. TLS) |
|---|---|---|
| EU-SE-1 | 263ms | 814ms |
| CA-MTL-1 | 310ms | 891ms |

Two regions 6,000km apart differ by only ~50ms, so the ~180ms floor is the
proxy's own hops rather than distance. Reaching the pod's public IP directly
would avoid it; the pod has one, it just does not serve 8000 on it.

There is no batching to be had. `jev_omni.predict` hardcodes `batch=1` and
`use_cache=False`, so a request with N questions is N forward passes under one
lock; 32 questions cost 32x one question. The head would take a batch — it masks
logits by a per-row option count — so a batched `predict` is the single change
that would move these numbers.

The consequence upstream: the bulk lane's 1,000 questions is ~78s of short-text
forward passes, over the 60s timeout in `src/dgemma.ts`. Jev-Omni suits the
image/audio door, not the packed bulk path, until that batch exists.

## Door shape

One media file per request, not four. `predict` attaches one file to one
question, so a body carrying more is refused as `jevomni_input` rather than
silently answered off the first image. That is a regression against
`DGEMMA_MAX_IMAGES` if Jev-Omni ever replaces dgemma.

Refusals: `jevomni_unauthorized` (401), `jevomni_input` (400),
`jevomni_unavailable` (502/503). Logs carry counts and durations only — never
state text, never a question, never a caller, the same rule as `src/privacy.ts`.

## License

The card says "Apache-2.0, following Gemma 4. Dataset rights remain separate."
The head, `jev_omni.py` and the fine-tune are the author's to license; the
Gemma 4 weights underneath are not, and stay under Google's Gemma Terms of Use
with its Prohibited Use Policy and its pass-through obligation. Serving it
commercially is permitted; calling it Apache-2.0 on our own pages is not.

## Testing it

```sh
JEVOMNI_URL=https://<pod-id>-8000.proxy.runpod.net JEVOMNI_TOKEN=... python3 smoke.py
```

Twelve checks: health, both 401s, a text choice, a noul, an image decision, the
five `jevomni_input` refusals and packed item resolution. All twelve passed
against the A40 pod on 2026-10-09 — image `red` @ 0.9988 in 1,512ms.

`smoke.py` shells out to curl on purpose. The RunPod proxy sits behind
Cloudflare, which answers `Python-urllib`'s default user agent with **403**
while letting curl through, so a 403 from the proxy says nothing about whether
the pod is up. Check the pod's status before believing it.
