import avatar from '../assets/fa1-avatar.svg'
import './fa1.css'

const AREAS = {
  fa1: { title: 'Alerts & Sources', area: 'FA1', href: '#/' },
  fa2: { title: 'Investigations & Incidents', area: 'FA2 / FA3', href: '#/investigations' },
}

function AreaLink({ id, activeArea }) {
  const { title, area, href } = AREAS[id]
  if (id === activeArea) {
    return (
      <div className="fa1-main-nav-item fa1-main-nav-active" aria-current="true">
        <span className="fa1-main-nav-title">{title}</span>
        <span className="fa1-main-nav-area">{area}</span>
      </div>
    )
  }
  return (
    <a className="fa1-main-nav-item fa1-main-nav-link" href={href}>
      <span className="fa1-main-nav-title">{title}</span>
      <span className="fa1-main-nav-area">{area}</span>
    </a>
  )
}

// Shared shell for the team's functional areas. FA3's Dashboard is not built yet.
export default function Fa1Layout({ children, activeArea = 'fa1' }) {
  return (
    <div className="fa1-shell">
      <a className="fa1-skip-link" href={activeArea === 'fa2' ? '#fa2-content' : '#fa1-content'}>Skip to content</a>
      <header className="fa1-header">
        <div className="fa1-brand">
          <span className="fa1-logo-mark" aria-hidden="true" />
          <span>AlertChain Agent</span>
        </div>
        <div className="fa1-user">
          <span>SOC Analyst</span>
          <img src={avatar} alt="" width="28" height="28" />
        </div>
      </header>
      <div className="fa1-shell-body">
        <aside className="fa1-sidebar">
          <nav aria-label="Application">
            <ul className="fa1-main-nav">
              <li>
                <button className="fa1-main-nav-item" type="button" aria-disabled="true" aria-describedby="dashboard-integration">
                  <span className="fa1-main-nav-title">Dashboard</span>
                  <span className="fa1-main-nav-area">FA3</span>
                  <span className="fa1-integration-note" id="dashboard-integration">Unavailable — awaiting team integration</span>
                </button>
              </li>
              <li><AreaLink id="fa1" activeArea={activeArea} /></li>
              <li><AreaLink id="fa2" activeArea={activeArea} /></li>
            </ul>
          </nav>
        </aside>
        {children}
      </div>
    </div>
  )
}
