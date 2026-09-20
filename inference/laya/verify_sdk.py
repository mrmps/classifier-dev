"""One-off GPU equivalence check: uvx --from modal modal run inference/laya/verify_sdk.py."""
import modal
from deploy import image

app = modal.App("classifier-laya-sdk-check")


@app.function(image=image, gpu="L4", cpu=2, memory=4096, max_containers=1, timeout=480)
def verify():
    from adapter import predict_routed_batch, predict_batch
    from runtime import load_router
    router = load_router()
    questions = {
        "department": {"type": "choice", "instructions": "Which department should handle this?",
                       "criteria": {"billing": "invoices, payments, refunds", "technical": "bugs, outages"}},
        "refund": {"type": "noul", "instructions": "Does the user explicitly request a refund?"},
    }
    states = ["Please refund the duplicate invoice payment.",
              "मुझसे दो बार शुल्क लिया गया है। कृपया मेरा पैसा वापस कर दें।",
              "Me han cobrado dos veces en mi cuenta. Por favor, quiero que me devuelvan el dinero.",
              "The application crashes every time I log in."]
    resident = {name: id(router.load(name)) for name in router.loaded}
    expected = [router.predict(state, questions) for state in states]
    actual = predict_routed_batch(router, [{"state": state, "questions": questions} for state in states])
    assert [row["routing"]["model"] for row in actual] == ["english", "multilingual", "multilingual", "english"]
    assert all(id(router.load(name)) == identity for name, identity in resident.items())
    # Typed-decisions is resident but never automatically substituted by the SDK default.
    typed_expected = router.predict(states[0], questions, model="typed-decisions")
    typed_actual = predict_batch(router.load("typed-decisions"), [{"state": states[0], "questions": questions}])[0]
    max_delta = 0.0
    for official, adapted in zip(expected, actual):
        assert official["routing"] == adapted["routing"]
        assert official["usage"] == adapted["usage"]
    for official, adapted in list(zip(expected, actual)) + [(typed_expected, typed_actual)]:
        for key in questions:
            a, b = official["answers"][key], adapted["answers"][key]
            assert a.get("choice") == b.get("choice")
            for field in ("confidence", "noul"):
                if field in a:
                    max_delta = max(max_delta, abs(a[field] - b[field]))
            for label, value in a.get("probabilities", {}).items():
                max_delta = max(max_delta, abs(value - b["probabilities"][label]))
            max_delta = max(max_delta, abs(a["action"]["act_probability"] - b["action"]["act_probability"]))
    assert max_delta <= .01, max_delta  # BF16 padding/batch shape can change rounding.
    return {"rows": len(states), "questions": len(states) * len(questions), "device": "cuda",
            "routes": [row["routing"]["model"] for row in actual], "resident_checkpoints": sorted(resident),
            "same_routing_and_order": True, "same_token_counts": True, "no_model_reloads": True,
            "same_choices": True, "typed_checkpoint_checked": True,
            "max_score_delta": round(max_delta, 6), "tolerance": .01}


@app.local_entrypoint()
def main():
    import json
    from pathlib import Path
    result = verify.remote()
    Path(__file__).with_name("sdk-check.json").write_text(json.dumps(result, indent=2) + "\n")
    print(result)
