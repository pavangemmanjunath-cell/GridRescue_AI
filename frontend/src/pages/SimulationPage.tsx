import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Area, AreaChart, CartesianGrid, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { EmptyAssessment, useAssessmentGuard } from '../components/results/Shared'
import { SiteScene, frameAt, type SceneConfig, type SimFrame } from '../components/three/SiteScene'
import { Icon } from '../components/ui/Icon'
import { useSiteStore } from '../store/useSiteStore'
import { OUTAGES } from '../components/explorer/GridScanPanel'
import { showToast } from '../components/ui/Primitives'
import { downloadEsgReport } from '../lib/esg'
import { FAMILY_SHORT } from '../components/results/MLCard'
import type { Architecture } from '../api/types'

/** The lens the user looks through (Explorer's Sun · Wind · Water) chooses which kind of design is simulated. */
const LENS = {
  sun: { label: 'Sun', icon: 'sun', parts: ['solar_pv'], resource: 'solar' },
  wind: { label: 'Wind', icon: 'wind', parts: ['wind'], resource: 'wind' },
  water: { label: 'Water', icon: 'water', parts: ['hydrogen', 'pumped_hydro'], resource: 'water (river-linked or hydrogen)' },
} as const
type LensId = keyof typeof LENS
const coordText = (lat: number, lng: number) => `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lng).toFixed(2)}°${lng >= 0 ? 'E' : 'W'}`

/** Supplies the user can allow; a design is shown only if every part is allowed. */
const SOURCES = [
  { id: 'solar', label: 'Solar', color: '#F59E0B' },
  { id: 'wind', label: 'Wind', color: '#0EA5E9' },
  { id: 'grid', label: 'Grid', color: '#2F6FEB' },
  { id: 'gen', label: 'Generator', color: '#EF4444' },
] as const
const SHORT: Record<string, string> = { solar_pv: 'Solar', wind: 'Wind', diesel_gen: 'Generator', li_ion: 'Backup Device', flow: 'Flow backup device', hydrogen: 'Hydrogen', pumped_hydro: 'Pumped hydro' }
/** The Backup Device types the engine can pick; the numbers are the catalogue values the engine sizes with. */
const DEVICE_TYPE: Record<string, { short: string; name: string; why: string }> = {
  li_ion: { short: 'LFP', name: 'Lithium iron phosphate (LFP)', why: 'responds in < 20 ms · 90 % round-trip · ~5,000 cycles — the lowest cost for 1–8 h of backup' },
  flow: { short: 'Vanadium flow', name: 'Vanadium flow', why: '15,000 cycles · 20-year life — suits 4–12 h of deep daily cycling' },
  hydrogen: { short: 'Hydrogen', name: 'Hydrogen (electrolyser + fuel cell)', why: 'covers 24 h or more, but returns only ~35 % of the energy stored' },
  pumped_hydro: { short: 'Pumped hydro', name: 'Pumped hydro', why: '60-year life, 78 % round-trip — needs real terrain head; community scale' },
}
const plainName = (parts: string[]) => parts.filter((x) => x !== 'ups').map((x) => SHORT[x] ?? x).join(' + ') || 'UPS only'
const usd = (v: number) => (v >= 1e6 ? `US$ ${(v / 1e6).toFixed(2)} M` : `US$ ${Math.round(v / 1000)}k`)
const TT = { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 10, color: '#0F172A', fontSize: 12, boxShadow: '0 8px 24px rgba(15,23,42,0.12)' }
const litres = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(2)} M L` : `${Math.round(v / 1000)}k L`)
const hh = (h: number) => `${String(((Math.floor(h) % 24) + 24) % 24).padStart(2, '0')}:00`

/**
 * Outage simulation — one screen, no scrolling. A full-bleed 3D view of the real site with floating cards:
 * KPIs (top-left), controls (top), the recommended system + live power (right), the outage timeline and the
 * cost with vs without the system (bottom-left), and the engine's stress-tested use cases (bottom-right).
 */
export function SimulationPage() {
  const a = useAssessmentGuard()
  const { runAssessment, assessing, assessError, caseData, lat, lng, mode, setMode, location } = useSiteStore()
  const lens: LensId = (mode in LENS ? mode : 'sun') as LensId
  const nav = useNavigate()
  const [esgBusy, setEsgBusy] = useState(false)
  // a new location clears the last result: run the engine for the selected site straight away (once per pin)
  const pinKey = `${lat},${lng}`
  const tried = useRef('')
  useEffect(() => {
    if (a || assessing || tried.current === pinKey) return
    tried.current = pinKey
    runAssessment()
  }, [a, assessing, pinKey, runAssessment])
  const [showQs, setShowQs] = useState(false)
  const [t, setT] = useState(8)
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'power' | 'cost'>('power')
  const [allow, setAllow] = useState({ solar: true, wind: true })
  const [pending, setPending] = useState<{ grid?: boolean; gen?: boolean }>({})
  const frameRef = useRef<SimFrame>(null as unknown as SimFrame)

  const grid = a?.inputs.facility.existing.grid_connection ?? true
  const gen = (a?.inputs.facility.existing.generator_kva ?? 0) > 0 || (a?.inputs.facility.allow_new_generator ?? false)
  // the design to play: the best viable design that uses the lens's resource and only the allowed supplies; if the
  // resource is not viable at this site, the site's best design, with the reason shown
  const pick = useMemo(() => {
    if (!a) return undefined
    const ok = (parts: string[]) => parts.every((p) => (p !== 'solar_pv' || allow.solar) && (p !== 'wind' || allow.wind) && (p !== 'diesel_gen' || gen))
    const playable = [a.recommended, ...a.ranked].filter((o) => o.simulation_hourly.length === 24 && ok(o.parts))
    const fits = (o: Architecture) => o.parts.some((p) => (LENS[lens].parts as readonly string[]).includes(p))
    const lensOpt = playable.find((o) => fits(o) && o.suitability !== 'Not suitable')
    return { opt: lensOpt ?? playable[0], matched: !!lensOpt, best: playable[0] }
  }, [a, allow, gen, lens])
  const opt = pick?.opt
  const rows = opt?.simulation_hourly ?? []
  if (rows.length === 24) frameRef.current = frameAt(rows, t)

  // the simulated clock
  useEffect(() => {
    if (!playing) return
    let raf = 0, last = performance.now()
    const tick = (now: number) => { const dt = (now - last) / 1000; last = now; setT((x) => (x + dt * 0.8 * speed) % 24); raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, speed])

  if (!a) {
    const here = location?.name ? `${location.name}${location.country ? `, ${location.country}` : ''}` : coordText(lat, lng)
    if (assessing || tried.current !== pinKey) return (
      <div className="gr-page"><div className="gr-empty" data-testid="sim-loading">
        <Icon name="refresh" size={30} className="gr-spin" style={{ color: 'var(--gr-rescue)' }} />
        <h2 className="gr-h3" style={{ marginTop: 12 }}>Simulating {here}</h2>
        <p className="gr-body" style={{ maxWidth: 560, margin: '8px auto 0' }}>Reading the sun, wind, water and grid at {coordText(lat, lng)}, then sizing and testing the system through the {LENS[lens].label.toLowerCase()} lens…</p>
      </div></div>
    )
    return <EmptyAssessment title={assessError ? `The simulation could not run here — ${assessError}` : 'No assessment yet'} />
  }

  // grid / generator / outage change the physics → re-run the engine without clearing the screen
  const rerun = async (patch: { grid?: boolean; gen?: boolean; outage?: (typeof OUTAGES)[number] }) => {
    useSiteStore.setState((st) => ({
      facility: { ...st.facility,
        ...(patch.outage ? { backup_hours: patch.outage.hours } : {}),
        existing: { ...st.facility.existing, ...(patch.grid != null ? { grid_connection: patch.grid } : {}), ...(patch.gen != null ? { generator_kva: patch.gen ? (st.facility.existing.generator_kva || 500) : 0 } : {}) },
        ...(patch.gen != null ? { allow_new_generator: patch.gen } : {}) },
      ...(patch.outage ? { outageStartHour: patch.outage.start } : {}),
    }))
    await runAssessment()
  }
  const on = { solar: allow.solar, wind: allow.wind, grid: pending.grid ?? grid, gen: pending.gen ?? gen }
  const toggle = (id: (typeof SOURCES)[number]['id']) => {
    if (id === 'solar' || id === 'wind') return setAllow((x) => ({ ...x, [id]: !x[id] }))
    const v = !on[id]
    setPending((p) => ({ ...p, [id]: v }))   // tick at once; the engine re-run follows
    rerun(id === 'grid' ? { grid: v } : { gen: v }).finally(() => setPending((p) => ({ ...p, [id]: undefined })))
  }

  const start = a.inputs.options.outage_start_hour, hours = a.inputs.facility.backup_hours
  const outage = OUTAGES.find((o) => o.start === start && o.hours === hours)
  const rel = a.grid.reliability
  const s = opt?.simulation_summary
  const ok = s ? s.critical_served_pct >= 99.9 && s.essential_served_pct >= 99 : false
  const life = opt?.lifecycle ?? {}
  // the investment case is computed for the recommended design only
  const inv = opt === a.recommended ? a.investment_case?.investment ?? {} : {}
  // diesel avoided for any design: the site's diesel today minus what this design still burns (the engine's formula)
  const dieselToday = a.investment_case?.do_nothing?.diesel_litres_per_year
  const dieselAvoided = inv.diesel_avoided_l_per_year ?? (dieselToday != null && s ? Math.max(0, dieselToday - ((s as any).fuel_l ?? 0) * 365) : null)
  const f = frameRef.current
  const comp = opt?.components ?? {}
  const device = DEVICE_TYPE[comp.hydrogen ? 'hydrogen' : comp.pumped_hydro ? 'pumped_hydro' : comp.backup_device?.chemistry ?? '']
  // Brief 12: the case hospital is named with its address, and its kit is shown as relocatable
  const isCase = !!caseData && a.inputs.facility.name === caseData.hospital.name
  const answers: any[] = isCase ? a.relocatable_case?.starter_answers ?? [] : []
  // every simulation is tagged with its location: the place, the coordinates and the lens
  const loc = a.location
  const place = [loc.name, loc.state, loc.country].filter(Boolean).join(', ')
  const coords = coordText(loc.lat, loc.lng)
  const site = a.site
  const water = site.water?.nearest_km != null ? `water ${site.water.nearest_km} km (${site.water.discharge_class})` : 'no river within 10 km'
  const config: SceneConfig = {
    pvKwp: comp.pv?.kwp ?? 0, backupKwh: comp.backup_device?.energy_kwh ?? 0, windKw: comp.wind?.kw ?? 0, generatorKva: comp.generator?.kva ?? 0,
    hasUps: !!comp.ups, hasHydrogen: !!comp.hydrogen, hasRiver: (a.site.water.nearest_km ?? 99) <= 3, hasGrid: grid, peakKw: a.load.peak_load_kw,
    lat: loc.lat, lng: loc.lng, name: a.inputs.facility.name || `Hospital site · ${loc.name}`, backupType: device?.short,
    address: isCase ? caseData!.hospital.address : `${place} · ${coords}`, relocatable: isCase,
  }
  // what the lens did: the design for this resource, or why the resource is not viable here
  const L = LENS[lens]
  const resourceHere = lens === 'sun' ? `${site.solar?.annual_psh} peak-sun hours a day (${site.solar?.label})`
    : lens === 'wind' ? `${site.wind?.annual_ws50} m/s at 50 m (${site.wind?.label}, ${site.wind?.score}/100)`
    : `${water}, terrain head ${site.water?.head_m} m (${site.water?.label})`
  const lensNote = !pick?.matched
    ? `${L.label} lens · ${resourceHere}: no ${L.resource} design is viable here, so the site's best design is shown.`
    : opt === a.recommended ? `${L.label} lens · ${resourceHere} · the recommended design for this site.`
    : `${L.label} lens · ${resourceHere} · best ${L.resource} design here (ranked #${opt?.rank}); the overall best is ${plainName(pick!.best.parts)}.`
  const downloadEsg = async () => {
    setEsgBusy(true)
    try { await downloadEsgReport(a, null, { optionId: opt === a.recommended ? null : opt?.id, lens }); showToast(`ESG report for ${loc.name} downloaded`) }
    catch (e: any) { showToast('ESG report failed: ' + (e?.message || 'is the backend running?')) } finally { setEsgBusy(false) }
  }

  // hourly power and money. Without the system every kWh comes from the grid (tariff) or, when the grid is off,
  // from diesel; with it only grid imports and generator kWh are paid for — sun and backup device are free at the meter.
  const hourNow = Math.floor(t)
  const fx = opt?.cost.assumptions.usd_to_ngn ?? 1330
  const tariff = (opt?.cost.assumptions.grid_tariff_usd_per_kwh ?? 0.158) * fx      // ₦ per kWh from the grid
  const diesel = (life.baseline_diesel_usd_per_kwh ?? 0.456) * fx                    // ₦ per kWh from a diesel generator
  const chart = rows.map((r) => {
    const noSystem = r.load_kw * (r.grid_available ? tariff : diesel)
    const withSystem = r.grid_import_kw * tariff + (r.generator_kw + r.fuel_cell_kw) * diesel
    return { hour: r.hour, load: r.load_kw, pv: r.pv_kw + r.wind_kw, backup_device: r.backup_discharge_kw, generator: r.generator_kw + r.fuel_cell_kw + r.pumped_hydro_kw,
      grid: r.grid_import_kw, shed: r.unserved_kw, noSystem: Math.round(noSystem), withSystem: Math.round(withSystem), saving: Math.round(noSystem - withSystem) }
  })
  const now = chart[hourNow]
  const priceNow = f?.grid_available ? tariff : diesel
  const savedToday = chart.reduce((x, c) => x + c.saving, 0)
  const naira = (v: number) => `₦${Math.round(v).toLocaleString()}`

  // outage timeline: where the simulated clock is relative to the outage window
  const into = (((t - start) % 24) + 24) % 24
  const inOutage = hours >= 24 || into < hours
  const stage = inOutage ? (into < 0.4 ? 1 : 2) : into < hours + 1 ? 3 : 0
  const steps = [
    { icon: 'zap', label: 'Grid on', at: hh(start - 1) },
    { icon: 'alert', label: 'Outage hits', at: hh(start) },
    { icon: 'shield', label: 'UPS · 0 ms', at: hh(start) },
    { icon: 'sun', label: 'Backup Device + solar carry', at: `${hh(start)} – ${hours >= 24 ? 'all day' : hh(start + hours)}` },
    { icon: 'check', label: hours >= 24 ? 'Grid back next day' : 'Grid back', at: hours >= 24 ? '+24 h' : hh(start + hours) },
  ]
  const active = stage === 0 ? 0 : stage === 1 ? 2 : stage === 2 ? 3 : 4

  const without = life.baseline_diesel_usd_15y ?? 0, withSys = life.net_cost_15y_usd ?? 0
  const tests: any[] = a.agent?.stress_tests ?? []

  return (
    <div className="gr-sim3" data-testid="simulation-page">
      <div className="gr-sim3-canvas">{opt ? <SiteScene config={config} frameRef={frameRef} /> : <div className="gr-empty">No design works with only these supplies — allow solar, grid or a generator.</div>}</div>
      <span className="gr-sim3-attr" data-testid="sim-map-attribution">Ground map © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors</span>

      {/* top-left: three headline numbers */}
      <div className="gr-sim3-kpis">
        <div className="gr-fcard gr-kpi"><Icon name="hospital" size={18} /><div><small>Critical care powered</small><b>{s ? `${s.critical_served_pct} %` : '—'}</b><em className={ok ? 'up' : 'down'}>{ok ? 'outage avoided' : 'not fully covered'}</em></div></div>
        <div className="gr-fcard gr-kpi"><Icon name="zap" size={18} /><div><small>Diesel avoided</small><b data-testid="sim-diesel-avoided">{dieselAvoided ? litres(dieselAvoided) : '—'}</b><em>per year</em></div></div>
        <div className="gr-fcard gr-kpi"><Icon name="dollar" size={18} /><div><small>Saved over 15 years</small><b>{without ? usd(without - withSys) : '—'}</b><em className="up" title="Simple payback if the system is bought outright; the hospital plan uses a service fee with no upfront capital">bought outright · payback {life.simple_payback_years ?? '—'} yr</em></div></div>
      </div>

      {/* top: controls */}
      <div className="gr-fcard gr-sim3-ctl gr-no-print">
        <div className="gr-drop">
          <button className="gr-chipbtn" onClick={() => setOpen((v) => !v)} data-testid="supply-btn"><Icon name="zap" size={13} /> {SOURCES.filter((x) => on[x.id]).map((x) => x.label).join(' · ') || 'No supply'} ▾</button>
          {open && <div className="gr-drop-menu light" data-testid="supply-menu">{SOURCES.map((x) => (
            <label key={x.id}><input type="checkbox" checked={on[x.id]} disabled={assessing} onChange={() => toggle(x.id)} data-testid={`supply-${x.id}`} /><i style={{ background: x.color }} />{x.label}</label>
          ))}</div>}
        </div>
        <select className="gr-lselect" value={outage?.id ?? ''} disabled={assessing} onChange={(e) => { const o = OUTAGES.find((x) => x.id === e.target.value); if (o) rerun({ outage: o }) }} data-testid="outage-select">
          {!outage && <option value="">Custom outage</option>}
          {OUTAGES.map((o) => <option key={o.id} value={o.id}>{o.label} · {o.hours} h</option>)}
        </select>
        <button className="gr-chipbtn" onClick={() => setPlaying((p) => !p)} data-testid="play-btn"><Icon name={playing ? 'pause' : 'play'} size={13} /></button>
        <span className="gr-sim3-clock" data-testid="hud">{`${String(hourNow).padStart(2, '0')}:${String(Math.floor((t % 1) * 60)).padStart(2, '0')}`} <i className={f?.grid_available ? 'on' : 'off'}>{f?.outage_event ? 'outage' : f?.grid_available ? 'grid on' : 'no grid'}</i></span>
        <input className="gr-range" type="range" min={0} max={23.99} step={0.05} value={t} onChange={(e) => { setT(Number(e.target.value)); setPlaying(false) }} aria-label="hour" data-testid="time-slider" style={{ width: 110 }} />
        <select className="gr-lselect" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="speed"><option value={0.5}>½×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select>
        {answers.length > 0 && <button className={`gr-chipbtn ${showQs ? 'on' : ''}`} onClick={() => setShowQs((v) => !v)} data-testid="sim-questions-btn"><Icon name="info" size={13} /> 5 questions</button>}
        {assessing && <Icon name="refresh" size={15} className="gr-spin" />}
      </div>

      {/* the location tag, the lens (Sun · Wind · Water) that picks the design, and the ESG report for this site */}
      <div className="gr-fcard gr-sim3-lens gr-no-print" data-testid="sim-lens-card">
        <span className="gr-sim3-tag" data-testid="sim-location-tag"><Icon name="target" size={13} /><b>{loc.name}</b>{[loc.state, loc.country].filter(Boolean).join(', ') ? ` · ${[loc.state, loc.country].filter(Boolean).join(', ')}` : ''} · {coords}</span>
        <div className="gr-seg2" role="tablist" aria-label="Lens">{(Object.keys(LENS) as LensId[]).map((m) => (
          <button key={m} className={lens === m ? 'on' : ''} onClick={() => setMode(m)} aria-pressed={lens === m} data-testid={`sim-lens-${m}`}><Icon name={LENS[m].icon} size={12} /> {LENS[m].label}</button>))}
        </div>
        <button className="gr-chipbtn" onClick={downloadEsg} disabled={esgBusy} data-testid="sim-esg-download"><Icon name={esgBusy ? 'refresh' : 'download'} size={13} className={esgBusy ? 'gr-spin' : undefined} /> ESG report</button>
        <span className="gr-sim3-lensnote" data-testid="sim-lens-note">{lensNote}</span>
      </div>

      {/* Brief 12: the five starter questions, answered for this hospital, next to the running simulation */}
      {showQs && answers.length > 0 && (
        <div className="gr-fcard gr-sim3-qs" data-testid="sim-questions">
          <h4>Brief 12 · the five questions <button className="gr-chipbtn" onClick={() => nav('/case')} data-testid="sim-open-plan">Full Enugu plan <Icon name="arrow" size={12} /></button></h4>
          {answers.map((q, i) => <details key={q.id} open={i === 0}><summary>{i + 1}. {q.question}</summary><p>{q.answer}</p></details>)}
        </div>
      )}

      {/* right: the recommended system for this site */}
      <aside className="gr-fcard gr-sim3-detail" data-testid="best-card">
        <div className="gr-sim3-head">
          <span className="gr-sim3-ico"><Icon name="shield" size={18} /></span>
          <div><small>Best for this site</small><b data-testid="best-name">{opt ? plainName(opt.parts) : '—'}</b><span data-testid="sim-site-name">{a.inputs.facility.name || 'Pinned site'} · {a.location.name}</span>
            {isCase && <span className="gr-sim3-addr" data-testid="sim-address">{caseData!.hospital.address} · ground-mounted, containerised — moves in year {caseData!.hospital.move_in_years}</span>}</div>
        </div>
        <div className={`gr-sim3-status ${ok ? 'ok' : 'bad'}`} data-testid="outage-verdict">{ok ? '✓ Outage avoided' : '✕ Not fully avoided'} · {outage ? outage.label : 'custom outage'}</div>
        {a.agent?.ml && (
          <div className="gr-sim3-ml" data-testid="sim-ml">
            ML pick ({a.agent.ml.algorithm?.split(' · ')[0] ?? 'ML'}): <b>{FAMILY_SHORT[a.agent.ml.family] ?? a.agent.ml.family_label}</b> · {Math.round(a.agent.ml.confidence * 100)} % ·{' '}
            {a.agent.steps?.find((x: any) => x.id === 'verify')?.status === 'agree' ? 'the simulation agrees' : 'the simulation decides'}
          </div>
        )}
        {/* the final suggestion: which type of Backup Device to buy for this load and budget */}
        {device && (
          <div className="gr-sim3-device" data-testid="device-type">
            <small>Recommended Backup Device</small>
            <b>{device.name}</b>
            <span>{device.why}</span>
            <em>chosen for a {hours} h outage, ≈ {Math.round(a.load.daily_kwh).toLocaleString()} kWh a day and a {a.inputs.facility.priority.replace('_', ' ')} budget priority</em>
          </div>
        )}
        <dl className="gr-sim3-rows" data-testid="grid-outages">
          <dt>Location</dt><dd data-testid="sim-location">{place} · {coords}</dd>
          <dt>Sun · wind · water</dt><dd data-testid="sim-resources">{site.solar?.annual_psh} h/day · {site.wind?.annual_ws50} m/s · {water}</dd>
          <dt>Grid here</dt><dd>{grid ? `${rel.expected_outage_hours_per_day} h off a day · ${rel.outage_risk} risk` : 'not connected'}</dd>
          {/* the system: only the parts this design has */}
          <dt>System</dt><dd data-testid="sim-system">{[
            comp.pv?.kwp ? `Solar ${Math.round(comp.pv.kwp).toLocaleString()} kWp` : null,
            comp.wind?.kw ? `Wind ${Math.round(comp.wind.kw).toLocaleString()} kW` : null,
            comp.hydrogen ? `H₂ ${Math.round(comp.hydrogen.h2_kg).toLocaleString()} kg (site water)` : null,
            comp.backup_device?.energy_kwh ? `${device?.short ?? 'Storage'} ${Math.round(comp.backup_device.energy_kwh).toLocaleString()} kWh` : null,
            comp.generator?.kva ? `Gen ${Math.round(comp.generator.kva).toLocaleString()} kVA (last)` : null,
          ].filter(Boolean).join(' · ') || 'UPS only'}</dd>
          <dt className="opt">Daily use</dt><dd className="opt">≈ {Math.round(a.load.daily_kwh).toLocaleString()} kWh · {a.inputs.facility.beds ?? '—'} beds</dd>
          {loc.country_code === 'NG' && <><dt className="opt">National grid</dt><dd className="opt">12 collapses in 2024</dd></>}
        </dl>
        <div className="gr-sim3-chart">
          <div className="gr-sim3-charthead">
            <div className="gr-seg2" role="tablist">{(['power', 'cost'] as const).map((v) => <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)} data-testid={`chart-${v}`}>{v === 'power' ? 'Power' : 'Cost'}</button>)}</div>
            {/* the price of electricity at this simulated moment, and what the system saves right now */}
            <span className="gr-sim3-now" data-testid="price-now">{f?.grid_available ? 'Grid' : 'Diesel'} {naira(priceNow)}/kWh · saving <b>{naira(now?.saving ?? 0)}/h</b></span>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <ResponsiveContainer>
              {view === 'power' ? (
                <AreaChart data={chart} margin={{ left: 2, right: 2, top: 4, bottom: 0 }}>
                  <defs>{[['pv', '#F59E0B'], ['backup_device', '#22C55E'], ['generator', '#EF4444'], ['grid', '#2F6FEB'], ['shed', '#94A3B8']].map(([k, c]) => (
                    <linearGradient key={k} id={`g-${k}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={c} stopOpacity={0.85} /><stop offset="100%" stopColor={c} stopOpacity={0.25} /></linearGradient>))}</defs>
                  <CartesianGrid stroke="#EEF2F7" vertical={false} />
                  <XAxis dataKey="hour" type="number" domain={[0, 23]} ticks={[0, 6, 12, 18]} tickFormatter={(h) => `${h}h`} tick={{ fill: '#64748B', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#94A3B8', fontSize: 9 }} axisLine={false} tickLine={false} width={30} />
                  <Tooltip contentStyle={TT} formatter={(v: any, k: any) => [`${Math.round(Number(v))} kW`, k]} labelFormatter={(h) => hh(Number(h))} />
                  <Area isAnimationActive={false} type="monotone" dataKey="pv" name="Solar" stackId="1" stroke="#F59E0B" strokeWidth={1.5} fill="url(#g-pv)" />
                  <Area isAnimationActive={false} type="monotone" dataKey="backup_device" name="Backup Device" stackId="1" stroke="#22C55E" strokeWidth={1.5} fill="url(#g-backup)" />
                  <Area isAnimationActive={false} type="monotone" dataKey="generator" name="Generator" stackId="1" stroke="#EF4444" strokeWidth={1.5} fill="url(#g-generator)" />
                  <Area isAnimationActive={false} type="monotone" dataKey="grid" name="Grid" stackId="1" stroke="#2F6FEB" strokeWidth={1.5} fill="url(#g-grid)" />
                  <Area isAnimationActive={false} type="monotone" dataKey="shed" name="Shed" stackId="1" stroke="#94A3B8" strokeWidth={1} fill="url(#g-shed)" />
                  <Line isAnimationActive={false} type="monotone" dataKey="load" name="Load" stroke="#0F172A" strokeWidth={2} dot={false} />
                  <ReferenceLine x={t} stroke="#0F172A" strokeWidth={1.5} />
                </AreaChart>
              ) : (
                <AreaChart data={chart} margin={{ left: 2, right: 2, top: 4, bottom: 0 }}>
                  <defs>
                    <linearGradient id="g-no" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#EF4444" stopOpacity={0.35} /><stop offset="100%" stopColor="#EF4444" stopOpacity={0.05} /></linearGradient>
                    <linearGradient id="g-with" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#22C55E" stopOpacity={0.6} /><stop offset="100%" stopColor="#22C55E" stopOpacity={0.15} /></linearGradient>
                  </defs>
                  <CartesianGrid stroke="#EEF2F7" vertical={false} />
                  <XAxis dataKey="hour" type="number" domain={[0, 23]} ticks={[0, 6, 12, 18]} tickFormatter={(h) => `${h}h`} tick={{ fill: '#64748B', fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: '#94A3B8', fontSize: 9 }} axisLine={false} tickLine={false} width={40} tickFormatter={(v) => `₦${Math.round(v / 1000)}k`} />
                  <Tooltip contentStyle={TT} formatter={(v: any, k: any) => [`${naira(Number(v))}/h`, k]} labelFormatter={(h) => hh(Number(h))} />
                  <Area isAnimationActive={false} type="monotone" dataKey="noSystem" name="Without the system" stroke="#EF4444" strokeWidth={2} fill="url(#g-no)" />
                  <Area isAnimationActive={false} type="monotone" dataKey="withSystem" name="With the system" stroke="#16A34A" strokeWidth={2} fill="url(#g-with)" />
                  <ReferenceLine x={t} stroke="#0F172A" strokeWidth={1.5} />
                </AreaChart>
              )}
            </ResponsiveContainer>
          </div>
          <div className="gr-sim3-legend">{view === 'power'
            ? [['Solar', '#F59E0B'], ['Backup Device', '#22C55E'], ['Generator', '#EF4444'], ['Grid', '#2F6FEB'], ['Shed', '#94A3B8'], ['Load', '#0F172A']].map(([k, c]) => <span key={k}><i style={{ background: c }} />{k}</span>)
            : <><span><i style={{ background: '#EF4444' }} />Without the system</span><span><i style={{ background: '#16A34A' }} />With the system</span><span>· saved today <b style={{ color: '#15803D' }}>{naira(savedToday)}</b></span></>}</div>
        </div>
      </aside>

      {/* bottom-left: outage timeline + cost with vs without the system */}
      <div className="gr-fcard gr-sim3-track">
        <div className="gr-sim3-cardhead"><Icon name="alert" size={15} /><b>Outage timeline</b><span>{outage ? `${outage.label} · ${outage.hours} h` : `${hours} h from ${hh(start)}`}</span></div>
        <ol className="gr-steps-line" data-testid="outage-timeline">
          {steps.map((st, i) => <li key={st.label} className={i < active ? 'done' : i === active ? 'now' : ''}><span><Icon name={st.icon} size={13} /></span><b>{st.label}</b><small>{st.at}</small></li>)}
        </ol>
        <div className="gr-sim3-cost" data-testid="cost-compare">
          <div><small>Diesel only · 15 yr</small><i><em style={{ width: '100%', background: '#EF4444' }} /></i><b>{usd(without)}</b></div>
          <div><small>With this system · 15 yr</small><i><em style={{ width: `${without ? Math.max(2, (Math.max(0, withSys) / without) * 100) : 0}%`, background: '#22C55E' }} /></i><b>{withSys < 0 ? `+${usd(-withSys)} net gain` : usd(withSys)}</b></div>
        </div>
      </div>

      {/* bottom-right: the same design stress-tested on other real outage cases */}
      <div className="gr-fcard gr-sim3-cases" data-testid="use-cases">
        <div className="gr-sim3-cardhead"><Icon name="layers" size={15} /><b>Outage use cases</b><span>{tests.filter((x) => x.status === 'pass').length}/{tests.length} passed</span></div>
        <table>
          <tbody>
            {tests.map((x) => (
              <tr key={x.scenario}><td>{x.scenario.split('—')[0].replace('+ design outage', '').trim()}</td><td>{x.critical_served_pct} %</td><td><span className={`gr-pill ${x.status}`}>{x.status === 'pass' ? 'Covered' : x.status === 'warn' ? 'Partly' : 'Short'}</span></td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
