import { useNavigate } from 'react-router-dom'
import { EmptyAssessment, Radar, ResultNav, useAssessmentGuard } from '../components/results/Shared'
import { AffordabilityPanel, AgentPanel } from '../components/results/AgentPanel'
import { MLCard } from '../components/results/MLCard'
import { Screen } from '../components/layout/Screen'
import { Card, Chip, ScoreBar, Stat } from '../components/ui/Primitives'
import { Icon } from '../components/ui/Icon'
import { PART_COLOR, PART_LABEL, fmt, scoreColor } from '../lib/format'

// plain-language name of a design, e.g. "Solar + Backup Device + Generator"
const SHORT: Record<string, string> = { solar_pv: 'Solar', wind: 'Wind', diesel_gen: 'Generator', li_ion: 'Backup Device', flow: 'Flow backup device', hydrogen: 'Hydrogen', pumped_hydro: 'Pumped hydro' }
const plainName = (parts: string[], gen: boolean) => [...parts.filter((p) => p !== 'ups').map((p) => SHORT[p] ?? p), ...(gen && !parts.includes('diesel_gen') ? ['Generator'] : [])].join(' + ') || 'UPS only'

const KIND_COLOR: Record<string, string> = { grid: 'var(--gr-grid)', need: 'var(--gr-critical)', resource: 'var(--gr-sun-300)', storage: 'var(--gr-rescue)', existing: 'var(--gr-fg-2)', exclusion: 'var(--gr-fg-3)', regional: 'var(--gr-water-light)', future: 'var(--gr-hydrogen)', constraint: 'var(--gr-danger)', engine: 'var(--gr-wind-light)' }

/** Advisor — the answer first, then the AI agent's checks, the money, and the other options (one screen, tabs). */
export function RecommendationPage() {
  const a = useAssessmentGuard()
  const nav = useNavigate()
  if (!a) return <EmptyAssessment />
  const rec = a.recommended
  const site = a.site
  const ic: any = a.investment_case
  const comp = rec.components
  const dims = Object.keys(a.weights)
  const rival = a.ranked.find((r) => r.id !== rec.id)

  const answer = (
    <div className="gr-fit" style={{ gridTemplateRows: 'auto 1fr' }}>
      <Card accent>
        <div className="gr-row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 280 }}>
            <div className="gr-eyebrow" style={{ color: 'var(--gr-rescue)' }}>Recommended</div>
            <div className="gr-headline" style={{ fontSize: 'clamp(20px, 3vh, 30px)' }} data-testid="recommended-name">{rec.name}</div>
            <div className="gr-stackline">
              {rec.parts.map((p, i) => (<span key={p} style={{ display: 'contents' }}><span className="gr-stack-node" style={{ borderColor: PART_COLOR[p] }}><span className="gr-dot" style={{ background: PART_COLOR[p] }} />{PART_LABEL[p] ?? p}</span>{i < rec.parts.length - 1 && <span className="gr-stack-arrow">+</span>}</span>))}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="gr-metric gr-metric-lg" style={{ color: scoreColor(rec.score) }}>{rec.score}<span className="gr-metric-unit">/100</span></div>
            <Chip kind={rec.suitability}>{rec.suitability} suitability</Chip>
          </div>
        </div>
        <div className="gr-grid gr-grid-4" style={{ marginTop: 14, gap: 10 }}>
          <Stat label="Estimated CAPEX" value={fmt.usdShort(rec.cost.capex_usd)} sub={fmt.ngn(rec.cost.capex_ngn)} accent="var(--gr-sun-300)" />
          <Stat label="Simple payback" value={rec.lifecycle.simple_payback_years ? `${rec.lifecycle.simple_payback_years} yr` : '—'} sub={`vs diesel-only ${fmt.usdShort(rec.lifecycle.baseline_diesel_usd_15y)} / 15 yr`} />
          <Stat label="Critical load served" value={fmt.pct(rec.simulation_summary.critical_served_pct)} sub={`${a.inputs.facility.backup_hours} h outage · ${rec.simulation_summary.hours_on_backup} h on backup device`} accent="var(--gr-rescue)" />
          <Stat label="Renewable share" value={fmt.pct(rec.simulation_summary.renewable_share_pct)} sub={`${rec.simulation_summary.fuel_l} L diesel on the sim day`} accent="var(--gr-wind-light)" />
        </div>
        {/* outage survival (the REopt resilience metric): the outage started at every hour of the day */}
        {a.resilience && (
          <div className="gr-survival" data-testid="survival" title={a.resilience.method}>
            <span className="gr-survival-label">Critical load survives an outage starting at <b>any hour</b></span>
            {a.resilience.curve.map((c) => (
              <span key={c.hours} className={`gr-survival-cell ${c.survival_pct >= 95 ? 'ok' : c.survival_pct >= 60 ? 'mid' : 'low'}`} data-testid={`survival-${c.hours}`}>
                <small>{c.hours} h</small><b>{c.survival_pct} %</b><i><em style={{ width: `${c.survival_pct}%` }} /></i>
              </span>
            ))}
          </div>
        )}
      </Card>
      <div className="gr-grid gr-grid-3 gr-advisor-row" style={{ minHeight: 0 }}>
        <Card>
          <div className="gr-eyebrow">Why this is recommended</div>
          <div data-testid="reasons">
            {rec.reasons.slice(0, 4).map((r, i) => <div key={i} className="gr-reason"><span className="gr-reason-kind" style={{ color: KIND_COLOR[r.kind] ?? 'var(--gr-fg-3)' }}>{r.kind}</span><span>{r.text}</span></div>)}
          </div>
        </Card>
        {/* the ML classifier's pick for this facility's configuration, and whether the hourly simulation agrees */}
        <MLCard pred={a.agent?.ml} meta={a.agent?.model_card?.meta} title="ML pick · best-suited system"
          verdict={a.agent?.ml ? { agrees: a.agent.steps?.find((s: any) => s.id === 'verify')?.status === 'agree', engineName: plainName(rec.parts, !!comp.generator) } : null} />
        <Card>
          <div className="gr-eyebrow">Suggested sizing</div>
          <div className="gr-grid gr-grid-3" style={{ gap: 10 }} data-testid="sizing">
            {comp.ups && <Stat label="UPS · critical" value={`${comp.ups.kva} kVA`} sub={`${comp.ups.autonomy_min} min · ${fmt.kw(comp.ups.covers_kw)}`} />}
            {comp.pv && comp.pv.kwp > 0 && <Stat label="Solar PV" value={`${fmt.num(comp.pv.kwp)} kWp`} sub={`${fmt.num(comp.pv.area_m2)} m²`} accent="var(--gr-sun-300)" />}
            {comp.wind && comp.wind.kw > 0 && <Stat label="Wind turbine" value={`${comp.wind.kw} kW`} sub={`CF ${Math.round(comp.wind.capacity_factor * 100)} %`} accent="var(--gr-wind-light)" />}
            {comp.backup_device && <Stat label={comp.backup_device.chemistry === 'flow' ? 'Flow backup device' : 'Backup Device · LFP'} value={fmt.kwh(comp.backup_device.energy_kwh)} sub={`${fmt.kw(comp.backup_device.power_kw)} · ${comp.backup_device.autonomy_h} h`} accent="var(--gr-rescue)" />}
            {comp.hydrogen && <Stat label="Hydrogen" value={`${fmt.num(comp.hydrogen.h2_kg)} kg H₂`} sub={`${comp.hydrogen.fuel_cell_kw} kW fuel cell`} accent="var(--gr-hydrogen)" />}
            {comp.generator && <Stat label={comp.generator.existing ? 'Generator (existing)' : 'Generator (new)'} value={`${fmt.num(comp.generator.kva)} kVA`} sub={comp.generator.adequate ? 'last tier' : `needs ${comp.generator.recommended_kva} kVA`} accent="var(--gr-grid)" />}
            {comp.pumped_hydro && <Stat label="Pumped hydro" value={fmt.kw(comp.pumped_hydro.power_kw)} sub={fmt.kwh(comp.pumped_hydro.energy_kwh)} accent="var(--gr-water-light)" />}
          </div>
        </Card>
      </div>
    </div>
  )

  const money = ic && (
    <div className="gr-fit" style={{ gridTemplateRows: 'auto 1fr' }}>
      <Card style={{ borderColor: ic.decision_kind === 'go' ? 'rgba(74,222,128,0.5)' : 'rgba(240,203,114,0.5)' }} data-testid="investment-case">
        <div className="gr-card-head"><div className="gr-eyebrow">Investment case · the call</div><Chip kind={ic.decision_kind === 'go' ? 'High' : ic.decision_kind.startsWith('go') ? 'Medium' : 'Low'}>{ic.decision}</Chip></div>
        <p className="gr-body" style={{ color: '#fff', fontSize: 15 }}>{ic.headline}</p>
        <div className="gr-grid gr-grid-2" style={{ marginTop: 12 }}>
          <div className="gr-stat" style={{ borderColor: 'rgba(239,107,92,0.4)' }}><span className="gr-stat-label" style={{ color: 'var(--gr-danger)' }}>If you do nothing</span><p className="gr-body" style={{ marginTop: 4 }}>{ic.do_nothing.statement}</p></div>
          <div className="gr-stat" style={{ borderColor: 'rgba(74,222,128,0.4)' }}><span className="gr-stat-label" style={{ color: 'var(--gr-rescue)' }}>If you invest</span>
            <p className="gr-body" style={{ marginTop: 4 }}>CAPEX {fmt.usd(ic.investment.capex_usd)} · net savings {fmt.usd(ic.investment.annual_net_savings_usd)}/yr · payback {ic.investment.simple_payback_years ?? '> 15'} yr · {fmt.num(ic.investment.diesel_avoided_l_per_year)} L diesel and {ic.investment.co2_avoided_t_per_year} t CO₂ avoided a year.</p></div>
        </div>
      </Card>
      <AffordabilityPanel af={ic.affordability} />
    </div>
  )

  const options = (
    <div className="gr-grid gr-grid-sidebar" style={{ height: '100%' }}>
      <Card>
        <div className="gr-card-head"><div className="gr-eyebrow">Ranked options</div><button className="gr-btn-pill" onClick={() => nav('/compare')}>Full comparison <Icon name="arrow" size={12} /></button></div>
        <div className="gr-stack" style={{ gap: 8 }} data-testid="ranked">
          {a.ranked.slice(0, 5).map((r) => (
            <div key={r.id} className={`gr-rank-card ${r.id === rec.id ? 'rec' : ''}`}>
              <span className="gr-rank-num">#{r.rank}</span>
              <div><div style={{ fontWeight: 600, color: '#fff' }}>{r.name}</div><div className="gr-muted" style={{ fontSize: 12 }}>{fmt.usdShort(r.cost.capex_usd)} · {fmt.hours(r.autonomy_h)} autonomy · {r.simulation_summary.critical_served_pct}% critical served</div></div>
              <div style={{ textAlign: 'right' }}><div className="gr-metric" style={{ fontSize: 22, color: scoreColor(r.score) }}>{r.score}</div><Chip kind={r.suitability}>{r.suitability}</Chip></div>
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <div className="gr-eyebrow">Site and score profile</div>
        <div className="gr-stack" style={{ gap: 8 }} data-testid="site-scores">
          <ScoreBar label={`Solar · ${site.solar.annual_psh} PSH`} value={site.solar.score} color="var(--gr-sun-500)" />
          <ScoreBar label={`Wind · ${site.wind.annual_ws50} m/s`} value={site.wind.score} color="var(--gr-wind)" />
          <ScoreBar label={`Water · ${site.water.discharge_class}`} value={site.water.score} color="var(--gr-water)" />
          <ScoreBar label={`Grid · class ${site.grid.class}`} value={site.grid.score} color="var(--gr-grid)" />
        </div>
        <Radar size={240} dims={dims} labels={a.dimension_labels} series={[{ name: rec.short, color: '#4ADE80', values: rec.dimensions }, ...(rival ? [{ name: rival.short, color: '#F0CB72', values: rival.dimensions }] : [])]} />
      </Card>
    </div>
  )

  return (
    <Screen testid="recommendation-page" eyebrow="Advisor" title={`Best for this site: ${plainName(rec.parts, !!comp.generator)}`}
      sub={`${a.inputs.facility.name || a.inputs.facility_label} · ${a.location.name} · ${a.inputs.facility.backup_hours} h outage`} actions={<ResultNav />}
      tabs={[
        { id: 'answer', label: 'Answer', content: answer },
        { id: 'agent', label: 'AI agent', content: <AgentPanel agent={a.agent} /> },
        { id: 'money', label: 'Money', content: money },
        { id: 'options', label: 'Options', content: options },
      ]} />
  )
}
