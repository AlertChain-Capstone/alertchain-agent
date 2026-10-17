import { useState } from 'react'

const LARGE = 25

function branchingDemo(chain) {
  const base = chain.nodes.slice(0, 2)
  const nodes = [
    ...base,
    { id: 'B3', alertId: null, time: '15:46', event: 'GetObject (2,140 calls)', principal: base[1]?.principal ?? 'dev-ci-user', resource: 'Bucket sample-audit-bucket', technique: 'T1530 Data from Cloud Storage', why: 'Same key as the previous node, 6 minutes later.', evidence: null, traceStep: null },
    { id: 'B4', alertId: null, time: '15:48', event: 'CreateUser', principal: base[1]?.principal ?? 'dev-ci-user', resource: 'IAM user backup-svc', technique: null, why: 'Same key as the previous node, 8 minutes later. No attack technique could be mapped for this event.', evidence: null, traceStep: null },
  ]
  const second = base[1]?.id ?? base[0].id
  const edges = [...(base.length > 1 ? [[base[0].id, base[1].id]] : []), [second, 'B3'], [second, 'B4']]
  return { window: chain.window, nodes, edges }
}

function largeDemo() {
  const names = ['ListBuckets', 'GetObject', 'DescribeInstances', 'ListUsers', 'GetCallerIdentity', 'AssumeRole']
  const nodes = Array.from({ length: 30 }, (_, i) => ({
    id: `L${i + 1}`, alertId: null, time: `14:${String(30 + i).padStart(2, '0')}`, event: names[i % names.length],
    principal: 'dev-ci-user', resource: 'Account 123456789012', technique: i % 7 === 3 ? null : 'T1580 Cloud Infrastructure Discovery',
    why: 'Same key and source IP as the previous node.', evidence: null, traceStep: null,
  }))
  const edges = nodes.slice(1).map((n, i) => [nodes[i].id, n.id])
  return { window: '14:30 → 14:59 UTC, 2026-10-17', nodes, edges }
}

// Column = distance from the first node, so branches stack in one column.
function columns(chain) {
  const depth = {}
  chain.nodes.forEach((n) => { depth[n.id] = 0 })
  for (let i = 0; i < chain.nodes.length; i++) {
    chain.edges.forEach(([from, to]) => { depth[to] = Math.max(depth[to], depth[from] + 1) })
  }
  const cols = []
  chain.nodes.forEach((n) => { (cols[depth[n.id]] ??= []).push(n) })
  return cols
}

export default function AttackChain({ inv, onViewInTrace }) {
  const [demo, setDemo] = useState('investigated')
  const [showAll, setShowAll] = useState(false)
  const chain = demo === 'branching' ? branchingDemo(inv.chain) : demo === 'large' ? largeDemo() : inv.chain
  const [selectedId, setSelectedId] = useState(inv.chain.nodes[1]?.id ?? inv.chain.nodes[0]?.id ?? null)
  const selected = chain.nodes.find((n) => n.id === selectedId) ?? chain.nodes.at(-1) ?? null
  const tooLarge = chain.nodes.length > LARGE && !showAll

  let cols = columns(chain)
  let hidden = 0
  if (tooLarge) {
    hidden = cols.length - 6
    cols = [...cols.slice(0, 3), 'gap', ...cols.slice(-3)]
  }

  return (
    <div className="fa2-chain-layout">
      <section className="fa1-card fa2-chain-card" aria-labelledby="fa2-chain-title">
        <div className="fa1-card-heading fa2-spread">
          <h2 id="fa2-chain-title">Time → <span className="fa1-muted">({chain.window})</span></h2>
          <div className="fa1-filter fa2-inline-demo">
            <label htmlFor="fa2-chain-demo">Chain demo scenario</label>
            <select id="fa2-chain-demo" value={demo} onChange={(e) => { setDemo(e.target.value); setShowAll(false); setSelectedId(null) }}>
              <option value="investigated">As investigated</option>
              <option value="branching">Branching chain</option>
              <option value="large">Large chain (30 events)</option>
            </select>
          </div>
        </div>

        {tooLarge && (
          <div className="fa2-banner fa2-banner-info" role="status">
            <p>This chain has {chain.nodes.length} events – too many to read at once. Showing the first and last 3 events.</p>
            <button type="button" onClick={() => setShowAll(true)}>Show all {chain.nodes.length} events</button>
          </div>
        )}

        {chain.nodes.length === 0 ? (
          <p className="fa2-chain-empty">No events linked yet. The first node appears when the agent finds the alert's event.</p>
        ) : (
          <div className="fa2-graph" role="list" aria-label="Attack chain, in time order">
            {cols.map((col, i) => (
              <div key={col === 'gap' ? 'gap' : col[0].id} className="fa2-graph-col-wrap" role="presentation">
                {i > 0 && <span className="fa2-arrow" aria-hidden="true">→</span>}
                {col === 'gap' ? (
                  <div className="fa2-node fa2-node-gap" role="listitem">
                    <strong>{hidden} more events</strong>
                    <button type="button" className="fa2-link" onClick={() => setShowAll(true)}>Show all</button>
                  </div>
                ) : (
                  <div className="fa2-graph-col">
                    {col.map((node) => (
                      <button
                        key={node.id}
                        type="button"
                        role="listitem"
                        className={`fa2-node${selected?.id === node.id ? ' fa2-node-selected' : ''}`}
                        aria-pressed={selected?.id === node.id}
                        onClick={() => setSelectedId(node.id)}
                      >
                        <span className="fa1-muted">{node.time}</span>
                        <strong>{node.event}</strong>
                        <span className="fa1-muted">Principal: {node.principal}</span>
                        <span className="fa1-muted">Resource: {node.resource}</span>
                        {node.technique ? <span className="fa2-technique">{node.technique}</span> : <span className="fa2-warning-text">Technique: could not be mapped</span>}
                      </button>
                    ))}
                    {col.length > 1 && <span className="fa1-muted fa2-branch-note">Branches to {col.length} events</span>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {chain.nodes.length === 1 && (
          <p className="fa2-chain-note">Only one event is linked to this alert – no chain was found. The incident is shown as a single event.</p>
        )}
        <p className="fa1-muted">Select a node to see why it is linked · nodes are placed in time order</p>
      </section>

      <aside className="fa1-card fa2-node-details" aria-labelledby="fa2-node-title">
        <p className="fa2-eyebrow">Selected event</p>
        {selected ? (
          <>
            <h2 id="fa2-node-title">{selected.event}{selected.alertId ? ` · ${selected.alertId}` : ''}</h2>
            <dl className="fa2-node-fields">
              <dt>Time</dt><dd>2026-10-17 {selected.time} UTC</dd>
              <dt>Principal</dt><dd>{selected.principal}</dd>
              <dt>Resource</dt><dd>{selected.resource}</dd>
              <dt>Technique</dt><dd>{selected.technique ?? <span className="fa2-warning-text">Could not be mapped – the event did not match a known MITRE ATT&amp;CK technique.</span>}</dd>
              <dt>Why it is linked</dt><dd>{selected.why}</dd>
            </dl>
            {selected.evidence && <p className="fa2-node-evidence">Evidence: {selected.evidence}</p>}
            {selected.traceStep ? (
              <button type="button" onClick={() => onViewInTrace(selected.traceStep)}>View in reasoning trace (step {selected.traceStep})</button>
            ) : (
              <p className="fa1-muted">Demo node – not part of the recorded trace.</p>
            )}
          </>
        ) : (
          <h2 id="fa2-node-title">No event selected</h2>
        )}
      </aside>
    </div>
  )
}
