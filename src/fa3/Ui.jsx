import { useEffect, useRef } from 'react'
import { Link } from 'react-router'

export function PageHeading({ title, eyebrow, children }) {
  const ref = useRef(null)
  useEffect(() => { ref.current?.focus() }, [title])
  return <header className="fa3-heading"><p className="fa3-eyebrow">{eyebrow}</p><h1 tabIndex={-1} ref={ref}>{title}</h1>{children}</header>
}

export function Badge({ value }) {
  const tone = ['Critical', 'High'].includes(value) ? 'danger'
    : ['Medium', 'Needs human review'].includes(value) ? 'warning'
    : value === 'Closed' ? 'neutral' : 'info'
  return <span className={`fa3-badge fa3-badge-${tone}`}>{value}</span>
}

export function Notice({ title, children, error = false }) {
  return <section className={`fa3-notice ${error ? 'fa3-notice-error' : ''}`} role={error ? 'alert' : 'status'}><h2>{title}</h2>{children}</section>
}

export function DemoControl({ id, label, value, options, onChange }) {
  return (
    <details className="fa3-demo-controls">
      <summary>Demo scenarios</summary>
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([key, title]) => <option key={key} value={key}>{title}</option>)}
      </select>
      <small>Simulated locally; fixture records stay unchanged.</small>
    </details>
  )
}

export function Unavailable({ id }) {
  return <><PageHeading title="Incident unavailable" eyebrow="INCIDENT REVIEW" /><Notice title={`${id} is unavailable`} error><p>No other incident has been substituted.</p><Link to="/incidents">Back to incidents</Link></Notice></>
}
