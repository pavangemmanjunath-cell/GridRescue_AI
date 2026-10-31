import { useNavigate } from 'react-router-dom'
import type { Assessment } from '../../api/types'
import { useSiteStore } from '../../store/useSiteStore'
import { Icon } from '../ui/Icon'
import { fmt } from '../../lib/format'

/** Guard for result pages: renders an empty state when no assessment has been run. */
export function useAssessmentGuard(): Assessment | null {
  return useSiteStore((s) => s.assessment)
}

export function EmptyAssessment({ title = 'No assessment yet' }: { title?: string }) {
  const nav = useNavigate()
  return (
    <div className="gr-page">
      <div className="gr-empty" data-testid="empty-assessment">
        <Icon name="shield" size={32} style={{ color: 'var(--gr-fg-4)' }} />
        <h2 className="gr-h3" style={{ marginTop: 12 }}>{title}</h2>
        <p className="gr-body" style={{ maxWidth: 520, margin: '8px auto 20px' }}>Pick a site on the explorer map, describe the facility and run the assessment. The results — recommendation, comparison, costs, simulation and report — appear here.</p>
        <div className="gr-row" style={{ justifyContent: 'center' }}>
          <button className="gr-btn" onClick={() => nav('/explorer')}><Icon name="globe" /> Open explorer</button>
          <button className="gr-btn gr-btn-ghost" onClick={() => nav('/facility')}><Icon name="hospital" /> Facility form</button>
        </div>
      </div>
    </div>
  )
}

export function ResultHeader({ a, step, title, subtitle }: { a: Assessment; step: string; title: string; subtitle?: string }) {
  const loc = a.location
  return (
    <div className="gr-page-head">
      <div>
        <div className="gr-eyebrow">{step}</div>
        <h1 className="gr-h2">{title}</h1>
        <div className="gr-page-sub">{a.inputs.facility.name || a.inputs.facility_label} · {loc.name}{loc.state ? `, ${loc.state}` : ''} · {loc.country} · {fmt.coord(loc.lat, loc.lng)} · {a.inputs.facility.backup_hours} h backup · priority {a.inputs.facility.priority.replace('_', ' ')}{subtitle ? ` · ${subtitle}` : ''}</div>
      </div>
      <ResultNav />
    </div>
  )
}

export function ResultNav() {
  const nav = useNavigate()
  const items = [['/recommendation', 'Advisor'], ['/compare', 'Compare'], ['/costs', 'Costs'], ['/simulation', 'Simulate'], ['/report', 'Report']]
  return <div className="gr-nav gr-no-print">{items.map(([to, l]) => <a key={to} href={to} className={window.location.pathname === to ? 'active' : ''} onClick={(e) => { e.preventDefault(); nav(to) }}>{l}</a>)}</div>
}

/** Radar chart of the 9 scoring dimensions for one or more architectures. */
export function Radar({ dims, labels, series, size = 300 }: { dims: string[]; labels: Record<string, string>; series: { name: string; color: string; values: Record<string, number> }[]; size?: number }) {
  const cx = size / 2, cy = size / 2, r = size / 2 - 40
  const n = dims.length
  const ang = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n
  const pt = (i: number, v: number) => [cx + Math.cos(ang(i)) * r * (v / 100), cy + Math.sin(ang(i)) * r * (v / 100)]
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="gr-radar" style={{ maxWidth: size }} aria-label="Score radar">
      {[25, 50, 75, 100].map((lv) => <polygon key={lv} points={dims.map((_, i) => pt(i, lv).join(',')).join(' ')} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="0.8" />)}
      {dims.map((_, i) => { const [x, y] = pt(i, 100); return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(255,255,255,0.12)" /> })}
      {series.map((sr) => (
        <g key={sr.name}>
          <polygon points={dims.map((d, i) => pt(i, sr.values[d] ?? 0).join(',')).join(' ')} fill={sr.color} fillOpacity="0.18" stroke={sr.color} strokeWidth="2" />
          {dims.map((d, i) => { const [x, y] = pt(i, sr.values[d] ?? 0); return <circle key={d} cx={x} cy={y} r="3" fill={sr.color} /> })}
        </g>
      ))}
      {dims.map((d, i) => { const [x, y] = pt(i, 122); return <text key={d} x={x} y={y} textAnchor="middle" dominantBaseline="middle" fontSize="9.5" fill="#B8C4D9" fontFamily="DM Sans, sans-serif">{labels[d] ?? d}</text> })}
    </svg>
  )
}
