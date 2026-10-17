// FA2 data helpers. FA1 alert fixtures are read here and never modified.
import fa1 from '../mock/fa1.json'
import fa2 from '../mock/fa2.json'

export const config = {
  referenceTime: fa2.referenceTime,
  severityThreshold: fa2.severityThreshold,
  reviewThreshold: fa2.confidenceReviewThreshold,
  maxSteps: fa2.maxSteps,
  analystName: fa2.analystName,
  otherAnalystName: fa2.otherAnalystName,
}

export const alerts = fa1.alerts
export const alertById = (id) => alerts.find((alert) => alert.id === id)

const SEVERITY_RANK = { Low: 1, Medium: 2, High: 3 }
export const isBelowThreshold = (alert) =>
  (SEVERITY_RANK[alert.severity] ?? 0) < SEVERITY_RANK[config.severityThreshold]

export function formatTime(iso) {
  return iso ? new Date(iso).toISOString().slice(11, 16) : '—'
}

export function formatDateTime(iso) {
  return iso ? new Date(iso).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '—'
}

// Label and colour for an investigation's status chip.
export function statusOf(inv) {
  if (inv.resolution) return { label: `Closed · ${inv.resolution.type}`, tone: inv.resolution.type === 'True positive' ? 'danger' : 'success' }
  if (inv.status === 'paused') return { label: 'Paused', tone: 'warning' }
  if (inv.status === 'running') {
    const failed = inv.trace.filter((step) => step.failed).length
    return failed ? { label: `Running · ${failed} step failed`, tone: 'warning' } : { label: 'Running', tone: 'info' }
  }
  if (needsReview(inv)) return { label: 'Needs human review', tone: 'warning' }
  return { label: 'Investigation done · Alert open', tone: 'info' }
}

export function needsReview(investigation) {
  return investigation.status === 'done' && investigation.confidence < config.reviewThreshold
}

const TECHNIQUES = {
  PutBucketPolicy: 'T1530 Data from Cloud Storage',
  CreateAccessKey: 'T1098.001 Additional Cloud Credentials',
  StopLogging: 'T1562.008 Disable or Modify Cloud Logs',
  DeleteTrail: 'T1562.008 Disable or Modify Cloud Logs',
  AttachUserPolicy: 'T1098 Account Manipulation',
  ConsoleLogin: 'T1110 Brute Force',
  'UnauthorizedAccess:EC2/SSHBruteForce': 'T1110 Brute Force',
  'Recon:IAMUser/UserPermissions': 'T1087.004 Cloud Account Discovery',
  'UnauthorizedAccess:IAMUser/InstanceCredentialExfiltration.OutsideAWS': 'T1078.004 Valid Accounts: Cloud Accounts',
}

const NEXT_STEPS = {
  PutBucketPolicy: (alert) => [
    { text: `Remove any public access from ${alert.resource}`, action: { kind: 'copy', label: 'Copy CLI command', value: `aws s3api delete-bucket-policy --bucket ${alert.resource}` } },
    { text: `Ask ${alert.principal} whether the policy change was planned`, action: { kind: 'copy', label: 'Copy message', value: `Hi ${alert.principal} – did you plan the bucket policy change on ${alert.resource}? AlertChain flagged it.` } },
    { text: `Review what ${alert.principal} did today`, action: { kind: 'trace', label: 'Open filtered trace', filter: alert.principal } },
  ],
  CreateAccessKey: (alert) => [
    { text: `Confirm ${alert.principal} created the new key on purpose`, action: { kind: 'copy', label: 'Copy message', value: `Hi ${alert.principal} – did you create access key ${alert.accessKeyId} today?` } },
    { text: `If not, deactivate key ${alert.accessKeyId}`, action: { kind: 'copy', label: 'Copy CLI command', value: `aws iam update-access-key --user-name ${alert.principal} --access-key-id ${alert.accessKeyId} --status Inactive` } },
    { text: `Review what ${alert.sourceIp ?? 'the same IP'} did after the key was created`, action: { kind: 'trace', label: 'Open filtered trace', filter: alert.sourceIp ?? alert.principal } },
  ],
}

function defaultNextSteps(alert) {
  return [
    { text: `Confirm with the owner of ${alert.principal} that this activity was expected`, action: { kind: 'copy', label: 'Copy message', value: `Hi – AlertChain flagged ${alert.eventName} by ${alert.principal} (${alert.id}). Was this expected?` } },
    { text: `Review everything ${alert.principal} did in the last 24 hours`, action: { kind: 'trace', label: 'Open filtered trace', filter: alert.principal } },
    { text: `If it was not expected, revoke active sessions for ${alert.principal}`, action: { kind: 'copy', label: 'Copy CLI command', value: `aws iam put-role-policy --role-name ${alert.principal} --policy-name AWSRevokeOlderSessions --policy-document file://revoke.json` } },
  ]
}

// Steps a simulated investigation adds one at a time. `kind` marks where the
// Bedrock (paused) and CloudTrail (failed step) demo scenarios take effect.
export function buildRunPlan(alert) {
  const t = formatTime(alert.occurredAt)
  const steps = [
    { kind: 'bedrock', decision: 'Plan the first check', why: 'Amazon Bedrock decides what to look at first.', tool: 'Amazon Bedrock', query: `plan(alert=${alert.id})`, result: `Start with the principal's recent CloudTrail activity.`, evidence: [] },
    { kind: 'cloudtrail', decision: `Find everything ${alert.principal} did around ${t}`, why: 'Related calls show what else the principal touched.', tool: 'AWS CloudTrail', query: `LookupEvents Username=${alert.principal}, last 24 hours`, result: `5 events, including ${alert.eventName} at ${t}.`, evidence: ['E1'], links: [{ label: `${alert.id} ${alert.eventName} event`, alertId: alert.id, available: alert.rawEvent != null }] },
    { kind: 'baseline', decision: `Check whether ${alert.principal} normally does this`, why: 'A first-time action is more suspicious.', tool: 'AWS CloudTrail', query: `LookupEvents Username=${alert.principal} EventName=${alert.eventName}, last 90 days`, result: '0 earlier events in 90 days.', evidence: ['E2'] },
    { kind: 'guardduty', decision: 'Check GuardDuty findings in the same window', why: 'GuardDuty may have seen related behaviour.', tool: 'Amazon GuardDuty', query: 'ListFindings, last 24 hours', result: 'No related findings.', evidence: [] },
    { kind: 'correlate', decision: 'Link the events into an attack chain', why: 'Correlate anything related within 24 h.', tool: 'Correlation rules', query: 'correlate(E1, E2, window=24h)', result: 'Only one event – no chain.', evidence: ['E1'] },
    { kind: 'verdict', decision: 'Write the verdict and next steps', why: 'The analyst needs a decision and concrete actions.', tool: 'Amazon Bedrock', query: 'summarize(evidence=E1–E2)', result: '', evidence: ['E1', 'E2'] },
  ]
  const evidenceByStep = {
    cloudtrail: { id: 'E1', alertId: alert.id, text: `${alert.id} · ${alert.eventName} by ${alert.principal} · ${t}`, source: alert.source.replace('Amazon ', '').replace('AWS ', '') },
    baseline: { id: 'E2', alertId: null, text: `Baseline · ${alert.principal} has not done ${alert.eventName} in 90 days`, source: 'Baseline' },
  }
  const high = alert.severity === 'High'
  const final = {
    verdict: high ? 'Likely malicious' : 'Suspicious',
    confidence: high ? 81 : 74,
    summary: `${alert.summary} ${alert.principal} has not done this in the last 90 days and no related activity explains it (E1, E2).`,
    nextSteps: (NEXT_STEPS[alert.eventName] ?? defaultNextSteps)(alert).map((step, i) => ({ id: `NS${i + 1}`, ...step })),
  }
  steps[5].result = `${final.verdict}, confidence ${final.confidence}%. ${final.nextSteps.length} next steps.`
  const node = {
    id: 'N1', alertId: alert.id, time: t, event: alert.eventName, principal: alert.principal,
    resource: alert.resource, technique: TECHNIQUES[alert.eventName] ?? null, evidence: 'E1', traceStep: 2,
    why: `This is the only event linked to ${alert.id} so far.`,
  }
  return { steps, evidenceByStep, final, node }
}

function hydrate(raw) {
  if (raw.status !== 'running') {
    return { ...raw, ticks: Object.fromEntries((raw.resolution?.done ?? []).map((id) => [id, 'done'])), skipReasons: raw.resolution?.skipped ?? {} }
  }
  const alert = alertById(raw.alertId)
  const plan = buildRunPlan(alert)
  // INV-003 is already partway through when the demo opens.
  const done = 2
  return {
    ...raw, plan, cursor: done, scenario: 'normal', holdUntilOpened: true,
    trace: plan.steps.slice(0, done).map((step, i) => ({ ...step, n: i + 1 })),
    evidence: [plan.evidenceByStep.cloudtrail],
    nextSteps: [], ticks: {}, skipReasons: {},
    chain: { window: `${formatTime(alert.occurredAt)} → now, 2026-10-17`, nodes: [plan.node], edges: [] },
  }
}

export function initialInvestigations() {
  return fa2.investigations.map(hydrate)
}

export function newInvestigation(alert, id, scenario) {
  const plan = buildRunPlan(alert)
  return {
    id, alertId: alert.id, incidentId: null, status: scenario === 'bedrock' ? 'paused' : 'running',
    startedAt: config.referenceTime, finishedAt: null, plan, cursor: 0, scenario,
    trace: [], evidence: [], nextSteps: [], ticks: {}, skipReasons: {},
    chain: { window: `${formatTime(alert.occurredAt)} → now, 2026-10-17`, nodes: [], edges: [] },
  }
}

// Advance a running investigation by one reasoning step.
export function advance(inv) {
  if (inv.status !== 'running') return inv
  const step = inv.plan.steps[inv.cursor]
  const n = inv.trace.length + 1
  const failed = inv.scenario === 'cloudtrail' && step.kind === 'cloudtrail'
  const traced = failed
    ? { ...step, n, failed: true, result: 'AccessDenied – the agent is not allowed to call cloudtrail:LookupEvents.', evidence: [], links: [] }
    : { ...step, n }
  const next = { ...inv, cursor: inv.cursor + 1, trace: [...inv.trace, traced] }
  const ev = !failed && inv.plan.evidenceByStep[step.kind]
  if (ev) next.evidence = [...inv.evidence, ev]
  if (step.kind === 'cloudtrail' && !failed) next.chain = { ...inv.chain, nodes: [inv.plan.node] }
  if (step.kind === 'verdict') {
    Object.assign(next, inv.plan.final, { status: 'done', finishedAt: config.referenceTime })
    if (inv.trace.some((s) => s.failed)) {
      next.confidence = Math.max(60, next.confidence - 8)
      next.summary = next.summary.replace('(E1, E2)', '(E2 – the CloudTrail query in step 2 failed, so the agent is less sure)')
    }
    if (next.chain.nodes.length === 0) next.chain = { ...next.chain, nodes: [{ ...inv.plan.node, traceStep: null }] }
  }
  return next
}
