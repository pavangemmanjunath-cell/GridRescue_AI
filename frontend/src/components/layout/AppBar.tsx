import { NavLink, Link } from 'react-router-dom'
import { Logo, Wordmark } from '../brand/Logo'
import { useSiteStore } from '../../store/useSiteStore'
import { fmt, weatherDesc } from '../../lib/format'
import { Icon } from '../ui/Icon'
import { AskButton } from '../ask/AskPanel'

const NAV = [
  { to: '/', label: 'Home', icon: 'home', end: true },
  { to: '/case', label: 'Relocation', icon: 'hospital' },
  { to: '/explorer', label: 'Explorer', icon: 'globe' },
  { to: '/build', label: 'Build 3D', icon: 'cube' },
  { to: '/facility', label: 'Facility', icon: 'hospital' },
  { to: '/recommendation', label: 'Advisor', icon: 'shield' },
  { to: '/compare', label: 'Compare', icon: 'compare' },
  { to: '/costs', label: 'Costs', icon: 'dollar' },
  { to: '/simulation', label: 'Simulate', icon: 'cube' },
  { to: '/learn', label: 'Learn', icon: 'book' },
  { to: '/report', label: 'Report', icon: 'file' },
  { to: '/hands', label: 'Hands', icon: 'target' },
]

/** Top bar: brand, the selected (lockable) site, live weather, and the page menu. */
export function AppBar() {
  const { lat, lng, location, weather, locked, setLocked, caseData } = useSiteStore()
  const wc = weather?.current
  return (
    <header className="gr-appbar gr-no-print">
      <div className="gr-appbar-left">
        <Link to="/" style={{ display: 'flex' }} aria-label="GridRescue AI home"><Logo size={42} /></Link>
        <Link to="/" style={{ textDecoration: 'none' }}><Wordmark sub={caseData ? 'BRIEF 12 · HOSPITAL ON THE MOVE' : location?.country_code === 'NG' ? 'NIGERIA · CRITICAL INFRASTRUCTURE' : 'AFRICA · CRITICAL INFRASTRUCTURE'} /></Link>
      </div>
      <div className="gr-appbar-center">
        {/* the site every page uses; click to lock / unlock it */}
        <button className="gr-readout" style={{ borderColor: locked ? 'var(--gr-rescue)' : undefined }} title={locked ? 'Site locked — every page uses this site. Click to unlock.' : 'Click to lock this site for every page'} onClick={() => setLocked(!locked)} data-testid="site-readout">
          {locked ? '🔒' : '📍'} {caseData && Math.abs(lat - caseData.hospital.lat) < 0.03 && Math.abs(lng - caseData.hospital.lng) < 0.03 ? `${caseData.hospital.short} · Enugu · ` : location?.name ? `${location.name} · ` : ''}{fmt.coord(lat, lng)}
        </button>
        {wc && <span className="gr-readout gr-readout-pill" title="Live weather (Open-Meteo)">{weatherDesc(wc.weather_code).icon} {Math.round(wc.temperature_c)}°C · {wc.wind_speed_ms} m/s</span>}
      </div>
      <nav className="gr-nav" aria-label="Main">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'active' : '')} title={n.label}>
            <Icon name={n.icon} size={14} /><span className="lbl">{n.label}</span>
          </NavLink>
        ))}
        <AskButton />
      </nav>
    </header>
  )
}
