"""Turns the model's final-answer text into a domain Conclusion."""

from __future__ import annotations

import json
import re
from typing import Any

from domain.investigation import (
    AttackChain,
    AttackChainStage,
    Conclusion,
    Confidence,
    DomainError,
    Severity,
)

_FENCED_JSON = re.compile(r"```(?:json)?\s*(\{.*?\})\s*```", re.DOTALL)


class ConclusionParseError(ValueError):
    pass


def parse_conclusion(text: str) -> Conclusion:
    data = _extract_json(text)
    try:
        stages = tuple(
            AttackChainStage(
                description=str(stage["description"]),
                evidence_ids=tuple(_str_list(stage.get("evidence_ids"))),
            )
            for stage in data.get("attack_chain") or []
        )
        return Conclusion(
            summary=str(data["summary"]).strip(),
            severity=Severity(str(data["severity"]).upper()),
            confidence=Confidence(str(data["confidence"]).upper()),
            attack_chain=AttackChain(stages),
            evidence_ids=tuple(_str_list(data.get("evidence_ids"))),
        )
    except (KeyError, TypeError, ValueError, DomainError) as exc:
        raise ConclusionParseError(f"invalid conclusion: {exc}") from exc


def _extract_json(text: str) -> dict[str, Any]:
    fenced = _FENCED_JSON.search(text)
    candidate = fenced.group(1) if fenced else text[text.find("{") : text.rfind("}") + 1]
    if not candidate:
        raise ConclusionParseError("final answer contains no JSON object")
    try:
        data = json.loads(candidate)
    except json.JSONDecodeError as exc:
        raise ConclusionParseError(f"final answer is not valid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise ConclusionParseError("final answer JSON must be an object")
    return data


def _str_list(value: Any) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
        raise TypeError("evidence_ids must be a list of strings")
    return list(dict.fromkeys(value))
