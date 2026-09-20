import asyncio
import unittest
import threading
import httpx
from runtime import make_api, Admission

ROW = {"state": "refund please", "questions": {"q": {"type": "choice", "instructions": "Choose", "criteria": {"billing": None, "tech": None}}}}


class Tests(unittest.IsolatedAsyncioTestCase):
    async def test_validation(self):
        calls = []
        def predict(rows):
            calls.append(rows)
            return [{"answers": {}} for _ in rows]
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=make_api("fast", predict)), base_url="http://test") as client:
            for body in ({"batch": []}, {"batch": [ROW, ROW]}, {"batch": [{"state": "text"}]}):
                self.assertEqual((await client.post("/predict", json=body)).status_code, 400)
            self.assertEqual((await client.post("/predict", content="{" )).status_code, 400)
            self.assertEqual((await client.post("/predict", content="x" * 256001)).status_code, 413)
            self.assertEqual(len(calls), 0)

    async def test_fast_overload_does_not_block_health_and_recovers(self):
        started, release = threading.Event(), threading.Event()
        def predict(rows):
            started.set()
            release.wait(3)
            return [{"answers": {}}]
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=make_api("fast", predict)), base_url="http://test") as client:
            first = asyncio.create_task(client.post("/predict", json={"batch": [ROW]}))
            await asyncio.to_thread(started.wait, 2)
            try:
                self.assertEqual((await client.get("/health")).status_code, 200)
                response = await client.post("/predict", json={"batch": [ROW]})
                self.assertEqual(response.status_code, 429)
                self.assertEqual(response.headers["retry-after"], "1")
            finally:
                release.set()
            self.assertEqual((await first).status_code, 200)
            self.assertEqual((await client.post("/predict", json={"batch": [ROW]})).status_code, 200)

    def test_admission_is_bounded(self):
        gate = Admission("bulk")
        self.assertTrue(all(gate.enter("bulk", 64) for _ in range(4)))
        self.assertFalse(gate.enter("bulk", 1))
        gate.leave()
        self.assertTrue(gate.enter("bulk", 64))


if __name__ == "__main__":
    unittest.main()
