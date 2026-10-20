// Route ownership remains available even when a team's folder is absent.
export const areas = [
  { id: 'fa3', title: 'Dashboard & Incidents', label: 'FA3 · Review & Ask the Agent', path: '/' },
  { id: 'fa1', title: 'Alerts & Sources', label: 'FA1 · Security signals', path: '/sources' },
  { id: 'fa2', title: 'Investigations', label: 'FA2 · Reasoning & correlation', path: '/investigations' },
]

const modules = import.meta.glob('../fa[123]/routes.jsx', { eager: true, import: 'default' })
const fallback = {
  fa1: [{ path: '/sources' }, { path: '/alerts' }, { path: '/alerts/:id' }],
  fa2: [{ path: '/investigations' }, { path: '/investigations/:id' }, { path: '/incidents/:id/chain' }],
  fa3: [{ path: '/' }, { path: '/incidents' }, { path: '/incidents/:id' }, { path: '/incidents/:id/ask' }],
}

export const routeTable = areas.flatMap(({ id }) =>
  (modules[`../${id}/routes.jsx`]?.routes ?? fallback[id]).map((route) => ({ ...route, area: id })),
)
