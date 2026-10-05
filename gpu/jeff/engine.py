"""Unchanged Jeff Fast numerics with one CPU encoding per admitted request."""
import math
import sys
from dataclasses import dataclass
from pathlib import Path

@dataclass
class Encoded:
    inputs: dict
    split: int
    count: int
    keys: list
    question: dict
    length: int

class ContextTooLong(ValueError):
    pass

class Engine:
    def __init__(self, recipe, checkpoint, graphs='on', threads=4):
        from fetch import verify_recipe
        recipe = Path(recipe).resolve()
        verify_recipe(recipe)
        sys.path[:0] = [str(recipe / x) for x in ('native', 'grafting', 'backends')]
        import torch
        from native import NativeJeff, validate
        from jeff.model import PreparedBatch, decision_messages, describe, options, answer
        from graft import GraftBatch
        from graft_backend import install_compiled_graft
        import transformers
        if not torch.__version__.startswith('2.13.0') or transformers.__version__ != '5.17.0':
            raise RuntimeError('Use the pinned Torch2.13/Transformers5.17 runtime')
        torch.set_num_threads(threads)
        if graphs == 'off':
            torch._inductor.config.triton.cudagraphs = False
        elif graphs == 'static':
            torch._inductor.config.triton.cudagraph_skip_dynamic_graphs = True
        self.torch, self.validate = torch, validate
        self.PreparedBatch, self.GraftBatch = PreparedBatch, GraftBatch
        self.messages, self.describe, self.options, self.answer = decision_messages, describe, options, answer
        self.native = NativeJeff(checkpoint)
        self.model, _ = install_compiled_graft(self.native.model)
        if graphs == 'off':
            # reduce-overhead enables graphs, so disable them in the compiled callable explicitly.
            self.model.forward = torch.compile(self.model.forward._torchdynamo_orig_callable,
                                               dynamic=True, options={'triton.cudagraphs': False})
        self.processor = self.native.model.processor
        self.versions = {n: p._version for n, p in self.model.named_parameters()}
        self.info = {'gpu': torch.cuda.get_device_name(0), 'torch': torch.__version__,
                     'transformers': transformers.__version__, 'precision': 'BF16',
                     'parameters': sum(p.numel() for p in self.model.parameters()),
                     'model_revision': self.native.pins['revision'], 'graphs': graphs}
        if self.info['parameters'] != 855344192:
            raise RuntimeError('Unexpected model parameter count')

    def encode(self, request):
        if not isinstance(request, dict) or 'images' in request:
            raise ValueError('Text-only {state, question} is required')
        self.validate(request)
        keys, _ = self.options(request['question'])
        text = self.processor.apply_chat_template(
            self.messages(request, self.native.model.codes, 'state-first'),
            tokenize=False, add_generation_prompt=True, enable_thinking=False)
        marker = '\n\nQuestion:\n' + self.describe(request['question'].get('instructions') or 'Choose the best matching option.') + '\n\nOptions:\n'
        boundary = text.rfind(marker)
        if boundary < 0:
            raise ValueError('Question boundary missing')
        encoded = dict(self.processor(text=[text], images=None, padding=True,
                                      return_tensors='pt', return_offsets_mapping=True))
        offsets = encoded.pop('offset_mapping')[0].tolist()
        length = encoded['input_ids'].shape[1]
        if length > 8192:
            raise ContextTooLong('Maximum rendered context is 8192 tokens; no truncation')
        start = next(i for i, (_, end) in enumerate(offsets) if end > boundary)
        split = max(0, min(length - self.model.tail, start))
        return Encoded({k: v[0] for k, v in encoded.items()}, split, len(keys), list(keys), request['question'], length)

    def collate(self, rows):
        torch = self.torch
        width = max(row.length for row in rows)
        inputs = {}
        for key in rows[0].inputs:
            fill = self.processor.tokenizer.pad_token_id if key == 'input_ids' else 0
            value = torch.full((len(rows), width), fill, dtype=rows[0].inputs[key].dtype)
            for i, row in enumerate(rows):
                value[i, width-row.length:] = row.inputs[key]
            inputs[key] = value.to('cuda')
        counts = tuple(r.count for r in rows)
        native = self.PreparedBatch(inputs, counts, sum(r.length for r in rows))
        return self.GraftBatch(native, torch.tensor([width-r.length+r.split for r in rows], device='cuda'),
                               torch.tensor([r.length for r in rows], device='cuda'))

    def predict(self, rows):
        torch = self.torch
        with torch.inference_mode():
            batch = self.collate(rows)
            values = torch.softmax(self.model(batch) / self.model.temperature, -1).cpu()
            results = []
            for row, value in zip(rows, values, strict=True):
                probs = value[:row.count].tolist()
                if not all(math.isfinite(p) and p >= 0 for p in probs) or abs(sum(probs)-1) > 1e-5:
                    raise RuntimeError('Invalid model probabilities')
                results.append({'answer': self.answer(row.question, probs),
                                'probabilities': dict(zip(row.keys, probs, strict=True)),
                                'input_tokens': row.length})
            return results

    def warmup(self):
        rows = [{'state': 'A red ball rests in a box.', 'question': {'type': t,
                 'instructions': 'Is a red ball present?', 'criteria':
                 {'false': 'No red ball', 'true': 'Red ball present'} if t == 'noul' else
                 ['Absent', 'Uncertain', 'Present'] if t == 'score' else
                 {'absent': 'No red ball', 'present': 'Red ball present'}}}
                for t in ('choice', 'noul', 'score', 'choice', 'noul', 'score', 'choice', 'noul')]
        # Canonical published startup remains first; then warm supported batch sizes.
        for size in (8, 1, 2, 4, 8):
            self.predict([self.encode(row) for row in rows[:size]])
        self.assert_unchanged()

    def assert_unchanged(self):
        if self.versions != {n: p._version for n, p in self.model.named_parameters()}:
            raise RuntimeError('Model parameters changed')

    def memory(self):
        return {'allocated_bytes': self.torch.cuda.memory_allocated(),
                'reserved_bytes': self.torch.cuda.memory_reserved(),
                'peak_allocated_bytes': self.torch.cuda.max_memory_allocated(),
                'peak_reserved_bytes': self.torch.cuda.max_memory_reserved()}
