"""Read stored incident reports and the evidence cited by each report."""

from datetime import UTC, datetime
from typing import Any

from domain.investigation import EvidenceRepository, IncidentRepository


SEVERITY_ORDER = {"Critical": 0, "High": 1, "Medium": 2, "Low": 3}


def _timestamp(value: str | None) -> str | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value)
        if parsed.tzinfo is not None:
            return parsed.astimezone(UTC).isoformat(timespec="microseconds").replace("+00:00", "Z")
    except (ValueError, OverflowError):
        pass
    return None


def _summary(record: dict[str, Any]) -> dict[str, Any]:
    # The FA2 tool opens an incident. Earlier records have no creation or event time.
    return {
        "id": record["id"],
        "title": record.get("title") or record["id"],
        "severity": (record.get("severity") or "Unknown").capitalize(),
        "status": (record.get("status") or "Open").replace("_", " ").capitalize(),
        "occurredAt": _timestamp(record.get("occurred_at")),
        "createdAt": _timestamp(record.get("created_at")),
        "investigationId": record.get("investigation_id"),
        "alertId": record.get("alert_id"),
    }


class IncidentQueryService:
    def __init__(self, incidents: IncidentRepository, evidence: EvidenceRepository):
        self._incidents = incidents
        self._evidence = evidence

    def list_incidents(self, search: str, severity: str, status: str,
                       page: int, page_size: int) -> dict[str, Any]:
        search, severity, status = search.casefold(), severity.casefold(), status.casefold()
        matches = []
        for record in self._incidents.list_all():
            row = _summary(record)
            if severity and row["severity"].casefold() != severity:
                continue
            if status and row["status"].casefold() != status:
                continue
            if search in f'{row["id"]} {row["title"]}'.casefold():
                matches.append(row)

        # Stable sorts apply the secondary keys before the primary severity key.
        matches.sort(key=lambda row: row["id"])
        matches.sort(key=lambda row: row["occurredAt"] or row["createdAt"] or "", reverse=True)
        matches.sort(key=lambda row: SEVERITY_ORDER.get(row["severity"], len(SEVERITY_ORDER)))
        start = (page - 1) * page_size
        return {"incidents": matches[start:start + page_size], "totalIncidents": len(matches),
                "page": page, "pageSize": page_size}

    def get_incident(self, incident_id: str) -> dict[str, Any] | None:
        record = self._incidents.get(incident_id)
        if record is None:
            return None
        evidence_ids = list(dict.fromkeys(record.get("evidence_ids") or []))
        investigation_id = record.get("investigation_id")
        evidence = []
        if investigation_id and evidence_ids:
            scoped = {item.id: item for item in self._evidence.list_for_investigation(investigation_id)
                      if item.investigation_id == investigation_id}
            for cited_id in evidence_ids:
                if cited_id in scoped:
                    item = scoped[cited_id]
                    evidence.append({"id": item.id, "incidentId": incident_id, "source": item.source,
                                     "summary": item.summary, "raw": item.raw})
        return {**_summary(record), "summary": record.get("summary"), "evidenceIds": evidence_ids,
                "evidence": evidence}
