"""AgentOrchestrator: runs the Converse tool loop for one investigation.

Each loop iteration makes one model call. Tool calls are executed through the ToolRegistry;
every call is saved as a ReasoningStep and every successful tool result as Evidence. The run
ends COMPLETED on a valid, fully cited final answer, NEEDS_HUMAN_REVIEW when the StepLimiter
trips or the final answer is unusable, and FAILED when the model call itself fails.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from datetime import UTC, datetime
from typing import Any, Protocol

from domain.investigation import (
    DomainError,
    Evidence,
    EvidenceRepository,
    Investigation,
    InvestigationRepository,
    InvestigationStatus,
    ReasoningStep,
)
from infra.bedrock import LLMGatewayError, ModelTurn, ToolDefinition, ToolUse

from .conclusion_parser import ConclusionParseError, parse_conclusion
from .prompts import SYSTEM_PROMPT, initial_user_message
from .registry import ToolRegistry, UnknownToolError
from .step_limiter import StepLimiter
from .tools import ToolContext, ToolInputError

_UNUSABLE_STOP_REASONS = {"guardrail_intervened", "content_filtered"}


class LLMGateway(Protocol):
    def converse(
        self, system: str, messages: list[dict[str, Any]], tools: Iterable[ToolDefinition] = ()
    ) -> ModelTurn: ...


class InvestigationNotFoundError(LookupError):
    pass


class AgentOrchestrator:
    def __init__(
        self,
        llm: LLMGateway,
        registry: ToolRegistry,
        investigations: InvestigationRepository,
        evidence: EvidenceRepository,
        limiter_factory: Callable[[], StepLimiter] = StepLimiter,
        now: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self._llm = llm
        self._registry = registry
        self._investigations = investigations
        self._evidence = evidence
        self._limiter_factory = limiter_factory
        self._now = now

    def run(self, investigation_id: str) -> Investigation:
        inv = self._investigations.get(investigation_id)
        if inv is None:
            raise InvestigationNotFoundError(investigation_id)
        if inv.status is not InvestigationStatus.RUNNING:
            raise DomainError(f"investigation {inv.id} is {inv.status}, not RUNNING")

        limiter = self._limiter_factory()
        limiter.start()
        messages: list[dict[str, Any]] = [
            {"role": "user", "content": [{"text": initial_user_message(inv.alert_id)}]}
        ]

        while True:
            if reason := limiter.limit_reason():
                inv.escalate(reason)
                break
            try:
                turn = self._llm.converse(SYSTEM_PROMPT, messages, self._registry.tools)
            except LLMGatewayError as exc:
                inv.fail(str(exc))
                break
            limiter.record_step()

            if turn.tool_uses:
                messages.append(turn.assistant_message)
                results = [self._run_tool(inv, tool_use, turn) for tool_use in turn.tool_uses]
                messages.append({"role": "user", "content": results})
                self._investigations.save(inv)  # persist progress after every step
                continue

            self._finish(inv, turn)
            break

        self._investigations.save(inv)
        return inv

    def _run_tool(self, inv: Investigation, tool_use: ToolUse, turn: ModelTurn) -> dict[str, Any]:
        existing = self._evidence.list_for_investigation(inv.id)
        context = ToolContext(
            investigation_id=inv.id,
            alert_id=inv.alert_id,
            known_evidence_ids=frozenset(e.id for e in existing),
        )
        try:
            result = self._registry.execute(tool_use.name, tool_use.input, context)
        except (UnknownToolError, ToolInputError) as exc:
            return self._tool_error(inv, tool_use, turn, str(exc))
        except Exception:  # a broken tool/repository must not crash the run
            return self._tool_error(inv, tool_use, turn, f"tool {tool_use.name!r} failed")

        evidence = Evidence(
            id=f"{inv.id}-ev-{len(existing) + 1}",
            investigation_id=inv.id,
            source=tool_use.name,
            summary=result.summary,
            raw={"tool_input": tool_use.input, "output": result.data},
        )
        self._evidence.add(evidence)
        self._add_step(
            inv,
            turn,
            tool_use,
            {"evidence_id": evidence.id, "summary": result.summary, "data": result.data},
        )
        return {
            "toolResult": {
                "toolUseId": tool_use.tool_use_id,
                "content": [{"json": {"evidence_id": evidence.id, "result": result.data}}],
                "status": "success",
            }
        }

    def _tool_error(
        self, inv: Investigation, tool_use: ToolUse, turn: ModelTurn, message: str
    ) -> dict[str, Any]:
        # Errors are recorded as steps but are not Evidence: they are not facts.
        self._add_step(inv, turn, tool_use, {"error": message})
        return {
            "toolResult": {
                "toolUseId": tool_use.tool_use_id,
                "content": [{"text": f"Error: {message}"}],
                "status": "error",
            }
        }

    def _finish(self, inv: Investigation, turn: ModelTurn) -> None:
        self._add_step(inv, turn, None, None)
        if turn.stop_reason in _UNUSABLE_STOP_REASONS:
            inv.escalate(f"model stopped with {turn.stop_reason}")
            return
        known_ids = {e.id for e in self._evidence.list_for_investigation(inv.id)}
        try:
            inv.complete(parse_conclusion(turn.text), known_ids)
        except (ConclusionParseError, DomainError) as exc:
            inv.escalate(f"final answer rejected: {exc}")

    def _add_step(
        self,
        inv: Investigation,
        turn: ModelTurn,
        tool_use: ToolUse | None,
        tool_output: dict[str, Any] | None,
    ) -> None:
        inv.add_step(
            ReasoningStep(
                step_no=len(inv.steps) + 1,
                thought=turn.thinking or turn.text,
                tool_name=tool_use.name if tool_use else None,
                tool_input=dict(tool_use.input) if tool_use else None,
                tool_output=tool_output,
                timestamp=self._now(),
            )
        )
