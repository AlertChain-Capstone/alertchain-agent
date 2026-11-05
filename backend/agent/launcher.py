"""Starting an investigation run outside the request that created it.

LocalLauncher runs it on a thread in this process (local dev and tests).
LambdaSelfInvokeLauncher asynchronously invokes the current Lambda function with an
"investigation_job" event; the Lambda handler routes that event to
handle_investigation_job. The launcher is picked by the INVESTIGATION_LAUNCHER env var.

The Lambda launcher needs shared storage: the job runs in a different execution
environment, so in-memory repositories are not visible to it.
"""

from __future__ import annotations

import json
import logging
import os
import re
from abc import ABC, abstractmethod
from collections.abc import Callable, Mapping
from concurrent.futures import Executor, ThreadPoolExecutor
from typing import TYPE_CHECKING, Any

from domain.investigation import InvestigationRepository, InvestigationStatus

if TYPE_CHECKING:
    from .orchestrator import AgentOrchestrator
    from .runtime import AgentRuntime

logger = logging.getLogger(__name__)

INVESTIGATION_JOB_TYPE = "investigation_job"
LAUNCHER_ENV_VAR = "INVESTIGATION_LAUNCHER"
_INVESTIGATION_ID = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")


class LauncherError(RuntimeError):
    pass


class InvestigationLauncher(ABC):
    @abstractmethod
    def launch(self, investigation_id: str) -> None:
        """Start the run and return without waiting for it. Raises LauncherError."""


class LocalLauncher(InvestigationLauncher):
    """Runs `run(investigation_id)` on a worker thread of this process."""

    def __init__(self, run: Callable[[str], Any], executor: Executor | None = None) -> None:
        self._run = run
        self._executor = executor or ThreadPoolExecutor(
            max_workers=4, thread_name_prefix="investigation"
        )

    def launch(self, investigation_id: str) -> None:
        try:
            self._executor.submit(self._run, investigation_id)
        except RuntimeError as exc:  # executor shut down
            raise LauncherError(str(exc)) from exc


class LambdaSelfInvokeLauncher(InvestigationLauncher):
    """Invokes the current function asynchronously (InvocationType="Event")."""

    def __init__(self, client: Any = None, function_name: str | None = None) -> None:
        if function_name is None:
            try:
                function_name = os.environ["AWS_LAMBDA_FUNCTION_NAME"]
            except KeyError:
                raise LauncherError("AWS_LAMBDA_FUNCTION_NAME is not set") from None
        self._function_name = function_name
        self._client = client

    def launch(self, investigation_id: str) -> None:
        payload = {"type": INVESTIGATION_JOB_TYPE, "investigationId": investigation_id}
        try:
            response = self._lambda().invoke(
                FunctionName=self._function_name,
                InvocationType="Event",
                Payload=json.dumps(payload).encode(),
            )
        except Exception as exc:
            raise LauncherError(f"lambda invoke failed: {type(exc).__name__}") from exc
        if response.get("StatusCode") != 202:
            raise LauncherError(f"lambda invoke returned status {response.get('StatusCode')}")

    def _lambda(self) -> Any:
        if self._client is None:
            import boto3  # imported lazily so tests and local runs don't need it

            self._client = boto3.client("lambda")
        return self._client


def launcher_from_env(
    run: Callable[[str], Any], env: Mapping[str, str] | None = None
) -> InvestigationLauncher:
    """INVESTIGATION_LAUNCHER=local|lambda. Unset means lambda when running in Lambda
    (a local thread would be frozen once the response is returned), otherwise local."""
    env = os.environ if env is None else env
    kind = env.get(LAUNCHER_ENV_VAR, "").strip().lower()
    if not kind:
        kind = "lambda" if env.get("AWS_LAMBDA_FUNCTION_NAME") else "local"
    if kind == "local":
        return LocalLauncher(run)
    if kind == "lambda":
        name = env.get("AWS_LAMBDA_FUNCTION_NAME")
        if not name:
            raise LauncherError("AWS_LAMBDA_FUNCTION_NAME is not set")
        return LambdaSelfInvokeLauncher(function_name=name)
    raise LauncherError(f"{LAUNCHER_ENV_VAR} must be 'local' or 'lambda', got {kind!r}")


def run_investigation_safely(
    orchestrator: AgentOrchestrator, investigations: InvestigationRepository, investigation_id: str
) -> InvestigationStatus | None:
    """Runs one investigation. Idempotent: a missing or no-longer-RUNNING investigation is
    skipped (Lambda async invokes can be delivered more than once). Anything unexpected
    marks it FAILED so it never stays RUNNING forever. Returns the final status."""
    inv = investigations.get(investigation_id)
    if inv is None:
        logger.warning("investigation %s not found, skipping", investigation_id)
        return None
    if inv.status is not InvestigationStatus.RUNNING:
        logger.info("investigation %s is already %s, skipping", investigation_id, inv.status)
        return inv.status
    try:
        return orchestrator.run(investigation_id).status
    except Exception as exc:
        logger.exception("investigation %s crashed", investigation_id)
        inv = investigations.get(investigation_id)
        if inv is None or inv.status is not InvestigationStatus.RUNNING:
            return inv.status if inv else None
        inv.fail(f"internal error: {type(exc).__name__}")
        investigations.save(inv)
        return inv.status


def handle_investigation_job(
    event: Mapping[str, Any], runtime: AgentRuntime | None = None
) -> dict[str, Any]:
    """Entry point for {"type": "investigation_job", "investigationId": ...} events.

    Raises ValueError for a malformed event (not retried usefully, so the handler should
    log and drop it). Returns {"investigationId", "status"}; status is null if not found.
    """
    if event.get("type") != INVESTIGATION_JOB_TYPE:
        raise ValueError(f"not an {INVESTIGATION_JOB_TYPE} event")
    investigation_id = event.get("investigationId")
    if not isinstance(investigation_id, str) or not _INVESTIGATION_ID.match(investigation_id):
        raise ValueError("investigationId is missing or invalid")
    if runtime is None:
        from .runtime import default_runtime

        runtime = default_runtime()
    status = run_investigation_safely(runtime.orchestrator, runtime.investigations, investigation_id)
    return {"investigationId": investigation_id, "status": str(status) if status else None}
