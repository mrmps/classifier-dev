# Jev-Omni on RunPod

`akhilaaa3/Jev-Omni` is a 12B multimodal decision model — Gemma 4 12B IT plus a
256-slot linear head over the last hidden state — behind the System One door in
`server.py`. It answers text, image, audio and video questions in the same
`{state, questions} -> {answers}` shape the rest of `src/jev.ts` speaks.

## The pod

| | |
|---|---|
| Pod | named `jevomni-systemone`; the id is in the RunPod account |
| GPU | NVIDIA L40S 48GB, secure cloud, US (created with `countryCodes: ["US"]`) |
| Cost | **$1.09/hr**, billed by the hour — $796/mo at 24/7 |

The pod is in the US because that is where it measured best for US callers
(109ms warm text, against 225ms from an EU pod; see below). An A40 at $0.59/hr
serves the same suite and is the cheaper choice where one is in stock — none
was in the US when this pod was made, so the create fell through to the L40S.
List the A40 first in `gpuTypeIds` with `gpuTypePriority: "custom"` to get it
when it is there.
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

`provision.sh` is the whole setup, `restart.sh` restarts without
re-downloading the weights, and `stop.sh` is what both use to stop the server.
They read `JEVOMNI_TOKEN` from the environment and none of them contains it:

```sh
scp server.py requirements.txt provision.sh restart.sh stop.sh root@<pod>:/root/
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

What the stock image and the upstream loader get wrong, all handled by the
scripts here:

  - `pip` refuses to install without `--break-system-packages` (PEP 668).
  - `torchaudio` ships built against the image's torch 2.8 and
    `requirements.txt` pulls torch 2.14, so `libtorchaudio.so` fails on an
    undefined `torch::autograd::deleteNode` and takes the process down at
    import. Nothing needs it — `soundfile` does the audio decoding — so
    `provision.sh` removes it.
  - **Upstream bug: audio never worked as shipped.** `jev_omni.predict` makes
    its ffmpeg output path with `NamedTemporaryFile`, which creates the file,
    then runs ffmpeg without `-y`. ffmpeg refuses to overwrite, prints
    `Not overwriting - exiting`, and every audio request ends in
    `LibsndfileError`. `provision.sh` adds the `-y` and warns if the patch
    stops applying, which is the signal that upstream fixed it.
  - `fuser` is not installed (no psmisc), so `fuser -k 8000/tcp` silently does
    nothing; the new server fails to bind and the old one keeps answering with
    the old code in memory. `stop.sh` finds the process through `/proc`
    instead, from a script file, because a `pkill -f` pattern in an ssh command
    matches that ssh command and kills the session.
  - **Changing a running pod's ports recreates its container.** With no
    network volume that wipes the container disk — the 23GB of weights, the
    scripts, the patched loader — and the server with it. Decide the ports at
    create time.

## Measured on the A40

Pod-side, two separately rented A40s (2026-10-09 CA-MTL-1, 2026-10-12 EU-SE-1)
agreeing to the millisecond and returning identical probabilities:

| | per decision | throughput |
|---|---|---|
| Short text (~15 tokens) | 77–89ms | ~12.9/s — ~1.11M/day |
| Image (256×256 PNG) | 160–430ms | ~3–6/s |
| Audio (5s of speech, 173KB WAV) | 172–576ms | ~2–6/s |
| Video (4s clip, 16 frames sampled) | 2.7–4.1s | ~0.3/s |
| Long text (~2,000 tokens) | 761ms | 1.3/s — ~113k/day |
| Text at the 32,000-character item cap | 3.2s | |
| Model load to first answer | 10.6–11.7s | |
| VRAM | 23.1GB of 46GB | |

Every modality answers correctly on its fixture (`podtest.py`): text, image,
both speech clips, a solid-colour video, and a red-then-blue clip asked which
colour comes first — `red` at 0.925, the lowest confidence of the set, which is
in keeping with the card's MVBench 53.10%.

Every format the door accepts was sent and answered correctly:

| | formats |
|---|---|
| Image | PNG, JPEG, WebP, static GIF |
| Audio | WAV, MP3 (`audio/mpeg`), AAC (`audio/mp4`), Opus (`audio/webm`) |
| Video | MP4 (H.264), WebM (VP9); a 30s clip answers like a 4s one, since 16 frames are sampled whatever the length |

Noul questions work over media (`is it red?` 0.983, `is it blue?` 0.000), and
several questions over one clip answer independently (a crash report: category
`technical`, `crash?` 0.931, `refund?` 0.001).

Three things that are true but easy to get wrong:

  - **Confidence thins out with more options.** The same red image is `red` at
    0.9985 among four colours and `red` at 0.6475 among twenty. The card
    establishes quality only up to 20 options; the head accepts 256.
  - **Questions about the audio itself are unreliable** even when questions
    about its content are right. On a clip the model correctly read as a
    refund request (`refund?` 0.977), "can anyone be heard speaking?" scored
    0.054.
  - **Long, mostly silent audio degrades the answer** even within the cap: the
    same 6s of speech padded to 40s went from `billing` at 0.988 to `account`
    at 0.362. Send the speech, not the recording around it.

Delivered through RunPod's proxy to a datacenter caller — the pod calling its
own public URL, which is what a Cloudflare Worker sees — on one kept-alive
connection, 2026-10-12, EU-SE-1:

| | p50 | p95 | of which model | proxy |
|---|---|---|---|---|
| Text | 130ms | 131ms | 74ms | ~55ms |
| Image | 250ms | 301ms | 195ms | ~55ms |
| Audio (173KB WAV) | 334ms | 357ms | 181ms | ~150ms |
| Video (4s) | 2,417ms | 2,715ms | 2,362ms | ~55ms |
| Text, new TLS connection each time | 169ms | 265ms | | |

The proxy costs about 55ms, not the ~180ms first measured: that figure came
from a residential connection in London, so most of it was distance and the
uplink. Audio's extra ~95ms is its ~240KB body plus the `ffprobe` duration
check, which spawns a process per request (~60ms of it, measured on
localhost). Large bodies are fine from a datacenter: 237KB crosses the proxy in
well under two seconds, where a slow residential uplink takes tens of seconds —
and scp to the pod is just as slow from there, so it is the uplink, not the
proxy.

Reaching the pod's public IP directly would save the ~55ms, which is not worth
what it costs: a TCP port is plain HTTP, so the bearer would cross the internet
unencrypted unless the pod terminates TLS itself, and adding the port to a live
pod wipes it (above).

An L40S in US-NC-1 ($1.09/hr) answers the same suite with the same choices and
is somewhat faster on everything but video: text 110ms and image 139ms through
the proxy, against the A40's 130ms and 250ms; video was slower there, 3.3s
against 2.4s, so the video path is bounded by something other than GPU compute
(frame decoding on the CPU is the likely candidate; not investigated).

Region matters more than the card. Each pod calling the other's public URL,
warm text p50:

| caller | pod in US-NC-1 (L40S) | pod in EU-SE-1 (A40) |
|---|---|---|
| in the US | **109ms** | 225ms |
| in the EU | 186ms | **142ms** |

A US caller pays twice as much against the EU pod; an EU caller pays only ~44ms
more against the US pod, because the L40S's faster compute absorbs some of the
Atlantic. Cold connections widen both gaps, since TLS takes several round trips.

**Concurrency is where it stops being crisp.** Requests run one at a time behind
a lock, so simultaneous callers queue, each adding about 80ms of text:

| text requests arriving together | fastest | p50 | slowest |
|---|---|---|---|
| 1 | 76ms | 76ms | 76ms |
| 2 | 78ms | 78ms | 179ms |
| 4 | 80ms | 268ms | 394ms |
| 8 | 84ms | 523ms | 863ms |
| 16 | 97ms | 1,110ms | 2,006ms |

And it is head-of-line: a text request that arrives just behind a video waits
for the video, 3.9s instead of 0.08s.

Both come from the same place. `jev_omni.predict` hardcodes `batch=1` and
`use_cache=False`, so a request with N questions is N forward passes under one
lock and N callers are N passes in a row; 32 questions cost 32x one question.
The head would take a batch — it masks logits by a per-row option count — so a
batched `predict` is the single change that would move these numbers.

The consequence upstream: the bulk lane's 1,000 questions is ~78s of short-text
forward passes, over the 60s timeout in `src/dgemma.ts`. Jev-Omni suits the
image/audio door, not the packed bulk path, until that batch exists.

## Door shape

One media file per request, not four. `predict` attaches one file to one
question, so a body carrying more is refused as `jevomni_input` rather than
silently answered off the first image. That is a regression against
`DGEMMA_MAX_IMAGES` if Jev-Omni ever replaces dgemma.

Input bounds, set by latency rather than memory. Without a KV cache every
question re-reads its whole state, and reads grow superlinearly: 32K characters
took 3.2s, 64K 11s, 128K 44s and 192K 97s, none of them out of memory.

| | limit | why |
|---|---|---|
| One state item, text + rubric | 32,000 characters | the line the service already draws between ordinary and long-context Jev |
| Read across all questions in a request | 128,000 characters | keeps a full request near 13s, inside the 60s the Worker waits |
| Media | 900,000 base64 characters | the dgemma door's ceiling, so neither door accepts what the other refuses |

Anything that still runs the GPU out of memory gets a 413 and the allocator's
cache back; before that, one oversized request left 42.7GB of 46GB held.

The media cap has a consequence for audio worth knowing: 16kHz mono WAV is
32KB a second, so a WAV fits only about 21 seconds; MP3, AAC or Opus fit the
full 30.

**Input the loader would silently cut is refused instead**, the same rule as
refusing a second image rather than answering off the first:

  - Audio over 30 seconds. The loader's ffmpeg call keeps the first 30 and
    drops the rest, and the answer gives no sign of it: a refund request
    spoken at 32–38s of a clip scored `refund?` 0.012 against 0.977 for the
    same words unpadded, while still returning a category at 0.59.
  - Animated GIFs, which the loader opens as their first frame. Send them as
    video, which samples across the whole clip.

Caller media is written to `/tmp` only after every check that can refuse the
request has passed, and is removed after inference whatever the outcome.
Decoding it first left the file behind whenever a later check refused.

Refusals: `jevomni_unauthorized` (401), `jevomni_input` (400, or 413 when the
GPU runs out of memory), `jevomni_unavailable` (502/503). Logs carry counts and
durations only — never state text, never a question, never a caller, the same
rule as `src/privacy.ts`.

## License

The card says "Apache-2.0, following Gemma 4. Dataset rights remain separate."
The head, `jev_omni.py` and the fine-tune are the author's to license; the
Gemma 4 weights underneath are not, and stay under Google's Gemma Terms of Use
with its Prohibited Use Policy and its pass-through obligation. Serving it
commercially is permitted; calling it Apache-2.0 on our own pages is not.

## Testing it

Two suites. `smoke.py` is the public door, from anywhere:

```sh
JEVOMNI_URL=https://<pod-id>-8000.proxy.runpod.net JEVOMNI_TOKEN=... python3 smoke.py
```

Twelve checks: health, both 401s, a text choice, a noul, an image decision, the
five `jevomni_input` refusals and packed item resolution.

`podtest.py` runs on the pod against localhost and covers what needs large
bodies or the pod's own disk: every modality, every advertised format, noul and
multi-question requests over media, the truncation refusals, every input bound,
and that no caller media is left in `/tmp`. It builds its image and video
fixtures with PIL and ffmpeg and transcodes the audio ones; the speech itself
has to be passed in, and its docstring has the `say` commands that made it:

```sh
scp podtest.py billing.wav technical.wav root@<pod>:/root/
ssh root@<pod> "JEVOMNI_TOKEN=... python3 /root/podtest.py /root/billing.wav /root/technical.wav"
```

Both passed in full on 2026-10-12 — 12/12 and 25/25.

`smoke.py` shells out to curl on purpose. The RunPod proxy sits behind
Cloudflare, which answers `Python-urllib`'s default user agent with **403**
while letting curl through, so a 403 from the proxy says nothing about whether
the pod is up. Check the pod's status before believing it.
