import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { answerQuestion, resolveEvidence, selectIncidents } from '../src/fa3/fa3Data.js'

const data = JSON.parse(readFileSync(new URL('../src/mock/fa3.json', import.meta.url)))
const fa1 = JSON.parse(readFileSync(new URL('../src/mock/fa1.json', import.meta.url)))
const fa2 = JSON.parse(readFileSync(new URL('../src/mock/fa2.json', import.meta.url)))
const first = data.incidents[0]

test('portfolio ordering is severity descending, then timestamp descending; filters combine', () => {
  const all = selectIncidents(data.incidents, { search: '', severity: '', status: '' })
  assert.deepEqual(all.map((i) => i.id), ['INC-001', 'INC-DEMO-003', 'INC-DEMO-004', 'INC-DEMO-005', 'INC-002', 'INC-DEMO-006'])
  const filtered = selectIncidents(data.incidents, { search: 'logging', severity: 'High', status: 'Open' })
  assert.deepEqual(filtered.map((i) => i.id), ['INC-001'])
  assert.equal(selectIncidents(data.incidents, { search: '', severity: 'Critical', status: '' }).length, 0)
})

test('all substantive canned answers cite evidence owned by their incident', () => {
  for (const incident of data.incidents) {
    for (const answer of incident.answers) {
      const result = answerQuestion(incident, answer.question)
      assert.equal(result.kind, 'answer')
      assert.ok(result.citations.length)
      for (const id of result.citations) assert.equal(resolveEvidence(incident, id)?.incidentId, incident.id)
    }
  }
})

test('snapshots and shared incident links agree with existing FA1/FA2 fixtures', () => {
  for (const incident of data.incidents) {
    if (incident.investigationId) {
      const inv = fa2.investigations.find((i) => i.id === incident.investigationId)
      assert.equal(inv.incidentId, incident.id)
    }
    for (const evidence of incident.evidence) {
      const alert = fa1.alerts.find((a) => a.id === evidence.alertId)
      assert.deepEqual(evidence.raw, alert.rawEvent)
      for (const key of ['occurredAt', 'principal', 'resource', 'eventName']) assert.equal(evidence[key], alert[key])
    }
  }
})

test('invalid and foreign citations never expose evidence or unsupported answers', () => {
  const poisoned = { ...first, evidence: first.evidence.map((e) => ({ ...e, incidentId: 'OTHER' })) }
  assert.equal(resolveEvidence(poisoned, 'E2'), null)
  assert.equal(answerQuestion(poisoned, first.answers[0].question).kind, 'limitation')
  assert.equal(answerQuestion(first, first.answers[0].question, 'invalid').kind, 'limitation')
})

test('validation, unrecognized questions, missing evidence, timeout and partial answers remain distinct', () => {
  assert.equal(answerQuestion(first, '   ').kind, 'validation')
  assert.equal(answerQuestion(first, 'Disable logging now').kind, 'limitation')
  assert.equal(answerQuestion(first, 'Tell me something unrelated').kind, 'limitation')
  assert.equal(answerQuestion(first, first.answers[0].question, 'timeout').kind, 'timeout')
  assert.equal(answerQuestion({ ...first, evidence: [] }, first.answers[0].question).kind, 'limitation')
  const partial = answerQuestion(first, first.answers[3].question)
  assert.equal(partial.kind, 'answer')
  assert.equal(partial.partial, true)
  assert.ok(partial.limitation)
})
