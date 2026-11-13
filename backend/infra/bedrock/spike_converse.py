"""Spike: verify Bedrock Converse tool use end to end with one cheap model.

Flow: user asks the model to investigate alert "A-1" -> model requests the
get_related_events tool -> we return a fake tool result -> model gives a final answer.

Run (boto3[crt] is required for credentials created by `aws login`):
    uv run --no-project --with "boto3[crt]" python backend/infra/bedrock/spike_converse.py
    uv run --no-project --with "boto3[crt]" python backend/infra/bedrock/spike_converse.py \
        --region us-east-2 --model us.amazon.nova-lite-v1:0
"""

import argparse
import json
import re

import boto3
from botocore.config import Config

# USD per 1M tokens, from the AWS Price List API (AmazonBedrock /
# AmazonBedrockFoundationModels, standard on-demand tier), checked 2026-11-01.
PRICES_PER_MTOK = {
    "amazon.nova-micro-v1:0": (0.035, 0.14),
    "us.amazon.nova-micro-v1:0": (0.035, 0.14),
    "amazon.nova-lite-v1:0": (0.06, 0.24),
    "us.amazon.nova-lite-v1:0": (0.06, 0.24),
    "us.anthropic.claude-haiku-5-5": (0.11, 0.55),
    "global.anthropic.claude-haiku-5-5": (0.10, 0.50),
}

MAX_TOKENS = 300

TOOL_CONFIG = {
    "tools": [
        {
            "toolSpec": {
                "name": "get_related_events",
                "description": "Return monitoring events related to an alert, such as deploys, "
                "config changes and other alerts on the same service.",
                "inputSchema": {
                    "json": {
                        "type": "object",
                        "properties": {
                            "alert_id": {"type": "string", "description": "Alert ID, e.g. A-1"}
                        },
                        "required": ["alert_id"],
                    }
                },
            }
        }
    ]
}

ALERT_ID_RE = re.compile(r"^[A-Za-z0-9-]{1,32}$")


def get_related_events(alert_id: str) -> dict:
    """Fake tool: canned events for the spike."""
    return {
        "alert_id": alert_id,
        "events": [
            {"time": "2026-11-01T09:58:00Z", "type": "deploy", "service": "checkout-api",
             "detail": "Deployed v2.14.0"},
            {"time": "2026-11-01T10:01:00Z", "type": "alert", "service": "checkout-api",
             "detail": "p95 latency 2.4s (threshold 800ms)"},
            {"time": "2026-11-01T10:02:00Z", "type": "alert", "service": "payments-db",
             "detail": "Connection pool exhausted (100/100)"},
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", default="alertchain")
    parser.add_argument("--region", default="us-east-2")
    parser.add_argument("--model", default="us.amazon.nova-lite-v1:0")
    args = parser.parse_args()

    client = boto3.Session(profile_name=args.profile, region_name=args.region).client(
        "bedrock-runtime", config=Config(retries={"max_attempts": 3, "mode": "adaptive"})
    )

    messages = [{
        "role": "user",
        "content": [{"text": 'Investigate alert "A-1". Use the tools available, then give a '
                             "short likely root cause and next step."}],
    }]
    usage = {"inputTokens": 0, "outputTokens": 0}
    calls = 0
    tool_called = False

    def converse():
        nonlocal calls
        calls += 1
        resp = client.converse(
            modelId=args.model,
            messages=messages,
            toolConfig=TOOL_CONFIG,
            inferenceConfig={"maxTokens": MAX_TOKENS, "temperature": 0},
        )
        usage["inputTokens"] += resp["usage"]["inputTokens"]
        usage["outputTokens"] += resp["usage"]["outputTokens"]
        return resp

    resp = converse()
    if resp["stopReason"] == "tool_use":
        assistant_msg = resp["output"]["message"]
        messages.append(assistant_msg)
        results = []
        for block in assistant_msg["content"]:
            if "toolUse" not in block:
                continue
            tool_use = block["toolUse"]
            alert_id = tool_use["input"].get("alert_id", "")
            # Model output is untrusted: validate before calling the tool.
            if tool_use["name"] == "get_related_events" and ALERT_ID_RE.match(alert_id):
                tool_called = True
                print(f"tool call: get_related_events(alert_id={alert_id!r})")
                content, status = [{"json": get_related_events(alert_id)}], "success"
            else:
                content, status = [{"text": "Invalid tool call."}], "error"
            results.append({"toolResult": {"toolUseId": tool_use["toolUseId"],
                                           "content": content, "status": status}})
        messages.append({"role": "user", "content": results})
        resp = converse()

    final_text = "".join(b.get("text", "") for b in resp["output"]["message"]["content"])
    worked = tool_called and resp["stopReason"] in ("end_turn", "max_tokens") and bool(final_text)

    in_price, out_price = PRICES_PER_MTOK.get(args.model, (None, None))
    cost = None
    if in_price is not None:
        cost = usage["inputTokens"] / 1e6 * in_price + usage["outputTokens"] / 1e6 * out_price

    print("\nfinal answer:\n" + final_text)
    print("\n" + json.dumps({
        "model": args.model,
        "region": args.region,
        "worked": worked,
        "tool_called": tool_called,
        "final_stop_reason": resp["stopReason"],
        "converse_calls": calls,
        "usage": usage,
        "estimated_cost_usd": round(cost, 8) if cost is not None else None,
    }, indent=2))


if __name__ == "__main__":
    main()
