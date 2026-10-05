"""Exercise the live Jeff HTTP service and save a repeatable acceptance receipt."""
import argparse
import asyncio
from collections import Counter
import hashlib
import json
import os
from pathlib import Path
import time

import aiohttp

from load_test import validate_response


def choice(index):
    return {'id': f'e2e-{index}', 'priority': 'interactive', 'request': {
        'state': 'The light is green.',
        'question': {'type': 'choice', 'instructions': 'Which color is the light?',
                     'criteria': {f'green_{index}': 'Green', f'red_{index}': 'Red'}}}}


async def run(args):
    if args.out.exists() or not args.out.parent.is_dir():
        raise ValueError('output must be a new file in an existing directory')
    key = os.environ.get('JEFF_API_KEY')
    if not key:
        raise ValueError('JEFF_API_KEY environment variable is required')
    headers = {'Authorization': 'Bearer ' + key}
    checks = {}
    receipt = {'runner_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
               'checks': checks, 'configuration': {
                   'concurrent': args.concurrent, 'overload_requests': args.overload_requests,
                   'min_observed_batch': args.min_observed_batch},
               'limitations': ['Requires a ready, otherwise idle service; overload burst must exceed admission capacity.',
                               'Checks API behavior and response association; source-development gates separately verify model quality.']}
    started = time.perf_counter()
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=120),
                                     connector=aiohttp.TCPConnector(limit=0)) as session:
        async def request(method, path, body=None, auth=True, raw=None):
            kw = {'headers': headers if auth else {}}
            if raw is not None:
                kw['data'] = raw
                kw['headers'] = {**kw['headers'], 'Content-Type': 'application/json'}
            elif body is not None:
                kw['json'] = body
            async with session.request(method, args.url + path, **kw) as response:
                data = await response.read()
                try:
                    value = json.loads(data)
                except (ValueError, UnicodeDecodeError):
                    value = None
                return response.status, value

        def check(name, passed):
            checks[name] = bool(passed)
            if not passed:
                raise AssertionError(name)

        async def accepted(body):
            status, value = await request('POST', '/v1/decide', body)
            if status != 200:
                raise AssertionError('valid_request_http_' + str(status))
            question = body['request']['question']
            keys = (['false', 'true'] if question['type'] == 'noul' else
                    [str(i) for i in range(len(question['criteria']))] if question['type'] == 'score' else
                    question['criteria'])
            return validate_response(value, body['id'], keys)

        try:
            check('public_health', (await request('GET', '/healthz', auth=False))[0] == 200)
            check('ready', (await request('GET', '/readyz', auth=False))[0] == 200)
            check('decide_requires_auth', (await request('POST', '/v1/decide', choice('auth'), auth=False))[0] == 401)
            check('metrics_requires_auth', (await request('GET', '/metrics', auth=False))[0] == 401)
            check('malformed_json', (await request('POST', '/v1/decide', raw=b'{'))[0] == 400)
            check('invalid_schema', (await request('POST', '/v1/decide', {'id': 'invalid'}))[0] == 400)
            image = choice('images')
            image['request']['images'] = ['data:image/png;base64,AA==']
            check('images_rejected', (await request('POST', '/v1/decide', image))[0] == 400)
            oversized = choice('body-limit')
            oversized['request']['state'] = 'x' * args.oversize_chars
            check('body_limit', (await request('POST', '/v1/decide', oversized))[0] == 413)
            context = choice('context-limit')
            context['request']['state'] = ' word' * args.context_words
            check('context_limit', (await request('POST', '/v1/decide', context))[0] == 413)
            status, before = await request('GET', '/metrics')
            check('metrics_before', status == 200 and isinstance(before, dict))
            receipt['metrics_before'] = before
            valid_jobs = [accepted(choice(i)) for i in range(args.concurrent)]
            outcomes = await asyncio.gather(*valid_jobs, request('POST', '/v1/decide', {'id': 'malformed-neighbor'}))
            values, invalid = outcomes[:-1], outcomes[-1]
            check('concurrent_unique_option_mapping', len(values) == args.concurrent)
            check('invalid_neighbor_isolated', invalid[0] == 400)
            check('observed_batch_size', max(value['batch_size'] for value in values) >= args.min_observed_batch)
            for kind, criteria in [('noul', {'false': 'No', 'true': 'Yes'}),
                                   ('score', ['Poor', 'Fair', 'Good'])]:
                body = choice(kind)
                body['request']['question'] = {'type': kind, 'instructions': 'Evaluate the statement.', 'criteria': criteria}
                await accepted(body)
                check(kind + '_probabilities', True)
            receipt['successful_request_batch_sizes'] = dict(Counter(str(v['batch_size']) for v in values))
            deadline = choice('deadline')
            deadline['timeout_ms'] = 1
            check('deadline_504', (await request('POST', '/v1/decide', deadline))[0] == 504)
            await accepted(choice('after-deadline'))
            check('deadline_recovery', True)

            async def burst(i):
                body = choice(f'overload-{i}')
                body.update(priority='bulk', timeout_ms=args.overload_timeout_ms)
                return (await request('POST', '/v1/decide', body))[0]
            statuses = await asyncio.gather(*(burst(i) for i in range(args.overload_requests)))
            receipt['overload_http_statuses'] = dict(Counter(str(status) for status in statuses))
            check('overload_429', 429 in statuses)
            check('overload_no_server_errors', all(status in (200, 429, 504) for status in statuses))
            deadline_at = time.perf_counter() + args.drain_timeout
            while True:
                status, metrics = await request('GET', '/metrics')
                check('metrics_available', status == 200 and isinstance(metrics, dict))
                if metrics.get('queue_depth') == 0 and metrics.get('inflight') == 0:
                    break
                if time.perf_counter() >= deadline_at:
                    raise AssertionError('admission_drain')
                await asyncio.sleep(0.1)
            await accepted(choice('after-overload'))
            check('overload_recovery', True)
            status, after = await request('GET', '/metrics')
            check('metrics_contract', status == 200 and all(k in after for k in
                  ('batch_sizes', 'real_input_tokens', 'queue_depth', 'inflight')))
            check('real_tokens_increased', after['real_input_tokens'] > before['real_input_tokens'])
            receipt['metrics_after'] = after
            receipt['status'] = 'PASS'
        except (AssertionError, ValueError, KeyError, TypeError, aiohttp.ClientError, asyncio.TimeoutError) as exc:
            receipt['status'] = 'FAIL'
            receipt['failure'] = str(exc) if isinstance(exc, AssertionError) else type(exc).__name__
    receipt['elapsed_seconds'] = time.perf_counter() - started
    with args.out.open('x') as handle:
        handle.write(json.dumps(receipt, indent=2, allow_nan=False) + '\n')
    print(json.dumps({'status': receipt['status'], 'checks': checks, 'failure': receipt.get('failure')}))
    return 0 if receipt['status'] == 'PASS' else 1


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:8080')
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--concurrent', type=int, default=8, help='Keep below configured admission capacity')
    parser.add_argument('--overload-requests', type=int, default=256, help='Must exceed configured admission capacity')
    parser.add_argument('--overload-timeout-ms', type=int, default=1000, help='Long enough for burst admission to reach capacity')
    parser.add_argument('--min-observed-batch', type=int, default=1, help='Use 2 to require batching in adaptive configuration')
    parser.add_argument('--oversize-chars', type=int, default=2_000_000)
    parser.add_argument('--context-words', type=int, default=20_000)
    parser.add_argument('--drain-timeout', type=float, default=30)
    args = parser.parse_args()
    if min(args.concurrent, args.overload_requests, args.min_observed_batch, args.oversize_chars, args.context_words, args.drain_timeout, args.overload_timeout_ms) <= 0:
        raise SystemExit('all size and timeout options must be positive')
    try:
        raise SystemExit(asyncio.run(run(args)))
    except (ValueError, OSError):
        raise SystemExit('check JEFF_API_KEY, output path and configuration') from None
