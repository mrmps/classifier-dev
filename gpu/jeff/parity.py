"""Compare one-time encoding/collation with the immutable recipe; no model forwards."""
import argparse
import hashlib
import json
from pathlib import Path
import time

from engine import Engine
from load_test import native_request


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--recipe', type=Path, required=True)
    p.add_argument('--checkpoint', type=Path, required=True)
    p.add_argument('--input', type=Path, action='append', required=True)
    p.add_argument('--out', type=Path, required=True)
    args = p.parse_args()
    if args.out.exists():
        p.error('output already exists')
    started = time.monotonic()
    engine = Engine(args.recipe, args.checkpoint, graphs='static')
    checks, sources = [], []
    total = batches = 0
    for path in args.input:
        sources.append(sha(path))
        rows = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
        native = [native_request(row)[0] for row in rows]
        encoded = [engine.encode(row) for row in native]
        orders = [('original-8', list(range(len(rows))), 8),
                  ('length-8', sorted(range(len(rows)), key=lambda i: encoded[i].length), 8)]
        sample = list(dict.fromkeys(j * (len(rows)-1) // 63 for j in range(64)))
        orders += [(f'mixed-sample-{size}', sample, size) for size in (1, 2, 4)]
        for label, order, size in orders:
            for start in range(0, len(order), size):
                indices = order[start:start+size]
                actual = engine.collate([encoded[i] for i in indices])
                expected = engine.model.prepare([native[i] for i in indices])
                assert set(actual.native.inputs) == set(expected.native.inputs), 'input fields'
                for key in actual.native.inputs:
                    assert engine.torch.equal(actual.native.inputs[key], expected.native.inputs[key]), key
                assert actual.native.counts == expected.native.counts, 'option counts'
                assert actual.native.input_tokens == expected.native.input_tokens, 'token total'
                assert engine.torch.equal(actual.splits, expected.splits), 'graft splits'
                assert engine.torch.equal(actual.lengths, expected.lengths), 'lengths'
                batches += 1
            checks.append({'input_sha256': sources[-1], 'profile': label,
                           'requests': len(order), 'pass': True})
        total += len(rows)
    engine.assert_unchanged()
    config = engine.info['compiler_options']
    assert config == {'triton.cudagraphs': True, 'triton.cudagraph_skip_dynamic_graphs': True,
                      'graph_partition': False}, 'static compiler policy'
    receipt = {'status': 'PASS', 'unique_requests': total, 'batch_comparisons': batches,
               'checks': checks, 'model': engine.info, 'input_sha256': sources,
               'engine_sha256': sha(Path(__file__).with_name('engine.py')),
               'script_sha256': sha(__file__),
               'immutable_prepare_sha256': sha(args.recipe/'grafting/fast_prepare.py'),
               'elapsed_seconds': time.monotonic()-started,
               'scope': 'All input tensors, token counts, option counts, lengths and graft splits exactly equal immutable prepare. No model forward or probability comparison.'}
    with args.out.open('x') as handle:
        handle.write(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps(receipt, indent=2))


if __name__ == '__main__':
    main()
