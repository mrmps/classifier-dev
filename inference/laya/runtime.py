"""Bounded, in-memory serving. Overload is explicit, never an unbounded GPU queue."""
import asyncio
import time


class Admission:
    def __init__(self, lane):
        self.capacity = 1 if lane == "fast" else 4
        self.pending = 0
        self.lock = asyncio.Lock()
        self.tokens = 4.0
        self.updated = time.monotonic()

    def enter(self, lane, questions):
        now = time.monotonic()
        self.tokens = min(4.0, self.tokens + (now - self.updated) * 20)
        self.updated = now
        if self.pending >= self.capacity or (lane == "fast" and questions > self.tokens):
            return False
        if lane == "fast":
            self.tokens -= questions
        self.pending += 1
        return True

    def leave(self):
        self.pending -= 1


def make_api(lane, predict):
    from fastapi import FastAPI, HTTPException, Request
    api = FastAPI()
    admission = Admission(lane)
    limit = 4 if lane == "fast" else 64

    @api.get("/health")
    async def health():
        return {"ok": True, "lane": lane, "max_questions": limit, "pending": admission.pending}

    @api.post("/predict")
    async def classify(request: Request):
        raw = bytearray()
        async for chunk in request.stream():
            raw.extend(chunk)
            if len(raw) > 256_000:
                raise HTTPException(413, "request too large")
        import json
        try:
            body = json.loads(raw)
        except (ValueError, UnicodeDecodeError):
            raise HTTPException(400, "invalid JSON")
        rows = body.get("batch") if isinstance(body, dict) else None
        if not isinstance(rows, list) or not 1 <= len(rows) <= (1 if lane == "fast" else 64):
            raise HTTPException(400, "invalid batch size")
        count = 0
        for row in rows:
            if not isinstance(row, dict) or not isinstance(row.get("state"), str) or not row["state"].strip():
                raise HTTPException(400, "state must be non-empty text")
            questions = row.get("questions")
            if not isinstance(questions, dict) or not questions:
                raise HTTPException(400, "questions are required")
            for q in questions.values():
                if not isinstance(q, dict) or q.get("type") not in ("choice", "noul") or not isinstance(q.get("instructions"), str):
                    raise HTTPException(400, "invalid question")
                if q["type"] == "choice" and (not isinstance(q.get("criteria"), dict) or not 2 <= len(q["criteria"]) <= 16):
                    raise HTTPException(400, "choice requires 2–16 labels")
            count += len(questions)
        if count > limit:
            raise HTTPException(400, "too many questions")
        if not admission.enter(lane, count):
            raise HTTPException(429, "lane busy; retry later", headers={"Retry-After": "1"})
        started = time.monotonic()
        try:
            try:
                await asyncio.wait_for(admission.lock.acquire(), timeout=5)
            except TimeoutError:
                raise HTTPException(429, "lane busy; retry later", headers={"Retry-After": "1"})
            try:
                task = asyncio.create_task(asyncio.to_thread(predict, rows))
                try:
                    results = await asyncio.shield(task)
                except asyncio.CancelledError:
                    # Do not release the GPU lock while its thread still runs.
                    await task
                    raise
            finally:
                admission.lock.release()
            return {"results": results, "lane": lane, "inference_ms": round((time.monotonic() - started) * 1000, 2)}
        except (ValueError, TypeError, KeyError):
            raise HTTPException(400, "input exceeds Laya context or has an invalid question")
        finally:
            admission.leave()

    return api


def load_router():
    """Preload all pinned checkpoints offline, retaining the SDK's public route IDs."""
    import laya
    import os
    from huggingface_hub import snapshot_download
    checkpoint = snapshot_download("convaiinnovations/laya", revision=os.environ["LAYA_REVISION"], local_files_only=True)
    router = laya.Router(device="cuda", max_loaded=3)
    for name, subfolder in (("english", None), ("multilingual", "multilingual"), ("typed-decisions", "typed-decisions")):
        agent = laya.load(checkpoint, subfolder=subfolder, device="cuda")
        if agent.device.type != "cuda":
            raise RuntimeError("Laya GPU initialization failed; refusing CPU fallback")
        router.attach(name, agent)
    router.preload()  # Already attached: no downloads, rebuilding, or eviction.
    return router


def start_server(lane):
    import threading
    import torch
    import uvicorn
    from adapter import predict_routed_batch
    router = load_router()

    def predict(rows):
        with torch.inference_mode():
            return predict_routed_batch(router, rows)

    server = uvicorn.Server(uvicorn.Config(make_api(lane, predict), host="0.0.0.0", port=8000,
                                         log_level="critical", access_log=False))
    threading.Thread(target=server.run, daemon=True).start()
    return server
