"""The System One door in front of Jev-Omni.

Jev-Omni is not a System One service. Its reference loader exposes one call,
`predict(state=, question=, options=, media=, modality=)`, which answers a
single question about a single state item with `batch=1` and `use_cache=False`
hardcoded. Everything in `src/jev.ts` upstream speaks the packed System One
shape instead: many state items, many named questions, one round trip. This
process is the translation, and it is the only thing that knows Jev-Omni's
reference interface exists.

Two consequences are worth stating plainly rather than hiding:

  - There is no batching to be had. The decision head would take a batch (it
    masks logits by a per-row option count) but `predict` never passes one, so
    a request with N questions is N forward passes, run under one lock because
    they share a GPU. Packing items upstream saves bytes here, not time.
  - One media per request. `predict` attaches one file to one question;
    dgemma's door accepts four images for the whole body. A body carrying more
    than one is refused rather than silently answered off the first image.

Logs carry counts and durations only. Never the state text, never a question,
never a caller's identity: the same rule as `src/privacy.ts` upstream. That rule
is also why this must run with `--no-access-log`: uvicorn's access log writes the
client address of every request, which is precisely what `privacy.ts` exists to
keep out of anything we hold. The flag lives in the start command, so it is not
visible in this file -- check it before trusting the rule.
"""
from __future__ import annotations

import base64
import binascii
import hmac
import logging
import os
import re
import tempfile
import threading
import time
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from jev_omni import load_jev_omni

MODEL_LABEL = "jev/omni"
MAX_QUESTIONS = 32
MAX_OPTIONS = 256
MAX_STATE_ITEMS = 20
# The head is trained to 256 slots but the card establishes quality only to 20.
QUALITY_OPTIONS = 20
DATA_URL = re.compile(r"^data:(image/(?:png|jpeg|webp|gif)|audio/(?:wav|mpeg|mp4|webm)|video/(?:mp4|webm));base64,(.+)$", re.S)
MODALITY_OF = {"image": "image", "audio": "audio", "video": "video"}
# Questions name their state item as `id` in the instructions, the way
# questionsFor() in src/jev.ts writes them.
BACKTICKED = re.compile(r"`([^`]{1,128})`")

# The pod is reachable on the public internet, so the token is the only thing
# between an idle GPU and somebody else's traffic. Set it or the pod refuses to
# start: a service that forgets its own gate is worse than one that is down.
TOKEN = os.environ.get("JEVOMNI_TOKEN", "")

log = logging.getLogger("jevomni")
app = FastAPI()
_lock = threading.Lock()
_model = None


class StateItem(BaseModel):
    id: str
    text: str
    rubric: str | None = None


class Question(BaseModel):
    type: str
    instructions: str
    criteria: dict[str, None] | None = None


class Body(BaseModel):
    model: str | None = None
    state: list[StateItem]
    questions: dict[str, Question]
    media: list[str] | None = None
    images: list[str] | None = None


def refuse(code: str, message: str, status: int = 400):
    return JSONResponse({"error": {"type": code, "message": message}}, status_code=status)


def state_for(question: Question, state: list[StateItem]) -> str:
    """The state item a question is about, or every item when it names none.

    A packed body asks about many items at once and each question names its
    own, so answering a question against the whole batch would both cost more
    tokens and invite the model to read the wrong item.
    """
    by_id = {item.id: item for item in state}
    named = [by_id[ref] for ref in BACKTICKED.findall(question.instructions) if ref in by_id]
    chosen = named[:1] or state
    return "\n\n".join(
        item.text if not item.rubric else f"{item.text}\n\nRUBRIC: {item.rubric}" for item in chosen
    )


def options_for(question: Question) -> list[str] | None:
    """Jev-Omni needs 2 to 256 named options; a noul is that as a yes/no."""
    if question.type == "noul":
        return ["Yes", "No"]
    if question.type != "choice" or not question.criteria:
        return None
    options = list(question.criteria.keys())
    return options if 2 <= len(options) <= MAX_OPTIONS else None


def media_file(url: str) -> tuple[str, str] | None:
    """A data URL written to a temp file, since `predict` reads a path."""
    found = DATA_URL.match(url.strip())
    if not found:
        return None
    mime, payload = found.group(1), found.group(2)
    try:
        blob = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError):
        return None
    if not blob:
        return None
    kind = MODALITY_OF[mime.split("/", 1)[0]]
    handle = tempfile.NamedTemporaryFile(suffix="." + mime.split("/", 1)[1], delete=False)
    handle.write(blob)
    handle.close()
    return kind, handle.name


@app.on_event("startup")
def warm() -> None:
    """Load once, then answer one throwaway question so the first caller does
    not pay for CUDA graph capture and the processor's first tokenization."""
    global _model
    if not TOKEN:
        raise RuntimeError("JEVOMNI_TOKEN must be set")
    started = time.monotonic()
    _model = load_jev_omni()
    _model.predict(state="ready", question="Is this service ready?", options=["Yes", "No"])
    log.warning("jevomni warm in %.1fs", time.monotonic() - started)


@app.get("/health")
def health():
    return {"ok": _model is not None, "model": MODEL_LABEL}


def authorized(request: Request) -> bool:
    header = request.headers.get("authorization", "")
    scheme, _, presented = header.partition(" ")
    if scheme.lower() != "bearer" or not presented:
        return False
    return hmac.compare_digest(presented, TOKEN)


@app.post("/v1/systemone")
def systemone(body: Body, request: Request):
    if not authorized(request):
        return refuse("jevomni_unauthorized", "A bearer token is required", 401)
    if _model is None:
        return refuse("jevomni_unavailable", "The model is still loading", 503)
    if not body.state or len(body.state) > MAX_STATE_ITEMS:
        return refuse("jevomni_input", f"state must hold 1 to {MAX_STATE_ITEMS} items")
    if not body.questions or len(body.questions) > MAX_QUESTIONS:
        return refuse("jevomni_input", f"questions must contain 1 to {MAX_QUESTIONS} named questions")

    supplied = (body.media or []) + (body.images or [])
    if len(supplied) > 1:
        return refuse("jevomni_input", "Jev-Omni reads at most one media file per request")
    attached = None
    if supplied:
        attached = media_file(supplied[0])
        if attached is None:
            return refuse("jevomni_input", "media must be one base64 data URL of a supported image, audio or video type")

    plan = []
    for qid, question in body.questions.items():
        options = options_for(question)
        if options is None:
            return refuse("jevomni_input", f"Question {qid} must be a noul or a choice over 2 to {MAX_OPTIONS} criteria")
        if len(options) > QUALITY_OPTIONS:
            log.warning("question asks %d options, above the established %d", len(options), QUALITY_OPTIONS)
        plan.append((qid, question, options))

    modality, path = attached or ("text", None)
    answers, started = {}, time.monotonic()
    try:
        with _lock:
            for qid, question, options in plan:
                result = _model.predict(
                    state=state_for(question, body.state),
                    question=question.instructions,
                    options=options,
                    media=path,
                    modality=modality,
                )
                probabilities = result["probabilities"]
                if question.type == "noul":
                    answers[qid] = {"noul": probabilities["Yes"]}
                else:
                    answers[qid] = {
                        "choice": result["prediction"],
                        "confidence": result["confidence"],
                        "probabilities": probabilities,
                    }
    except Exception as failure:
        # Deliberately not log.exception and deliberately not str(failure): a
        # traceback or an exception message can carry the state text, a file
        # path or a command line, and none of that is ours to write down.
        log.error("jevomni inference failed over %d questions: %s", len(plan), type(failure).__name__)
        return refuse("jevomni_unavailable", "The model could not answer this request", 502)
    finally:
        if path is not None:
            Path(path).unlink(missing_ok=True)

    elapsed = time.monotonic() - started
    log.warning("jevomni answered %d questions over %d items in %.0fms (%s)",
                len(plan), len(body.state), elapsed * 1000, modality)
    return {
        "model": MODEL_LABEL,
        "answers": answers,
        # Billed by the hour, so this is for observability upstream, never a price.
        "usage": {"input_tokens": 0, "output_tokens": 0, "forward_passes": len(plan),
                  "inference_ms": round(elapsed * 1000)},
    }
