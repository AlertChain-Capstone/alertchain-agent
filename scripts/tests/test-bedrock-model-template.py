"""Offline SAM/default/IAM contract checks; no AWS clients, packaging or deployment.

Run with the installed SAM CLI runtime Python (provides samtranslator).
"""

import copy
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest

from samtranslator.parser.parser import Parser
from samtranslator.translator.arn_generator import ArnGenerator
from samtranslator.translator.translator import Translator
from samtranslator.yaml_helper import yaml_parse

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("floci_model_defaults", ROOT / "scripts/floci-j11.py")
LOCAL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(LOCAL)
MODEL = "us.amazon.nova-micro-v1:0"


class ModelTemplateTest(unittest.TestCase):
    def test_model_endpoints_routes_and_exact_iam_scope(self):
        template = yaml_parse((ROOT / "template.yaml").read_text())
        self.assertEqual(template["Parameters"]["BedrockModelId"]["Default"], MODEL)
        self.assertEqual(LOCAL.build_parser().parse_args(["deploy"]).bedrock_model_id, MODEL)
        self.assertEqual(LOCAL.REGION, "us-east-2")
        variables = template["Resources"]["BackendFunction"]["Properties"]["Environment"]["Variables"]
        self.assertEqual(variables["BEDROCK_MODEL_ID"], {"Ref": "BedrockModelId"})
        self.assertEqual(variables["BEDROCK_REGION"], {"Ref": "AWS::Region"})
        self.assertEqual(variables["DYNAMODB_ENDPOINT_URL"], {"Ref": "DynamoDBEndpointUrl"})
        self.assertEqual(variables["LAMBDA_ENDPOINT_URL"], {"Ref": "DynamoDBEndpointUrl"})
        self.assertEqual(variables["BEDROCK_ENDPOINT_URL"], {"Ref": "BedrockEndpointUrl"})
        policies = template["Resources"]["BackendExecutionRole"]["Properties"]["Policies"]
        policy = next(p for p in policies if p["PolicyName"] == "AgentInvokeBedrock")
        statements = policy["PolicyDocument"]["Statement"]
        self.assertEqual(len(statements), 1)
        self.assertEqual(statements[0]["Action"], ["bedrock:InvokeModel"])
        expected = {f"arn:${{AWS::Partition}}:bedrock:${{AWS::Region}}:${{AWS::AccountId}}:inference-profile/{MODEL}"}
        expected.update(f"arn:${{AWS::Partition}}:bedrock:{region}::foundation-model/amazon.nova-micro-v1:0"
                        for region in ("us-east-1", "us-east-2", "us-west-2"))
        self.assertEqual({r["Fn::Sub"] for r in statements[0]["Resource"]}, expected)
        source = copy.deepcopy(template)
        source["Resources"]["BackendFunction"]["Properties"]["CodeUri"] = "s3://offline-placeholder/backend.zip"
        params = {k: v["Default"] for k, v in source["Parameters"].items()}
        ArnGenerator.BOTO_SESSION_REGION_NAME = "us-east-2"
        translated = Translator({}, Parser(), boto_session=SimpleNamespace(region_name="us-east-2")).translate(
            source, params, get_managed_policy_map=lambda: {})
        self.assertEqual(len(translated["Resources"]["HttpApi"]["Properties"]["Body"]["paths"]), 10)
        function = translated["Resources"]["BackendFunction"]
        # SAM retains CloudFormation Refs; parameter evaluation happens later.
        model_ref = function["Properties"]["Environment"]["Variables"]["BEDROCK_MODEL_ID"]
        self.assertEqual(model_ref, {"Ref": "BedrockModelId"})
        self.assertEqual(params[model_ref["Ref"]], MODEL)
        tables = {k: v for k, v in translated["Resources"].items() if v["Type"] == "AWS::DynamoDB::Table"}
        self.assertEqual(len(tables), 4)
        for name, table in tables.items():
            self.assertEqual(table, template["Resources"][name])


if __name__ == "__main__":
    unittest.main(verbosity=2)
