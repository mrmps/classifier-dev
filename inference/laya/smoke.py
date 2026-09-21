"""Live isolated lane checks. Credential JSON path is supplied, never printed."""
import asyncio
from collections import Counter
import json
from pathlib import Path
import sys
import time
import httpx

ROW = {"state": "Please refund the duplicate invoice payment.", "questions": {
    "q": {"type": "choice", "instructions": "Which department should handle this?", "criteria": {"billing": None, "technical": None}}}}


async def main():
    keys = json.loads(Path(sys.argv[1]).read_text())
    headers = {"Modal-Key": keys["LAYA_MODAL_KEY"], "Modal-Secret": keys["LAYA_MODAL_SECRET"]}
    report = {}
    async with httpx.AsyncClient(headers=headers, timeout=30) as client:
        for lane in ("fast", "bulk"):
            url = f"https://miryaboy--classifier-laya-router-trial-west-{lane}.us-west.modal.direct"
            started = time.monotonic()
            while time.monotonic() - started < 240:
                try:
                    ready = await client.get(url + "/health")
                    if ready.status_code == 200:
                        break
                    assert ready.status_code == 503, ready.status_code
                except httpx.TransportError:
                    pass
                await asyncio.sleep(2)
            else:
                raise TimeoutError(lane + " not ready")
            count = 1 if lane == "fast" else 64
            response = await client.post(url + "/predict", json={"batch": [ROW] * count})
            assert response.status_code == 200, (lane, response.status_code, response.text[:80])
            rows = response.json()["results"]
            assert len(rows) == count and all(r["answers"]["q"]["choice"] == "billing" for r in rows)
            assert all(r["routing"]["model"] == "english" for r in rows)
            await asyncio.sleep(.3)
            hindi = await client.post(url + "/predict", json={"batch": [{**ROW, "state": "मुझसे दो बार शुल्क लिया गया है। कृपया मेरा पैसा वापस कर दें।"}]})
            assert hindi.status_code == 200
            assert hindi.json()["results"][0]["routing"]["model"] == "multilingual"
            invalid = await client.post(url + "/predict", json={"batch": []})
            assert invalid.status_code == 400
            await asyncio.sleep(.3)
            long = await client.post(url + "/predict", json={"batch": [{**ROW, "state": "text " * 3000}]})
            assert long.status_code == 400, (lane, long.status_code)
            await asyncio.sleep(.3)
            started = time.monotonic()
            burst = await asyncio.gather(*(client.post(url + "/predict", json={"batch": [ROW] * count}) for _ in range(24)))
            statuses = dict(Counter(str(r.status_code) for r in burst))
            assert all(r.status_code in (200, 429) for r in burst), statuses
            assert statuses.get("200", 0) > 0 and statuses.get("429", 0) > 0, statuses
            elapsed = time.monotonic() - started
            await asyncio.sleep(.3)
            recovery = await client.post(url + "/predict", json={"batch": [ROW]})
            assert recovery.status_code == 200
            async with httpx.AsyncClient() as anonymous:
                assert (await anonymous.get(url + "/health")).status_code == 401
            report[lane] = {"valid_rows": count, "invalid": invalid.status_code,
                            "oversized_context": long.status_code, "burst": statuses,
                            "burst_elapsed_seconds": round(elapsed, 2), "recovery": recovery.status_code,
                            "unauthenticated": 401, "english_and_hindi_routes": "passed"}
            print(json.dumps({lane: report[lane]}), flush=True)
    Path("inference/laya/live-checks.json").write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    asyncio.run(main())
