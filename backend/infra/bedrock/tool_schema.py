"""Maps tool definitions to the Bedrock Converse `toolConfig` shape."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any, Protocol


class ToolDefinition(Protocol):
    name: str
    description: str
    input_schema: dict[str, Any]  # JSON Schema object


class ToolSchemaMapper:
    def to_tool_spec(self, tool: ToolDefinition) -> dict[str, Any]:
        return {
            "toolSpec": {
                "name": tool.name,
                "description": tool.description,
                "inputSchema": {"json": tool.input_schema},
            }
        }

    def to_tool_config(self, tools: Iterable[ToolDefinition]) -> dict[str, Any] | None:
        specs = [self.to_tool_spec(t) for t in tools]
        return {"tools": specs} if specs else None
