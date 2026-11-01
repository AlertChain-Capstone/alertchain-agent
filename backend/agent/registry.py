"""ToolRegistry: looks tools up by name and validates model-supplied input before running them."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from .tools import AgentTool, ToolContext, ToolInputError, ToolResult

_JSON_TYPES: dict[str, type | tuple[type, ...]] = {
    "string": str,
    "integer": int,
    "number": (int, float),
    "boolean": bool,
    "array": list,
    "object": dict,
}


class UnknownToolError(LookupError):
    pass


class ToolRegistry:
    def __init__(self, tools: Iterable[AgentTool]) -> None:
        self._tools: dict[str, AgentTool] = {}
        for tool in tools:
            if tool.name in self._tools:
                raise ValueError(f"duplicate tool name {tool.name!r}")
            self._tools[tool.name] = tool

    @property
    def tools(self) -> list[AgentTool]:
        return list(self._tools.values())

    def execute(self, name: str, tool_input: dict[str, Any], context: ToolContext) -> ToolResult:
        tool = self._tools.get(name)
        if tool is None:
            raise UnknownToolError(
                f"unknown tool {name!r}; available tools: {sorted(self._tools)}"
            )
        validate_input(tool.input_schema, tool_input)
        return tool.execute(tool_input, context)


def validate_input(schema: dict[str, Any], tool_input: Any) -> None:
    """Minimal JSON Schema check covering what our tool schemas use (no extra dependency)."""
    if not isinstance(tool_input, dict):
        raise ToolInputError("tool input must be a JSON object")
    props: dict[str, Any] = schema.get("properties", {})
    missing = [k for k in schema.get("required", []) if k not in tool_input]
    if missing:
        raise ToolInputError(f"missing required field(s): {missing}")
    if schema.get("additionalProperties") is False:
        extra = sorted(set(tool_input) - set(props))
        if extra:
            raise ToolInputError(f"unexpected field(s): {extra}")
    for key, value in tool_input.items():
        _validate_value(key, props.get(key, {}), value)


def _validate_value(key: str, spec: dict[str, Any], value: Any) -> None:
    expected = spec.get("type")
    if expected:
        py_type = _JSON_TYPES[expected]
        if not isinstance(value, py_type) or (expected != "boolean" and isinstance(value, bool)):
            raise ToolInputError(f"field {key!r} must be {expected}")
    if "enum" in spec and value not in spec["enum"]:
        raise ToolInputError(f"field {key!r} must be one of {spec['enum']}")
    if isinstance(value, str) and len(value) > spec.get("maxLength", 1000):
        raise ToolInputError(f"field {key!r} is too long")
    if isinstance(value, list):
        if len(value) < spec.get("minItems", 0):
            raise ToolInputError(f"field {key!r} needs at least {spec['minItems']} item(s)")
        for item in value:
            _validate_value(f"{key}[]", spec.get("items", {}), item)
