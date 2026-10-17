import avatar from '../assets/fa1-avatar.svg'
import './fa1.css'

// Temporary FA1 shell; replace this wrapper with the team's shared layout later.
export default function Fa1Layout({ children }) {
  return (
    <div className="fa1-shell">
      <a className="fa1-skip-link" href="#fa1-content">Skip to content</a>
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
              <li>
                <div className="fa1-main-nav-item fa1-main-nav-active" aria-current="true">
                  <span className="fa1-main-nav-title">Alerts &amp; Sources</span>
                  <span className="fa1-main-nav-area">FA1</span>
                </div>
              </li>
              <li>
                <button className="fa1-main-nav-item" type="button" aria-disabled="true" aria-describedby="investigations-integration">
                  <span className="fa1-main-nav-title">Investigations &amp; Incidents</span>
                  <span className="fa1-main-nav-area">FA2 / FA3</span>
                  <span className="fa1-integration-note" id="investigations-integration">Unavailable — awaiting team integration</span>
                </button>
              </li>
            </ul>
          </nav>
        </aside>
        {children}
      </div>
    </div>
  )
}
