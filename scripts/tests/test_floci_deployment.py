"""Offline regression checks for Floci's unchanged-stack change-set response."""
import importlib.util
import contextlib
import copy
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

SPEC = importlib.util.spec_from_file_location(
    "floci_deployment", Path(__file__).resolve().parents[1] / "floci-j11.py")
LOCAL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(LOCAL)


class ChangeSetTest(unittest.TestCase):
    def test_explicit_empty_update_does_not_execute(self):
        self.assertFalse(LOCAL.change_set_requires_execution({
            "Status": "FAILED", "Changes": [],
            "StatusReason": "The submitted information didn't contain changes. Submit different information to create a change set.",
        }))

    def test_ready_update_executes(self):
        self.assertTrue(LOCAL.change_set_requires_execution({"Status": "CREATE_COMPLETE"}))

    def test_other_failures_and_inconsistent_responses_remain_errors(self):
        for response in (
            {"Status": "FAILED", "StatusReason": "Invalid template", "Changes": []},
            {"Status": "CREATE_IN_PROGRESS"},
            {"Status": "FAILED", "StatusReason": "The submitted information didn't contain changes.",
             "Changes": [{"ResourceChange": {"Action": "Remove"}}]},
        ):
            with self.subTest(response=response), self.assertRaises(RuntimeError):
                LOCAL.change_set_requires_execution(response)


class DeployTest(unittest.TestCase):
    """Exercise real packaging/control flow with offline service responses and fixture files."""

    def setUp(self):
        root = Path(self.enterContext(tempfile.TemporaryDirectory(prefix="alertchain-deploy-test-")))
        self.enterContext(contextlib.redirect_stdout(io.StringIO()))
        (root / "backend").mkdir()
        (root / "backend/handler.py").write_text("def handler(event, context): return event\n")
        (root / "template.yaml").write_text("Resources: {}\n")
        self.enterContext(patch.object(LOCAL, "REPO", root))
        self.sleep = self.enterContext(patch.object(LOCAL.time, "sleep"))
        self.local = LOCAL.Floci.__new__(LOCAL.Floci)
        self.local.evidence = root / "evidence"
        self.local.evidence.mkdir()
        self.resources = {"AlertsTable": {"ResourceType": "AWS::DynamoDB::Table",
                                         "PhysicalResourceId": "original-alerts"}}
        self.rows = {"original-alerts": [{"alertId": {"S": "original"}, "value": {"S": "preserved"}}]}
        self.local.inspect = Mock(return_value=copy.deepcopy(self.resources))
        self.local.resources = Mock(return_value=copy.deepcopy(self.resources))
        self.local.snapshot = Mock(side_effect=[copy.deepcopy(self.rows), copy.deepcopy(self.rows)])
        self.local.ensure_cors = Mock()
        self.local.api = Mock(return_value="http://127.0.0.1:4566")
        self.local.http = Mock(return_value=(200, {"status": "ok"}, {}))
        self.changes = {"Status": "FAILED", "Changes": [],
                        "StatusReason": "The submitted information didn't contain changes."}
        self.statuses = iter(["CREATE_COMPLETE"])
        self.local.aws = Mock(side_effect=self.aws)

    def aws(self, *args, **kwargs):
        if args[:2] == ("cloudformation", "describe-change-set"):
            return self.changes
        if args[:2] == ("cloudformation", "describe-stacks"):
            return {"Stacks": [{"StackStatus": next(self.statuses)}]}
        return {}

    def executed(self):
        return any(call.args[:2] == ("cloudformation", "execute-change-set")
                   for call in self.local.aws.call_args_list)

    def test_unchanged_healthy_stack_runs_preservation_cors_and_health_checks(self):
        for status in ("CREATE_COMPLETE", "UPDATE_COMPLETE"):
            with self.subTest(status=status):
                # Each deployment needs a fresh build directory and two snapshots.
                self.local.evidence = self.local.evidence.parent / status
                self.local.evidence.mkdir()
                self.statuses = iter([status])
                self.local.snapshot.reset_mock(side_effect=True)
                self.local.snapshot.side_effect = [copy.deepcopy(self.rows), copy.deepcopy(self.rows)]
                self.local.deploy("http://127.0.0.1:5173")
                self.assertFalse(self.executed())
                self.assertEqual(self.local.snapshot.call_count, 2)
                self.assertTrue((self.local.evidence / "tables-before.json").is_file())
                self.assertTrue((self.local.evidence / "tables-after.json").is_file())
                self.local.ensure_cors.assert_called_with("http://127.0.0.1:5173")
                self.local.http.assert_called_with("/health")

    def test_actual_update_waits_for_update_complete(self):
        self.changes = {"Status": "CREATE_COMPLETE", "Changes": []}
        self.statuses = iter(["UPDATE_IN_PROGRESS", "UPDATE_COMPLETE"])
        self.local.deploy("http://127.0.0.1:5173")
        self.assertTrue(self.executed())
        self.sleep.assert_called_once_with(1)
        self.assertEqual(self.local.snapshot.call_count, 2)

    def test_actual_update_does_not_accept_create_complete(self):
        self.changes = {"Status": "CREATE_COMPLETE", "Changes": []}
        with self.assertRaisesRegex(RuntimeError, "Stack update did not complete: CREATE_COMPLETE"):
            self.local.deploy("http://127.0.0.1:5173")
        self.assertTrue(self.executed())
        self.local.ensure_cors.assert_not_called()

    def test_unchanged_unhealthy_stack_still_fails(self):
        self.statuses = iter(["UPDATE_ROLLBACK_COMPLETE"])
        with self.assertRaisesRegex(RuntimeError, "UPDATE_ROLLBACK_COMPLETE"):
            self.local.deploy("http://127.0.0.1:5173")
        self.assertFalse(self.executed())
        self.local.ensure_cors.assert_not_called()

    def test_unrelated_change_set_failure_still_fails_before_execution(self):
        self.changes = {"Status": "FAILED", "Changes": [], "StatusReason": "Invalid template"}
        with self.assertRaisesRegex(RuntimeError, "Change set not ready"):
            self.local.deploy("http://127.0.0.1:5173")
        self.assertFalse(self.executed())

    def test_removal_or_replacement_is_never_executed(self):
        for action, replacement in (("Remove", "False"), ("Modify", "True"), ("Modify", "Conditional")):
            with self.subTest(action=action, replacement=replacement):
                self.local.evidence = self.local.evidence.parent / (action + replacement)
                self.local.evidence.mkdir()
                self.local.snapshot.side_effect = [copy.deepcopy(self.rows)]
                self.changes = {"Status": "CREATE_COMPLETE", "Changes": [{"ResourceChange": {
                    "Action": action, "LogicalResourceId": "AlertsTable", "Replacement": replacement}}]}
                with self.assertRaisesRegex(RuntimeError, "removal or replacement"):
                    self.local.deploy("http://127.0.0.1:5173")
                self.assertFalse(self.executed())

    def test_unchanged_deployment_still_checks_table_identity(self):
        self.local.resources.return_value["AlertsTable"]["PhysicalResourceId"] = "replacement-table"
        with self.assertRaises(AssertionError):
            self.local.deploy("http://127.0.0.1:5173")
        self.local.ensure_cors.assert_not_called()

    def test_unchanged_deployment_still_checks_full_record_values(self):
        changed = copy.deepcopy(self.rows)
        changed["original-alerts"][0]["value"]["S"] = "overwritten"
        self.local.snapshot.side_effect = [copy.deepcopy(self.rows), changed]
        with self.assertRaisesRegex(AssertionError, "Data changed: original-alerts"):
            self.local.deploy("http://127.0.0.1:5173")
        self.local.ensure_cors.assert_not_called()


if __name__ == "__main__":
    unittest.main()
