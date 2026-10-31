import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { CASE_ID } from '../case/CasePage'
import { Logo } from '../components/brand/Logo'
import { Icon } from '../components/ui/Icon'
import { showToast } from '../components/ui/Primitives'
import { useSiteStore } from '../store/useSiteStore'

// Brief 12 through the Three A's: energy Access, Affordability and Availability for a hospital that is moving.
const THREE_AS = [
  { key: 'access', icon: 'hospital', title: 'Access', tag: 'Theatres first: surgical theatres, ICU and burns never lose power.',
    help: 'Critical-load list and a phased build that powers the theatres first.' },
  { key: 'affordability', icon: 'dollar', title: 'Affordability', tag: 'No upfront capital: energy-as-a-service, paid from the diesel budget.',
    help: 'Diesel, grid and solar compared over 5 and 10 years — with named funders.' },
  { key: 'availability', icon: 'zap', title: 'Availability', tag: '0 ms switchover, and the power moves with the hospital.',
    help: 'Ground-mounted solar and battery containers move to the new building in year 5.' },
]

const STEPS = ["Scan the grid at today's site and the new site", 'Power the theatres first', 'Move it with the hospital in year 5']

/** One-screen landing page: Brief 12 — relocatable solar for the National Orthopaedic Hospital, Enugu. */
export function HomePage() {
  const nav = useNavigate()
  const loadCase = useSiteStore((s) => s.loadCase)
  const [busy, setBusy] = useState(false)
  const [hands, setHands] = useState<'ready' | 'model' | 'checking'>('checking')
  useEffect(() => { fetch('/models/gesture_recognizer.task', { method: 'HEAD' }).then((r) => setHands(r.ok && !(r.headers.get('content-type') ?? '').includes('text/html') && !!navigator.mediaDevices ? 'ready' : 'model')).catch(() => setHands('model')) }, [])

  const openCase = async () => {
    setBusy(true)
    try { loadCase(await api.caseData(CASE_ID)); nav('/explorer') }
    catch { showToast('Could not load the Enugu case — is the backend running?') }
    finally { setBusy(false) }
  }

  const kpis = [
    { v: '≈ 6 h', l: 'of grid power a day at the hospital', s: "hospital's head engineer", c: 'var(--gr-grid)' },
    { v: '1,550 kW', l: 'connected capacity, theatres to wards', s: "hospital's head engineer", c: '#fff' },
    { v: '₦3,277 / L', l: 'diesel, up 86 % in a year', s: 'NBS, May 2026', c: 'var(--gr-danger)' },
    { v: '5 years', l: 'until the hospital moves building', s: 'rooftop solar would be stranded', c: 'var(--gr-sun-300)' },
  ]

  return (
    <div className="gr-home" data-testid="home">
      <div className="gr-hero-grid" />
      <section className="gr-home-hero">
        <div className="gr-home-title"><Logo size={56} /><h1 className="gr-h1"><span className="g">Grid</span><span className="r">Rescue</span> AI</h1></div>
        <p className="gr-home-tagline">Relocatable solar for a hospital on the move.</p>
        <div className="gr-muted" style={{ fontSize: 13, marginTop: -6 }} data-testid="home-case">GEH Brief 12 · Clean Energy Solutions · any hospital that must move — worked example: National Orthopaedic Hospital, Enugu</div>
        <ol className="gr-home-steps" data-testid="steps">
          {STEPS.map((s, i) => <li key={s}><span>{i + 1}</span>{s}</li>)}
        </ol>
        <button className="gr-home-gest" onClick={() => nav('/hands')} data-testid="home-hands" title="Walk the design with one hand in front of the webcam">
          <span className="gr-dot" style={{ background: hands === 'ready' ? 'var(--gr-rescue)' : hands === 'model' ? 'var(--gr-sun-300)' : 'var(--gr-fg-4)' }} />
          Hands-free simulation · {hands === 'ready' ? 'enabled — camera + on-device hand model' : hands === 'model' ? 'mouse mode (hand model not installed — run START.bat)' : 'checking…'}
        </button>
        <div className="gr-home-ctas">
          <button className="gr-btn gr-btn-lg gr-btn-rescue" onClick={() => nav('/explorer')} data-testid="cta-explore"><Icon name="globe" size={18} /> Start — pick the hospital's site today, then its new site</button>
          <button className="gr-btn gr-btn-lg gr-btn-ghost" onClick={openCase} disabled={busy} data-testid="cta-case">{busy ? <><Icon name="refresh" size={18} className="gr-spin" /> Opening…</> : <><Icon name="hospital" size={18} /> Worked example · National Orthopaedic Hospital, Enugu</>}</button>
        </div>
      </section>

      <section className="gr-home-kpis" data-testid="kpis">
        {kpis.map((k) => <div key={k.l} className="gr-home-kpi"><b style={{ color: k.c }}>{k.v}</b><span>{k.l}</span><small>{k.s}</small></div>)}
      </section>

      <section className="gr-home-aaa" data-testid="three-as">
        {THREE_AS.map((x) => (
          <div key={x.key} className={`gr-home-a ${x.key === 'affordability' ? 'feature' : ''}`} data-testid={`aaa-${x.key}`}>
            <div className="gr-home-a-head"><span className="gr-aaa-icon"><Icon name={x.icon} size={20} /></span><h3>{x.title}</h3></div>
            <p className="gr-home-a-tag">{x.tag}</p>
            <p className="gr-home-a-help"><Icon name="check" size={13} /> {x.help}</p>
          </div>
        ))}
      </section>
      <footer className="gr-home-foot">Open data · NASA POWER · PVGIS · NLR PVWatts · OpenStreetMap · NBS · EERC · Pre-feasibility (±30 %) · Global Energy Hackathon 2026</footer>
    </div>
  )
}
