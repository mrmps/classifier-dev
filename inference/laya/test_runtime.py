import asyncio
import unittest
import threading
import contextlib
import types
from unittest.mock import patch
import httpx
from runtime import make_api, Admission, start_server
from adapter import predict_routed_batch

ROW = {"state": "refund please", "questions": {"q": {"type": "choice", "instructions": "Choose", "criteria": {"billing": None, "tech": None}}}}


class Tests(unittest.IsolatedAsyncioTestCase):
    def test_checkpoints_are_warmed_before_server_readiness(self):
        events = []
        def predict(router, rows):
            events.append([row["state"] for row in rows])
            return []
        server = types.SimpleNamespace(run=lambda: None)
        thread = types.SimpleNamespace(start=lambda: events.append("listening"))
        with patch("runtime.load_router", return_value=object()), \
             patch("adapter.predict_routed_batch", side_effect=predict), \
             patch("threading.Thread", return_value=thread), \
             patch.dict("sys.modules", {
                 "torch": types.SimpleNamespace(inference_mode=contextlib.nullcontext),
                 "uvicorn": types.SimpleNamespace(Config=lambda *a, **k: None, Server=lambda config: server),
             }):
            self.assertIs(start_server("fast"), server)
        self.assertEqual(events, [["warmup", "तैयार"], "listening"])

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

    def test_routed_batch_groups_checkpoints_and_restores_order(self):
        class Router:
            loaded = ["english", "multilingual", "typed-decisions"]
            def route(self, state, questions):
                return {"model": "multilingual" if state.startswith("ml") else "english", "reason": "fixture"}
            def load(self, name):
                return name
        calls = []
        def predict(agent, rows):
            calls.append((agent, [row["state"] for row in rows]))
            return [{"answers": {"state": row["state"]}, "usage": {"input_tokens": len(row["state"])}} for row in rows]
        states = ["en-first", "ml-second", "en-third", "ml-fourth"]
        actual = predict_routed_batch(Router(), [{**ROW, "state": state} for state in states], predict)
        self.assertEqual(calls, [("english", ["en-first", "en-third"]), ("multilingual", ["ml-second", "ml-fourth"])])
        self.assertEqual([row["answers"]["state"] for row in actual], states)
        self.assertEqual([row["routing"]["model"] for row in actual], ["english", "multilingual", "english", "multilingual"])
        self.assertEqual([row["usage"]["input_tokens"] for row in actual], list(map(len, states)))

    def test_missing_resident_checkpoint_never_loads_on_request(self):
        class Router:
            loaded = ["english"]
            def route(self, state, questions):
                return {"model": "multilingual", "reason": "fixture"}
            def load(self, name):
                self.fail("must not load")
        with self.assertRaisesRegex(RuntimeError, "not preloaded"):
            predict_routed_batch(Router(), [ROW])


if __name__ == "__main__":
    unittest.main()
