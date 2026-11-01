"""StepLimiter: caps model turns and wall-clock time for one investigation run."""

from __future__ import annotations

import time
from collections.abc import Callable

DEFAULT_MAX_STEPS = 6
DEFAULT_TIMEOUT_SECONDS = 90.0


class StepLimiter:
    """A step is one model call (converse). Checked before each call, so a run makes at
    most `max_steps` calls. The timeout cannot interrupt an in-flight call; the Bedrock
    client's read timeout bounds that."""

    def __init__(
        self,
        max_steps: int = DEFAULT_MAX_STEPS,
        timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.max_steps = max_steps
        self.timeout_seconds = timeout_seconds
        self._clock = clock
        self._started_at: float | None = None
        self.steps_taken = 0

    def start(self) -> None:
        self._started_at = self._clock()
        self.steps_taken = 0

    def record_step(self) -> None:
        self.steps_taken += 1

    def limit_reason(self) -> str | None:
        if self._started_at is None:
            raise RuntimeError("StepLimiter.start() was not called")
        if self.steps_taken >= self.max_steps:
            return f"step limit of {self.max_steps} reached without a final answer"
        if self._clock() - self._started_at >= self.timeout_seconds:
            return f"timeout of {self.timeout_seconds:g}s reached without a final answer"
        return None
