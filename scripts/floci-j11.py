"""Local-only J11 deployment/verification. Every AWS CLI operation is pinned to Floci.

No AWS credentials/profile are used. Artifacts and evidence are written under the OS temp dir.
Deploy updates the existing stack only, rejecting deletions/replacements and preserving data.
"""

from __future__ import annotations

import argparse
import ast
import json
import os
import re
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError
from urllib.parse import urlencode, urlparse
from urllib.request import ProxyHandler, Request, build_opener
import uuid

ENDPOINT = "http://127.0.0.1:4566"
REGION = "us-east-2"
STACK = "alertchain-local"
WEBSITE_ORIGIN = "http://alertchain-frontend-local.s3-website-us-east-2.localhost.floci.io:4566"
REPO = Path(__file__).resolve().parents[1]
TABLES = ("alertchain-alerts", "alertchain-investigations", "alertchain-evidence", "alertchain-incidents")
HTTP = build_opener(ProxyHandler({}))


class Floci:
    def __init__(self):
        self.executable = shutil.which("aws")
        if not self.executable:
            raise RuntimeError("AWS CLI v2 must already be installed")
        self.env = {key: value for key, value in os.environ.items()
                    if key not in ("AWS_PROFILE", "AWS_DEFAULT_PROFILE")
                    and not key.startswith("AWS_ENDPOINT_URL")}
        self.env.update(AWS_ACCESS_KEY_ID="test", AWS_SECRET_ACCESS_KEY="test", AWS_SESSION_TOKEN="test",
                        AWS_REGION=REGION, AWS_DEFAULT_REGION=REGION, AWS_PAGER="",
                        AWS_ENDPOINT_URL=ENDPOINT, AWS_ENDPOINT_URL_S3=ENDPOINT,
                        AWS_EC2_METADATA_DISABLED="true", AWS_MAX_ATTEMPTS="1")
        self.evidence = Path(tempfile.mkdtemp(prefix="alertchain-j11-"))
        print(f"Floci only: {ENDPOINT}; evidence: {self.evidence}", flush=True)

    def aws(self, *args, timeout=60):
        result = subprocess.run([self.executable, "--endpoint-url", ENDPOINT, "--region", REGION,
                                 "--no-cli-pager", "--output", "json", *args], env=self.env,
                                capture_output=True, text=True, timeout=timeout)
        if result.returncode:
            raise RuntimeError(f"Local {' '.join(args[:2])}: {result.stderr.strip() or result.stdout.strip()}")
        if args[:2] == ("cloudformation", "package"):
            return {"packaged": True}
        return json.loads(result.stdout) if result.stdout.strip() else {}

    def save(self, name, value):
        path = self.evidence / name
        path.write_text(json.dumps(value, indent=2), encoding="utf-8")
        return path

    def file_arg(self, name, value):
        return "file://" + str(self.save(name, value))

    def resources(self):
        result = self.aws("cloudformation", "list-stack-resources", "--stack-name", STACK)
        return {r["LogicalResourceId"]: r for r in result["StackResourceSummaries"]}

    def snapshot(self):
        result = {}
        for table in TABLES:
            rows = []
            args = []
            while True:
                page = self.aws("dynamodb", "scan", "--table-name", table, "--consistent-read",
                                "--no-paginate", *args)
                rows.extend(page.get("Items", []))
                if not page.get("LastEvaluatedKey"):
                    break
                args = ["--exclusive-start-key", self.file_arg("scan-key.json", page["LastEvaluatedKey"])]
            result[table] = rows
        return result

    def api(self):
        api_id = self.resources()["HttpApi"]["PhysicalResourceId"]
        metadata = self.aws("apigatewayv2", "get-api", "--api-id", api_id)
        self.save("api.json", metadata)
        # Floci returns AWS-shaped ApiEndpoint metadata. Use its documented local hostname
        # with the discovered stack-owned API ID; never request the public AWS hostname.
        host = f"{api_id}.execute-api.localhost.floci.io"
        addresses = {item[4][0] for item in socket.getaddrinfo(host, 4566, type=socket.SOCK_STREAM)}
        if not addresses or not addresses <= {"127.0.0.1", "::1"}:
            raise RuntimeError(f"Refusing non-loopback API hostname: {addresses}")
        return f"http://{host}:4566"

    def http(self, path, query=None, *, method="GET", headers=None):
        base = getattr(self, "api_url", None)
        if base is None:
            base = self.api_url = self.api()
        request = Request(base + path + ("?" + urlencode(query) if query else ""),
                          method=method, headers=headers or {})
        try:
            response = HTTP.open(request, timeout=125)
        except HTTPError as error:
            response = error
        raw = response.read().decode("utf-8")
        try:
            body = json.loads(raw) if raw else None
        except ValueError:
            body = raw
        return response.status, body, dict(response.headers)

    def inspect(self):
        stack = self.aws("cloudformation", "describe-stacks", "--stack-name", STACK)["Stacks"][0]
        resources = self.resources()
        assert sum(r["ResourceType"] == "AWS::Lambda::Function" for r in resources.values()) == 1
        print("Stack:", stack["StackStatus"], "API:", self.api(), flush=True)
        for table in TABLES:
            data = self.aws("dynamodb", "describe-table", "--table-name", table)["Table"]
            print(table, "items", data.get("ItemCount"), "indexes",
                  [g["IndexName"] for g in data.get("GlobalSecondaryIndexes", [])], flush=True)
        return resources

    def bedrock_parameters(self, profile):
        """Real AWS credentials for the Lambda's Bedrock client only (from `aws login`).
        Without a profile, Bedrock calls go to Floci's stub, which returns placeholder text."""
        if not profile:
            print("No --bedrock-profile: investigations will use Floci's Bedrock stub", flush=True)
            return [{"ParameterKey": "BedrockEndpointUrl", "ParameterValue": "http://host.docker.internal:4566"},
                    *({"ParameterKey": key, "ParameterValue": ""} for key in
                      ("BedrockAccessKeyId", "BedrockSecretAccessKey", "BedrockSessionToken"))]
        env = {key: value for key, value in os.environ.items()
               if not key.startswith(("AWS_ENDPOINT_URL", "AWS_ACCESS_KEY", "AWS_SECRET", "AWS_SESSION"))}
        result = subprocess.run([self.executable, "configure", "export-credentials", "--profile", profile,
                                 "--format", "process"], env=env, capture_output=True, text=True, timeout=60)
        if result.returncode:
            raise RuntimeError(f"Could not read AWS credentials for profile {profile!r} "
                               f"(run `aws login --profile {profile}`): {result.stderr.strip()}")
        creds = json.loads(result.stdout)
        print(f"Bedrock: real AWS via profile {profile!r}; credentials expire {creds.get('Expiration')}",
              flush=True)
        # Explicit public endpoint: Floci keeps a variable's previous value when it is set to "".
        return [{"ParameterKey": "BedrockEndpointUrl",
                 "ParameterValue": f"https://bedrock-runtime.{REGION}.amazonaws.com"},
                {"ParameterKey": "BedrockAccessKeyId", "ParameterValue": creds["AccessKeyId"]},
                {"ParameterKey": "BedrockSecretAccessKey", "ParameterValue": creds["SecretAccessKey"]},
                {"ParameterKey": "BedrockSessionToken", "ParameterValue": creds.get("SessionToken") or ""}]

    def deploy(self, origin, bedrock_profile=None):
        bedrock = self.bedrock_parameters(bedrock_profile)
        parsed = urlparse(origin)
        if parsed.scheme != "http" or parsed.hostname not in ("127.0.0.1", "localhost") or parsed.path:
            raise ValueError("Use a loopback HTTP frontend origin, e.g. http://127.0.0.1:5173")
        resources_before = self.inspect()
        before = self.snapshot()
        self.save("tables-before.json", before)
        source = self.evidence / "build"
        source.mkdir()
        shutil.copytree(REPO / "backend", source / "backend",
                        ignore=shutil.ignore_patterns("tests", "__pycache__", "*.pyc", ".env", ".env.*"))
        for path in (source / "backend").rglob("*.py"):
            ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        shutil.copyfile(REPO / "template.yaml", source / "template.yaml")
        validation = self.aws("cloudformation", "validate-template", "--template-body",
                              "file://" + str(source / "template.yaml"))
        self.save("validation.json", validation)
        packaged = source / "packaged.yaml"
        self.aws("cloudformation", "package", "--template-file", str(source / "template.yaml"),
                 "--s3-bucket", "alertchain-local-artifacts", "--output-template-file", str(packaged))
        name = "j11-" + uuid.uuid4().hex[:12]
        self.aws("cloudformation", "create-change-set", "--stack-name", STACK,
                 "--change-set-name", name, "--change-set-type", "UPDATE", "--template-body",
                 "file://" + str(packaged), "--capabilities", "CAPABILITY_IAM", "--parameters",
                 self.file_arg("parameters.json", [
                     {"ParameterKey": "DynamoDBEndpointUrl", "ParameterValue": "http://host.docker.internal:4566"},
                     {"ParameterKey": "CorsAllowedOrigins", "ParameterValue": f"{origin},{WEBSITE_ORIGIN}"},
                     *bedrock,
                 ]))
        changes = self.aws("cloudformation", "describe-change-set", "--stack-name", STACK,
                           "--change-set-name", name)
        self.save("change-set.json", changes)
        if changes.get("Status") != "CREATE_COMPLETE":
            raise RuntimeError(f"Change set not ready: {changes}")
        for change in changes.get("Changes", []):
            resource = change["ResourceChange"]
            print("Change:", resource["Action"], resource["LogicalResourceId"],
                  "replacement", resource.get("Replacement"), flush=True)
            if resource["Action"] == "Remove" or resource.get("Replacement") in ("True", "Conditional"):
                raise RuntimeError("Refusing change set with removal or replacement")
        self.aws("cloudformation", "execute-change-set", "--stack-name", STACK, "--change-set-name", name)
        deadline = time.monotonic() + 120
        while True:
            stack = self.aws("cloudformation", "describe-stacks", "--stack-name", STACK)["Stacks"][0]
            if stack["StackStatus"] == "UPDATE_COMPLETE":
                break
            if stack["StackStatus"] != "UPDATE_IN_PROGRESS" or time.monotonic() > deadline:
                raise RuntimeError(f"Stack update did not complete: {stack['StackStatus']}")
            time.sleep(1)
        resources_after = self.resources()
        for key, resource in resources_before.items():
            if resource["ResourceType"] == "AWS::DynamoDB::Table":
                assert resources_after[key]["PhysicalResourceId"] == resource["PhysicalResourceId"]
        after = self.snapshot()
        for table, rows in before.items():
            stored = {json.dumps(row, sort_keys=True) for row in after[table]}
            assert all(json.dumps(row, sort_keys=True) in stored for row in rows), f"Data changed: {table}"
        self.save("tables-after.json", after)
        print("PASS stack UPDATE_COMPLETE; original table IDs and every existing record preserved", flush=True)
        self.ensure_cors(origin)
        print("API:", self.api(), flush=True)
        print("Health:", self.http("/health")[:2], flush=True)

    def ensure_cors(self, origin):
        api_id = self.resources()["HttpApi"]["PhysicalResourceId"]
        # The local website (scripts/deploy-floci-frontend.ps1) calls this API too.
        desired = {"AllowOrigins": [origin, WEBSITE_ORIGIN], "AllowMethods": ["GET", "POST", "OPTIONS"],
                   "AllowHeaders": ["Content-Type"], "MaxAge": 600}
        metadata = self.aws("apigatewayv2", "get-api", "--api-id", api_id)
        if metadata.get("CorsConfiguration") != desired:
            print("Floci SAM did not retain declared CORS; applying it through local update-api", flush=True)
            self.aws("apigatewayv2", "update-api", "--api-id", api_id, "--cors-configuration",
                     self.file_arg("cors.json", desired))
        actual = self.aws("apigatewayv2", "get-api", "--api-id", api_id).get("CorsConfiguration")
        assert actual == desired, actual
        status, _, headers = self.http("/alerts", method="OPTIONS", headers={
            "Origin": origin, "Access-Control-Request-Method": "GET"})
        normalized = {key.lower(): value for key, value in headers.items()}
        assert status in (200, 204) and normalized.get("access-control-allow-origin") == origin, (status, headers)
        print("PASS local CORS metadata and preflight for", origin, flush=True)

    def verify(self, ids, origin):
        self.inspect()
        if not ids:
            process = subprocess.run(["powershell.exe", "-NoProfile", "-File",
                                      str(REPO / "scripts/test-floci-ingestion.ps1")],
                                     env=self.env, capture_output=True, text=True, timeout=150)
            (self.evidence / "ingestion.txt").write_text(process.stdout + process.stderr, encoding="utf-8")
            print(process.stdout, flush=True)
            assert process.returncode == 0, process.stderr
            ids = re.findall(r"PASS [^\n]+alertId=([a-f0-9-]+)", process.stdout)
        assert len(ids) == 3, "Supply the three fresh IDs printed by the J10 ingestion smoke test"
        snapshot = self.snapshot()
        self.save("verification-before.json", snapshot)
        rows = {row["alertId"]["S"]: row for row in snapshot["alertchain-alerts"]}
        records = [decode(row) for row in rows.values()]
        expected_order = sorted(records, key=lambda row: (row["eventTime"], row["alertId"]), reverse=True)
        self.api_url = self.api()
        results = []

        def passed(name):
            print("PASS", name, flush=True)
            results.append(name)

        def read(path, query=None, expected_status=200, headers=None):
            status, body, actual_headers = self.http(path, query, headers=headers)
            assert status == expected_status, (path, status, body)
            return body, {key.lower(): value for key, value in actual_headers.items()}

        first, headers = read("/alerts", {"page": 1, "pageSize": 2}, headers={"Origin": origin})
        assert headers.get("access-control-allow-origin") == origin, headers
        assert first["totalAlerts"] == len(rows)
        seen = []
        for number in range(1, (len(rows) + 1) // 2 + 1):
            page, _ = read("/alerts", {"page": number, "pageSize": 2})
            assert page["page"] == number and page["pageSize"] == 2 and page["totalAlerts"] == len(rows)
            seen.extend(row["id"] for row in page["alerts"])
        assert seen == [row["alertId"] for row in expected_order]
        assert len(seen) == len(set(seen))
        extra, _ = read("/alerts", {"page": len(rows) + 1, "pageSize": 2})
        assert extra["alerts"] == [] and extra["totalAlerts"] == len(rows)
        passed("HTTP numbered pages, exact totals, descending time/ID order, no duplicates and out-of-range page")

        for alert_id in ids:
            stored = decode(rows[alert_id])
            found, _ = read("/alerts", {"search": alert_id, "page": 1, "pageSize": 6})
            assert found["totalAlerts"] == 1 and found["alerts"][0]["id"] == alert_id
            detail, _ = read(f"/alerts/{alert_id}")
            for field in ("eventName", "source", "severity", "status", "region", "principal", "resource"):
                assert detail[field] == stored.get(field), (field, detail, stored)
            assert detail["occurredAt"] == stored["eventTime"]
            assert detail["createdAt"] == stored["createdTime"]
            assert "rawEvent" not in detail and "incidentId" not in detail
            raw, _ = read(f"/alerts/{alert_id}/raw-event")
            assert raw["rawEvent"] == stored["rawEvent"]
            fixture_name = ("guardduty_finding.json" if stored["source"] == "Amazon GuardDuty" else
                            "cloudtrail_stop_logging.json" if stored["eventName"] == "StopLogging"
                            else "cloudtrail_create_access_key.json")
            fixture = json.loads((REPO / "backend/tests/fixtures" / fixture_name).read_text())
            if stored["source"] == "Amazon GuardDuty":
                fixture["detail"]["id"] = stored["rawEvent"]["id"]
                fixture["detail"]["arn"] = stored["rawEvent"]["arn"]
            else:
                fixture["detail"]["eventID"] = stored["rawEvent"]["eventID"]
            assert raw["rawEvent"] == fixture["detail"], "Source fixture detail changed"
            association, _ = read(f"/alerts/{alert_id}/associated-incident")
            assert association == {"alertId": alert_id, "status": "none", "incidentId": None}
        passed("All three ingested alerts: search, normalized details, exact raw fixture fidelity and no association")

        sample = next(row for row in records if row["alertId"] in ids and row["eventName"] == "StopLogging")
        bound = sample["eventTime"]
        combined = {"search": "stopLOG", "source": "AWS CloudTrail", "severity": "HIGH", "status": "New",
                    "from": bound, "to": bound, "pageSize": 100}
        expected = [row for row in expected_order if row["source"] == "AWS CloudTrail"
                    and row["severity"] == "HIGH" and row["status"] == "New"
                    and "stoplog" in row["eventName"].lower() and row["eventTime"] == bound]
        actual, _ = read("/alerts", combined)
        assert actual["totalAlerts"] == len(expected) > 0
        assert [row["id"] for row in actual["alerts"]] == [row["alertId"] for row in expected]
        empty, _ = read("/alerts", {"search": "j11-no-match-" + uuid.uuid4().hex})
        assert empty["alerts"] == [] and empty["totalAlerts"] == 0
        passed("Case-insensitive search, combined source/severity/status filters, inclusive equal time bounds and empty results")

        missing = str(uuid.uuid4())
        for suffix in ("", "/raw-event", "/associated-incident"):
            body, _ = read(f"/alerts/{missing}{suffix}", expected_status=404)
            assert body["error"]["code"] == "ALERT_NOT_FOUND"
        for query in ({"page": 0}, {"pageSize": 101}, {"severity": "High"}, {"from": "invalid"},
                      {"from": "2026-11-15T00:00:00Z", "to": "2026-11-01T00:00:00Z"}):
            body, _ = read("/alerts", query, expected_status=400)
            assert body["error"]["code"] == "INVALID_QUERY"
        repeated, _ = read("/alerts?page=1&page=2", expected_status=400)
        assert repeated["error"]["code"] == "INVALID_QUERY"
        passed("Missing alert 404s across all detail operations and invalid/repeated filter/pagination 400s")

        # Acknowledge execution of redelivery through Lambda, not merely acceptance by EventBridge.
        # The original smoke test already exercised EventBridge -> Lambda for these same IDs.
        for alert_id in ids:
            stored = decode(rows[alert_id])
            envelope = {"source": "aws.guardduty", "detail-type": "GuardDuty Finding"}
            if stored["source"] == "AWS CloudTrail":
                envelope = {"source": "aws.cloudtrail" if stored["eventName"] == "StopLogging" else "aws.iam",
                            "detail-type": "AWS API Call via CloudTrail"}
            envelope.update(detail=stored["rawEvent"], time=stored["eventTime"])
            output = self.evidence / f"duplicate-{alert_id}.json"
            invoke = self.aws("lambda", "invoke", "--function-name", "alertchain-backend",
                              "--cli-binary-format", "raw-in-base64-out", "--payload",
                              self.file_arg(f"event-{alert_id}.json", envelope), str(output))
            assert not invoke.get("FunctionError"), invoke
            assert json.loads(output.read_text()) == {"alertId": alert_id, "outcome": "duplicate"}
            item = self.aws("dynamodb", "get-item", "--table-name", "alertchain-alerts", "--consistent-read",
                            "--key", self.file_arg("key.json", {"alertId": {"S": alert_id}}))["Item"]
            assert item == rows[alert_id], "Duplicate modified the stored alert"
        passed("Acknowledged duplicate redelivery of all three alerts preserves complete stored items and creation times")

        run_id = uuid.uuid4().hex
        own_ids = []
        alert_id = ids[0]
        try:
            for index in range(2):
                incident_id = f"INC-J11-{run_id}-{index}"
                incident = {"incident_id": {"S": incident_id}, "alert_id": {"S": alert_id},
                            "investigation_id": {"S": f"INV-J11-{run_id}"}, "verificationRun": {"S": run_id}}
                self.aws("dynamodb", "put-item", "--table-name", "alertchain-incidents", "--item",
                         self.file_arg("incident.json", incident), "--condition-expression", "attribute_not_exists(incident_id)")
                own_ids.append(incident_id)
                result, _ = read(f"/alerts/{alert_id}/associated-incident")
                assert result == {"alertId": alert_id, "status": "associated" if index == 0 else "ambiguous",
                                  "incidentId": incident_id if index == 0 else None}, result
            passed("Associated incident: one match returns ID; multiple matches explicitly ambiguous without selection")
        finally:
            for incident_id in own_ids:
                self.aws("dynamodb", "delete-item", "--table-name", "alertchain-incidents", "--key",
                         self.file_arg("incident-key.json", {"incident_id": {"S": incident_id}}),
                         "--condition-expression", "verificationRun = :run", "--expression-attribute-values",
                         self.file_arg("incident-condition.json", {":run": {"S": run_id}}))
        final = self.snapshot()
        assert {t: sorted(json.dumps(r, sort_keys=True) for r in v) for t, v in final.items()} == {
            t: sorted(json.dumps(r, sort_keys=True) for r in v) for t, v in snapshot.items()}
        passed("Verification cleanup removed only its own synthetic incidents; all baseline table data unchanged")
        denied_status, _, denied_headers = self.http("/alerts", headers={"Origin": "http://127.0.0.1:9999"})
        assert denied_status == 200 and not any(k.lower() == "access-control-allow-origin" for k in denied_headers)
        passed("Allowed frontend Origin receives CORS header; unrelated Origin does not")
        self.save("verification.json", {"apiUrl": self.api_url, "alertIds": ids, "totalAlerts": len(rows),
                                         "passed": results, "origin": origin})
        print("Verified alert IDs:", ",".join(ids), flush=True)


def decode(value):
    """DynamoDB wire JSON -> ordinary JSON values (only source JSON types are stored)."""
    if len(value) == 1:
        kind, item = next(iter(value.items()))
        if kind == "S":
            return item
        if kind == "N":
            return float(item) if "." in item or "e" in item.lower() else int(item)
        if kind == "NULL":
            return None
        if kind == "BOOL":
            return item
        if kind == "L":
            return [decode(child) for child in item]
        if kind == "M":
            return {key: decode(child) for key, child in item.items()}
    return {key: decode(child) for key, child in value.items()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("inspect", "deploy", "verify"))
    parser.add_argument("--origin", default="http://127.0.0.1:5173")
    parser.add_argument("--bedrock-profile",
                        help="AWS profile whose credentials the Floci Lambda uses for real Bedrock calls")
    parser.add_argument("--alert-ids", help="Comma-separated IDs from an already-passed J10 smoke run")
    args = parser.parse_args()
    local = Floci()
    if args.action == "deploy":
        local.deploy(args.origin, args.bedrock_profile)
    elif args.action == "verify":
        local.verify(args.alert_ids.split(",") if args.alert_ids else [], args.origin)
    else:
        local.inspect()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"FAIL: {error}", flush=True)
        sys.exit(1)
