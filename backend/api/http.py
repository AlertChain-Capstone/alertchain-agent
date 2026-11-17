"""Common request validation and JSON responses for the Lambda HTTP API."""

import json
import re
from typing import Any
from urllib.parse import parse_qsl

RESOURCE_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}")


class InvalidQuery(ValueError):
    pass


def response(status: int, body: Any) -> dict[str, Any]:
    return {"statusCode": status, "headers": {"content-type": "application/json"},
            "body": json.dumps(body, allow_nan=False)}


def error_response(status: int, code: str, message: str) -> dict[str, Any]:
    return response(status, {"error": {"code": code, "message": message}})


def query_values(event: dict[str, Any], allowed_keys: set[str]) -> dict[str, str]:
    # v2 queryStringParameters folds duplicate values into a comma-separated string.
    # Parse rawQueryString instead, so duplicates cannot silently change semantics.
    if "rawQueryString" in event:
        pairs = parse_qsl(event["rawQueryString"], keep_blank_values=True)
    else:
        pairs = list((event.get("queryStringParameters") or {}).items())
    values = {}
    for key, value in pairs:
        if key not in allowed_keys or key in values:
            raise InvalidQuery("Unknown or repeated query parameter.")
        values[key] = value.strip()
    return values


def positive_int(value: str, name: str, maximum: int | None = None) -> int:
    if not re.fullmatch(r"[0-9]+", value):
        raise InvalidQuery(f"{name} must be a positive integer.")
    try:
        result = int(value)
    except ValueError as exc:
        raise InvalidQuery(f"Invalid {name}.") from exc
    if result < 1 or (maximum is not None and result > maximum):
        raise InvalidQuery(f"Invalid {name}.")
    return result
