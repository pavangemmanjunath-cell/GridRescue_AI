import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import * as THREE from 'three'
import { api } from '../api/client'
import type { CaseData, SitePoint, Suggestions } from '../api/types'
import { frameAt, type SimFrame } from '../components/three/SiteScene'
import { Icon } from '../components/ui/Icon'
import { showToast } from '../components/ui/Primitives'
import { useSiteStore, distanceKm } from '../store/useSiteStore'
import { CASE_ID } from '../case/CasePage'
import { GestureScene, PADS, PART_META, type PartId, type PlacedPart } from './GestureScene'
import { GESTURES, useHands, useHold } from './useHands'

/** Both use cases stay in one dropdown, no detail: the brief's hospital, or any site the user has pinned. */
const USE_CASES = [
  { id: 'brief12', label: 'Relocatable solar for a hospital on the move — National Orthopaedic Hospital, Enugu (GEH Brief 12)' },
  { id: 'pinned', label: 'Backup power for any hospital — the site pinned in the Explorer' },
] as const
const STEPS = ['Use case', 'Site', 'Daily consumption', 'Place the parts', 'Outage']
const PART_ORDER: PartId[] = ['ups', 'bess', 'pv', 'gen']
const hh = (h: number) => `${String(Math.floor(h) % 24).padStart(2, '0')}:00`

/**
 * Hands-free simulation (Brief 12, last page). A hospital engineer or a judge walks the design with one hand in
 * front of the webcam: pick the site, dial the hospital's daily consumption, carry each part to its pad — the
 * engine's sizing fills every parameter — then run the outage and read each component live. Why it exists: the
 * plan has to be explained in a theatre corridor, a board room and a site visit, with no desk and no mouse; and
 * every value it shows is the same engine output the rest of GridRescue uses, so what is shown is what is sized.
 */
export function GesturePage() {
  const nav = useNavigate()
  const s = useSiteStore()
  const video = useRef<HTMLVideoElement | null>(null)
  const [enabled, setEnabled] = useState(false)
  const { hand, status, useMouse } = useHands(video, enabled)
  const [useCase, setUseCase] = useState<(typeof USE_CASES)[number]['id']>('brief12')
  const [step, setStep] = useState(0)
  const [cd, setCd] = useState<CaseData | null>(null)
  const [sites, setSites] = useState<(SitePoint & { kind: string; score?: number })[]>([])
  const [siteIdx, setSiteIdx] = useState(0)
  const [siteData, setSiteData] = useState<Record<string, any>>({})
  const [cons, setCons] = useState<any>(null)
  const [band, setBand] = useState<number | null>(null)
  const [parts, setParts] = useState<PlacedPart[]>(PART_ORDER.map((id) => ({ id, pad: null, carried: false })))
  const [carried, setCarried] = useState<PartId | null>(null)
  const [inspect, setInspect] = useState<PartId | null>(null)
  const [explode, setExplode] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [t, setT] = useState(8)
  const [playing, setPlaying] = useState(true)
  const world = useRef(new THREE.Vector3())
  const frameRef = useRef<SimFrame>({ hour: 8, load_kw: 0, critical_kw: 0, pv_kw: 0, wind_kw: 0, grid_import_kw: 0, grid_available: 1, outage_event: 0, backup_charge_kw: 0, backup_discharge_kw: 0, soc_pct: 90, generator_kw: 0, fuel_cell_kw: 0, unserved_kw: 0, unserved_critical_kw: 0 })
  const a = s.assessment
  const rec = a?.recommended
  const comp = rec?.components ?? {}
  const sizing = { pvKwp: comp.pv?.kwp ?? 0, bessKwh: comp.backup_device?.energy_kwh ?? 0, genKva: comp.generator?.kva ?? (s.facility.existing.generator_kva || 0), upsKva: comp.ups?.kva ?? 0, backupType: comp.backup_device?.chemistry === 'flow' ? 'Vanadium flow' : comp.backup_device ? 'LFP' : undefined }
  const rows = rec?.simulation_hourly ?? []
  if (rows.length === 24) frameRef.current = frameAt(rows, t)
  const hospitalName = cd?.hospital.name ?? s.facility.name ?? 'Hospital'
  const address = cd?.hospital.address

  // ── step 0 → 1: load the use case, list the sites the hand can choose from ──
  const begin = useCallback(async () => {
    try {
      let c = cd
      if (useCase === 'brief12') { c = await api.caseData(CASE_ID); setCd(c); s.loadCase(c) } else { setCd(null); s.clearCase() }
      const here = { lat: s.lat, lng: s.lng }
      const base = c ? { lat: c.hospital.lat, lng: c.hospital.lng } : here
      const list: (SitePoint & { kind: string; score?: number })[] = [{ ...base, label: c ? `Today · ${c.hospital.short}, ${c.hospital.address}` : 'Pinned site', kind: 'today' }]
      if (c) list.push({ lat: c.new_site.lat, lng: c.new_site.lng, label: c.new_site.label, kind: 'new' })
      const sg: Suggestions | null = await api.suggestSites(base.lat, base.lng).catch(() => null)
      sg?.top.slice(0, 3).forEach((x) => list.push({ lat: x.lat, lng: x.lng, label: `Lens area #${x.rank} · ${x.direction}, ${x.distance_km} km`, kind: 'lens', score: x.score }))
      setSites(list); setSiteIdx(0); setStep(1)
    } catch { showToast('Could not load the case — is the backend running?') }
  }, [cd, useCase, s])

  // ── step 1 → 2: lock the site and read it with every open-data API at once ──
  const confirmSite = useCallback(async () => {
    const p = sites[siteIdx]; if (!p) return
    s.setLatLng(p.lat, p.lng, true); s.setLocked(true)
    if (cd && distanceKm(p, cd.hospital) > 3) s.setNewSite(p)
    setStep(2)
    const calls = { location: api.location(p.lat, p.lng), sun: api.sun(p.lat, p.lng), wind: api.wind(p.lat, p.lng), weather: api.weather(p.lat, p.lng), water: api.water(p.lat, p.lng), grid: api.gridScan(p.lat, p.lng, undefined, null, cd?.options.supply_hours_override ?? null), facilities: api.facilities(p.lat, p.lng), hourly: api.hourly(p.lat, p.lng, s.month), solar: api.solarCheck(p.lat, p.lng) }
    const out: Record<string, any> = {}
    await Promise.all(Object.entries(calls).map(([k, pr]) => pr.then((v) => { out[k] = v; setSiteData({ ...out }) }).catch(() => { out[k] = null })))
    const c0 = cd ? await api.caseConsumption(CASE_ID).catch(() => null) : await api.loadModel(s.facility).then((lm: any) => ({ ...lm, peak_kw: lm.peak_load_kw, hourly_kwh: lm.hourly?.total ?? [], hourly_critical_kw: lm.hourly?.critical ?? [], bands_kwh: [1000, 2500, 5000, 8000, 12000, 16000, 20000, 28000, 36000], band_index: 4, source: 'estimate', note: 'Estimated from beds and type.' })).catch(() => null)
    if (c0) { setCons(c0); setBand(c0.band_index) }
  }, [sites, siteIdx, cd, s])

  // ── step 2 → 3: the dialled consumption becomes the engine's load; the engine sizes every part ──
  const confirmLoad = useCallback(async () => {
    if (cons && band != null) s.setFacility({ daily_kwh: cons.bands_kwh[band] })
    setStep(3)
    const r = await s.runAssessment()
    if (!r) showToast('Sizing failed — is the backend running?')
  }, [cons, band, s])

  // ── hand → UI mapping per step ──
  const hovered = useMemo(() => {
    if (step === 1) return Math.min(sites.length - 1, Math.max(0, Math.floor(hand.y * sites.length * 1.15 - 0.1)))
    return -1
  }, [hand.y, step, sites.length])
  useEffect(() => { if (step === 1 && hovered >= 0 && hand.present) setSiteIdx(hovered) }, [hovered, step, hand.present])
  useEffect(() => { if (step === 2 && cons && hand.present && (hand.intent === 'open' || hand.intent === 'point' || status === 'mouse')) setBand(Math.round(hand.openness * (cons.bands_kwh.length - 1))) }, [hand.openness, hand.intent, hand.present, step, cons, status])
  useEffect(() => {
    if (step < 3) return
    if (hand.intent === 'open' && hand.openness > 0.85) setExplode((e) => Math.min(1, e + 0.08))
    if (hand.intent === 'fist') setExplode((e) => Math.max(0, e - 0.1))
    if (hand.intent === 'two_hands' && hand.span > 0) setZoom(Math.max(0.6, Math.min(2.2, hand.span * 3)))
  }, [hand.intent, hand.openness, hand.span, step])
  // pinch: pick up the nearest unplaced part (or the part under the cursor); release: drop on the pad under the cursor
  const nearPad = () => PADS.find((p) => Math.hypot(p.at[0] - world.current.x, p.at[2] - world.current.z) < 3.2)?.id ?? null
  useEffect(() => {
    if (step !== 3) return
    if (hand.intent === 'pinch' && !carried) {
      const under = parts.find((p) => p.pad && p.pad === nearPad())
      const next = under ?? parts.find((p) => !p.pad)
      if (next) { setCarried(next.id); setParts((ps) => ps.map((p) => (p.id === next.id ? { ...p, carried: true, pad: null } : p))) }
    }
    if (hand.intent !== 'pinch' && carried) {
      const pad = nearPad()
      setParts((ps) => ps.map((p) => (p.id === carried ? { ...p, carried: false, pad } : p)))
      if (pad) showToast(pad === PART_META[carried].rightPad ? `${PART_META[carried].label} placed on the right pad ✓` : `${PART_META[carried].label} placed — ${PADS.find((x) => x.id === pad)?.why}`)
      setCarried(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hand.intent, step])
  useEffect(() => { if (step >= 3 && hand.intent === 'point') { const pad = nearPad(); setInspect(parts.find((p) => p.pad === pad)?.id ?? null) } }, [hand.x, hand.y, hand.intent, step, parts])
  useEffect(() => { if (step === 4 && hand.present && (hand.intent === 'point' || hand.intent === 'open')) { setPlaying(false); setT(hand.x * 23.99) } }, [hand.x, hand.intent, hand.present, step])
  useEffect(() => {
    if (!playing || step !== 4) return
    let raf = 0, last = performance.now()
    const tick = (now: number) => { const dt = (now - last) / 1000; last = now; setT((x) => (x + dt * 0.8) % 24); raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, step])

  const allPlaced = parts.every((p) => p.pad)
  const rightCount = parts.filter((p) => p.pad === PART_META[p.id].rightPad).length
  const next = useCallback(() => {
    if (step === 0) begin()
    else if (step === 1) confirmSite()
    else if (step === 2) confirmLoad()
    else if (step === 3 && allPlaced) { setStep(4); setPlaying(true) }
    else if (step === 4) nav('/case')
  }, [step, begin, confirmSite, confirmLoad, allPlaced, nav])
  const back = useCallback(() => setStep((x) => Math.max(0, x - 1)), [])
  const holdNext = useHold(hand, 'thumbs_up', next)
  useHold(hand, 'peace', back, 700)
  const autoPlace = () => setParts(PART_ORDER.map((id) => ({ id, pad: PART_META[id].rightPad, carried: false })))

  // ── per-part parameter cards, all from the engine ──
  const card = (id: PartId) => {
    const f = frameRef.current
    const fx = rec?.cost.assumptions.usd_to_ngn ?? 1330
    const cost = (prefix: string) => rec?.cost.breakdown.filter((b: any) => b.category.startsWith(prefix)).reduce((x: number, b: any) => x + b.usd, 0) ?? 0
    const m = (usd: number) => `₦${(usd * fx / 1e6).toFixed(0)} M`
    if (id === 'pv') return [['Size', `${Math.round(sizing.pvKwp)} kWp · ${Math.round(comp.pv?.area_m2 ?? 0).toLocaleString()} m²`], ['Yield', `${Math.round(comp.pv?.annual_kwh ?? 0).toLocaleString()} kWh a year`], ['Now', `${Math.round(f.pv_kw)} kW`], ['Mounting', 'ballasted ground racks · moves'], ['Cost', m(cost('Solar PV'))]]
    if (id === 'bess') return [['Size', `${Math.round(sizing.bessKwh).toLocaleString()} kWh · ${Math.round(comp.backup_device?.power_kw ?? 0)} kW`], ['Carries', `${comp.backup_device?.autonomy_h ?? '—'} h of protected load`], ['Charge now', `${Math.round(f.soc_pct)} % · ${f.backup_discharge_kw > 0 ? `giving ${Math.round(f.backup_discharge_kw)} kW` : f.backup_charge_kw > 0 ? `taking ${Math.round(f.backup_charge_kw)} kW` : 'idle'}`], ['Form', `${Math.ceil(sizing.bessKwh / 2000)} × 20-ft containers · moves`], ['Cost', m(cost('Backup Device') + cost('PCS') + cost('Transformers') + cost('EMS') + cost('HVAC') + cost('Fire'))]]
    if (id === 'ups') return [['Size', `${sizing.upsKva} kVA online · ${comp.ups?.autonomy_min ?? 15} min`], ['Protects', `${Math.round(a?.load.critical_peak_kw ?? 0)} kW theatres, ICU, imaging`], ['Switchover', '0 ms — no gap at the table'], ['Form', 'containerised e-house · moves'], ['Cost', m(cost('UPS'))]]
    return [['Size', `${Math.round(sizing.genKva)} kVA · ${comp.generator?.existing ? 'existing' : 'new'}`], ['Role', 'last tier only'], ['Now', `${Math.round(f.generator_kw)} kW`], ['Fuel on this day', `${rec?.simulation_summary.fuel_l ?? 0} L`], ['Avoided', `${Math.round(a?.investment_case?.investment.diesel_avoided_l_per_year ?? 0).toLocaleString()} L a year`]]
  }

  const ready = status === 'running' || status === 'mouse'
  return (
    <div className="gr-gest" data-testid="gesture-page">
      <video ref={video} className="gr-gest-video" muted playsInline />
      {ready && step >= 1 && <div className="gr-gest-scene" data-testid="gesture-scene"><GestureScene parts={parts} sizing={sizing} cursor={{ x: hand.x, y: hand.y }} carriedId={carried} explode={explode} zoom={zoom} inspect={inspect} frameRef={frameRef} name={hospitalName} address={address} onCursorWorld={(w) => world.current.copy(w)} /></div>}
      {ready && hand.present && <div className="gr-gest-cursor" style={{ left: `${hand.x * 100}%`, top: `${hand.y * 100}%` }} data-testid="hand-cursor"><i style={{ transform: `scale(${1 + hand.pinch * 0.6})`, borderColor: hand.intent === 'pinch' ? '#F59E0B' : '#fff' }} />{holdNext > 0 && <svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" stroke="#4ADE80" strokeWidth="4" fill="none" strokeDasharray={`${holdNext * 94} 94`} /></svg>}</div>}

      {/* header: steps + camera state */}
      <header className="gr-gest-head">
        <div><div className="gr-eyebrow" style={{ margin: 0 }}>Brief 12 · hands-free simulation</div><h1>Walk the relocatable design with one hand</h1></div>
        <ol className="gr-gest-steps" data-testid="gesture-steps">{STEPS.map((x, i) => <li key={x} className={i === step ? 'now' : i < step ? 'done' : ''}><span>{i + 1}</span>{x}</li>)}</ol>
        <div className="gr-gest-cam" data-testid="camera-status">
          <span className={`gr-dot ${status}`} />{status === 'running' ? `camera · ${hand.fps} fps · ${hand.raw}` : status === 'mouse' ? 'mouse mode' : status === 'loading' ? 'loading hand model…' : status === 'camera' ? 'waiting for the camera…' : status === 'no-camera' ? 'no camera' : status === 'no-model' ? 'hand model missing — run START.bat' : 'off'}
          {!enabled ? <button className="gr-btn gr-btn-rescue" onClick={() => setEnabled(true)} data-testid="camera-on"><Icon name="play" size={14} /> Start camera</button>
            : status !== 'mouse' && <button className="gr-btn-pill" onClick={useMouse} data-testid="use-mouse">Use the mouse instead</button>}
        </div>
      </header>

      {/* left: the current step's panel */}
      <aside className="gr-gest-panel" data-testid="gesture-panel">
        {step === 0 && <>
          <div className="gr-eyebrow">1 · Use case</div>
          <select className="gr-select" value={useCase} onChange={(e) => setUseCase(e.target.value as any)} data-testid="usecase">{USE_CASES.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}</select>
          <p className="gr-gest-why">What this is for: explaining the plan where there is no desk — a theatre corridor, a site visit, a board room — and proving the sizing by placing each part yourself. Every number comes from the same engine as the plan.</p>
          <ul className="gr-gest-gl">{GESTURES.map((g) => <li key={g.intent}><b>{g.icon} {g.label}</b><span>{g.does}</span></li>)}</ul>
          {ready ? <button className="gr-btn gr-btn-rescue" onClick={next} data-testid="step-next">👍 Thumbs up (or click) to begin</button> : <div className="gr-muted" style={{ fontSize: 12 }}>Start the camera, or use the mouse.</div>}
        </>}
        {step === 1 && <>
          <div className="gr-eyebrow">2 · Site — move the hand up and down, thumbs up to lock</div>
          <ul className="gr-gest-list" data-testid="site-list">{sites.map((p, i) => <li key={p.label} className={i === siteIdx ? 'on' : ''} onClick={() => setSiteIdx(i)}><b>{p.label}</b><small>{p.kind === 'today' ? "today's building" : p.kind === 'new' ? 'the new building site' : `grid lens · ${p.score}/100`}</small></li>)}</ul>
          <button className="gr-btn gr-btn-rescue" onClick={next} data-testid="step-next">👍 Lock this site</button>
        </>}
        {step === 2 && <>
          <div className="gr-eyebrow">3 · Daily consumption — open the hand to dial it</div>
          {cons ? <>
            <div className="gr-gest-big" data-testid="band-value">{cons.bands_kwh[band ?? cons.band_index].toLocaleString()} <small>kWh a day</small></div>
            <div className="gr-gest-bands">{cons.bands_kwh.map((b: number, i: number) => <i key={b} className={i === (band ?? cons.band_index) ? 'on' : i === cons.band_index ? 'ref' : ''} />)}</div>
            <div className="gr-muted" style={{ fontSize: 11.5 }}>{cons.source === 'meter' ? 'Meter log' : 'Engine estimate'}: {cons.daily_kwh.toLocaleString()} kWh a day · peak {cons.peak_kw} kW{cons.connected_kw ? ` of ${cons.connected_kw.toLocaleString()} kW connected` : ''} · {cons.kwh_without_grid?.toLocaleString() ?? '—'} kWh of it falls in the {24 - (cons.grid_hours_per_day ?? 0)} h without grid.</div>
            <div style={{ height: 110, marginTop: 6 }} data-testid="consumption-chart"><ResponsiveContainer><AreaChart data={cons.hourly_kwh.map((v: number, h: number) => ({ h, kwh: v, crit: cons.hourly_critical_kw?.[h] ?? 0 }))} margin={{ left: 0, right: 4, top: 4, bottom: 0 }}>
              <XAxis dataKey="h" tick={{ fill: '#7A8AA8', fontSize: 9 }} ticks={[0, 6, 12, 18]} tickFormatter={(h) => `${h}h`} axisLine={false} tickLine={false} /><YAxis hide /><Tooltip contentStyle={{ background: '#1A3052', border: 'none', borderRadius: 8, color: '#fff', fontSize: 11 }} formatter={(v: any, k: any) => [`${Math.round(Number(v))} ${k === 'kwh' ? 'kWh' : 'kW'}`, k === 'kwh' ? 'all loads' : 'life-critical']} labelFormatter={(h) => hh(Number(h))} />
              <Area isAnimationActive={false} type="monotone" dataKey="kwh" stroke="#F0CB72" fill="#F0CB72" fillOpacity={0.25} /><Area isAnimationActive={false} type="monotone" dataKey="crit" stroke="#EF4444" fill="#EF4444" fillOpacity={0.3} /></AreaChart></ResponsiveContainer></div>
            <div className="gr-muted" style={{ fontSize: 11 }}>{cons.note}</div>
          </> : <div className="gr-muted">Reading the hospital's consumption…</div>}
          <button className="gr-btn gr-btn-rescue" onClick={next} disabled={!cons} data-testid="step-next">👍 Size the system for this</button>
        </>}
        {step === 3 && <>
          <div className="gr-eyebrow">4 · Place the parts — pinch to carry, open to drop</div>
          {s.assessing && <div className="gr-muted"><Icon name="refresh" className="gr-spin" /> The engine is sizing every part for this site and load…</div>}
          <ul className="gr-gest-list" data-testid="part-list">{parts.map((p) => <li key={p.id} className={p.pad === PART_META[p.id].rightPad ? 'on' : p.pad ? 'warn' : ''}><b><span className="gr-dot" style={{ background: PART_META[p.id].color, marginRight: 6 }} />{PART_META[p.id].label}</b><small>{p.carried ? 'in hand' : p.pad ? (p.pad === PART_META[p.id].rightPad ? '✓ right pad' : `on ${PADS.find((x) => x.id === p.pad)?.label} — not ideal`) : 'waiting'}</small></li>)}</ul>
          <div className="gr-muted" style={{ fontSize: 11.5 }}>The green ring is the pad the plan recommends. {rightCount}/4 on the right pad. Point at a placed part to read its parameters.</div>
          <div className="gr-row" style={{ gap: 6 }}><button className="gr-btn-pill" onClick={autoPlace} data-testid="auto-place">Place all as the plan says</button><button className="gr-btn gr-btn-rescue" onClick={next} disabled={!allPlaced || s.assessing} data-testid="step-next">👍 Run the outage</button></div>
        </>}
        {step === 4 && <>
          <div className="gr-eyebrow">5 · Outage — move the hand left / right to scrub the day</div>
          <div className="gr-gest-big" data-testid="clock">{hh(t)} <small className={frameRef.current.grid_available ? 'ok' : 'bad'}>{frameRef.current.outage_event ? 'outage' : frameRef.current.grid_available ? 'grid on' : 'no grid'}</small></div>
          <dl className="gr-gest-live" data-testid="live-powers">
            <dt>Load</dt><dd>{Math.round(frameRef.current.load_kw)} kW</dd><dt>Solar</dt><dd>{Math.round(frameRef.current.pv_kw)} kW</dd><dt>Batteries</dt><dd>{frameRef.current.backup_discharge_kw > 0 ? `−${Math.round(frameRef.current.backup_discharge_kw)}` : `+${Math.round(frameRef.current.backup_charge_kw)}`} kW · {Math.round(frameRef.current.soc_pct)} %</dd>
            <dt>Generator</dt><dd>{Math.round(frameRef.current.generator_kw)} kW</dd><dt>Grid</dt><dd>{Math.round(frameRef.current.grid_import_kw)} kW</dd><dt>Theatres</dt><dd className={frameRef.current.unserved_critical_kw < 0.5 ? 'ok' : 'bad'}>{frameRef.current.unserved_critical_kw < 0.5 ? 'powered' : 'SHORT'}</dd>
          </dl>
          <div className="gr-muted" style={{ fontSize: 11.5 }}>{rec ? `${rec.simulation_summary.critical_served_pct} % of critical load served · ${rec.simulation_summary.fuel_l} L diesel on this day · ${a?.agent?.stress_tests?.filter((x: any) => x.status === 'pass').length ?? 0}/${a?.agent?.stress_tests?.length ?? 0} stress tests passed` : 'no sizing yet'}</div>
          <div className="gr-row" style={{ gap: 6 }}><button className="gr-btn-pill" onClick={() => setPlaying((p) => !p)}>{playing ? 'Pause' : 'Play'}</button><button className="gr-btn gr-btn-rescue" onClick={next} data-testid="step-next">👍 Open the full plan</button></div>
        </>}
        {step > 0 && <button className="gr-btn-pill" style={{ alignSelf: 'flex-start' }} onClick={back} data-testid="step-back">✌️ Back</button>}
      </aside>

      {/* right: what the hand is pointing at, and the data read for this site */}
      {step >= 1 && (
        <aside className="gr-gest-side">
          {inspect && step >= 3 && <div className="gr-gest-card" data-testid="part-card"><b style={{ color: PART_META[inspect].color }}>{PART_META[inspect].label}</b><table><tbody>{card(inspect).map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}</tbody></table><small>{PADS.find((p) => p.id === parts.find((x) => x.id === inspect)?.pad)?.why}</small></div>}
          <div className="gr-gest-card gr-gest-data" data-testid="site-data">
            <b>Open data read for this site</b>
            <Row ok={!!siteData.location} k="Place" v={siteData.location ? `${siteData.location.name}, ${siteData.location.state ?? ''} · ${siteData.location.elevation_m} m` : '…'} />
            <Row ok={!!siteData.sun} k="Sun" v={siteData.sun ? `${siteData.sun.annual_psh} kWh/m² a day · ${siteData.sun.source}` : '…'} />
            <Row ok={!!siteData.solar} k="Cross-check" v={siteData.solar ? siteData.solar.rows.filter((r: any) => r.value != null).map((r: any) => `${r.source.split(' ')[0]} ${r.value}`).join(' · ') : '…'} />
            <Row ok={!!siteData.wind} k="Wind" v={siteData.wind ? `${siteData.wind.annual_avg_ms} m/s at 50 m` : '…'} />
            <Row ok={!!siteData.weather?.current} k="Now" v={siteData.weather?.current ? `${Math.round(siteData.weather.current.temperature_c)} °C · cloud ${siteData.weather.current.cloud_cover_pct} %` : '…'} />
            <Row ok={!!siteData.grid} k="Grid" v={siteData.grid ? `${siteData.grid.rings[0].reliability.class_label} · ${siteData.grid.rings[0].reliability.expected_supply_hours_per_day} h a day · ${siteData.grid.rings[0].power.summary.substations} substations in 50 km` : '…'} />
            <Row ok={!!siteData.water} k="Water" v={siteData.water ? `${siteData.water.waterways.nearest ? `${siteData.water.waterways.nearest.name} ${siteData.water.waterways.nearest.distance_km} km` : 'none in 10 km'} · head ${siteData.water.scores.head_m} m` : '…'} />
            <Row ok={!!siteData.facilities} k="Health" v={siteData.facilities ? `${siteData.facilities.hospitals} hospitals, ${siteData.facilities.clinics} clinics in 25 km` : '…'} />
            <Row ok={!!siteData.hourly} k="Typical day" v={siteData.hourly ? `peak ${Math.round(Math.max(...siteData.hourly.ghi_w_m2))} W/m² · ${siteData.hourly.source}` : '…'} />
            {a && <Row ok k="ML" v={`${(a.agent?.steps?.find((x: any) => x.id === 'classify')?.summary ?? '').split(' because')[0].replace('Predicts ', 'classifier: ') || 'classifier'} · verified → ${rec?.short}`} />}
          </div>
        </aside>
      )}
    </div>
  )
}

function Row({ ok, k, v }: { ok: boolean; k: string; v: string }) {
  return <div className="gr-gest-row"><span className="gr-dot" style={{ background: ok ? '#4ADE80' : '#4D5E7E' }} /><small>{k}</small><span>{v}</span></div>
}
