"""Storage port for normalized alerts."""

from abc import ABC, abstractmethod

from .models import AlertFilter, AlertPage, IncidentAssociation, NormalizedAlert


class AlertRepository(ABC):
    @abstractmethod
    def store_if_absent(self, alert: NormalizedAlert) -> bool:
        """Return True if inserted, False if the alert ID already exists."""
        ...

    @abstractmethod
    def list_alerts(self, filter: AlertFilter, page: int, page_size: int) -> AlertPage:
        """Return a numbered page and full filtered total, newest first, ID descending on ties."""
        ...

    @abstractmethod
    def get_alert(self, alert_id: str) -> NormalizedAlert | None: ...

    @abstractmethod
    def get_raw_event(self, alert_id: str) -> dict | None:
        """Return raw detail or None; raise AlertNotFoundError if the alert is absent."""
        ...


class AlertIncidentLookup(ABC):
    """FA1 read port; does not alter FA2/FA3's incident repository contract."""

    @abstractmethod
    def get_association(self, alert_id: str) -> IncidentAssociation: ...
