"""Storage port for normalized alerts."""

from abc import ABC, abstractmethod

from .models import NormalizedAlert


class AlertRepository(ABC):
    @abstractmethod
    def store_if_absent(self, alert: NormalizedAlert) -> bool:
        """Return True if inserted, False if the alert ID already exists."""
        ...
