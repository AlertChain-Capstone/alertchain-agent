const severityRank = { Critical: 4, High: 3, Medium: 2, Low: 1 }

export function selectIncidents(incidents, filters) {
  const query = filters.search.trim().toLowerCase()
  return incidents.filter((incident) =>
    (!filters.severity || incident.severity === filters.severity) &&
    (!filters.status || incident.status === filters.status) &&
    `${incident.id} ${incident.title}`.toLowerCase().includes(query),
  ).sort((a, b) => (severityRank[b.severity] ?? 0) - (severityRank[a.severity] ?? 0) || b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id))
}

export function formatDate(iso) {
  return iso ? new Date(iso).toISOString().replace('T', ' ').replace('.000Z', ' UTC') : 'Not recorded'
}

export function resolveEvidence(incident, id) {
  return incident.evidence.find((item) => item.id === id && item.incidentId === incident.id) ?? null
}

const normalize = (value) => value.trim().toLowerCase().replace(/[?!.]+$/g, '').replace(/\s+/g, ' ')

// Deliberately exact canned questions, never a generated or keyword-guessed answer.
export function answerQuestion(incident, question, scenario = 'normal') {
  if (!question.trim()) return { kind: 'validation', text: 'Enter a question about this incident.' }
  if (scenario === 'timeout') return { kind: 'timeout', text: 'The agent did not answer in time. Your question was kept.' }
  if (scenario === 'scope' || /^(please\s+)?(disable|delete|revoke|stop|remediate|fix)\b/i.test(question.trim()) || /\b(weather|other incidents|all incidents)\b/i.test(question)) {
    return { kind: 'limitation', text: `Ask about ${incident.id} using its stored evidence. Ask the Agent cannot change AWS resources or answer across unrelated incidents.` }
  }
  if (scenario === 'insufficient' || !incident.evidence.length) {
    return { kind: 'limitation', text: 'The available stored evidence cannot support an answer. No factual conclusion or citation was produced.' }
  }
  const answer = incident.answers.find((item) => normalize(item.question) === normalize(question))
  if (!answer) return { kind: 'limitation', text: 'This Inception prototype has no canned answer for that question. Try a suggested question about this incident; no answer has been inferred.' }
  const citations = scenario === 'invalid' ? ['INVALID'] : answer.citations
  if (!citations.length || citations.some((id) => !resolveEvidence(incident, id))) {
    return { kind: 'limitation', text: 'A verifiable answer could not be produced. The candidate answer had invalid citations and was withheld.' }
  }
  return { ...answer, citations, kind: 'answer' }
}
