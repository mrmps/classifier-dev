# classifier-dev (Python)

Official client for [classifier.dev](https://classifier.dev): zero-shot text classification over HTTP, calibrated confidence per answer, no API key. Standard library only.

    pip install classifier-dev

```python
from classifier_dev import classify

for r in classify(["the checkout button does nothing", "love the new dark mode"], ["bug", "praise", "feature"]):
    print(r.label, r.confidence)      # bug 0.99 / praise 0.97
```

`Client(api_key=...)` for a partner key; `client.classify(..., tier="smart", multi=True, max_labels=2, instructions="...")`
for the rest. Errors raise `ClassifierError` with a stable `.code` and `.retry_after` on 429.
Up to 1,000 texts per call. Docs: https://classifier.dev/developers
