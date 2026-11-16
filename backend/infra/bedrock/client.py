"""BedrockClient: the LLM gateway over bedrock-runtime `converse`.

Configuration (env vars):
    BEDROCK_MODEL_ID  default us.amazon.nova-micro-v1:0
    BEDROCK_REGION    default us-east-2 (the project's Region)
Credentials come from the normal boto3 chain (e.g. AWS_PROFILE). Credentials created by
`aws login` need the `boto3[crt]` extra.
"""

from __future__ import annotations

import os
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

from .request_builder import ConverseRequestBuilder
from .response_parser import ModelResponseParser, ModelTurn
from .tool_schema import ToolDefinition, ToolSchemaMapper

DEFAULT_MODEL_ID = "us.amazon.nova-micro-v1:0"
DEFAULT_REGION = "us-east-2"
DEFAULT_MAX_TOKENS = 600


class LLMGatewayError(RuntimeError):
    """The model call failed (throttling after retries, access denied, bad request...)."""


@dataclass(frozen=True)
class BedrockSettings:
    model_id: str = DEFAULT_MODEL_ID
    region: str = DEFAULT_REGION
    max_tokens: int = DEFAULT_MAX_TOKENS
    read_timeout_seconds: int = 60

    @classmethod
    def from_env(cls) -> BedrockSettings:
        return cls(
            model_id=os.environ.get("BEDROCK_MODEL_ID") or DEFAULT_MODEL_ID,
            region=os.environ.get("BEDROCK_REGION") or DEFAULT_REGION,
        )


class BedrockClient:
    def __init__(
        self,
        settings: BedrockSettings | None = None,
        runtime_client: Any | None = None,
    ) -> None:
        """`runtime_client` is injectable so tests never touch AWS."""
        self.settings = settings or BedrockSettings.from_env()
        self._runtime = runtime_client
        self._builder = ConverseRequestBuilder(self.settings.model_id, self.settings.max_tokens)
        self._mapper = ToolSchemaMapper()
        self._parser = ModelResponseParser()

    def converse(
        self,
        system: str,
        messages: list[dict[str, Any]],
        tools: Iterable[ToolDefinition] = (),
    ) -> ModelTurn:
        request = self._builder.build(system, messages, self._mapper.to_tool_config(tools))
        try:
            response = self._runtime_client().converse(**request)
        except Exception as exc:  # botocore ClientError, timeouts, etc.
            raise LLMGatewayError(f"Bedrock converse failed: {exc}") from exc
        return self._parser.parse(response)

    def _runtime_client(self) -> Any:
        if self._runtime is None:
            import boto3
            from botocore.config import Config

            endpoint_url = os.environ.get("BEDROCK_ENDPOINT_URL") or None
            credentials: dict[str, str] = {}
            # Local Floci runs with a real Bedrock: the Lambda's own credentials are Floci's
            # fake ones, so real AWS credentials are passed in separately for Bedrock only.
            # The public endpoint is pinned so a Floci-wide AWS_ENDPOINT_URL can't capture it.
            if os.environ.get("BEDROCK_AWS_ACCESS_KEY_ID"):
                credentials = {
                    "aws_access_key_id": os.environ["BEDROCK_AWS_ACCESS_KEY_ID"],
                    "aws_secret_access_key": os.environ.get("BEDROCK_AWS_SECRET_ACCESS_KEY", ""),
                    "aws_session_token": os.environ.get("BEDROCK_AWS_SESSION_TOKEN") or None,
                }
                endpoint_url = endpoint_url or (
                    f"https://bedrock-runtime.{self.settings.region}.amazonaws.com"
                )
            self._runtime = boto3.client(
                "bedrock-runtime",
                region_name=self.settings.region,
                # BEDROCK_ENDPOINT_URL is only set to use Floci's Bedrock stub; unset or
                # empty means real AWS.
                endpoint_url=endpoint_url,
                **credentials,
                config=Config(
                    retries={"max_attempts": 3, "mode": "adaptive"},
                    read_timeout=self.settings.read_timeout_seconds,
                ),
            )
        return self._runtime
