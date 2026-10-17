import { useEffect, useRef, useState } from 'react'
import Fa1App from './fa1/Fa1App.jsx'
import Fa1Layout from './fa1/Fa1Layout.jsx'
import Fa2App from './fa2/Fa2App.jsx'

// Routes are hashes so the static Vite build needs no server config.
// #/ (default) = FA1 Alerts & Sources, #/investigations = FA2 Investigations & Incidents.
const FA2_HASH = '#/investigations'

function areaFromHash() {
  const hash = window.location.hash
  if (hash.startsWith(FA2_HASH)) return 'fa2'
  if (hash === '' || hash.startsWith('#/')) return 'fa1'
  return null // in-page anchors such as the skip link keep the current area
}

export default function App() {
  const [area, setArea] = useState(() => areaFromHash() ?? 'fa1')
  const fa2 = useRef(null)

  useEffect(() => {
    const onHashChange = () => {
      const next = areaFromHash()
      if (next) setArea(next)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  function showFa2() {
    if (!window.location.hash.startsWith(FA2_HASH)) window.location.hash = FA2_HASH
    setArea('fa2')
  }

  // Both areas stay mounted so filters, open alerts and investigations survive switching.
  return (
    <Fa1Layout activeArea={area}>
      <div className="app-area" hidden={area !== 'fa1'}>
        <Fa1App
          onInvestigate={(alert) => { showFa2(); fa2.current?.investigateAlert(alert.id) }}
          onOpenIncident={(incidentId) => { showFa2(); fa2.current?.openIncident(incidentId) }}
        />
      </div>
      <div className="app-area" hidden={area !== 'fa2'}>
        <Fa2App ref={fa2} />
      </div>
    </Fa1Layout>
  )
}
