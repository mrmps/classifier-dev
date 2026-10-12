"""One model, bounded admission, adaptive length-aware batches, real HTTP timing."""
import argparse
import asyncio
import collections
import hashlib
import hmac
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

from aiohttp import web
from engine import Engine, ContextTooLong

@dataclass
class Pending:
    encoded: object
    priority: str
    queued: float
    deadline: float
    future: asyncio.Future

class Service:
    def __init__(self, args):
        self.args = args
        self.key = os.environ.get('JEFF_API_KEY', '')
        if len(self.key) < 24:
            raise ValueError('JEFF_API_KEY must contain at least 24 characters')
        self.gpu = ThreadPoolExecutor(max_workers=1, thread_name_prefix='gpu')
        self.encoder = ThreadPoolExecutor(max_workers=1, thread_name_prefix='encode')
        self.engine = None
        self.ready = False
        self.failure = None
        self.queue = []
        self.condition = asyncio.Condition()
        self.active = 0
        self.inflight = 0
        self.interactive_streak = 0
        self.counts = collections.Counter()
        self.batch_sizes = collections.Counter()
        self.real_tokens = 0
        self.padded_tokens = 0
        self.started = time.monotonic()
        self.worker = None
        self.source_sha256 = {name: hashlib.sha256((Path(__file__).parent/name).read_bytes()).hexdigest()
                              for name in ('server.py', 'engine.py', 'fetch.py', 'recipe.lock.json')}

    async def initialize(self):
        loop = asyncio.get_running_loop()
        try:
            self.engine = await loop.run_in_executor(self.gpu, lambda: Engine(
                self.args.recipe, self.args.checkpoint, self.args.graphs, self.args.cpu_threads))
            await loop.run_in_executor(self.gpu, self.engine.warmup)
            self.ready = True
            self.worker = asyncio.create_task(self.dispatch())
        except Exception as error:
            self.failure = type(error).__name__
            print(json.dumps({'event': 'startup_failed', 'error_type': self.failure}), flush=True)
            return
        print(json.dumps({'event': 'ready', 'seconds': time.monotonic()-self.started,
                          'model': self.engine.info, 'scheduler': self.config()}), flush=True)

    def config(self):
        return {k: getattr(self.args, k) for k in ('max_batch', 'max_batch_tokens', 'batch_wait_ms',
                'bulk_wait_ms', 'max_queue', 'fairness_batches', 'graphs')}

    def authorized(self, request):
        supplied = request.headers.get('Authorization', '')
        return hmac.compare_digest(supplied.encode(), ('Bearer ' + self.key).encode())

    async def decide(self, request):
        started = time.monotonic()
        if not self.authorized(request):
            raise web.HTTPUnauthorized()
        if not self.ready:
            raise web.HTTPServiceUnavailable(text='Model not ready')
        try:
            body = await request.json(loads=lambda x: json.loads(x, parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Nonfinite JSON'))))
            if not isinstance(body, dict):
                raise ValueError('Expected object')
            rid, data = body.get('id'), body.get('request')
            priority = body.get('priority', 'interactive')
            timeout_ms = body.get('timeout_ms', self.args.request_timeout_ms)
            if not isinstance(rid, str) or not 1 <= len(rid) <= 128 or priority not in ('interactive', 'bulk'):
                raise ValueError('Require id and interactive/bulk priority')
            if isinstance(timeout_ms, bool) or not isinstance(timeout_ms, (int, float)) or not 1 <= timeout_ms <= self.args.request_timeout_ms:
                raise ValueError('Invalid timeout_ms')
            if not isinstance(data, dict) or 'images' in data:
                raise ValueError('Expected text-only native request')
            if not isinstance(data.get('state'), (str, dict, list)):
                raise ValueError('State must be text, object or array')
        except (ValueError, TypeError, KeyError, RecursionError):
            self.counts['invalid'] += 1
            raise web.HTTPBadRequest(text='Invalid decision request') from None
        if self.active >= self.args.max_queue:
            self.counts['rejected'] += 1
            raise web.HTTPTooManyRequests(headers={'Retry-After': '1'})
        self.active += 1
        self.counts['admitted'] += 1
        future = None
        deadline = started + timeout_ms/1000
        try:
            async with asyncio.timeout_at(deadline):
                loop = asyncio.get_running_loop()
                encoded = await loop.run_in_executor(self.encoder, self.engine.encode, data)
                if not self.ready:
                    raise RuntimeError('Inference unavailable')
                encode_ms = (time.monotonic()-started)*1000
                future = loop.create_future()
                item = Pending(encoded, priority, time.monotonic(), deadline, future)
                async with self.condition:
                    self.queue.append(item)
                    self.condition.notify()
                result, queue_ms, infer_ms, size = await future
                self.counts['completed'] += 1
                self.counts['completed_' + priority] += 1
                return web.json_response({'id': rid, **result, 'batch_size': size,
                    'timing': {'encode_ms': encode_ms, 'queue_ms': queue_ms,
                               'inference_ms': infer_ms, 'total_ms': (time.monotonic()-started)*1000}})
        except ContextTooLong:
            self.counts['invalid'] += 1
            raise web.HTTPRequestEntityTooLarge(max_size=8192, actual_size=8193) from None
        except (ValueError, TypeError, KeyError, IndexError, StopIteration, RecursionError):
            self.counts['invalid'] += 1
            raise web.HTTPBadRequest(text='Invalid decision schema') from None
        except TimeoutError:
            self.counts['expired'] += 1
            raise web.HTTPGatewayTimeout(text='Request deadline exceeded') from None
        except asyncio.CancelledError:
            self.counts['cancelled'] += 1
            raise
        except RuntimeError:
            raise web.HTTPServiceUnavailable(text='Inference unavailable') from None
        finally:
            if future is not None and not future.done():
                future.cancel()
            self.active -= 1

    def choose(self):
        now = time.monotonic()
        self.queue[:] = [x for x in self.queue if not x.future.done() and x.deadline > now]
        if not self.queue:
            return [], None
        interactive = [x for x in self.queue if x.priority == 'interactive']
        bulk = [x for x in self.queue if x.priority == 'bulk']
        bulk_due = bulk and (now-bulk[0].queued)*1000 >= self.args.bulk_wait_ms
        if bulk_due and self.interactive_streak >= self.args.fairness_batches:
            anchor = bulk[0]
        else:
            anchor = interactive[0] if interactive else bulk[0]
        # Oldest anchor prevents starvation; nearest lengths minimize padded work.
        pool = sorted((x for x in self.queue if x is not anchor),
                      key=lambda x: (x.priority != anchor.priority, abs(x.encoded.length-anchor.encoded.length), x.queued))
        batch = [anchor]
        width = anchor.encoded.length
        for item in pool:
            if len(batch) >= self.args.max_batch:
                break
            next_width = max(width, item.encoded.length)
            if next_width > 2*min(anchor.encoded.length, item.encoded.length):
                continue
            if next_width*(len(batch)+1) > self.args.max_batch_tokens:
                continue
            batch.append(item)
            width = next_width
        max_wait = self.args.batch_wait_ms if anchor.priority == 'interactive' else self.args.bulk_wait_ms
        wait = min(anchor.queued + max_wait/1000, anchor.deadline) - now
        if len(batch) < self.args.max_batch and wait > 0:
            return [], wait
        selected = {id(x) for x in batch}
        self.queue[:] = [x for x in self.queue if id(x) not in selected]
        self.interactive_streak = self.interactive_streak+1 if anchor.priority == 'interactive' else 0
        return batch, 0

    async def dispatch(self):
        loop = asyncio.get_running_loop()
        while True:
            async with self.condition:
                batch, wait = self.choose()
                if not batch:
                    try:
                        if wait is None:
                            await self.condition.wait()
                        else:
                            await asyncio.wait_for(self.condition.wait(), timeout=max(wait, 0.0001))
                    except TimeoutError:
                        pass
                    continue
            self.inflight = len(batch)
            dispatched = time.monotonic()
            try:
                results = await loop.run_in_executor(self.gpu, self.engine.predict, [x.encoded for x in batch])
                elapsed_ms = (time.monotonic()-dispatched)*1000
                if len(results) != len(batch):
                    raise RuntimeError('Inference result count mismatch')
                self.batch_sizes[str(len(batch))] += 1
                self.real_tokens += sum(x.encoded.length for x in batch)
                self.padded_tokens += len(batch)*max(x.encoded.length for x in batch)
                for item, result in zip(batch, results, strict=True):
                    if not item.future.done():
                        item.future.set_result((result, (dispatched-item.queued)*1000, elapsed_ms, len(batch)))
            except Exception as error:
                self.counts['inference_errors'] += 1
                self.failure = type(error).__name__
                self.ready = False
                for item in batch + self.queue:
                    if not item.future.done():
                        item.future.set_exception(RuntimeError('Inference unavailable'))
                self.queue.clear()
                print(json.dumps({'event': 'inference_failed', 'error_type': self.failure}), flush=True)
                return
            finally:
                self.inflight = 0

    async def metrics(self, request):
        if not self.authorized(request):
            raise web.HTTPUnauthorized()
        return web.json_response({'ready': self.ready, 'error_type': self.failure,
            'uptime_seconds': time.monotonic()-self.started, 'counters': dict(self.counts),
            'batch_sizes': dict(self.batch_sizes), 'real_input_tokens': self.real_tokens,
            'padded_input_tokens': self.padded_tokens, 'queue_depth': len(self.queue),
            'inflight': self.inflight, 'admitted_in_progress': self.active,
            'model': self.engine.info if self.engine else None,
            'source_sha256': self.source_sha256,
            'memory': self.engine.memory() if self.engine else None, 'scheduler': self.config()})

    async def health(self, request):
        return web.json_response({'alive': True})

    async def readiness(self, request):
        return web.json_response({'ready': self.ready}, status=200 if self.ready else 503)

    async def startup(self, app):
        app['initializer'] = asyncio.create_task(self.initialize())

    async def shutdown(self, app):
        self.ready = False
        for item in self.queue:
            if not item.future.done():
                item.future.set_exception(RuntimeError('Server shutting down'))
        if self.worker:
            self.worker.cancel()
            await asyncio.gather(self.worker, return_exceptions=True)
        await asyncio.gather(app['initializer'], return_exceptions=True)
        self.encoder.shutdown(wait=False, cancel_futures=True)
        self.gpu.shutdown(wait=False, cancel_futures=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--recipe', type=Path, default=Path(__file__).parent/'recipe')
    parser.add_argument('--checkpoint', type=Path, default=Path(__file__).parent/'model')
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8080)
    parser.add_argument('--max-batch', type=int, default=8)
    parser.add_argument('--max-batch-tokens', type=int, default=8192)
    parser.add_argument('--batch-wait-ms', type=float, default=2)
    parser.add_argument('--bulk-wait-ms', type=float, default=10)
    parser.add_argument('--max-queue', type=int, default=128)
    parser.add_argument('--fairness-batches', type=int, default=4)
    parser.add_argument('--request-timeout-ms', type=int, default=30000)
    parser.add_argument('--graphs', choices=('on', 'static', 'off'), default='off')
    parser.add_argument('--cpu-threads', type=int, default=4)
    args = parser.parse_args()
    if not (1 <= args.max_batch <= 8 and 1 <= args.max_queue <= 4096 and
            args.max_batch_tokens >= 8192 and args.fairness_batches >= 1 and
            0 <= args.batch_wait_ms <= args.bulk_wait_ms <= 1000 and args.request_timeout_ms >= 1):
        parser.error('Invalid scheduler limits')
    service = Service(args)
    app = web.Application(client_max_size=131072)
    app.add_routes([web.get('/healthz', service.health), web.get('/readyz', service.readiness),
                    web.get('/metrics', service.metrics), web.post('/v1/decide', service.decide)])
    app.on_startup.append(service.startup)
    app.on_cleanup.append(service.shutdown)
    web.run_app(app, host=args.host, port=args.port, access_log=None, handler_cancellation=True)

if __name__ == '__main__':
    main()
