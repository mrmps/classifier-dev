"""Official Python client for classifier.dev.

    from classifier_dev import classify
    results = classify(["the app crashes", "love it"], ["bug", "praise"])
    results[0].label, results[0].confidence   # "bug", 0.99

Zero-shot text classification over plain HTTP, no API key. One call carries
up to 1,000 texts and returns in about a second, each answer with a calibrated
confidence. Standard library only.
"""
from __future__ import annotations

import json
import os
import socket
import math
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence

__all__ = ["classify", "Client", "Result", "Response", "ClassifierError"]
__version__ = "0.1.0"

DEFAULT_BASE_URL = "https://classifier.dev"


def _probability(value: Any) -> bool:
    """Whether a decoded score is a finite probability, excluding bools."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    try:
        return math.isfinite(value) and 0 <= value <= 1
    except (OverflowError, ValueError):
        return False


class ClassifierError(Exception):
    """Anything that stopped a call from returning results.

    A non-2xx answer carries the API's message and stable ``code``, the HTTP
    ``status``, and ``retry_after`` seconds on 429. A request that never got an
    answer carries status 0 with code ``timeout`` or ``network``; a 2xx whose
    body is not one result per input is ``bad_response``.
    """

    def __init__(self, message: str, code: str, status: int, retry_after: Optional[int] = None):
        super().__init__(f"classifier.dev: {message} ({code}, HTTP {status})")
        self.message, self.code, self.status, self.retry_after = message, code, status, retry_after


@dataclass
class Result:
    label: Optional[str] = None            # single-label
    labels: List[str] = field(default_factory=list)  # multi-label
    confidence: Optional[float] = None     # calibrated 0-1; None when withheld
    scores: Optional[Dict[str, float]] = None
    escalated: bool = False
    unscored: Optional[str] = None
    model: Optional[str] = None


@dataclass
class Response:
    tier: str
    model: str
    results: List[Result]
    usage: Dict[str, Any]
    models_used: List[str] = field(default_factory=list)


class Client:
    """One classifier.dev deployment. ``api_key`` is optional: a partner key that lifts per-IP limits."""

    def __init__(self, base_url: str = DEFAULT_BASE_URL, api_key: Optional[str] = None, timeout: float = 180.0):
        self.base_url, self.api_key, self.timeout = base_url.rstrip("/"), api_key, timeout

    def classify(
        self,
        inputs: Sequence[str],
        labels: Sequence[str],
        *,
        tier: Optional[str] = None,
        instructions: Optional[str] = None,
        multi: bool = False,
        max_labels: Optional[int] = None,
    ) -> Response:
        if isinstance(inputs, (str, bytes)) or isinstance(labels, (str, bytes)):
            raise ValueError("inputs and labels must be sequences, not strings")
        try:
            input_values, label_values = list(inputs), list(labels)
        except TypeError:
            raise ValueError("inputs and labels must be sequences") from None
        if not all(isinstance(text, str) for text in input_values):
            raise ValueError("inputs must be a sequence of strings")
        if not all(isinstance(label, str) for label in label_values):
            raise ValueError("labels must be a sequence of strings")
        if not 1 <= len(input_values) <= 1000:
            raise ValueError("inputs must hold 1 to 1,000 texts")
        if not 2 <= len(label_values) <= 100:
            raise ValueError("labels must hold 2 to 100 names")
        if max_labels is not None and (isinstance(max_labels, bool) or not isinstance(max_labels, int) or max_labels < 1):
            raise ValueError("max_labels must be a whole number above 0")
        multi = multi or max_labels is not None
        body: Dict[str, Any] = {"inputs": input_values, "labels": label_values}
        if tier:
            body["tier"] = tier
        if instructions:
            body["instructions"] = instructions
        if multi:
            body["multi"] = True
        if max_labels is not None:
            body["max_labels"] = max_labels
        headers = {"content-type": "application/json", "user-agent": f"classifier-dev-python/{__version__}"}
        if self.api_key:
            headers["authorization"] = f"Bearer {self.api_key}"
        req = urllib.request.Request(f"{self.base_url}/v1/classify", data=json.dumps(body).encode(), headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as res:
                payload = json.load(res)
        except urllib.error.HTTPError as e:
            try:
                err = json.loads(e.read() or b"{}")
            except ValueError:
                err = {}
            if not isinstance(err, dict):
                err = {}
            retry = e.headers.get("Retry-After")
            raise ClassifierError(err.get("error", f"HTTP {e.code}"), err.get("code", f"http_{e.code}"), e.code, int(retry) if retry and retry.isdigit() else None) from None
        except (urllib.error.URLError, OSError) as e:
            # No answer at all: a refused connection, a DNS miss, a socket that
            # timed out. One exception type for the caller to catch, as promised.
            reason = getattr(e, "reason", e)
            timed_out = isinstance(reason, (socket.timeout, TimeoutError)) or "timed out" in str(reason).lower()
            raise ClassifierError(f"{'timed out' if timed_out else 'network error'}: {reason}", "timeout" if timed_out else "network", 0) from e
        except ValueError as e:
            raise ClassifierError(f"response was not JSON: {e}", "bad_response", 200) from None
        if not isinstance(payload, dict):
            raise ClassifierError("response was not a JSON object", "bad_response", 200)
        results = payload.get("results")
        if not isinstance(results, list) or len(results) != len(input_values):
            raise ClassifierError(f"{len(results) if isinstance(results, list) else 0} results for {len(input_values)} inputs", "bad_response", 200)
        parsed: List[Result] = []
        for i, raw_result in enumerate(results):
            if not isinstance(raw_result, dict):
                raise ClassifierError(f"result {i} was not a JSON object", "bad_response", 200)
            if multi:
                if not isinstance(raw_result.get("labels"), list) or not all(isinstance(label, str) for label in raw_result["labels"]):
                    raise ClassifierError(f"result {i} has no multi-label answer", "bad_response", 200)
            elif not isinstance(raw_result.get("label"), str):
                raise ClassifierError(f"result {i} has no single-label answer", "bad_response", 200)
            elif "labels" in raw_result and (not isinstance(raw_result["labels"], list) or not all(isinstance(label, str) for label in raw_result["labels"])):
                raise ClassifierError(f"result {i} has invalid optional labels", "bad_response", 200)
            confidence = raw_result.get("confidence")
            if not _probability(confidence) and confidence is not None:
                raise ClassifierError(f"result {i} has invalid confidence", "bad_response", 200)
            scores = raw_result.get("scores")
            if scores is not None and (not isinstance(scores, dict) or not all(isinstance(label, str) and _probability(score) for label, score in scores.items())):
                raise ClassifierError(f"result {i} has invalid scores", "bad_response", 200)
            parsed.append(
                Result(
                    label=raw_result.get("label"), labels=raw_result.get("labels", []), confidence=confidence,
                    scores=None if scores is None else dict(scores), escalated=bool(raw_result.get("escalated")),
                    unscored=raw_result.get("unscored"), model=raw_result.get("model"),
                )
            )
        return Response(
            tier=payload.get("tier", ""),
            model=payload.get("model", ""),
            models_used=payload.get("modelsUsed", []),
            usage=payload.get("usage", {}),
            results=parsed,
        )


def classify(inputs: Sequence[str], labels: Sequence[str], **kwargs: Any) -> List[Result]:
    """One label per text, fast tier, default client. Keyword arguments as in :meth:`Client.classify`."""
    return Client().classify(inputs, labels, **kwargs).results


def _cli() -> None:
    """classify-py <labels> < lines  — a tiny CLI; the full one is `npm i -g classifier-dev`.

    One ``label<TAB>confidence<TAB>text`` line per input line, in input order,
    a thousand lines per request. Errors go to stderr with exit 1; an empty
    stdin is an empty answer. ``CLASSIFIER_ENDPOINT`` points it elsewhere.
    """
    if len(sys.argv) < 2 or sys.argv[1] in ("-h", "--help"):
        print("usage: classify-py label1,label2[,...] < texts.txt", file=sys.stderr)
        sys.exit(2)
    labels = [l.strip() for l in sys.argv[1].split(",") if l.strip()]
    if len(labels) < 2:
        print("classify-py: give at least two labels, comma-separated", file=sys.stderr)
        sys.exit(2)
    texts = [l.strip() for l in sys.stdin if l.strip()]
    client = Client(base_url=os.environ.get("CLASSIFIER_ENDPOINT", DEFAULT_BASE_URL))
    try:
        for start in range(0, len(texts), 1000):
            chunk = texts[start : start + 1000]
            for text, r in zip(chunk, client.classify(chunk, labels).results):
                print(f"{r.label}\t{'-' if r.confidence is None else f'{r.confidence:.2f}'}\t{text}")
    except ClassifierError as e:
        print(f"classify-py: {e.message}", file=sys.stderr)
        sys.exit(1)
