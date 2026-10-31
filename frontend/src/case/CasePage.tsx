import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../api/client'
import type { Assessment, DataSource, EnergyData, FeederCheck, FeederRun, SolarCheck, Suggestions } from '../api/types'
import { downloadEsgReport } from '../lib/esg'
import { useSiteStore, distanceKm } from '../store/useSiteStore'
import { Screen } from '../components/layout/Screen'
import { ResultNav } from '../components/results/Shared'
import { Card, Chip, Stat, showToast } from '../components/ui/Primitives'
import { Icon } from '../components/ui/Icon'
import { fmt } from '../lib/format'
import { CaseMap, scoreColor } from './CaseMap'
import { TariffChip } from '../components/explorer/TariffChip'
import { loadLadder } from './ladder'

export const CASE_ID = 'noh-enugu'
/** GEH Brief 12 — what the problem statement asks every team for, and the tab that answers it. */
const DELIVERABLES = [
  { text: 'Critical-load list and phased design that powers surgical theatres first', tab: 'loads' },
  { text: 'Relocatable system design (ground-mounted or containerised) with a move plan for the new building', tab: 'move' },
  { text: 'Ownership and financing model (lease or energy-as-a-service) that fits federal asset rules', tab: 'money' },
  { text: 'Cost model comparing diesel, grid and solar over five and ten years', tab: 'money' },
  { text: 'Funding pitch naming specific funders and the case for each', tab: 'money' },
]
const TT = { background: '#1A3052', border: '1px solid #244065', borderRadius: 8, color: '#fff' }
const naira = (m: number | null | undefined) => (m == null ? '—' : m >= 1000 ? `₦${(m / 1000).toFixed(2)} bn` : `₦${m.toLocaleString('en-US', { maximumFractionDigits: 1 })} M`)
const CLASS_LABEL: Record<string, string> = { critical: 'Never off', essential: 'Ride-through', non_essential: 'Waits for grid' }
const CLASS_COLOR: Record<string, string> = { critical: 'var(--gr-critical)', essential: 'var(--gr-sun-300)', non_essential: 'var(--gr-fg-3)' }
const LINE_COLOR: Record<string, string> = { diesel: '#FF6B6B', grid: '#7FB2FF', solar: '#4ADE80', reported: '#F0CB72' }

/** Load the Brief 12 case (hospital, prices, reported grid hours, new site) and run the engine on it. */
export async function startEnuguCase() {
  const cd = await api.caseData(CASE_ID)
  useSiteStore.getState().loadCase(cd)
  return useSiteStore.getState().runAssessment()
}

/**
 * Enugu plan — Brief 12, "Relocatable solar for a hospital on the move". The five starter questions answered first,
 * then the evidence for each: the two sites on a grid lens, theatres-first loads, movable storage, the move, the money,
 * 5- and 10-year costs and the impact estimate (Access · Affordability · Availability).
 */
export function CasePage() {
  const s = useSiteStore()
  const nav = useNavigate()
  const c = s.caseData
  const a = s.assessment
  const rc = a?.relocatable_case
  const [tab, setTab] = useState('questions')
  const [busy, setBusy] = useState(false)
  const [sugg, setSugg] = useState<Suggestions | null>(null)
  const [solar, setSolar] = useState<SolarCheck | null>(null)
  const [feeders, setFeeders] = useState<{ today?: FeederCheck; next?: FeederCheck }>({})
  const [ed, setEd] = useState<EnergyData | null>(null)
  const [srcs, setSrcs] = useState<DataSource[] | null>(null)

  const base = a ? { lat: a.location.lat, lng: a.location.lng } : null
  useEffect(() => {
    if (!base) return
    const ctl = new AbortController()
    api.suggestSites(base.lat, base.lng, ctl.signal).then(setSugg).catch(() => null)
    api.solarCheck(base.lat, base.lng, ctl.signal).then(setSolar).catch(() => null)
    api.energydata(base.lat, base.lng, ctl.signal).then(setEd).catch(() => null)
    api.sources().then((r) => setSrcs(r.sources)).catch(() => null)
    return () => ctl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base?.lat, base?.lng])
  // grid-first: a dedicated feeder from the nearest mapped substation, at today's site and at the new one
  const protKw = a?.load.protected_peak_kw, connKw = c?.hospital?.connected_kw ?? null, nsKey = s.newSite ? `${s.newSite.lat},${s.newSite.lng}` : ''
  useEffect(() => {
    if (!base || !protKw) return
    const ctl = new AbortController()
    api.feeder(base.lat, base.lng, protKw, connKw, ctl.signal).then((f) => setFeeders((x) => ({ ...x, today: f }))).catch(() => null)
    if (s.newSite) api.feeder(s.newSite.lat, s.newSite.lng, protKw, connKw, ctl.signal).then((f) => setFeeders((x) => ({ ...x, next: f }))).catch(() => null)
    return () => ctl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base?.lat, base?.lng, protKw, nsKey])

  const start = async () => {
    setBusy(true)
    try { if (!(await startEnuguCase())) showToast('The plan could not run — is the backend running?') } catch { showToast('Could not load the Enugu case — is the backend running?') } finally { setBusy(false) }
  }
  const rerun = async () => { setBusy(true); try { await s.runAssessment() } finally { setBusy(false) } }

  if (!a || !rc || !a.inputs.options.relocation) {
    return (
      <div className="gr-page"><div className="gr-empty" data-testid="case-empty">
        <Icon name="hospital" size={32} style={{ color: 'var(--gr-rescue)' }} />
        <h2 className="gr-h3" style={{ marginTop: 12 }}>Relocatable solar for a hospital on the move</h2>
        <p className="gr-body" style={{ maxWidth: 600, margin: '8px auto 20px' }}>The flow: in the Explorer pick the hospital's site today, switch on <b>Hospital is moving</b>, place the new building site (the grid lens suggests areas), then run the plan. It sizes a theatres-first, relocatable system for that site, prices it with local diesel and grid tariffs, and answers the brief's five questions.</p>
        <div className="gr-row" style={{ justifyContent: 'center', gap: 10 }}>
          <button className="gr-btn gr-btn-rescue gr-btn-lg" onClick={() => { s.setMoving(true); nav('/explorer') }} data-testid="case-go-explorer"><Icon name="globe" size={18} /> Pick the sites in the Explorer</button>
          <button className="gr-btn gr-btn-ghost gr-btn-lg" onClick={c ? rerun : start} disabled={busy || s.assessing} data-testid="case-start">
            {busy || s.assessing ? <><Icon name="refresh" className="gr-spin" /> Running…</> : <><Icon name="hospital" size={18} /> {c ? 'Run the worked example' : 'Worked example · National Orthopaedic Hospital, Enugu'}</>}
          </button>
        </div>
      </div></div>
    )
  }

  const fx = a.recommended.cost.assumptions.usd_to_ngn as number
  // the hospital in view: the worked example's facts, or whatever the user pinned and described
  const atCase = !!c && a.inputs.facility.name === c.facility.name
  const h = atCase ? c.hospital : { name: a.inputs.facility.name || a.inputs.facility_label, short: a.inputs.facility.name || 'Hospital', address: `${a.location.name}${a.location.state ? `, ${a.location.state}` : ''}, ${a.location.country}`, lat: a.location.lat, lng: a.location.lng, beds: a.load.beds, connected_kw: null as number | null, grid_hours_per_day: a.site.grid.supply_hours, move_in_years: a.inputs.options.relocation.move_year }
  const two = rc.two_sites
  const newSite = s.newSite
  const moved = newSite && two && distanceKm(newSite, two.new) > 0.05
  const goto = (t: string) => setTab(t)

  // ── 1. the five starter questions ──
  const questions = (
    <div className="gr-qa-grid" data-testid="starter-answers">
      {rc.starter_answers.map((q: any, i: number) => (
        <Card key={q.id} className="gr-qa" data-testid={`answer-${q.id}`}>
          <div className="gr-qa-head"><span className="gr-qa-num">{i + 1}</span><b>{q.question}</b></div>
          <p className="gr-qa-text">{q.answer}</p>
          <div className="gr-facts">{q.facts.map((f: any) => <span key={f.label}><small>{f.label}</small><b>{f.value}</b></span>)}</div>
          <button className="gr-btn-pill" onClick={() => goto(q.tab)}>See the evidence <Icon name="arrow" size={12} /></button>
        </Card>
      ))}
      <Card className="gr-qa gr-qa-brief">
        <div className="gr-eyebrow">The brief asks for</div>
        <ul className="gr-checks">{DELIVERABLES.map((d) => <li key={d.text} onClick={() => goto(d.tab)}><Icon name="check" size={13} />{d.text}</li>)}</ul>
        <div className="gr-muted" style={{ fontSize: 12, marginTop: 8 }}>An asset-mobility and financing problem as much as a power problem: solar and storage can run the theatres; the hard part is a system the hospital can move, and a funder willing to pay for it.</div>
      </Card>
    </div>
  )

  // ── 2. two sites on the grid lens ──
  const sites = (
    <div className="gr-grid gr-grid-sidebar" style={{ height: '100%' }}>
      <div className="gr-fit" style={{ gridTemplateRows: '1fr auto' }}>
        {/* mounted only while its tab is open: Leaflet measures its box on mount, and hidden tabs have none */}
        {tab === 'sites' ? <CaseMap today={{ lat: h.lat, lng: h.lng, name: h.name }} newSite={newSite} candidates={sugg?.candidates ?? []} onPick={(p) => { s.setNewSite(p); showToast('New building site moved — re-run to update the plan') }} /> : <div />}
        <div className="gr-muted" style={{ fontSize: 12 }}>Grid lens: every dot is an area within 12 km scored on grid access (substations and lines from OpenStreetMap) and move distance — green is strong. Click a dot or anywhere on the map to place the new building. {sugg?.note}</div>
      </div>
      <div className="gr-stack" style={{ gap: 10, overflow: 'auto' }}>
        <div className="gr-grid gr-grid-2" style={{ gap: 10 }} data-testid="two-sites">
          <Stat label="Today" value={`${two?.today.supply_hours ?? a.site.grid.supply_hours} h grid`} sub={`Class ${a.site.grid.class} · ${a.site.solar.annual_psh} sun-hours`} accent="var(--gr-sun-trace)" />
          <Stat label="New building" value={two ? `${two.distance_km} km` : '—'} sub={two ? `Class ${two.new.grid_class} · ${two.new.psh} sun-hours` : 'not placed'} accent="var(--gr-rescue)" />
        </div>
        {two && <div className="gr-muted" style={{ fontSize: 11.5 }}>{two.new.note}</div>}
        <div className="gr-stack" style={{ gap: 6 }} data-testid="site-prices">
          <TariffChip lat={h.lat} lng={h.lng} label="Grid price · today's site" testid="price-today" />
          {newSite && <TariffChip lat={newSite.lat} lng={newSite.lng} label="Grid price · new site" testid="price-new" />}
        </div>
        {moved && <button className="gr-btn gr-btn-rescue" onClick={rerun} disabled={busy} data-testid="rerun-new-site">{busy ? <Icon name="refresh" className="gr-spin" /> : <Icon name="refresh" />} Re-run the plan with this site</button>}
        <Card className="gr-card-tight">
          <div className="gr-card-head"><div className="gr-eyebrow">Where should the new building go?</div><Chip kind="live">grid lens</Chip></div>
          <ul className="gr-layer-list gr-suggest" data-testid="site-suggestions">
            {(sugg?.top ?? []).map((x) => (
              <li key={`${x.lat},${x.lng}`} onClick={() => { s.setNewSite({ lat: x.lat, lng: x.lng, label: `Suggested area #${x.rank} · ${x.direction}, ${x.distance_km} km` }); showToast(`Area #${x.rank} chosen — re-run to update the plan`) }}>
                <b><span className="gr-dot" style={{ background: scoreColor(x.score), marginRight: 6 }} />#{x.rank} · {x.direction}, {x.distance_km} km · {x.score}/100</b><small>{x.reasons.slice(0, 2).join(' · ')}</small>
              </li>))}
            {!sugg && <li><span className="gr-muted">Scanning the grid around the hospital…</span></li>}
          </ul>
          {sugg?.today && <div className="gr-muted" style={{ fontSize: 11.5, marginTop: 6 }}>Today's site scores {sugg.today.score}/100 for grid access — the wires are close; the 6 hours are a supply problem on the feeder, not a lack of network.</div>}
        </Card>
        <Card className="gr-card-tight">
          <div className="gr-eyebrow">Sun at this site · four sources</div>
          <table className="gr-table gr-table-tight" data-testid="solar-check"><tbody>
            {(solar?.rows ?? []).map((r) => <tr key={r.id}><td>{r.source}</td><td className="num">{r.value ?? '—'} <span className="gr-muted">{r.value != null ? r.unit : ''}</span></td><td className="gr-muted" style={{ fontSize: 11 }}>{r.note}</td></tr>)}
            {!solar && <tr><td className="gr-muted">Checking NASA POWER, PVGIS, NLR PVWatts and Global Solar Atlas…</td></tr>}
          </tbody></table>
          {solar?.yield_spread_pct != null && <div className="gr-muted" style={{ fontSize: 11.5, marginTop: 4 }}>PVGIS, PVWatts and Global Solar Atlas agree within {solar.yield_spread_pct} %.</div>}
        </Card>
        <Card className="gr-card-tight" data-testid="feeder-check">
          <div className="gr-card-head"><div className="gr-eyebrow">Grid-first · a dedicated feeder from the nearest substation</div><Chip kind="live">load flow</Chip></div>
          <table className="gr-table gr-table-tight"><thead><tr><th>Site · nearest substation</th><th className="num">Load</th><th className="num">11 kV</th><th className="num">33 kV</th></tr></thead><tbody>
            {([['Today', feeders.today], ['New site', feeders.next]] as [string, FeederCheck | undefined][]).filter(([, f]) => f?.substation).flatMap(([name, f]) => {
              const loads = [...new Set(f!.checks.map((x) => x.load))]
              return loads.map((ld) => {
                const c11 = f!.checks.find((x) => x.kv === 11 && x.load === ld), c33 = f!.checks.find((x) => x.kv === 33 && x.load === ld)
                const cell = (x?: FeederRun) => (x ? <span style={{ color: x.ok ? 'var(--gr-rescue)' : 'var(--gr-danger)' }}>{x.drop_pct ?? '—'} % · {x.loading_pct ?? '—'} %</span> : '—')
                const sub = f!.substation!
                return <tr key={name + ld}><td style={{ color: '#fff' }}>{name}<div className="gr-muted" style={{ fontSize: 11 }}>{sub.voltage_kv ? `${sub.voltage_kv} kV · ` : ''}{sub.distance_km} km {sub.bearing} · {ld}</div></td><td className="num">{fmt.num(c11?.kw)} kW</td><td className="num">{cell(c11)}</td><td className="num">{cell(c33)}</td></tr>
              })
            })}
            {!feeders.today && <tr><td className="gr-muted" colSpan={4}>Running the feeder load flow…</td></tr>}
          </tbody></table>
          {feeders.today && <div className="gr-muted" style={{ fontSize: 11, marginTop: 4 }}>Voltage drop · conductor loading. {feeders.today.checks[0]?.solver}; {feeders.today.checks[0]?.limits}. {feeders.today.note}</div>}
          <a className="gr-btn" style={{ marginTop: 8 }} href={api.geojsonUrl(h.lat, h.lng, h.name)} download="gridrescue_grid.geojson" data-testid="qgis-geojson">Mapped grid for QGIS (GeoJSON)</a>
        </Card>
        <Card className="gr-card-tight" data-testid="energydata">
          <div className="gr-card-head"><div className="gr-eyebrow">Open energy data for this country</div><Chip kind="live">ENERGYDATA.INFO</Chip></div>
          <ul className="gr-layer-list gr-suggest">
            {(ed?.datasets ?? []).slice(0, 5).map((d) => <li key={d.url}><a href={d.url} target="_blank" rel="noreferrer" style={{ color: '#fff' }}><b>{d.title}</b></a><small>{d.publisher ?? 'World Bank'}{d.formats.length ? ` · ${d.formats.join(', ')}` : ''}</small></li>)}
            {!ed && <li><span className="gr-muted">Searching the World Bank's ENERGYDATA.INFO…</span></li>}
            {ed && !ed.datasets.length && <li><span className="gr-muted">{ed.error ? `ENERGYDATA.INFO ${ed.error}` : 'No datasets listed for this country.'}</span></li>}
          </ul>
          {ed && ed.count > 5 && <div className="gr-muted" style={{ fontSize: 11 }}>{ed.count} open datasets in all for {ed.country}.</div>}
        </Card>
      </div>
    </div>
  )

  // ── 3. theatres first: the load list and the phased build ──
  const loads = (
    <div className="gr-grid gr-grid-sidebar" style={{ height: '100%' }}>
      <Card style={{ overflow: 'auto' }}>
        <div className="gr-card-head"><div className="gr-eyebrow">Critical-load list · {h.short}</div><Chip kind="model">planning split · replace with the load audit</Chip></div>
        <table className="gr-table gr-table-tight" data-testid="load-list">
          <thead><tr><th>Load</th><th className="num">kW</th><th>Class</th><th>Backed by</th><th>Phase</th></tr></thead>
          <tbody>{rc.critical_loads.map((l: any) => (
            <tr key={l.id} className={l.id === 'theatres' ? 'rec' : ''}><td style={{ color: '#fff' }}>{l.name}<div className="gr-muted" style={{ fontSize: 11 }}>{l.what}</div></td><td className="num">{fmt.num(l.kw)}</td>
              <td><span style={{ color: CLASS_COLOR[l.class], fontWeight: 700, fontSize: 12 }}>{CLASS_LABEL[l.class]}</span></td><td className="gr-muted">{l.backed_by}</td><td>{l.phase ?? '—'}</td></tr>))}</tbody>
        </table>
      </Card>
      <div className="gr-stack" style={{ gap: 10, overflow: 'auto' }} data-testid="phases">
        {rc.phases.map((p: any) => (
          <Card key={p.id} className="gr-card-tight gr-phase">
            <div className="gr-card-head"><b style={{ color: '#fff' }}>{p.name}</b><Chip>{p.when}</Chip></div>
            <div className="gr-muted" style={{ fontSize: 12 }}>{p.loads}</div>
            <div className="gr-grid gr-grid-3" style={{ gap: 8, marginTop: 8 }}>
              <Stat label="Protects" value={`${fmt.num(p.protects_kw)} kW`} />
              <Stat label="Storage · solar" value={`${fmt.num(p.storage_kwh)} kWh`} sub={`${fmt.num(p.pv_kwp)} kWp · ${p.containers} containers`} />
              <Stat label={p.id === 3 ? 'Move cost' : 'Investment'} value={naira(p.capex_usd * fx / 1e6)} sub={fmt.usdShort(p.capex_usd)} accent="var(--gr-sun-300)" />
            </div>
            <div style={{ fontSize: 12, color: 'var(--gr-rescue)', marginTop: 6 }}>{p.note}</div>
          </Card>))}
      </div>
    </div>
  )

  // ── 4. movable storage: add loads up to the units' limit ──
  const storage = <MovableStorage rc={rc} />

  // ── 5. the move ──
  const mv = rc.move_plan, dz = rc.relocatable_design
  const move = (
    <div className="gr-grid gr-grid-2" style={{ height: '100%' }}>
      <div className="gr-stack" style={{ gap: 10, overflow: 'auto' }}>
        <div className="gr-grid gr-grid-3" style={{ gap: 10 }} data-testid="move-kpis">
          <Stat label="Reused at new building" value={`${mv.reuse_pct} %`} sub="of the investment" accent="var(--gr-rescue)" />
          <Stat label="Move cost" value={naira(mv.cost_ngn_m)} sub={`${mv.cost_pct} % · once, year ${mv.year}`} accent="var(--gr-sun-300)" />
          <Stat label="Rooftop would strand" value={naira(mv.stranded_if_rooftop_ngn_m)} sub="solar fixed to today's roofs" accent="var(--gr-danger)" />
        </div>
        <Card className="gr-card-tight">
          <div className="gr-eyebrow">Relocatable design — nothing fixed to today's buildings</div>
          <table className="gr-table gr-table-tight" data-testid="design-items"><tbody>
            {dz.items.map((it: any) => <tr key={it.part}><td style={{ color: '#fff', width: 130 }}>{it.part}</td><td>{it.spec}<div className="gr-muted" style={{ fontSize: 11 }}>{it.moves}</div></td></tr>)}
          </tbody></table>
        </Card>
      </div>
      <div className="gr-stack" style={{ gap: 10, overflow: 'auto' }}>
        <Card className="gr-card-tight">
          <div className="gr-eyebrow">Move plan · {mv.duration}</div>
          <ol className="gr-vsteps" data-testid="move-steps">{mv.steps.map((st: any) => <li key={st.when}><b>{st.when}</b><span>{st.what}</span></li>)}</ol>
        </Card>
        <Card className="gr-card-tight">
          <div className="gr-eyebrow">What the move costs</div>
          <table className="gr-table gr-table-tight"><tbody>
            {mv.cost_lines.map((l: any) => <tr key={l.item}><td>{l.item}</td><td className="num">{fmt.usd(l.usd)}</td></tr>)}
            <tr className="rec"><td><b>Total, once in year {mv.year}</b></td><td className="num"><b>{fmt.usd(mv.cost_usd)}</b></td></tr>
          </tbody></table>
        </Card>
      </div>
    </div>
  )

  // ── 6. ownership, the fee, and the funders ──
  const own = rc.ownership
  const money = (
    <div className="gr-grid gr-grid-2">
      <div className="gr-stack" style={{ gap: 10, overflow: 'auto' }}>
        <div className="gr-grid gr-grid-2" style={{ gap: 10 }}>
          <Stat label="Service fee" value={naira(own.fee_ngn_m_per_month)} sub={`a month · ₦${fmt.num(own.fee_ngn_per_kwh)}/kWh vs diesel ₦${fmt.num(own.diesel_ngn_per_kwh)}/kWh`} accent="var(--gr-rescue)" />
          <Stat label="Diesel today (model)" value={naira(rc.cost_model.diesel_ngn_m_per_month)} sub="a month, protected load" accent="var(--gr-danger)" />
        </div>
        <Card className="gr-card-tight">
          <div className="gr-eyebrow">Who owns the system?</div>
          <table className="gr-table gr-table-tight" data-testid="ownership"><thead><tr><th>Model</th><th>Owner</th><th>Upfront</th><th>Federal asset rules</th></tr></thead>
            <tbody>{own.options.map((o: any) => (
              <tr key={o.id} className={o.id === own.recommended ? 'rec' : ''} title={o.verdict}><td style={{ color: '#fff' }}>{o.label}<div className="gr-muted" style={{ fontSize: 11 }}>{o.verdict}</div></td><td>{o.owner}</td>
                <td>{o.upfront_capital ? naira(o.upfront_ngn_m) : '₦0'}</td><td style={{ color: o.fits_asset_rules ? 'var(--gr-rescue)' : 'var(--gr-danger)', fontWeight: 700 }}>{o.fits_asset_rules ? '✓ fits' : '✕ breaks'}</td></tr>))}</tbody></table>
          <ul className="gr-checks" style={{ marginTop: 8 }}>{own.contract_terms.map((t: string) => <li key={t}><Icon name="check" size={13} />{t}</li>)}</ul>
          <div className="gr-muted" style={{ fontSize: 11 }}>{own.financing}.</div>
        </Card>
        <DieselBill />
      </div>
      <div className="gr-stack" style={{ gap: 10, overflow: 'auto' }} data-testid="funders">
        {rc.funders.map((f: any) => (
          <Card key={f.id} className="gr-card-tight">
            <b style={{ color: '#fff', fontSize: 14 }}>{f.name}</b>
            <div className="gr-muted" style={{ fontSize: 12, margin: '4px 0' }}>Backed: {f.backed}</div>
            <div style={{ fontSize: 13, color: 'var(--gr-fg-2)' }}><b style={{ color: 'var(--gr-rescue)' }}>The case: </b>{f.case}</div>
            <div className="gr-facts" style={{ marginTop: 6 }}>{f.bring.map((b: string) => <span key={b}><small>bring</small><b>{b}</b></span>)}</div>
          </Card>))}
      </div>
    </div>
  )

  // ── 7. five and ten years ──
  const cm = rc.cost_model
  const series = cm.series.map((p: any) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, k === 'year' ? v : Math.round((v as number) * fx / 1e6)])))
  const years = (
    <div className="gr-stack" style={{ gap: 10 }}>
      <div className="gr-grid gr-grid-2" style={{ gap: 10 }} data-testid="years-kpis">
        <Stat label="5 years · 10 years saved vs diesel" value={`${naira(cm.at_5.saving_vs_diesel_ngn_m)} · ${naira(cm.at_10.saving_vs_diesel_ngn_m)}`} sub={`diesel ${naira(cm.at_10.diesel_ngn_m)} → solar ${naira(cm.at_10.solar_ngn_m)} over 10 years`} accent="var(--gr-rescue)" />
        <Stat label="Diesel savings alone repay" value={cm.payback_diesel_savings_years ? `${cm.payback_diesel_savings_years} yr` : '> 15 yr'} sub={`saves money when today's diesel bill is above ${naira(cm.breakeven_diesel_ngn_m_per_month)} a month`} />
      </div>
      <Card style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="gr-eyebrow">Cumulative cost to the hospital · ₦ million · diesel vs grid vs solar</div>
        <div style={{ height: 240 }} data-testid="years-chart">
          <ResponsiveContainer>
            <LineChart data={series} margin={{ left: 8, right: 16, top: 8 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
              <XAxis dataKey="year" tick={{ fill: '#7A8AA8', fontSize: 11 }} tickFormatter={(v) => `yr ${v}`} />
              <YAxis tick={{ fill: '#7A8AA8', fontSize: 11 }} tickFormatter={(v) => (v >= 1000 ? `₦${(v / 1000).toFixed(0)} bn` : `₦${v} M`)} width={70} />
              <Tooltip formatter={(v: any) => naira(Number(v))} labelFormatter={(y) => `Year ${y}`} contentStyle={TT} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {cm.lines.map((l: any) => <Line key={l.key} isAnimationActive={false} type="monotone" dataKey={l.key} name={l.label} stroke={LINE_COLOR[l.key]} strokeWidth={l.key === 'solar' ? 3.5 : 2.5} strokeDasharray={l.key === 'grid' ? '6 6' : undefined} dot={false} />)}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="gr-muted" style={{ fontSize: 11 }}>{cm.basis}</div>
      </Card>
    </div>
  )

  // ── 7b. energy type: ML pick vs the engine, the cost difference of each family, why a UPS stays ──
  const et = rc.energy_type, ns = rc.no_sun
  const energy = (
    <div className="gr-grid gr-grid-sidebar" style={{ height: '100%' }}>
      <Card style={{ overflow: 'auto' }}>
        <div className="gr-card-head"><div className="gr-eyebrow">Energy type for this site · cost difference against the plan</div><Chip kind="live">hourly simulation</Chip></div>
        <table className="gr-table gr-table-tight" data-testid="energy-types"><thead><tr><th>Energy type</th><th>UPS</th><th className="num">Equipment</th><th className="num">vs plan</th><th className="num">10-yr cost</th><th className="num">Theatres kept</th></tr></thead>
          <tbody>{(et?.options ?? []).map((o: any) => <tr key={o.family} className={o.recommended ? 'rec' : ''}><td style={{ color: '#fff' }}>{o.label}</td><td>{o.has_ups ? '✓' : '—'}</td><td className="num">{naira(o.capex_ngn_m)}</td><td className="num" style={{ color: o.recommended ? 'var(--gr-fg-3)' : o.capex_diff_ngn_m > 0 ? 'var(--gr-danger)' : 'var(--gr-rescue)' }}>{o.recommended ? 'the plan' : `${o.capex_diff_ngn_m > 0 ? '+' : ''}${naira(o.capex_diff_ngn_m)}`}</td><td className="num">{naira(o.net_10y_ngn_m)}</td><td className="num">{o.critical_served_pct} %</td></tr>)}</tbody></table>
        <div className="gr-muted" style={{ fontSize: 11.5, marginTop: 8 }}>Every family is simulated hour by hour against this site's sun, grid hours, load and land, then ranked; the first row is the plan, the others are the alternatives. Costs include the UPS where shown.{et?.not_viable ? ` ${et.not_viable} other option${et.not_viable > 1 ? 's are' : ' is'} not viable at this site and not listed.` : ''}</div>
      </Card>
      <div className="gr-stack" style={{ gap: 12, overflow: 'auto' }}>
        <Card className="gr-card-tight" data-testid="why-ups"><div className="gr-eyebrow">Why still a UPS when we have solar and batteries?</div><p className="gr-body" style={{ margin: 0, fontSize: 13 }}>{et?.why_ups}</p></Card>
        {rc.adapt && <Card className="gr-card-tight" data-testid="adapt">
          <div className="gr-eyebrow">If part of the plan can't be used · it adapts</div>
          {rc.adapt.rungs.map((r: any) => <div key={r.if} style={{ borderLeft: '3px solid var(--gr-rescue)', padding: '4px 0 4px 10px', margin: '8px 0' }}>
            <div style={{ color: '#fff', fontSize: 13 }}><b>{r.if}</b> → {r.option}</div>
            <div className="gr-muted" style={{ fontSize: 12 }}>{r.then}</div>
            <div style={{ fontSize: 12 }}>{naira(r.capex_ngn_m)} · theatres kept {r.critical_served_pct} %{r.fuel_l_day ? ` · ${fmt.num(r.fuel_l_day)} L diesel on the design day` : ''}</div>
            {r.note && <div className="gr-muted" style={{ fontSize: 11 }}>{r.note}</div>}
          </div>)}
          <div className="gr-eyebrow" style={{ marginTop: 6 }}>Grid-first, when storage has to wait</div>
          <ol className="gr-body" style={{ fontSize: 12, margin: '4px 0 0 16px', padding: 0 }}>{rc.adapt.grid_first.map((s: string) => <li key={s}>{s}</li>)}</ol>
        </Card>}
      </div>
    </div>
  )
  const nosun = (
    <div className="gr-grid gr-grid-2" style={{ height: '100%' }}>
      <Card data-testid="no-sun">
        <div className="gr-eyebrow">When there is no sun · charge at night, use in the early morning</div>
        <p className="gr-body" style={{ fontSize: 14, color: '#fff' }}>{ns?.text}</p>
        <div className="gr-grid gr-grid-2" style={{ gap: 10, marginTop: 8 }}>
          <Stat label={`Charged from the grid · ${ns?.night_hours}`} value={`${fmt.num(ns?.night_charge_kwh)} kWh`} sub={`₦${fmt.num(ns?.cost_ngn)} at ${ns?.tariff_label ?? 'the local tariff'} · ${ns?.night_cheaper ? 'night is cheaper here' : 'same price at night'}`} accent="var(--gr-water-light)" />
          <Stat label={`Used · ${ns?.morning_hours}`} value={`${fmt.num(ns?.morning_use_kwh)} kWh`} sub="the first theatre list, before the sun" accent="var(--gr-sun-300)" />
        </div>
      </Card>
      <Card className="gr-card-tight">
        <div className="gr-eyebrow">Outage stress tests · the engine's AI agent</div>
        <table className="gr-table gr-table-tight"><tbody>{(a.agent?.stress_tests ?? []).map((x: any) => <tr key={x.scenario}><td style={{ color: '#fff' }}>{x.scenario}</td><td className="num">{x.critical_served_pct} %</td><td><Chip kind={x.status === 'pass' ? 'High' : x.status === 'warn' ? 'Medium' : 'Low'}>{x.status}</Chip></td></tr>)}</tbody></table>
        <div className="gr-muted" style={{ fontSize: 11.5, marginTop: 6 }}>The grid is on about {ns?.grid_hours} h a day here, so night charging only happens when the feeder is live; the generator stays as the last tier for a long cloudy outage.</div>
      </Card>
    </div>
  )

  // ── 7c. every open data source and tool behind the numbers (the organisers' list), with its status ──
  const sourcesTab = (
    <Card style={{ overflow: 'auto' }} data-testid="data-sources">
      <div className="gr-card-head"><div className="gr-eyebrow">Open data and tools behind every number</div><Chip kind="live">{(srcs ?? []).filter((x) => x.status === 'live').length} live</Chip></div>
      <table className="gr-table gr-table-tight"><thead><tr><th>Group</th><th>Source</th><th>What GridRescue uses it for</th><th>Status</th><th>Route</th></tr></thead>
        <tbody>{(srcs ?? []).map((x) => <tr key={x.name}><td className="gr-muted">{x.group}</td><td style={{ color: '#fff' }}>{x.name}</td><td>{x.use}</td><td><Chip kind={x.status === 'live' ? 'High' : x.status === 'add key' ? 'Medium' : 'model'}>{x.status}</Chip></td><td className="gr-muted" style={{ fontSize: 11 }}>{x.route ?? '—'}</td></tr>)}</tbody></table>
      <div className="gr-muted" style={{ fontSize: 11.5, marginTop: 8 }}>OpenEI and the U.S. EIA need a free registered key (OPENEI_API_KEY, EIA_API_KEY); Global Wind Atlas publishes country maps, so point wind comes from ERA5.</div>
    </Card>
  )

  // ── 8. impact estimate, Access · Affordability · Availability ──
  const impact = (
    <div className="gr-stack" style={{ gap: 12 }}>
      <div className="gr-grid gr-grid-3" style={{ gap: 12 }} data-testid="three-as-case">
        {(['access', 'affordability', 'availability'] as const).map((k) => (
          <Card key={k} className={`gr-card-tight gr-aaa-${k}`}>
            <div className="gr-eyebrow" style={{ color: k === 'affordability' ? 'var(--gr-sun-300)' : k === 'access' ? 'var(--gr-rescue)' : 'var(--gr-wind-light)' }}>{k}</div>
            <b style={{ color: '#fff', fontSize: 15 }}>{rc.three_as[k].headline}</b>
            <ul className="gr-checks" style={{ marginTop: 6 }}>{rc.three_as[k].facts.map((f: string) => <li key={f}><Icon name="check" size={13} />{f}</li>)}</ul>
          </Card>))}
      </div>
      <Card className="gr-card-tight">
        <div className="gr-eyebrow">One-page impact estimate · the brief's success metrics</div>
        <table className="gr-table gr-table-tight" data-testid="metrics"><tbody>
          {rc.metrics.map((m: any) => <tr key={m.id}><td style={{ width: 150 }}><b style={{ color: '#fff' }}>{m.title}</b> <span className="gr-muted">{m.weight} %</span><div className="gr-muted" style={{ fontSize: 11 }}>{m.brief}</div></td><td>{m.ours.map((x: string) => <div key={x}>• {x}</div>)}</td></tr>)}
        </tbody></table>
      </Card>
      <Card className="gr-card-tight" data-testid="esg">
        <div className="gr-card-head"><div className="gr-eyebrow">ESG report lines · carbon</div><Chip kind="High">{fmt.num(rc.esg?.co2_t_per_year)} t CO₂ a year</Chip></div>
        <ul className="gr-checks">{(rc.esg?.report_lines ?? []).map((l: string) => <li key={l}><Icon name="check" size={13} />{l}</li>)}</ul>
        <CarbonValue esg={rc.esg} assessment={a} />
      </Card>
      <Card className="gr-card-tight">
        <div className="gr-eyebrow">Where the inputs come from</div>
        <table className="gr-table gr-table-tight" data-testid="input-sources"><tbody>
          {atCase && c.inputs_to_confirm.map((x) => <tr key={x.label}><td>{x.label}</td><td style={{ color: '#fff' }}>{x.value}</td><td className="gr-muted" style={{ fontSize: 11 }}>{x.why}</td></tr>)}
          <tr><td>Diesel price</td><td style={{ color: '#fff' }}>₦{fmt.num(a.recommended.cost.assumptions.diesel_price_usd_per_l * fx)} / L</td><td className="gr-muted" style={{ fontSize: 11 }}>{atCase ? 'NBS national average (brief ref 4)' : 'Facility page · default NBS national average'}</td></tr>
          <tr><td>Grid tariff</td><td style={{ color: '#fff' }}>₦{fmt.num(a.recommended.cost.assumptions.grid_tariff_usd_per_kwh * fx)} / kWh</td><td className="gr-muted" style={{ fontSize: 11 }}>{atCase ? 'EERC Band A for Enugu (brief ref 5)' : 'Facility page · default NERC Band A'}</td></tr>
          <tr><td>Grid hours</td><td style={{ color: '#fff' }}>{a.site.grid.supply_hours} h a day</td><td className="gr-muted" style={{ fontSize: 11 }}>{a.grid.reliability.basis}</td></tr>
          <tr><td>Sun</td><td style={{ color: '#fff' }}>{a.site.solar.annual_psh} kWh/m² a day</td><td className="gr-muted" style={{ fontSize: 11 }}>{a.climate.sources?.join(' · ')}</td></tr>
          <tr><td>Daily consumption</td><td style={{ color: '#fff' }}>{fmt.num(a.load.daily_kwh)} kWh</td><td className="gr-muted" style={{ fontSize: 11 }}>{a.inputs.facility.daily_kwh ? 'entered on the Facility page / dialled by hand' : `estimated from ${a.load.beds} beds (WHO / USAID Powering Health benchmarks)`}</td></tr>
          <tr><td>Equipment costs</td><td style={{ color: '#fff' }}>IRENA · BNEF · NREL ATB</td><td className="gr-muted" style={{ fontSize: 11 }}>with Nigeria import / EPC premiums · ±30 %</td></tr>
        </tbody></table>
      </Card>
    </div>
  )

  return (
    <Screen testid="case-page" eyebrow="GEH Brief 12 · Clean Energy Solutions · relocatable solar for a hospital on the move" title={`${h.name} — relocation plan`}
      sub={<>{h.address} · {h.beds} beds{h.connected_kw ? ` · ${h.connected_kw.toLocaleString()} kW connected` : ''} · grid ≈ {h.grid_hours_per_day} h a day · moves in {h.move_in_years} years{atCase ? '' : ' · change the hospital on the Facility page'}</>}
      actions={<><button className="gr-btn gr-btn-ghost" onClick={() => nav('/simulation')} data-testid="case-to-sim"><Icon name="cube" /> See it in 3D</button><ResultNav /></>}
      tab={tab} onTab={setTab}
      tabs={[
        { id: 'questions', label: '5 questions', content: questions },
        { id: 'sites', label: 'Two sites', content: sites },
        { id: 'loads', label: 'Theatres first', content: loads },
        { id: 'storage', label: 'Movable storage', content: storage },
        { id: 'energy', label: 'Energy type', content: energy },
        { id: 'nosun', label: 'No sun', content: nosun },
        { id: 'move', label: 'Move plan', content: move },
        { id: 'money', label: 'Money', content: <div className="gr-stack" style={{ gap: 12 }}>{money}{years}</div> },
        { id: 'impact', label: 'Impact', content: impact },
        { id: 'sources', label: 'Data sources', content: sourcesTab },
      ]} />
  )
}

/** Movable storage: pick the unit and how many, and see which loads fit — theatres first, up to the limit. */
function MovableStorage({ rc }: { rc: any }) {
  const ms = rc.mobile_storage
  const [unitId, setUnitId] = useState<string>(ms.default_unit)
  const [count, setCount] = useState<number>(Math.max(1, ms.default_count))
  const [hours, setHours] = useState<number>(Math.round(ms.default_hours))
  const unit = ms.units.find((u: any) => u.id === unitId) ?? ms.units[0]
  const ladder = useMemo(() => loadLadder(rc.critical_loads, unit.kwh * count, unit.kw * count, hours, ms.load_factor), [rc, unit, count, hours, ms.load_factor])
  const maxKw = Math.max(...rc.critical_loads.map((l: any) => l.kw), 1)
  return (
    <div className="gr-grid gr-grid-sidebar" style={{ height: '100%' }}>
      <Card style={{ overflow: 'auto' }}>
        <div className="gr-card-head"><div className="gr-eyebrow">Which loads can the movable storage carry?</div>
          <Chip kind={ladder.carried === 0 ? 'Not suitable' : ladder.limitedBy ? 'Medium' : 'High'}>{ladder.carried}/{ladder.rows.length} loads · {ladder.limitedBy ? `limited by ${ladder.limitedBy}` : 'all carried'}</Chip></div>
        {ladder.carried === 0 && <div className="gr-muted" style={{ fontSize: 12.5, marginBottom: 8, color: 'var(--gr-danger)' }} data-testid="ladder-none">Not even the theatres fit: they need {fmt.num(ladder.rows[0]?.kwh)} kWh for {hours} h, the units hold {fmt.num(ladder.kwhLimit)} kWh usable. Add units or carry fewer hours.</div>}
        <div className="gr-ladder" data-testid="ladder">
          {ladder.rows.map((r) => (
            <div key={r.id} className={`gr-ladder-row ${r.carried ? 'on' : ''}`} data-testid={`ladder-${r.id}`}>
              <span className="gr-ladder-name">{r.name}</span>
              <span className="gr-ladder-bar"><i style={{ width: `${Math.max(3, (r.kw / maxKw) * 100)}%` }} /></span>
              <span className="gr-ladder-num">{fmt.num(r.kw)} kW · {fmt.num(r.kwh)} kWh</span>
              <span className="gr-ladder-tag">{r.carried ? '✓ carried' : 'grid / diesel'}</span>
            </div>))}
        </div>
      </Card>
      <div className="gr-stack" style={{ gap: 10 }}>
        <Card className="gr-card-tight">
          <div className="gr-eyebrow">Battery units</div>
          <div className="gr-radio-row" data-testid="unit-type">{ms.units.map((u: any) => <button key={u.id} className={`gr-radio ${unitId === u.id ? 'on' : ''}`} onClick={() => setUnitId(u.id)} data-testid={`unit-${u.id}`}>{u.label}</button>)}</div>
          <div className="gr-muted" style={{ fontSize: 12, margin: '6px 0 10px' }}>{fmt.num(unit.kwh)} kWh · {fmt.num(unit.kw)} kW each — {unit.moves}</div>
          <div className="gr-row" style={{ gap: 8, alignItems: 'center' }}>
            <button className="gr-btn-pill" onClick={() => setCount((n) => Math.max(1, n - 1))} data-testid="units-minus">−</button>
            <b style={{ color: '#fff', fontSize: 22, minWidth: 40, textAlign: 'center' }} data-testid="units-count">{count}</b>
            <button className="gr-btn-pill" onClick={() => setCount((n) => Math.min(40, n + 1))} data-testid="units-plus">+</button>
            <span className="gr-muted" style={{ fontSize: 12 }}>units</span>
          </div>
          <label className="gr-field" style={{ marginTop: 10 }}><span className="gr-label">Hours to carry without grid · {hours} h</span>
            <input className="gr-range" type="range" min={1} max={24} value={hours} onChange={(e) => setHours(Number(e.target.value))} data-testid="ladder-hours" /></label>
        </Card>
        <div className="gr-grid gr-grid-2" style={{ gap: 10 }}>
          <Stat label="Power used" value={`${fmt.num(ladder.kwUsed)} kW`} sub={`of ${fmt.num(ladder.kwLimit)} kW`} accent={ladder.limitedBy === 'power' ? 'var(--gr-danger)' : 'var(--gr-rescue)'} />
          <Stat label="Energy used" value={`${fmt.num(ladder.kwhUsed)} kWh`} sub={`of ${fmt.num(ladder.kwhLimit)} kWh usable`} accent={ladder.limitedBy === 'energy' ? 'var(--gr-danger)' : 'var(--gr-rescue)'} />
        </div>
        <Card className="gr-card-tight" data-testid="move-bridge">
          <div className="gr-eyebrow">During the move</div>
          <p className="gr-body" style={{ margin: 0, fontSize: 13 }}>{ms.move_bridge.text}</p>
        </Card>
      </div>
    </div>
  )
}

/** The hospital's real diesel bill (partner data) — re-runs the payback on actual spend. */
function DieselBill() {
  const s = useSiteStore()
  const [v, setV] = useState(s.reportedDieselNgn ? String(Math.round(s.reportedDieselNgn / 1e6)) : '')
  const apply = async () => { s.setReportedDiesel(v ? Number(v) * 1e6 : null); await s.runAssessment() }
  return (
    <Card className="gr-card-tight">
      <div className="gr-eyebrow">The hospital's diesel bill today</div>
      <div className="gr-row" style={{ gap: 8, alignItems: 'center' }}>
        <span style={{ color: '#fff' }}>₦</span><input className="gr-input gr-input-mono" style={{ width: 110, padding: '7px 10px' }} type="number" min={0} placeholder="e.g. 47" value={v} onChange={(e) => setV(e.target.value)} data-testid="diesel-bill" />
        <span className="gr-muted">M a month</span>
        <button className="gr-btn-pill" onClick={apply} disabled={s.assessing} data-testid="diesel-bill-apply">{s.assessing ? 'Running…' : 'Recalculate'}</button>
      </div>
      <div className="gr-muted" style={{ fontSize: 11, marginTop: 6 }}>From the fuel records (partner data). Adds a "reported bill" line to the 5 & 10-year chart and the payback on real spend.</div>
    </Card>
  )
}


/** Carbon credits: the engine's avoided tonnes × a price the user enters (no default — prices vary by buyer and standard),
 *  and the downloadable ESG report for this site, carrying that price. */
function CarbonValue({ esg, assessment }: { esg: any; assessment: Assessment | null }) {
  const [price, setPrice] = useState('')
  const [busy, setBusy] = useState(false)
  const p = Number(price)
  if (!esg) return null
  const download = async () => {
    if (!assessment) return
    setBusy(true)
    try { await downloadEsgReport(assessment, p > 0 ? p : null); showToast('ESG report downloaded — open it and use “Save as PDF” for the board pack') }
    catch (e: any) { showToast('ESG report failed: ' + (e?.message || 'is the backend running?')) } finally { setBusy(false) }
  }
  return (
    <div className="gr-row" style={{ gap: 10, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 13, color: '#fff' }}>{fmt.num(esg.co2_t_10y)} t over 10 years ×</span>
      <span style={{ color: '#fff' }}>US$</span><input className="gr-input gr-input-mono" style={{ width: 90, padding: '6px 10px' }} type="number" min={0} placeholder="price / t" value={price} onChange={(e) => setPrice(e.target.value)} data-testid="carbon-price" />
      <b style={{ color: 'var(--gr-rescue)', fontSize: 15 }} data-testid="carbon-value">{p > 0 ? `= US$ ${Math.round(esg.co2_t_10y * p).toLocaleString()}` : 'enter the price your buyer pays per tonne'}</b>
      <button className="gr-btn" style={{ marginLeft: 'auto' }} onClick={download} disabled={busy || !assessment} data-testid="esg-download">
        <Icon name={busy ? 'refresh' : 'download'} size={14} className={busy ? 'gr-spin' : undefined} /> Download ESG report
      </button>
      <span className="gr-muted" style={{ fontSize: 11, flexBasis: '100%' }}>{esg.credits_note} Factors: {esg.factors}.</span>
    </div>
  )
}
