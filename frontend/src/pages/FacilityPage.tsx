import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { API_BASE, api } from '../api/client'
import { MLCard } from '../components/results/MLCard'
import type { FacilityInput, FacilityType, Priority } from '../api/types'
import { useSiteStore } from '../store/useSiteStore'
import { Icon } from '../components/ui/Icon'
import { Card, Chip, Stat, showToast } from '../components/ui/Primitives'
import { Screen } from '../components/layout/Screen'
import { fmt } from '../lib/format'

const TYPES: { id: FacilityType; label: string }[] = [
  { id: 'hospital_tertiary', label: 'Teaching / tertiary hospital' }, { id: 'hospital_general', label: 'General / secondary hospital' }, { id: 'clinic_phc', label: 'Primary health centre / clinic' },
  { id: 'emergency_center', label: 'Emergency / trauma centre' }, { id: 'telecom_tower', label: 'Telecom tower' }, { id: 'water_treatment', label: 'Water treatment / pumping' },
  { id: 'school', label: 'School' }, { id: 'cold_chain', label: 'Vaccine cold-chain store' }, { id: 'data_center', label: 'Data / ICT centre' }, { id: 'custom', label: 'Other critical facility' },
]
const PRIORITIES: { id: Priority; label: string; hint: string }[] = [
  { id: 'balanced', label: 'Balanced', hint: 'reliability, cost and clean energy weighed equally' },
  { id: 'cheapest', label: 'Cheapest', hint: 'lowest CAPEX and lifecycle cost' },
  { id: 'greenest', label: 'Greenest', hint: 'maximise renewable share' },
  { id: 'most_reliable', label: 'Most reliable', hint: 'zero-break, deepest protection' },
  { id: 'longest_backup', label: 'Longest backup', hint: 'multi-day autonomy' },
]
const HOURS = [4, 8, 12, 24, 48, 72]

/** Facility — pick a real hospital or describe one; the power requirement updates live on the right. */
export function FacilityPage() {
  const s = useSiteStore()
  const nav = useNavigate()
  const f = s.facility
  const [featured, setFeatured] = useState<any[]>([])
  const [hospQuery, setHospQuery] = useState('')
  const [load, setLoad] = useState<any>(null)
  const debounce = useRef<number>(0)

  useEffect(() => { fetch(`${API_BASE}/api/hospitals/featured`).then((r) => r.json()).then((j) => setFeatured(j.facilities)).catch(() => null) }, [])
  useEffect(() => { if (!s.location) s.fetchSite(); if (!s.facilities || !s.grid) s.fetchLayers() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    window.clearTimeout(debounce.current)
    debounce.current = window.setTimeout(() => {
      fetch(`${API_BASE}/api/load-model`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) }).then((r) => r.json()).then(setLoad).catch(() => null)
    }, 300)
  }, [f])
  // the ML pick follows the configuration live: the same site, grid hours and diesel price the full assessment uses
  const [ml, setMl] = useState<{ pred: any; meta: any } | null>(null)
  const [mlState, setMlState] = useState<'loading' | 'ready' | 'error'>('loading')
  const supply = s.supplyHours(), diesel = s.prices.diesel_ngn_per_l / s.prices.usd_to_ngn
  useEffect(() => {
    const ctl = new AbortController()
    setMlState('loading')
    const t = window.setTimeout(() => {
      api.mlPredict({ lat: s.lat, lng: s.lng }, f, { supply_hours_override: supply, diesel_price_usd_per_l: +diesel.toFixed(4) }, ctl.signal)
        .then((r) => { if (r.available) { setMl({ pred: r.prediction, meta: r.model }); setMlState('ready') } else setMlState('error') })
        .catch(() => { if (!ctl.signal.aborted) setMlState('error') })
    }, 500)
    return () => { window.clearTimeout(t); ctl.abort() }
  }, [s.lat, s.lng, f, supply, diesel])

  const num = (v: string) => (v === '' ? null : Number(v))
  const set = (patch: Partial<FacilityInput>) => s.setFacility(patch)
  const pickHospital = (h: any) => {
    s.setLatLng(h.lat, h.lng, true)
    set({ name: h.name, type: h.tier === 'tertiary' ? 'hospital_tertiary' : h.type === 'hospital' || h.tier === 'secondary' ? 'hospital_general' : 'clinic_phc', beds: h.beds ?? (h.tier === 'tertiary' ? 400 : 120) })
    showToast(`${h.name} selected`)
  }
  const nearby = (s.facilities?.facilities ?? []).filter((x) => x.type === 'hospital').slice(0, 6)
  const featuredFiltered = featured.filter((h) => !hospQuery || `${h.name} ${h.city} ${h.country}`.toLowerCase().includes(hospQuery.toLowerCase())).slice(0, 8)

  const run = async () => {
    const a = await s.runAssessment()
    if (a) nav('/recommendation')
  }

  const runBtn = (
    <button className="gr-btn gr-btn-rescue gr-btn-lg" onClick={run} disabled={s.assessing} style={{ width: '100%' }} data-testid="run-assessment">{s.assessing ? <><Icon name="refresh" className="gr-spin" /> Assessing…</> : <><Icon name="shield" size={18} /> Run assessment</>}</button>
  )

  return (
    <Screen testid="facility-page" eyebrow="Facility & load" title="How much power does this facility need?"
      sub={<>Site: {s.location ? `${s.location.name}, ${s.location.state ?? ''} ${s.location.country}` : fmt.coord(s.lat, s.lng)} · <a href="/explorer" onClick={(e) => { e.preventDefault(); nav('/explorer') }}>change on the map</a></>}
      tabs={[
        { id: 'hospital', label: 'Hospital & load', content: <div className="gr-grid gr-grid-2" style={{ alignItems: 'start' }}>{s.assessError && <div className="gr-card" style={{ borderColor: 'var(--gr-danger)', color: 'var(--gr-danger)' }}><Icon name="alert" /> {s.assessError}</div>}
          <Card>
            <div className="gr-card-head"><div className="gr-eyebrow">Select a real hospital (optional)</div><Chip kind="live">OSM · healthsites · curated</Chip></div>
            <div className="gr-grid gr-grid-2">
              <div>
                <div className="gr-label" style={{ marginBottom: 6 }}>Nearby (25 km of the pin)</div>
                <ul className="gr-layer-list" data-testid="nearby-hospitals">
                  {nearby.map((h) => <li key={h.id} onClick={() => pickHospital(h)}><b>🏥 {h.name}</b><small>{h.beds ? `${h.beds} beds · ` : ''}{h.distance_km} km</small></li>)}
                  {nearby.length === 0 && <li><span className="gr-muted">{s.layersLoading ? 'scanning…' : 'No hospital found nearby — use the featured list or enter values.'}</span></li>}
                </ul>
              </div>
              <div>
                <div className="gr-label" style={{ marginBottom: 6 }}>Featured referral hospitals · Africa</div>
                <input className="gr-input" placeholder="Filter by name, city, country…" value={hospQuery} onChange={(e) => setHospQuery(e.target.value)} style={{ marginBottom: 6, padding: '7px 10px', fontSize: 13 }} data-testid="hospital-filter" />
                <ul className="gr-layer-list" data-testid="featured-list">{featuredFiltered.map((h) => <li key={h.id} onClick={() => pickHospital(h)}><b>{h.name}</b><small>{h.city}{h.beds ? ` · ${h.beds} beds` : ''}</small></li>)}</ul>
              </div>
            </div>
          </Card>

          <Card>
            <div className="gr-eyebrow">Facility</div>
            <div className="gr-grid gr-grid-2">
              <label className="gr-field"><span className="gr-label">Facility type</span>
                <select className="gr-select" value={f.type} onChange={(e) => set({ type: e.target.value as FacilityType })} data-testid="facility-type">{TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
              <label className="gr-field"><span className="gr-label">Name <span className="hint">optional</span></span><input className="gr-input" value={f.name ?? ''} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. National Hospital Abuja" data-testid="facility-name" /></label>
              <label className="gr-field"><span className="gr-label">Beds</span><input className="gr-input gr-input-mono" type="number" min={0} value={f.beds ?? ''} onChange={(e) => set({ beds: num(e.target.value) })} data-testid="beds" /></label>
              <label className="gr-field"><span className="gr-label">Average load (kW) <span className="hint">from the meter · clears daily kWh</span></span><input className="gr-input gr-input-mono" type="number" min={0} value={f.avg_load_kw ?? ''} onChange={(e) => set({ avg_load_kw: num(e.target.value), ...(e.target.value ? { daily_kwh: null } : {}) })} placeholder="auto from beds" data-testid="avg-load" /></label>
              <label className="gr-field"><span className="gr-label">Critical load (kW) <span className="hint">override</span></span><input className="gr-input gr-input-mono" type="number" min={0} value={f.critical_load_kw ?? ''} onChange={(e) => set({ critical_load_kw: num(e.target.value) })} placeholder="auto (ICU, OT, labs)" data-testid="critical-load" /></label>
              <label className="gr-field"><span className="gr-label">Daily consumption (kWh/day) <span className="hint">from the bill or log · clears avg kW</span></span><input className="gr-input gr-input-mono" type="number" min={0} value={f.daily_kwh ?? ''} onChange={(e) => set({ daily_kwh: num(e.target.value), ...(e.target.value ? { avg_load_kw: null } : {}) })} placeholder="auto from beds" data-testid="daily-kwh" /></label>
            </div>
            <div className="gr-field" style={{ marginTop: 16 }}>
              <span className="gr-label">Required backup duration</span>
              <div className="gr-radio-row" data-testid="backup-hours">{HOURS.map((h) => <button key={h} className={`gr-radio ${f.backup_hours === h ? 'on' : ''}`} onClick={() => set({ backup_hours: h })}>{h >= 24 ? `${h / 24} day${h > 24 ? 's' : ''}` : `${h} h`}</button>)}
                <input className="gr-input gr-input-mono" type="number" min={0.25} max={168} step={0.5} value={f.backup_hours} onChange={(e) => set({ backup_hours: Number(e.target.value) || 1 })} style={{ padding: '8px 10px' }} aria-label="custom hours" /></div>
            </div>
          </Card>

          </div> },
        { id: 'equipment', label: 'Equipment & site', content: <div className="gr-stack">
          <Card>
            <div className="gr-card-head"><div className="gr-eyebrow">Prices the cost calculator uses</div><Chip kind="model">editable · sources shown</Chip></div>
            <div className="gr-grid gr-grid-3" data-testid="prices">
              <label className="gr-field"><span className="gr-label">Diesel (₦ / litre)</span><input className="gr-input gr-input-mono" type="number" min={100} value={s.prices.diesel_ngn_per_l} onChange={(e) => s.setPrices({ diesel_ngn_per_l: Number(e.target.value) || 0 })} data-testid="price-diesel" /><span className="hint" style={{ fontSize: 11 }}>NBS national average, May 2026: ₦3,277</span></label>
              <label className="gr-field"><span className="gr-label">Grid tariff (₦ / kWh)</span><input className="gr-input gr-input-mono" type="number" min={10} value={s.prices.grid_ngn_per_kwh} onChange={(e) => s.setPrices({ grid_ngn_per_kwh: Number(e.target.value) || 0 })} data-testid="price-grid" /><span className="hint" style={{ fontSize: 11 }}>NERC Band A ₦209.50 · Enugu (EERC) ₦160</span></label>
              <label className="gr-field"><span className="gr-label">Exchange rate (₦ / US$)</span><input className="gr-input gr-input-mono" type="number" min={100} value={s.prices.usd_to_ngn} onChange={(e) => s.setPrices({ usd_to_ngn: Number(e.target.value) || 1330 })} data-testid="price-fx" /><span className="hint" style={{ fontSize: 11 }}>CBN official window ≈ ₦1,330</span></label>
            </div>
            <label className="gr-field" style={{ marginTop: 12, maxWidth: 420 }}><span className="gr-label">Grid hours a day reported by the facility <span className="hint">optional · replaces the state assumption</span></span>
              <input className="gr-input gr-input-mono" type="number" min={0} max={24} step={0.5} value={s.reportedGridHours ?? ''} onChange={(e) => s.setReportedGridHours(e.target.value === '' ? null : Math.max(0, Math.min(24, Number(e.target.value))))} placeholder={`auto · ${s.grid?.reliability.expected_supply_hours_per_day ?? '…'} h/day for this state`} data-testid="grid-hours-input" /><span className="hint" style={{ fontSize: 11 }}>source: the facility's engineer or feeder log — Enugu's orthopaedic hospital reports about 6 h</span></label>
            <label className="gr-toggle" style={{ marginTop: 12 }}><input type="checkbox" checked={s.moving} onChange={(e) => s.setMoving(e.target.checked)} data-testid="moving-check" /><span className="tr" />This hospital will move to a new building (Brief 12) — plan a relocatable system</label>
          </Card>
          <Card>
            <div className="gr-eyebrow">Existing sources &amp; site</div>
            <div className="gr-grid gr-grid-2">
              <label className="gr-toggle"><input type="checkbox" checked={f.existing.grid_connection} onChange={(e) => s.setExisting({ grid_connection: e.target.checked })} /><span className="tr" />Grid connection</label>
              <label className="gr-toggle"><input type="checkbox" checked={f.allow_new_generator} onChange={(e) => set({ allow_new_generator: e.target.checked })} /><span className="tr" />Allow a new generator as last tier</label>
              <label className="gr-field"><span className="gr-label">Existing generator (kVA)</span><input className="gr-input gr-input-mono" type="number" min={0} value={f.existing.generator_kva} onChange={(e) => s.setExisting({ generator_kva: Number(e.target.value) || 0 })} data-testid="gen-kva" /></label>
              <label className="gr-field"><span className="gr-label">Existing solar (kWp)</span><input className="gr-input gr-input-mono" type="number" min={0} value={f.existing.solar_kwp} onChange={(e) => s.setExisting({ solar_kwp: Number(e.target.value) || 0 })} /></label>
              <label className="gr-field"><span className="gr-label">Existing UPS (kVA)</span><input className="gr-input gr-input-mono" type="number" min={0} value={f.existing.ups_kva} onChange={(e) => s.setExisting({ ups_kva: Number(e.target.value) || 0 })} /></label>
              <label className="gr-field"><span className="gr-label">Water source on site</span>
                <select className="gr-select" value={f.water_source} onChange={(e) => set({ water_source: e.target.value as FacilityInput['water_source'] })}><option value="none">None</option><option value="borehole">Borehole</option><option value="municipal">Municipal supply</option><option value="river">River / stream</option><option value="lake">Lake / reservoir</option></select></label>
              <label className="gr-field"><span className="gr-label">Roof area for PV (m²)</span><input className="gr-input gr-input-mono" type="number" min={0} value={f.roof_area_m2} onChange={(e) => set({ roof_area_m2: Number(e.target.value) || 0 })} data-testid="roof" /></label>
              <label className="gr-field"><span className="gr-label">Free land (m²)</span><input className="gr-input gr-input-mono" type="number" min={0} value={f.land_area_m2} onChange={(e) => set({ land_area_m2: Number(e.target.value) || 0 })} data-testid="land" /></label>
              <label className="gr-field"><span className="gr-label">Budget (US$) <span className="hint">optional</span></span><input className="gr-input gr-input-mono" type="number" min={0} value={f.budget_usd ?? ''} onChange={(e) => set({ budget_usd: num(e.target.value) })} placeholder="no cap" data-testid="budget" /></label>
              <label className="gr-field"><span className="gr-label">Grid reliability class <span className="hint">auto from state</span></span>
                <select className="gr-select" value={s.gridClassOverride ?? ''} onChange={(e) => s.setGridClassOverride(e.target.value || null)} data-testid="grid-class"><option value="">Auto ({s.grid?.reliability.grid_class ?? '…'} · {s.grid?.reliability.expected_supply_hours_per_day ?? '…'} h/day)</option><option value="A">A · &gt;20 h/day supply</option><option value="B">B · 14–20 h</option><option value="C">C · 10–14 h</option><option value="D">D · 6–10 h</option><option value="E">E · &lt;6 h</option></select></label>
              <label className="gr-field"><span className="gr-label">Outage event starts at</span><input className="gr-range" type="range" min={0} max={23} value={s.outageStartHour} onChange={(e) => s.setOutageStartHour(Number(e.target.value))} /><span className="gr-mono" style={{ fontSize: 12 }}>{fmt.hour(s.outageStartHour)} for {f.backup_hours} h</span></label>
            </div>
          </Card>

          </div> },
        { id: 'priority', label: 'Priority', content: <div className="gr-stack">
          <Card>
            <div className="gr-eyebrow">Priority</div>
            <div className="gr-radio-row" data-testid="priority">{PRIORITIES.map((p) => <button key={p.id} className={`gr-radio ${f.priority === p.id ? 'on' : ''}`} onClick={() => set({ priority: p.id })} title={p.hint}>{p.label}</button>)}</div>
            <div className="gr-muted" style={{ fontSize: 12, marginTop: 8 }}>{PRIORITIES.find((p) => p.id === f.priority)?.hint}</div>
          </Card>
          </div> },
      ]}
      aside={<>
          {runBtn}
          <MLCard pred={ml?.pred} meta={ml?.meta} live={mlState} testid="ml-live" title="ML pick · live" />
          <Card accent>
            <div className="gr-card-head"><div className="gr-eyebrow">Power requirement</div><Chip kind="live">live load model</Chip></div>
            {load ? (
              <>
                <p className="gr-body" style={{ color: '#fff' }} data-testid="load-statement">{load.statement}</p>
                <div className="gr-grid gr-grid-2" style={{ marginTop: 14, gap: 10 }}>
                  <Stat label="Average load" value={fmt.kw(load.avg_load_kw)} />
                  <Stat label="Peak load" value={fmt.kw(load.peak_load_kw)} />
                  <Stat label="Critical (no-break)" value={fmt.kw(load.critical_peak_kw)} accent="var(--gr-critical)" />
                  <Stat label="Protected (crit + essential)" value={fmt.kw(load.protected_peak_kw)} accent="var(--gr-sun-300)" />
                  <Stat label="Daily energy" value={fmt.kwh(load.daily_kwh)} />
                  <Stat label={`Ride-through ${f.backup_hours} h`} value={fmt.kwh(load.energy_to_ride_through_kwh)} accent="var(--gr-rescue)" />
                </div>
                <MiniLoad hourly={load.hourly} />
                <div className="gr-muted" style={{ fontSize: 11, marginTop: 8 }} data-testid="load-source">Source: {f.avg_load_kw ? 'average load you entered (meter)' : f.daily_kwh ? 'daily consumption you entered (bill or generator log)' : `${f.beds ?? '—'} beds × WHO / USAID 'Powering Health' kW-per-bed benchmark`} · critical share from the facility type · hourly shape from Nigerian hospital audits.</div>
              </>
            ) : <div className="gr-muted">Computing…</div>}
          </Card>
        </>} />
  )
}

function MiniLoad({ hourly }: { hourly: { total: number[]; critical: number[]; essential: number[] } }) {
  const max = Math.max(...hourly.total, 1)
  const w = 300, h = 80
  const pts = (arr: number[]) => arr.map((v, i) => `${(i / 23) * w},${h - (v / max) * (h - 6)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h + 14}`} width="100%" style={{ marginTop: 12 }} aria-label="24-hour load profile">
      <polyline points={pts(hourly.total)} fill="none" stroke="#B8C4D9" strokeWidth="1.5" />
      <polyline points={pts(hourly.essential.map((v, i) => v + hourly.critical[i]))} fill="none" stroke="#F0CB72" strokeWidth="1.5" />
      <polyline points={pts(hourly.critical)} fill="none" stroke="#EF6B5C" strokeWidth="1.5" />
      {[0, 6, 12, 18, 23].map((hh) => <text key={hh} x={(hh / 23) * w} y={h + 12} fontSize="9" fill="#7A8AA8" textAnchor="middle">{hh}:00</text>)}
    </svg>
  )
}
