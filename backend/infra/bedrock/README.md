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
| 2 | Amazon Nova Lite (chosen) | $0.06 | $0.24 | `us.amazon.nova-lite-v1:0` (AWS lists no in-Region endpoint in us-east-2, so use the US inference profile) |
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

> Team decision (Nov 12): the backend default is now **Nova Lite** (`us.amazon.nova-lite-v1:0`) for more reliable tool calling. The table below was measured on Nova Micro. The Nova Lite re-run (Nov 13) is in "Run 3" below.

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

### Run 3: us-east-2, Nova Lite (Nov 13)

| Field | Nova Lite (this run) | Nova Micro (Run 2) |
|---|---|---|
| Model ID | `us.amazon.nova-lite-v1:0` | `us.amazon.nova-micro-v1:0` |
| Tool call | `get_related_events(alert_id='A-1')` | same |
| Final stopReason | `end_turn` | `end_turn` |
| Converse calls | 2 | 2 |
| Tokens (in + out) | 1,209 + 334 | 1,213 + 308 |
| Estimated cost | $0.0001527 | $0.0000856 |
| Investigations per $1 | about 6,500 | about 11,700 |

Cost: 1,209 × $0.06/1M + 334 × $0.24/1M. Lite is about 1.8x the cost of Micro and still tiny per
investigation. No AWS resources were created by the spike.

Findings:
- **Nova Lite also wraps its final answer in `<answer>...</answer>`.** `ModelResponseParser` now
  strips those tags (it already removed `<thinking>` text), so users never see raw tags.
- **One run is not a model comparison.** On this single alert at temperature 0, Lite treated the
  exhausted payments-db connection pool as unrelated, while Micro linked the deploy, the latency
  and the pool and suggested a rollback. Run both models on several sample alerts before drawing
  conclusions about answer quality.

### Run 4: Micro vs Lite on 4 alerts, maxTokens 300 (Nov 13)

Total cost $0.0009825. Only 3 of 8 runs reached `end_turn`: 4 hit the 300 token cap (the models write
long `<thinking>` text first) and 1 was blocked by Bedrock's content filter. The backend uses
maxTokens 600, so this test was harsher than real use. Not a clean comparison.

| Alert | Micro | Lite |
|---|---|---|
| A-1 deploy/latency/pool | Finished, linked deploy, latency and pool, gave next steps | Cut off before any root cause |
| S-2 IAM key abuse (true positive) | Cut off inside `<thinking>` (reasoning was correct) | `content_filtered` |
| B-3 nightly batch (benign) | Correct but cut off, raw `<response>` tag | Finished, correct, vague |
| U-4 VPN + secret read (ambiguous) | Cut off on `</thinking` (reasoning was right) | Finished, but wrongly called it benign |

Takeaways: Micro reasoned better in all 4 cases but rarely finished. Lite finished more often but was
over-confident on U-4 and was blocked on S-2. The orchestrator already escalates to a human on
`content_filtered`. Next: re-run at maxTokens 600 and repeat S-2 on Lite to see if it is always blocked.

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
| `BEDROCK_MODEL_ID` | `us.amazon.nova-lite-v1:0` |
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
