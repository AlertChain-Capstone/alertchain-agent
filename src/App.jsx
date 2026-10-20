import { useRef } from 'react'
import { HashRouter, Link, matchRoutes, useLocation, useNavigate } from 'react-router'
import AppLayout from './shared/AppLayout.jsx'
import { areas, routeTable } from './shared/areas.js'

const modules = import.meta.glob('./fa[123]/routes.jsx', { eager: true, import: 'default' })

function Application() {
  const location = useLocation()
  const navigate = useNavigate()
  const fa2 = useRef(null)
  const match = matchRoutes(routeTable, location)?.at(-1)
  const activeArea = match?.route.area

  // Keep each area's state across navigation. Missing team folders are optional.
  return (
    <AppLayout activeArea={activeArea}>
      {areas.map((area) => {
        const Component = modules[`./${area.id}/routes.jsx`]?.Component
        const active = activeArea === area.id
        const route = active ? { ...match.route, params: match.params, state: location.state } : null
        return (
          <div className="app-area" key={area.id} hidden={!active}>
            {Component ? (
              <Component
                ref={area.id === 'fa2' ? fa2 : undefined}
                active={active}
                route={route}
                onInvestigate={(alert) => {
                  if (fa2.current) fa2.current.investigateAlert(alert.id)
                  else navigate('/investigations')
                }}
                onOpenIncident={(id) => navigate(`/incidents/${encodeURIComponent(id)}`)}
              />
            ) : (
              <main className="app-placeholder" id={`${area.id}-content`} tabIndex={-1}>
                <h1>{area.title}</h1>
                <p>This area is awaiting team integration.</p>
                <Link to="/">Return to dashboard</Link>
              </main>
            )}
          </div>
        )
      })}
      {!match && (
        <main className="app-placeholder" id="app-content" tabIndex={-1}>
          <h1>Page not found</h1>
          <p>This address does not match a screen in AlertChain.</p>
          <Link to="/">Return to dashboard</Link>
        </main>
      )}
    </AppLayout>
  )
}

export default function App() {
  return <HashRouter><Application /></HashRouter>
}
