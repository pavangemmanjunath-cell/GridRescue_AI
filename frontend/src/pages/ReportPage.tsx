import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { EmptyAssessment, ResultNav, useAssessmentGuard } from '../components/results/Shared'
import { Screen } from '../components/layout/Screen'
import { Card, Chip, Stat, showToast } from '../components/ui/Primitives'
import { downloadEsgReport } from '../lib/esg'
import { Icon } from '../components/ui/Icon'
import { fmt } from '../lib/format'

/** Report — the full assessment in three tabs; print / PDF includes every section. */
export function ReportPage() {
  const a = useAssessmentGuard()
  const [busy, setBusy] = useState(false)
  if (!a) return <EmptyAssessment />
  const rec = a.recommended
  const ic: any = (a as any).investment_case
  const comp = rec.components
  const rc: any = a.relocatable_case

  const downloadHtml = async () => {
    setBusy(true)
    try {
      const html = await api.report(a)
      const blob = new Blob([html], { type: 'text/html' })
      const url = URL.createObjectURL(blob)
      const el = document.createElement('a'); el.href = url; el.download = `GridRescue_${(a.inputs.facility.name || a.location.name || 'site').replace(/[^a-z0-9]+/gi, '_')}.html`; el.click()
      URL.revokeObjectURL(url)
      showToast('Report downloaded')
    } catch (e: any) { showToast('Report failed: ' + (e?.message || '')) } finally { setBusy(false) }
  }
  const downloadEsg = async () => {
    setBusy(true)
    try { await downloadEsgReport(a); showToast('ESG report downloaded') }
    catch (e: any) { showToast('ESG report failed: ' + (e?.message || '')) } finally { setBusy(false) }
  }
  const downloadJson = () => {
    const blob = new Blob([JSON.stringify(a, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob); const el = document.createElement('a'); el.href = url; el.download = 'gridrescue_assessment.json'; el.click(); URL.revokeObjectURL(url)
  }

  const actions = (
    <>
      <button className="gr-btn" onClick={() => window.print()} data-testid="print-btn"><Icon name="printer" /> Print / PDF</button>
      <button className="gr-btn gr-btn-ghost" onClick={downloadHtml} disabled={busy} data-testid="download-html"><Icon name="download" /> HTML report</button>
      <button className="gr-btn gr-btn-ghost" onClick={downloadEsg} disabled={busy} data-testid="download-esg"><Icon name="download" /> ESG report</button>
      <button className="gr-btn gr-btn-ghost" onClick={downloadJson}><Icon name="download" /> JSON</button>
      <ResultNav />
    </>
  )

  return (
    <Screen testid="report-page" eyebrow="Report" title="Energy resilience assessment report" sub={`${a.inputs.facility.name || a.inputs.facility_label} · ${a.location.name} · engine ${a.engine.version} (${a.engine.mode})`} actions={actions}
      tabs={[
        { id: 'summary', label: 'Summary', content: <div className="gr-stack">
      <Card style={{ marginBottom: 16 }}>
        <div className="gr-eyebrow">Executive summary</div>
        <p className="gr-body" style={{ color: '#fff', fontSize: 16 }}><b>{a.inputs.facility.name || a.inputs.facility_label}</b> in {a.location.name}{a.location.state ? `, ${a.location.state}` : ''}, {a.location.country}: recommended architecture <b style={{ color: 'var(--gr-rescue)' }}>{rec.name}</b> (score {rec.score}/100, {rec.suitability.toLowerCase()} suitability).</p>
        {ic && <p className="gr-body" style={{ marginTop: 8 }}>{ic.headline} {ic.decision_kind === 'go' ? 'Decision: invest now.' : `Decision: ${ic.decision}.`}</p>}
        <div className="gr-grid gr-grid-4" style={{ marginTop: 14, gap: 10 }}>
          <Stat label="CAPEX" value={fmt.usdShort(rec.cost.capex_usd)} sub={fmt.ngn(rec.cost.capex_ngn)} />
          <Stat label="Payback" value={rec.lifecycle.simple_payback_years ? `${rec.lifecycle.simple_payback_years} yr` : '—'} />
          <Stat label="Critical load served" value={fmt.pct(rec.simulation_summary.critical_served_pct)} />
          <Stat label="Renewable share" value={fmt.pct(rec.simulation_summary.renewable_share_pct)} />
        </div>
      </Card>

      <div className="gr-grid gr-grid-2">
        <Card><div className="gr-eyebrow">A · Site summary</div>
          <table className="gr-table"><tbody>
            <tr><td>Location</td><td>{a.location.name} · {a.location.state ?? '—'} · {a.location.country} · {fmt.coord(a.location.lat, a.location.lng, 4)} · {a.location.elevation_m} m</td></tr>
            <tr><td>Solar potential</td><td>{a.site.solar.annual_psh} PSH/day · {a.site.solar.label} ({a.site.solar.score}/100) · source {a.climate.ghi_source}</td></tr>
            <tr><td>Wind suitability</td><td>{a.site.wind.annual_ws50} m/s at 50 m · {a.site.wind.label} ({a.site.wind.score}/100)</td></tr>
            <tr><td>Water / river</td><td>{a.site.water.discharge_class} at {a.site.water.nearest_km ?? '—'} km · head {a.site.water.head_m} m · {a.site.water.rain_mm_yr} mm/yr · availability {a.site.water.score}/100</td></tr>
            <tr><td>Grid reliability</td><td>Class {a.site.grid.class} ({a.site.grid.label}) · ≈ {a.site.grid.supply_hours} h/day · score {a.site.grid.score}/100 · {a.site.grid.disco ?? ''}</td></tr>
            <tr><td>Outage risk</td><td>{a.site.outage.severity} · {a.site.outage.expected_outage_hours_per_day} h/day · {fmt.num(a.site.outage.annual_outage_hours)} h/yr</td></tr>
          </tbody></table>
        </Card>
        <Card><div className="gr-eyebrow">B · Facility &amp; load</div>
          <table className="gr-table"><tbody>
            <tr><td>Type</td><td>{a.inputs.facility_label} · {a.load.beds || '—'} beds</td></tr>
            <tr><td>Average / peak load</td><td>{fmt.kw(a.load.avg_load_kw)} / {fmt.kw(a.load.peak_load_kw)} · {fmt.kwh(a.load.daily_kwh)}/day</td></tr>
            <tr><td>Critical / protected</td><td>{fmt.kw(a.load.critical_peak_kw)} / {fmt.kw(a.load.protected_peak_kw)} ({Math.round(a.load.critical_share * 100)} % / {Math.round((a.load.critical_share + a.load.essential_share) * 100)} %)</td></tr>
            <tr><td>Backup target</td><td>{a.inputs.facility.backup_hours} h from {fmt.hour(a.inputs.options.outage_start_hour)} · priority {a.inputs.facility.priority.replace('_', ' ')}</td></tr>
            <tr><td>Existing assets</td><td>grid {a.inputs.facility.existing.grid_connection ? 'yes' : 'no'} · generator {a.inputs.facility.existing.generator_kva} kVA · solar {a.inputs.facility.existing.solar_kwp} kWp · UPS {a.inputs.facility.existing.ups_kva} kVA</td></tr>
            <tr><td>Roof / land / water</td><td>{a.inputs.facility.roof_area_m2} m² / {a.inputs.facility.land_area_m2} m² / {a.inputs.facility.water_source}</td></tr>
          </tbody></table>
        </Card>
      </div>

        </div> },
        { id: 'design', label: 'Design & costs', content: <div className="gr-stack">
      <Card style={{ marginTop: 16 }}><div className="gr-eyebrow">C · Why this is recommended</div>
        <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--gr-fg-2)', fontSize: 14, lineHeight: 1.7 }}>{rec.reasons.map((r, i) => <li key={i}>{r.text}</li>)}</ul>
      </Card>

      <div className="gr-grid gr-grid-2" style={{ marginTop: 16 }}>
        <Card><div className="gr-eyebrow">D · Sizing</div>
          <table className="gr-table"><tbody>
            {comp.ups && <tr><td>UPS</td><td>{comp.ups.kva} kVA · 15 min · critical circuits</td></tr>}
            {comp.pv && comp.pv.kwp > 0 && <tr><td>Solar PV</td><td>{fmt.num(comp.pv.kwp)} kWp · {fmt.num(comp.pv.area_m2)} m² · {fmt.num(comp.pv.annual_kwh)} kWh/yr</td></tr>}
            {comp.wind && comp.wind.kw > 0 && <tr><td>Wind</td><td>{comp.wind.kw} kW</td></tr>}
            {comp.backup_device && <tr><td>Storage</td><td>{fmt.kwh(comp.backup_device.energy_kwh)} / {fmt.kw(comp.backup_device.power_kw)} {comp.backup_device.chemistry === 'flow' ? 'vanadium flow' : 'Li-ion LFP'} · {comp.backup_device.autonomy_h} h</td></tr>}
            {comp.hydrogen && <tr><td>Hydrogen</td><td>{comp.hydrogen.h2_kg} kg · {comp.hydrogen.electrolyser_kw} kW electrolyser · {comp.hydrogen.fuel_cell_kw} kW fuel cell</td></tr>}
            {comp.generator && <tr><td>Generator</td><td>{comp.generator.kva} kVA ({comp.generator.existing ? 'existing, retained' : 'new'})</td></tr>}
            <tr><td>Autonomy / recharge</td><td>{fmt.hours(rec.autonomy_h)} · min SOC {rec.simulation_summary.min_soc_pct} % · {comp.pv?.kwp ? `${fmt.num(comp.pv.daily_kwh)} kWh/day PV recharge` : 'grid recharge'}</td></tr>
          </tbody></table>
        </Card>
        <Card><div className="gr-eyebrow">E · Costs</div>
          <table className="gr-table"><tbody>
            {rec.cost.breakdown.map((c: any) => <tr key={c.category}><td>{c.category}</td><td className="num">{fmt.usd(c.usd)} ({c.pct} %)</td></tr>)}
            <tr><td><b>Total CAPEX</b></td><td className="num"><b>{fmt.usd(rec.cost.capex_usd)}</b></td></tr>
            <tr><td>OPEX / yr</td><td className="num">{fmt.usd(rec.lifecycle.system_opex_usd_per_year)}</td></tr>
            <tr><td>15-yr net cost vs diesel-only</td><td className="num">{fmt.usd(rec.lifecycle.net_cost_15y_usd)} vs {fmt.usd(rec.lifecycle.baseline_diesel_usd_15y)}</td></tr>
          </tbody></table>
        </Card>
      </div>

        </div> },
        { id: 'options', label: 'Options & investment', content: <div className="gr-stack">
      <Card style={{ marginTop: 16 }}><div className="gr-eyebrow">F · Option comparison</div>
        <div className="gr-table-wrap"><table className="gr-table">
          <thead><tr><th>#</th><th>Option</th><th>Autonomy</th><th className="num">CAPEX</th><th className="num">OPEX/yr</th><th className="num">Clean</th><th className="num">Score</th><th>Suitability</th></tr></thead>
          <tbody>{a.ranked.map((r) => <tr key={r.id} className={r.id === rec.id ? 'rec' : ''}><td>{r.rank}</td><td>{r.name}</td><td>{fmt.hours(r.autonomy_h)}</td><td className="num">{fmt.usdShort(r.cost.capex_usd)}</td><td className="num">{fmt.usdShort(r.lifecycle.system_opex_usd_per_year)}</td><td className="num">{r.simulation_summary.renewable_share_pct} %</td><td className="num">{r.score}</td><td><Chip kind={r.suitability}>{r.suitability}</Chip></td></tr>)}</tbody>
        </table></div>
      </Card>

      {ic && <Card style={{ marginTop: 16 }}><div className="gr-eyebrow">G · Investment case</div>
        <p className="gr-body"><b style={{ color: '#fff' }}>Decision:</b> {ic.decision}. {ic.do_nothing.statement}</p>
        <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: 'var(--gr-fg-2)', fontSize: 14, lineHeight: 1.7 }}>{ic.why_technology.map((w: any, i: number) => <li key={i}><b>{w.verdict === 'include' ? 'Include' : 'Exclude'} {w.tech}:</b> {w.text}</li>)}</ul>
      </Card>}

      <div className="gr-muted" style={{ fontSize: 11, marginTop: 20 }}>Data: {a.climate.sources?.join(', ')} · Open-Meteo Flood API (GloFAS) · Open-Meteo elevation · OpenStreetMap Overpass · World Bank · healthsites.io / curated hospital list. Costs: IRENA, BNEF, Lazard, NREL. {a.engine.disclaimer}</div>
        </div> },
        ...(rc ? [{ id: 'brief12', label: 'Brief 12 · impact estimate', content: <div className="gr-stack" data-testid="report-brief12">
      <Card><div className="gr-eyebrow">Brief 12 · {rc.brief.title} · the five questions</div>
        {rc.starter_answers.map((q: any, i: number) => <div key={q.id} className="gr-reason"><span className="gr-reason-kind" style={{ color: 'var(--gr-rescue)' }}>Q{i + 1}</span><span><b style={{ color: '#fff' }}>{q.question}</b><br />{q.answer}</span></div>)}
      </Card>
      <Card><div className="gr-eyebrow">One-page impact estimate · the brief's success metrics</div>
        <table className="gr-table gr-table-tight"><tbody>{rc.metrics.map((m: any) => <tr key={m.id}><td style={{ width: 170 }}><b style={{ color: '#fff' }}>{m.title}</b> · {m.weight} %</td><td>{m.ours.join(' · ')}</td></tr>)}</tbody></table>
      </Card>
        </div> }] : []),
        { id: 'history', label: 'History', content: <History /> },
      ]} />
  )
}

/** Recently assessed sites, from the app's internal database — click one to reopen it in the Explorer. */
function History() {
  const nav = useNavigate()
  const [rows, setRows] = useState<any[] | null>(null)
  useEffect(() => { api.history(15).then((r) => setRows(r.assessments)).catch(() => setRows([])) }, [])
  return (
    <Card data-testid="history">
      <div className="gr-card-head"><div className="gr-eyebrow">Recent assessments · internal database</div><Chip kind="live">{rows ? `${rows.length} shown` : 'loading…'}</Chip></div>
      {rows && rows.length === 0 && <div className="gr-muted">No assessments stored yet.</div>}
      {rows && rows.length > 0 && (
        <div className="gr-table-wrap"><table className="gr-table gr-table-tight">
          <thead><tr><th>Site</th><th>Facility</th><th>Design (hourly simulation)</th><th>ML pick</th><th className="num">Critical served</th><th className="num">CO₂ avoided / yr</th><th /></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} data-testid="history-row">
              <td><b style={{ color: '#fff' }}>{r.place || '—'}</b><div className="gr-muted" style={{ fontSize: 11 }}>{r.country} · {Number(r.lat).toFixed(2)}, {Number(r.lng).toFixed(2)}</div></td>
              <td>{r.facility}<div className="gr-muted" style={{ fontSize: 11 }}>{r.backup_hours} h backup{r.runs > 1 ? ` · run ${r.runs}×` : ''}</div></td>
              <td>{r.design}</td>
              <td>{r.ml_family ?? '—'} {r.ml_family && <Chip kind={r.ml_agrees ? 'High' : 'Medium'}>{r.ml_agrees ? 'agrees' : 'differs'}</Chip>}</td>
              <td className="num">{r.critical_pct != null ? `${r.critical_pct} %` : '—'}</td>
              <td className="num">{r.co2_t != null ? `${Math.round(r.co2_t).toLocaleString()} t` : '—'}</td>
              <td><button className="gr-btn-pill" onClick={() => nav(`/explorer?lat=${r.lat}&lng=${r.lng}`)}>Open <Icon name="arrow" size={11} /></button></td>
            </tr>))}
          </tbody>
        </table></div>
      )}
    </Card>
  )
}
