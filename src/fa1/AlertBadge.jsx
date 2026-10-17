const colors = {
  severity: { High: 'danger', Medium: 'warning', Low: 'neutral' },
  status: {
    New: 'info',
    'Under investigation': 'warning',
    'Closed · Benign': 'neutral',
    'Closed · False positive': 'neutral',
    Resolved: 'success',
  },
}

export default function AlertBadge({ kind, value }) {
  return (
    <span className={`fa1-badge fa1-badge-${colors[kind]?.[value] ?? 'neutral'}`}>
      {value ?? 'Not available'}
    </span>
  )
}
