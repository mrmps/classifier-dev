# SPDX-License-Identifier: Apache-2.0
# Adapted from Laya 0.3.4 (https://github.com/NandhaKishorM/laya).
# Modified for multi-state batching, checkpoint grouping and strict context rejection.
# See LICENSE.upstream for the upstream license.

def predict_routed_batch(router, requests: list[dict], predict=None) -> list[dict]:
    """Use the SDK route decision, batch by resident checkpoint, restore caller order."""
    predict = predict or predict_batch
    groups = {}
    for index, request in enumerate(requests):
        decision = dict(router.route(request["state"], request["questions"]))
        name = decision["model"]
        if name not in router.loaded:
            raise RuntimeError("Required Laya checkpoint was not preloaded")
        groups.setdefault(name, []).append((index, request, decision))
    results = [None] * len(requests)
    for name, rows in groups.items():
        answers = predict(router.load(name), [row[1] for row in rows])
        if len(answers) != len(rows):
            raise RuntimeError("Incomplete checkpoint batch")
        for (index, _, decision), answer in zip(rows, answers):
            answer["routing"] = decision
            answer["model"] = "laya-0.3.4/" + name
            results[index] = answer
    return results


def predict_batch(agent, requests: list[dict]) -> list[dict]:
    """Flatten independent requests into one encoder batch, then split their answers."""
    import numpy as np
    import torch
    from laya.common import (
        QTYPES,
        build_sequence,
        collate_items,
        confidence_from_probs,
        render_options,
        temp_bucket,
    )

    items = []
    metadata = []
    max_len = agent.cfg.get("max_len", 512)
    head_max_len = agent.cfg.get("head_max_len", 192)
    results = [{"model": "laya-0.3.4/english", "answers": {}} for _ in requests]
    for request_index, request in enumerate(requests):
        state, questions = request.get("state"), request.get("questions")
        if state is None or not isinstance(questions, dict) or not questions:
            raise ValueError(f"batch item {request_index} must contain state and non-empty questions")
        for question_id, question in questions.items():
            internal = agent._to_internal(question)
            # Reject instead of silently truncating caller text or label definitions.
            opts = render_options(internal)
            # Match the SDK's special-mask sanitization before checking budgets.
            mask = agent.tok.mask_token
            option_ids = [agent.tok(" " + o.replace(mask, " "), add_special_tokens=False)["input_ids"] for o in opts]
            head_ids = agent.tok("%s question: %s" % (internal["t"], internal["ins"].replace(mask, " ")), add_special_tokens=False)["input_ids"]
            if any(len(o) > 48 for o in option_ids) or sum(len(o) + 1 for o in option_ids) + max(16, len(head_ids)) > head_max_len:
                raise ValueError("question or labels exceed Laya's context budget")
            sequence, markers = build_sequence(agent.tok, state, internal, 100_000, head_max_len)
            if len(sequence) > max_len:
                raise ValueError(f"text and question exceed Laya's {max_len}-token context")
            if len(markers) != len(render_options(internal)):
                raise ValueError(f"question {question_id!r} exceeds head_max_len={head_max_len}")
            items.append({"ids": sequence, "markers": markers, "qtype": QTYPES[internal["t"]]})
            metadata.append((request_index, question_id, internal, len(markers)))

    batch = collate_items([items], agent.tok.pad_token_id)
    with torch.no_grad(), torch.autocast(device_type=agent.device.type, dtype=agent.dtype, enabled=agent.device.type == "cuda"):
        logits, actions = agent.model(
            batch["input_ids"].to(agent.device),
            batch["attention_mask"].to(agent.device),
            batch["marker_pos"].to(agent.device),
            batch["marker_mask"].to(agent.device),
            batch["qtype"].to(agent.device),
        )
    logits = logits.float().cpu().numpy()
    actions = torch.softmax(actions.float(), -1).cpu().numpy()

    token_counts = [0] * len(requests)
    for row, (request_index, question_id, question, option_count) in enumerate(metadata):
        token_counts[request_index] += int(batch["attention_mask"][row].sum())
        question_type = QTYPES[question["t"]]
        scale = agent.temperature_by_options.get(
            temp_bucket(question_type, option_count), agent.temperature[question_type]
        )
        values = logits[row, :option_count] / max(1e-3, float(scale))
        probabilities = np.exp(values - values.max())
        probabilities /= probabilities.sum()
        confidence = round(confidence_from_probs(probabilities, option_count), 4)
        action = {"act_probability": round(float(actions[row, 0]), 4)}
        if question["t"] == "choice":
            keys = list(question["crit"].keys())
            answer = {
                "type": "choice",
                "choice": keys[int(probabilities.argmax())],
                "probabilities": {key: round(float(value), 4) for key, value in zip(keys, probabilities)},
                "confidence": confidence,
                "action": action,
            }
        elif question["t"] == "score":
            answer = {
                "type": "score",
                "score": round(float((np.arange(option_count) * probabilities).sum()), 4),
                "legend": {str(index): criterion for index, criterion in enumerate(question["crit"])},
                "probabilities": {str(index): round(float(value), 4) for index, value in enumerate(probabilities)},
                "confidence": confidence,
                "action": action,
            }
        else:
            answer = {
                "type": "noul",
                "noul": round(float(probabilities[1]), 4),
                "confidence": round(max(float(probabilities[1]), 1.0 - float(probabilities[1])), 4),
                "action": action,
            }
        results[request_index]["answers"][question_id] = answer

    for result, tokens in zip(results, token_counts):
        result["usage"] = {"input_tokens": tokens, "output_tokens": 0}
    return results
