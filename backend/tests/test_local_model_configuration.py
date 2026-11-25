"""Offline deployment-default and project-boundary tests. No AWS clients or CLI calls."""

import importlib.util
import inspect
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from infra.bedrock import BedrockSettings

_path = Path(__file__).resolve().parents[2] / "scripts" / "floci-j11.py"
_spec = importlib.util.spec_from_file_location("local_floci_configuration", _path)
local = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(local)


def test_nova_micro_defaults_agree_without_initializing_clients():
    expected = "us.amazon.nova-micro-v1:0"
    assert BedrockSettings().model_id == expected
    assert local.DEFAULT_BEDROCK_MODEL_ID == expected
    assert local.build_parser().parse_args(["deploy"]).bedrock_model_id == expected
    assert inspect.signature(local.Floci.deploy).parameters["bedrock_model_id"].default == expected
    assert local.REGION == BedrockSettings().region == "us-east-2"


def test_floci_stub_can_use_intended_profile_without_real_aws_access():
    local.validate_bedrock_model(local.DEFAULT_BEDROCK_MODEL_ID)
    instance = local.Floci.__new__(local.Floci)
    parameters = {p["ParameterKey"]: p["ParameterValue"]
                  for p in instance.bedrock_parameters(None)}
    assert parameters["BedrockEndpointUrl"] == "http://host.docker.internal:4566"
    assert all(parameters[key] == "" for key in
               ("BedrockAccessKeyId", "BedrockSecretAccessKey", "BedrockSessionToken"))
    assert local.ENDPOINT == "http://127.0.0.1:4566"


@pytest.mark.parametrize("model", ["us.amazon.nova-micro-v1:0", "eu.example", "apac.example", "global.example"])
def test_real_cross_region_profile_is_blocked_before_export_or_service_calls(model):
    instance = local.Floci.__new__(local.Floci)
    instance.bedrock_parameters = Mock(side_effect=AssertionError("must not export credentials"))
    instance.aws = Mock(side_effect=AssertionError("must not contact a service"))
    with pytest.raises(ValueError, match="managed project forbids cross-Region"):
        instance.deploy("http://127.0.0.1:5182", "alertchain", model)
    instance.bedrock_parameters.assert_not_called()
    instance.aws.assert_not_called()


def test_bare_micro_id_cannot_misrepresent_us_east_2_compatibility():
    with pytest.raises(ValueError, match="requires the us.amazon.nova-micro-v1:0"):
        local.validate_bedrock_model("amazon.nova-micro-v1:0")


def test_real_bedrock_parameters_pin_public_endpoint_and_isolate_export_environment(monkeypatch):
    # Test the parameter builder independently; deploy() still blocks this project's
    # real cross-Region profile before reaching it. The subprocess is entirely fake.
    export = Mock(return_value=SimpleNamespace(returncode=0, stdout=json.dumps({
        "AccessKeyId": "test-id", "SecretAccessKey": "test-secret", "SessionToken": "test-token",
    })))
    monkeypatch.setattr(local.subprocess, "run", export)
    monkeypatch.setenv("AWS_ENDPOINT_URL", "http://127.0.0.1:4566")
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "test")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "test")
    instance = local.Floci.__new__(local.Floci)
    instance.executable = "mock-aws"
    params = {p["ParameterKey"]: p["ParameterValue"] for p in instance.bedrock_parameters("alertchain")}
    assert params["BedrockEndpointUrl"] == "https://bedrock-runtime.us-east-2.amazonaws.com"
    assert local.ENDPOINT == "http://127.0.0.1:4566"
    assert not any(key.startswith(("AWS_ENDPOINT_URL", "AWS_ACCESS_KEY", "AWS_SECRET", "AWS_SESSION"))
                   for key in export.call_args.kwargs["env"])
