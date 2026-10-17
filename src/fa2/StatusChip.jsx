import { statusOf } from './fa2Data'

export default function StatusChip({ inv }) {
  const { label, tone } = statusOf(inv)
  return <span className={`fa1-badge fa1-badge-${tone}`}>{label}</span>
}
