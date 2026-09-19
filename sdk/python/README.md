# classifier-dev (Python)

Official client for [classifier.dev](https://classifier.dev): zero-shot text classification over HTTP, calibrated confidence per answer, no API key. Standard library only.

    pip install "classifier-dev @ git+https://github.com/mrmps/classifier-dev.git@python-v0.1.0#subdirectory=sdk/python"

Requires Git. Installs the tagged Python release from GitHub; the SDK has no
runtime dependencies.

```python
from classifier_dev import classify

for r in classify(["the checkout button does nothing", "love the new dark mode"], ["bug", "praise", "feature"]):
    print(r.label, r.confidence)      # bug 0.99 / praise 0.97
```

`Client(api_key=...)` for a partner key; `client.classify(..., tier="smart", multi=True, max_labels=2, instructions="...")`
for the rest. `max_labels` validates and implies multi-label output. A withheld
API score remains `None`. HTTP, transport and malformed-response failures raise
`ClassifierError`: the API's message and stable `.code`
with `.status`, `.retry_after` on 429, and `code == "network"` or `"timeout"` (status 0)
when no answer came at all. Up to 1,000 texts per call (200 for public smart requests). Docs: https://classifier.dev/developers

The install also puts a tiny `classify-py labels < lines` on the path, one
`label<TAB>confidence<TAB>text` line per input; the full CLI is `npm i -g classifier-dev`.
