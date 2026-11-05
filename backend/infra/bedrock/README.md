# Bedrock model spike

Goal: pick the cheapest Bedrock model that supports the Converse API with tool use. Then confirm one
complete tool loop works: the model calls `get_related_events(alert_id)`, gets a tool result, and
writes a final answer.

Checked 2026-11-01 with profile `alertchain`. The first run in us-east-1 was blocked by a
new-account verification hold. The second run, in the project's Region (us-east-2), worked.

## Shortlist: the 3 cheapest models with Converse tool use

Prices are USD per 1M tokens, standard on-demand tier. They come from the AWS Price List API
(service codes `AmazonBedrock` and `AmazonBedrockFoundationModels`) and are the same in us-east-1
and us-east-2. Tool use support comes from each model's card in the Bedrock User Guide
("Converse" API ✓, "Client-side tool calling" ✓).

| # | Model | Input | Output | Model ID to use |
|---|---|---|---|---|
| 1 | Amazon Nova Micro | $0.035 | $0.14 | `amazon.nova-micro-v1:0` (us-east-1 only) / `us.amazon.nova-micro-v1:0` |
| 2 | Amazon Nova Lite | $0.06 | $0.24 | `amazon.nova-lite-v1:0` (us-east-1 and us-east-2) / `us.amazon.nova-lite-v1:0` |
| 3 | Claude Haiku 5.5 | $0.11 (`us.`) / $0.10 (`global.`) | $0.55 / $0.50 | `us.anthropic.claude-haiku-5-5` / `global.anthropic.claude-haiku-5-5` |

Other models checked: Claude 3 Haiku ($0.25 / $1.25) and Nova 2 Lite ($0.30–0.33 / $2.50–2.75).

Notes:
- Nova Micro has **no in-Region endpoint in us-east-2**. From us-east-2, call it through the
  `us.amazon.nova-micro-v1:0` inference profile. That profile can route a request to us-east-1,
  us-east-2 or us-west-2.
- Nova Micro handles text only and returns at most 10K output tokens. Nova Lite also accepts images
  and video.
- Claude Haiku 5.5 is billed through AWS Marketplace, so its charges appear under Anthropic rather
  than Amazon Bedrock. Haiku 5.5 and Claude Haiku 4.5 ($1.00–1.10 / $5.00–5.50) are separate
  products.

## Test runs

Script: [`spike_converse.py`](spike_converse.py)

```
uv run --no-project --with "boto3[crt]" python backend/infra/bedrock/spike_converse.py \
  --region us-east-2 --model us.amazon.nova-micro-v1:0
```

`boto3[crt]` is required, not just `boto3`, because botocore needs the CRT extra to read credentials
created by `aws login`.

### Run 2: us-east-2, worked

| Field | Result |
|---|---|
| Model ID | `us.amazon.nova-micro-v1:0` (US inference profile) |
| Region | us-east-2 |
| maxTokens | 300 per call |
| Worked | **Yes.** The model called `get_related_events(alert_id='A-1')`, used the fake tool result, and finished with `stopReason: end_turn`. |
| Converse calls | 2 (one tool request, one final answer) |
| Tokens used | 1,213 input + 308 output (two calls combined) |
| Estimated cost | **$0.0000856** (1,213 × $0.035/1M + 308 × $0.14/1M) |

The final answer was correct. It linked the v2.14.0 deploy to the latency spike and the exhausted DB
connection pool, then suggested monitoring the service and rolling back if the problem continued.

Findings for the backend:
- **Nova Micro writes `<thinking>…</thinking>` text before its answer.** That reasoning appears in
  the response text, so strip it before showing the answer to users or storing it.
- **The tool definition takes up most of the input.** Over 1,200 input tokens for such a small
  prompt shows that the tool schema and system scaffolding are re-sent on every call. Each extra
  tool or loop step adds tokens.
- **Run cost:** about $0.0001 per investigation of this size, or roughly 11,700 investigations
  per $1.

### Run 1: us-east-1, blocked

| Field | Result |
|---|---|
| Model ID | `amazon.nova-micro-v1:0` |
| Region | us-east-1 |
| Worked | **No.** `AccessDeniedException: Your account is currently being verified…` (a new-account hold, not a code or model problem) |
| Tokens used / cost | 0 / $0.00 |

## LLM gateway (H12)

`BedrockClient` (`client.py`) wraps bedrock-runtime `converse` for the investigation agent in
`backend/agent/`. `ConverseRequestBuilder`, `ToolSchemaMapper` and `ModelResponseParser` build
the request, map tool definitions, and parse the response. The parser moves Nova's
`<thinking>…</thinking>` text out of the visible answer.

| Env var | Default |
|---|---|
| `BEDROCK_MODEL_ID` | `us.amazon.nova-micro-v1:0` |
| `BEDROCK_REGION` | `us-east-2` |

`maxTokens` is 600. Credentials come from the normal boto3 chain (e.g. `AWS_PROFILE`).

Tests use a fake bedrock-runtime client, so they make no AWS calls and do not need boto3:

```
uv run --no-project --python 3.12 --with pytest --with fastapi --with httpx python -m pytest backend/tests -v
```

## Investigations API and launcher (H13)

`backend/api/investigations.py` exposes `POST /investigations` (`{"alertId": "A-1"}` →
202 `{"investigationId": ...}`) and `GET /investigations/{investigationId}` (status,
steps, evidence, conclusion). POST saves a RUNNING investigation and hands it to an
`InvestigationLauncher` (`backend/agent/launcher.py`):

| `INVESTIGATION_LAUNCHER` | Launcher | Use |
|---|---|---|
| `local` (default outside Lambda) | `LocalLauncher` – worker thread in this process | local dev, tests |
| `lambda` (default inside Lambda) | `LambdaSelfInvokeLauncher` – async `lambda.invoke` of `AWS_LAMBDA_FUNCTION_NAME` with `{"type": "investigation_job", "investigationId": ...}` | deployed API |

The Lambda handler routes `investigation_job` events to
`agent.handle_investigation_job(event)`. It is idempotent: an investigation that is no
longer RUNNING (a redelivered or retried event) is skipped.

**The Lambda launcher needs shared storage.** The job runs in a different execution
environment, so the in-memory repositories used today are not visible to it. Use
`INVESTIGATION_LAUNCHER=local` until the repositories are backed by DynamoDB.

Frontend (FA2): set `VITE_API_BASE_URL` to the API URL for live mode. The mock prototype
is used when `VITE_USE_MOCK=true` or no API URL is set.
