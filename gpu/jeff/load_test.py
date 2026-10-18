"""HTTP load evidence; one invocation runs one scenario against a ready service."""
import argparse
import asyncio
from collections import Counter
import hashlib
import json
import math
import os
from pathlib import Path
import random
import time

import aiohttp


def native_request(row):
    kind = row['question_type'].lower()
    options = row['options']
    generic_keys = [str(option['id']) for option in options]
    if kind == 'score':
        criteria = [option['description'] for option in options]
        native_keys = [str(i) for i in range(len(options))]
    elif kind == 'noul':
        assert len(options) == 2
        native_keys = ['false', 'true']
        criteria = dict(zip(native_keys, [option['description'] for option in options]))
    else:
        assert kind == 'choice'
        native_keys = generic_keys
        criteria = {str(option['id']): option['description'] for option in options}
    return ({'state': row['state'], 'question': {
        'type': kind, 'instructions': row['question'], 'criteria': criteria}},
        dict(zip(native_keys, generic_keys)))


def validate_response(body, request_id, keys):
    if not isinstance(body, dict) or body.get('id') != request_id:
        raise ValueError('response_id')
    probabilities = body.get('probabilities')
    if not isinstance(probabilities, dict) or set(probabilities) != set(keys):
        raise ValueError('probability_keys')
    values = list(probabilities.values())
    if not all(isinstance(v, (int, float)) and not isinstance(v, bool)
               and math.isfinite(v) and 0 <= v <= 1 for v in values):
        raise ValueError('probability_values')
    if abs(sum(values) - 1) > 1e-5:
        raise ValueError('probability_sum')
    if not isinstance(body.get('input_tokens'), int) or body['input_tokens'] <= 0:
        raise ValueError('input_tokens')
    if not isinstance(body.get('batch_size'), int) or body['batch_size'] <= 0:
        raise ValueError('batch_size')
    if 'answer' not in body:
        raise ValueError('answer')
    timing = body.get('timing', {})
    for key in ('encode_ms', 'queue_ms', 'inference_ms', 'total_ms'):
        if not isinstance(timing.get(key), (int, float)) or not math.isfinite(timing[key]) or timing[key] < 0:
            raise ValueError('timing')
    return body


def percentiles(values):
    if not values:
        return {'p50': None, 'p95': None, 'p99': None, 'max': None}
    ordered = sorted(values)
    return {**{f'p{q}': ordered[max(0, math.ceil(len(ordered) * q / 100) - 1)]
               for q in (50, 95, 99)}, 'max': ordered[-1]}


def summarize(records, elapsed):
    success = [r for r in records if r['status'] == 'ok']
    return {
        'attempted': len(records), 'success': len(success),
        'errors': dict(Counter(r['status'] for r in records if r['status'] != 'ok')),
        'success_requests_per_second': len(success) / elapsed,
        'real_input_tokens': sum(r.get('input_tokens', 0) for r in success),
        'real_input_tokens_per_second': sum(r.get('input_tokens', 0) for r in success) / elapsed,
        'all_completed_scheduled_latency_ms': percentiles([r['scheduled_ms'] for r in records]),
        'success_scheduled_latency_ms': percentiles([r['scheduled_ms'] for r in success]),
        'actual_request_start_latency_ms': percentiles([r['send_ms'] for r in records]),
        'client_dispatch_lag_ms': percentiles([r['dispatch_lag_ms'] for r in records]),
        'server_timing_ms': {k: percentiles([r['timing'][k] for r in success])
                             for k in ('encode_ms', 'queue_ms', 'inference_ms', 'total_ms')},
        'request_weighted_batch_sizes': dict(Counter(str(r['batch_size']) for r in success)),
    }


async def run(args):
    outputs = [p for p in (args.out, args.responses, args.export_predictions) if p is not None]
    if len({p.resolve() for p in outputs}) != len(outputs) or any(p.exists() or not p.parent.is_dir() for p in outputs):
        raise ValueError('output files must be distinct, new, and have existing parent directories')
    key = os.environ.get('JEFF_API_KEY')
    if not key:
        raise ValueError('JEFF_API_KEY environment variable is required')
    rows = []
    hashes = []
    for path in args.input:
        raw = path.read_bytes()
        hashes.append(hashlib.sha256(raw).hexdigest())
        rows.extend(json.loads(line) for line in raw.splitlines() if line.strip())
    if not rows or len({row['id'] for row in rows}) != len(rows):
        raise ValueError('inputs must be nonempty with unique IDs across files')
    prepared = [native_request(row) for row in rows]
    count = args.requests or len(rows)
    if args.export_predictions and count != len(rows):
        raise ValueError('prediction export requires exactly one complete input pass')
    order = list(range(len(rows)))
    rng = random.Random(args.seed)
    rng.shuffle(order)
    jobs = [(order[i % len(order)], 'interactive' if rng.random() < args.interactive_fraction else 'bulk')
            for i in range(count)]
    records = []
    predictions = {}
    connector = aiohttp.TCPConnector(limit=0)
    timeout = aiohttp.ClientTimeout(total=args.client_timeout)
    headers = {'Authorization': 'Bearer ' + key}
    async with aiohttp.ClientSession(connector=connector, timeout=timeout, headers=headers) as session:
        async with session.get(args.url + '/readyz') as response:
            if response.status != 200:
                raise ValueError('service is not ready')
        async def metrics():
            async with session.get(args.url + '/metrics') as response:
                if response.status != 200:
                    raise ValueError('metrics unavailable')
                return await response.json()
        before = await metrics()
        start = time.perf_counter()

        async def send(sequence, due):
            index, priority = jobs[sequence]
            request, mapping = prepared[index]
            request_id = str(rows[index]['id']) if args.export_predictions else f'load-{args.seed}-{sequence}'
            body = {'id': request_id, 'request': request, 'priority': priority}
            if args.timeout_ms is not None:
                body['timeout_ms'] = args.timeout_ms
            payload = json.dumps(body).encode()
            await asyncio.sleep(max(0, due - time.perf_counter()))
            sent = time.perf_counter()
            record = {'sequence': sequence, 'priority': priority, 'status': 'client_error'}
            try:
                async with session.post(args.url + '/v1/decide', data=payload,
                                        headers={'Content-Type': 'application/json'}) as response:
                    raw = await response.read()
                    if response.status != 200:
                        record['status'] = f'http_{response.status}'
                    else:
                        try:
                            answer = validate_response(json.loads(raw), request_id, mapping)
                        except (ValueError, TypeError, KeyError, UnicodeDecodeError):
                            record['status'] = 'invalid_response'
                        else:
                            record.update(status='ok', input_tokens=answer['input_tokens'],
                                          batch_size=answer['batch_size'], timing=answer['timing'])
                            if args.export_predictions:
                                predictions[index] = {'id': rows[index]['id'], 'status': 'ok',
                                    'probabilities': {mapping[k]: v for k, v in answer['probabilities'].items()}}
            except (aiohttp.ClientError, asyncio.TimeoutError):
                record['status'] = 'client_timeout_or_transport'
            completed = time.perf_counter()
            record.update(dispatch_lag_ms=max(0, sent - due) * 1000,
                          scheduled_ms=(completed - due) * 1000, send_ms=(completed - sent) * 1000)
            records.append(record)

        if args.mode == 'open':
            await asyncio.gather(*(send(i, start + i / args.rate) for i in range(count)))
        else:
            next_job = iter(range(count))
            async def worker():
                for index in next_job:
                    await send(index, time.perf_counter())
            await asyncio.gather(*(worker() for _ in range(args.concurrency)))
        elapsed = time.perf_counter() - start
        after = await metrics()
    result = {
        'scenario': args.label, 'mode': args.mode, 'seed': args.seed,
        'input_sha256': hashes, 'runner_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'offered_requests': count, 'configured_offered_rate': args.rate if args.mode == 'open' else None,
        'scheduled_arrival_span_seconds': (count - 1) / args.rate if args.mode == 'open' else None,
        'concurrency': args.concurrency if args.mode == 'closed' else None,
        'elapsed_including_drain_seconds': elapsed,
        'all': summarize(records, elapsed),
        'by_priority': {priority: summarize([r for r in records if r['priority'] == priority], elapsed)
                        for priority in ('interactive', 'bulk')},
        'metrics_before': before, 'metrics_after': after,
        'server_batch_sizes_delta': {str(k): after.get('batch_sizes', {}).get(k, 0) - before.get('batch_sizes', {}).get(k, 0)
                                   for k in set(before.get('batch_sizes', {})) | set(after.get('batch_sizes', {}))},
        'limitations': ['HTTP latency includes response read and validation; actual-send means client request start, including connector/socket wait.',
                        'Open-loop uses scheduled arrivals without an in-flight limiter; dispatch lag is included in scheduled latency.',
                        'Closed-loop has response-dependent arrivals and is reported separately.',
                        'Server metrics are cumulative snapshots; use an otherwise idle service for counter deltas.'],
    }
    if args.export_predictions:
        with args.export_predictions.open('x') as handle:
            for i in range(len(rows)):
                item = predictions.get(i, {'id': rows[i]['id'], 'status': 'error'})
                handle.write(json.dumps(item) + '\n')
        result['prediction_sha256'] = hashlib.sha256(args.export_predictions.read_bytes()).hexdigest()
        result['complete_quality_export'] = len(predictions) == len(rows)
    if args.responses:
        with args.responses.open('x') as handle:
            for record in sorted(records, key=lambda r: r['sequence']):
                handle.write(json.dumps(record) + '\n')
    with args.out.open('x') as handle:
        handle.write(json.dumps(result, indent=2, allow_nan=False) + '\n')
    print(json.dumps({k: result[k] for k in ('scenario', 'mode', 'all', 'by_priority')}, allow_nan=False))
    return 1 if any(r['status'] == 'invalid_response' for r in records) or (args.export_predictions and len(predictions) != len(rows)) else 0


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--url', default='http://127.0.0.1:8080')
    p.add_argument('--input', type=Path, action='append', required=True, help='Generic source-development JSONL; repeat for multiple panels')
    p.add_argument('--mode', choices=('open', 'closed'), required=True)
    p.add_argument('--label', required=True)
    p.add_argument('--requests', type=int)
    p.add_argument('--rate', type=float, default=10, help='Open-loop arrivals per second')
    p.add_argument('--concurrency', type=int, default=8)
    p.add_argument('--interactive-fraction', type=float, default=0.5)
    p.add_argument('--seed', type=int, default=20261005)
    p.add_argument('--timeout-ms', type=int)
    p.add_argument('--client-timeout', type=float, default=120)
    p.add_argument('--out', type=Path, required=True)
    p.add_argument('--responses', type=Path, help='Optional per-request timing/status records, without request contents')
    p.add_argument('--export-predictions', type=Path, help='Exhaustive single-pass generic probabilities for existing quality evaluator')
    return p


if __name__ == '__main__':
    args = parser().parse_args()
    if not math.isfinite(args.rate) or args.rate <= 0 or not math.isfinite(args.client_timeout) or args.client_timeout <= 0 or args.concurrency <= 0 or (args.requests is not None and args.requests <= 0) or not 0 <= args.interactive_fraction <= 1:
        raise SystemExit('invalid rate, concurrency, request count or priority fraction')
    try:
        raise SystemExit(asyncio.run(run(args)))
    except (ValueError, OSError) as exc:
        raise SystemExit(type(exc).__name__ + ': check configuration or input files') from None
