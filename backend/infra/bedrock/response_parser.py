"""Parses a Converse response into a ModelTurn.

Nova models put their reasoning in `<thinking>...</thinking>` inside the text output. The
parser moves it to `ModelTurn.thinking` so it is never shown to users as the answer. Nova Lite
wraps the final answer in `<answer>...</answer>` and Nova Micro sometimes in `<response>...</response>`;
those tags are removed, the text is kept. A reply cut off mid closing tag (`</thinking`) is handled.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

_THINKING_BLOCK = re.compile(r"<thinking>(.*?)</thinking>", re.IGNORECASE | re.DOTALL)
# An opening tag with no close, e.g. output cut off by maxTokens.
_THINKING_UNCLOSED = re.compile(r"<thinking>(.*)\Z", re.IGNORECASE | re.DOTALL)
_STRAY_TAG = re.compile(r"</?thinking>", re.IGNORECASE)
# Nova Lite wraps its final answer in <answer>...</answer>; keep the content, drop the tags.
_ANSWER_TAG = re.compile(r"</?(?:answer|response)>", re.IGNORECASE)
# Output cut off in the middle of a closing tag, e.g. "...</thinking" with no ">".
_PARTIAL_CLOSE = re.compile(r"</(?:t(?:h(?:i(?:n(?:k(?:i(?:n(?:g)?)?)?)?)?)?)?)?\Z", re.IGNORECASE)


def strip_thinking(text: str) -> tuple[str, list[str]]:
    """Return (visible_text, thinking_blocks)."""
    text = _PARTIAL_CLOSE.sub("", text.rstrip()) if _PARTIAL_CLOSE.search(text.rstrip()) else text
    thoughts = [m.strip() for m in _THINKING_BLOCK.findall(text)]
    visible = _THINKING_BLOCK.sub("", text)
    unclosed = _THINKING_UNCLOSED.search(visible)
    if unclosed:
        thoughts.append(unclosed.group(1).strip())
        visible = visible[: unclosed.start()]
    visible = _STRAY_TAG.sub("", visible)
    visible = _ANSWER_TAG.sub("", visible)
    return visible.strip(), [t for t in thoughts if t]


@dataclass(frozen=True)
class ToolUse:
    tool_use_id: str
    name: str
    input: dict[str, Any]


@dataclass(frozen=True)
class ModelTurn:
    stop_reason: str
    text: str  # visible text with <thinking> removed
    thinking: str
    tool_uses: list[ToolUse] = field(default_factory=list)
    # Original assistant message, appended unchanged to the conversation history.
    assistant_message: dict[str, Any] = field(default_factory=dict)
    input_tokens: int = 0
    output_tokens: int = 0


class ModelResponseParser:
    def parse(self, response: dict[str, Any]) -> ModelTurn:
        message = response.get("output", {}).get("message", {"role": "assistant", "content": []})
        texts: list[str] = []
        tool_uses: list[ToolUse] = []
        for block in message.get("content", []):
            if "text" in block:
                texts.append(block["text"])
            elif "toolUse" in block:
                tu = block["toolUse"]
                tool_input = tu.get("input")
                tool_uses.append(
                    ToolUse(
                        tool_use_id=tu["toolUseId"],
                        name=tu["name"],
                        input=tool_input if isinstance(tool_input, dict) else {},
                    )
                )
        visible, thoughts = strip_thinking("\n".join(texts))
        usage = response.get("usage", {})
        return ModelTurn(
            stop_reason=response.get("stopReason", ""),
            text=visible,
            thinking="\n".join(thoughts),
            tool_uses=tool_uses,
            assistant_message=message,
            input_tokens=usage.get("inputTokens", 0),
            output_tokens=usage.get("outputTokens", 0),
        )
