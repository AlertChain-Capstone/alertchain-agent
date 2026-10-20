import { Link } from 'react-router'
import { areas } from './areas.js'
import './prototype.css'
import './shell.css'

export default function AppLayout({ activeArea, children }) {
  const contentId = activeArea ? `${activeArea}-content` : 'app-content'
  return (
    <div className="app-shell">
      <a className="app-skip" href={`#${contentId}`} onClick={(event) => {
        event.preventDefault()
        document.getElementById(contentId)?.focus()
      }}>Skip to content</a>
      <header className="app-header">
        <Link to="/" className="app-brand"><span className="app-mark" aria-hidden="true">A</span>AlertChain Agent</Link>
        <span className="app-user"><span className="app-avatar" aria-hidden="true">SA</span>SOC Analyst</span>
      </header>
      <div className="app-body">
        <aside className="app-sidebar">
          <p className="app-nav-label">WORKSPACE</p>
          <nav aria-label="Application">
            {areas.map((area) => (
              <Link key={area.id} to={area.path} className="app-nav-link" aria-current={area.id === activeArea ? 'page' : undefined}>
                <span>{area.title}</span><small>{area.label}</small>
              </Link>
            ))}
          </nav>
          <p className="app-prototype"><span aria-hidden="true">●</span> Inception prototype<br /><small>Fictional data · AWS sandbox</small></p>
        </aside>
        {children}
      </div>
    </div>
  )
}
