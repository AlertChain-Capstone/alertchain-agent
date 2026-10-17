import avatar from '../assets/fa1-avatar.svg'
import '../fa1/fa1.css'
import './fa2.css'

// Same look as the temporary FA1 shell, with Investigations & Incidents active.
// Reuses FA1 shell styles read-only; replace with the team's shared layout later.
export default function Fa2Layout({ children }) {
  return (
    <div className="fa1-shell">
      <a className="fa1-skip-link" href="#fa2-content">Skip to content</a>
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
                <button className="fa1-main-nav-item" type="button" aria-disabled="true" aria-describedby="fa2-dashboard-integration">
                  <span className="fa1-main-nav-title">Dashboard</span>
                  <span className="fa1-main-nav-area">FA3</span>
                  <span className="fa1-integration-note" id="fa2-dashboard-integration">Unavailable — awaiting team integration</span>
                </button>
              </li>
              <li>
                <a className="fa1-main-nav-item fa2-nav-link" href="#/">
                  <span className="fa1-main-nav-title">Alerts &amp; Sources</span>
                  <span className="fa1-main-nav-area">FA1</span>
                </a>
              </li>
              <li>
                <div className="fa1-main-nav-item fa1-main-nav-active" aria-current="true">
                  <span className="fa1-main-nav-title">Investigations &amp; Incidents</span>
                  <span className="fa1-main-nav-area">FA2 / FA3</span>
                </div>
              </li>
            </ul>
          </nav>
        </aside>
        {children}
      </div>
    </div>
  )
}
