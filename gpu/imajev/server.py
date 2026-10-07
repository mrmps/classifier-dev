"""Authenticated, bounded serving of the pinned Imajev decision model."""

import asyncio
import hmac
import json
import os
from pathlib import Path
import sys
import time

ROOT = Path(os.environ.get("IMAJEV_ROOT", "/opt/imajev"))
sys.path[:0] = [str(ROOT / "src"), str(ROOT / "scripts"), str(ROOT / "scripts/playground")]

import torch
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from server import TorchBackend, PlaygroundError, decode_images, decode_data_url, compile_payload
from vision_decision.calibration import TemperatureCalibrator
from vision_decision.jev_api import to_response


def create_app():
    token = os.environ["IMAJEV_TOKEN"]
    if len(token) < 32:
        raise ValueError("IMAJEV_TOKEN must contain at least 32 characters")
    torch.set_num_threads(int(os.environ.get("IMAJEV_CPU_THREADS", "4")))
    torch.set_num_interop_threads(1)
    backend = TorchBackend(bundle=ROOT / "artifacts/model-qwen4b.json",
                           adapter=ROOT / "adapters/imajev-4b", fast=True, merge_lora=True)
    backend.model = "imajev-4b"
    calibration = TemperatureCalibrator.load(ROOT / "adapters/imajev-4b/calibration.json")
    from PIL import Image
    warmup, _ = compile_payload({"state": "", "questions": {"ready": {
        "type": "choice", "instructions": "Identify the dominant color.",
        "criteria": {"red": None, "green": None, "blue": None},
    }}}, backend.max_options)
    for size in [(224, 224), (448, 448), (640, 640)]:
        backend.score([Image.new("RGB", size, "red")], warmup)
    torch.cuda.synchronize()
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    busy = asyncio.Lock()
    slots = asyncio.Semaphore(4)

    @app.get("/health")
    async def health():
        return {"ready": True, "model": backend.model, "graphs": backend.graph_lengths}

    @app.post("/v1/systemone")
    async def classify(request: Request):
        started = time.perf_counter()
        if not hmac.compare_digest(request.headers.get("authorization", ""), "Bearer " + token):
            return JSONResponse({"error": "Unauthorized", "code": "unauthorized"}, status_code=401)
        if slots.locked():
            return JSONResponse({"error": "Image model is busy", "code": "model_busy"}, status_code=429,
                                headers={"retry-after": "1"})
        async with slots:
            raw = bytearray()
            async for chunk in request.stream():
                raw.extend(chunk)
                if len(raw) > 1_000_000:
                    return JSONResponse({"error": "Request exceeds 1 MB", "code": "payload_too_large"}, status_code=413)
            try:
                payload = json.loads(raw)
                if not isinstance(payload, dict):
                    raise ValueError("Send a JSON object")
                if payload.get("model", "imajev-4b") != "imajev-4b":
                    raise ValueError("Use model imajev-4b")
                if payload.get("thinking"):
                    raise ValueError("This endpoint supports single-pass decisions only")
                images = payload.pop("images", [])
                if not isinstance(images, list) or not 1 <= len(images) <= 2:
                    raise ValueError("Provide one or two image data URLs")
                compiled, plan = compile_payload(payload, backend.max_options)
                blobs = [decode_data_url(value, i) for i, value in enumerate(images)]
            except (ValueError, TypeError, PlaygroundError) as error:
                return JSONResponse({"error": str(error), "code": "invalid_request"}, status_code=422)

            queue_started = time.perf_counter()
            try:
                await asyncio.wait_for(busy.acquire(), timeout=2.0)
            except TimeoutError:
                return JSONResponse({"error": "Image model is busy", "code": "model_busy"}, status_code=429,
                                    headers={"retry-after": "1"})
            queue_ms = (time.perf_counter() - queue_started) * 1000
            try:
                def infer():
                    decode_started = time.perf_counter()
                    loaded = decode_images(blobs)
                    decoded = time.perf_counter()
                    photos = [image for image, _ in loaded]
                    results, tokens = [], 0
                    for field in compiled.fields:
                        scored, usage = backend.score(photos, compiled.model_copy(update={"fields": [field]}))
                        tokens += usage["input_tokens"]
                        results.extend(scored)
                    inferred = time.perf_counter()
                    results = [calibration.calibrate_result(result, field.type, len(result.scores) - 1,
                                                           image=True, photo_only=not compiled.state)
                               for field, result in zip(compiled.fields, results)]
                    body = to_response(compiled, results, model=backend.model, plan=plan)
                    body["usage"] = {"input_tokens": tokens, "output_tokens": 0, "images": len(photos),
                                     "queue_ms": queue_ms, "decode_ms": (decoded - decode_started) * 1000,
                                     "inference_ms": (inferred - decoded) * 1000,
                                     "total_ms": (time.perf_counter() - started) * 1000}
                    return body

                try:
                    body = await run_in_threadpool(infer)
                except (ValueError, PlaygroundError) as error:
                    return JSONResponse({"error": str(error), "code": "invalid_image"}, status_code=422)
                except Exception:
                    return JSONResponse({"error": "Image inference failed", "code": "inference_failed"}, status_code=503)
                usage = body["usage"]
                return JSONResponse(body, headers={"cache-control": "no-store",
                    "server-timing": f'queue;dur={usage["queue_ms"]:.3f}, decode;dur={usage["decode_ms"]:.3f}, infer;dur={usage["inference_ms"]:.3f}, total;dur={usage["total_ms"]:.3f}'})
            finally:
                busy.release()

    return app


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(create_app(), host="0.0.0.0", port=8765, access_log=False)
