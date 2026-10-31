import { useState } from 'react'
import { EmptyAssessment, Radar, ResultNav, useAssessmentGuard } from '../components/results/Shared'
import { Screen } from '../components/layout/Screen'
import { Card, Chip } from '../components/ui/Primitives'
import { PART_COLOR, PART_LABEL, fmt, scoreColor } from '../lib/format'

const COMPLEXITY = (v: number) => (v >= 90 ? 'low' : v >= 70 ? 'medium' : v >= 40 ? 'high' : 'very high')

/** Compare — every option in one table; tick up to three to overlay their score profiles. */
export function ComparePage() {
  const a = useAssessmentGuard()
  const [sel, setSel] = useState<string[]>([])
  if (!a) return <EmptyAssessment />
  const rows = a.ranked
  const dims = Object.keys(a.weights)
  const picked = rows.filter((r) => sel.includes(r.id)).slice(0, 3)
  const palette = ['#4ADE80', '#F0CB72', '#22B7E8']
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id].slice(-3)))

  const table = (
    <Card style={{ height: '100%', boxSizing: 'border-box' }}>
      <table className="gr-table gr-table-compare gr-table-tight" data-testid="compare-table">
        <thead><tr><th>#</th><th>Option</th><th>Backup</th><th className="num">CAPEX</th><th className="num">15-yr net cost</th><th className="num">Clean</th><th>Complexity</th><th className="num">Critical</th><th className="num">Score</th><th>Fit</th><th>Compare</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={r.id === a.recommended.id ? 'rec' : ''}>
              <td className="num">{r.rank}</td>
              <td><b style={{ color: '#fff' }}>{r.name}</b><div style={{ display: 'flex', gap: 6, marginTop: 2 }}>{r.parts.map((p) => <span key={p} style={{ fontSize: 10.5, color: PART_COLOR[p] }}>● {PART_LABEL[p]}</span>)}</div></td>
              <td>{fmt.hours(r.autonomy_h)}</td>
              <td className="num">{fmt.usdShort(r.cost.capex_usd)}</td>
              <td className="num">{fmt.usdShort(r.lifecycle.net_cost_15y_usd)}</td>
              <td className="num">{r.simulation_summary.renewable_share_pct} %</td>
              <td>{COMPLEXITY(r.dimensions.complexity)}</td>
              <td className="num">{r.simulation_summary.critical_served_pct} %</td>
              <td className="num" style={{ color: scoreColor(r.score), fontWeight: 700 }}>{r.score}</td>
              <td><Chip kind={r.suitability}>{r.suitability}</Chip></td>
              <td><input type="checkbox" checked={sel.includes(r.id)} onChange={() => toggle(r.id)} aria-label={`compare ${r.short}`} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="gr-muted" style={{ fontSize: 12, marginTop: 8 }}>Diesel-only over 15 years: {fmt.usdShort(a.recommended.lifecycle.baseline_diesel_usd_15y)} · costs ±30 % (IRENA, BNEF, Lazard, NREL)</div>
    </Card>
  )

  const profiles = (
    <div className="gr-grid gr-grid-2" style={{ height: '100%' }}>
      <Card>
        <div className="gr-eyebrow">Score radar · tick options in the table</div>
        {picked.length === 0 ? <div className="gr-muted" style={{ padding: 24, textAlign: 'center' }}>Tick up to three options in the table to overlay their score profiles.</div>
          : <><Radar dims={dims} labels={a.dimension_labels} series={picked.map((r, i) => ({ name: r.short, color: palette[i], values: r.dimensions }))} size={340} />
            <div className="gr-row" style={{ fontSize: 12 }}>{picked.map((r, i) => <span key={r.id} className="gr-legend-item"><span className="gr-legend-swatch" style={{ background: palette[i] }} />{r.short}</span>)}</div></>}
      </Card>
      <Card>
        <div className="gr-eyebrow">Dimension scores</div>
        <table className="gr-table gr-table-tight">
          <thead><tr><th>Dimension</th><th className="num">weight</th>{rows.slice(0, 4).map((r) => <th key={r.id} className="num">{r.short}</th>)}</tr></thead>
          <tbody>{dims.map((d) => <tr key={d}><td>{a.dimension_labels[d]}</td><td className="num">{Math.round(a.weights[d] * 100)}%</td>{rows.slice(0, 4).map((r) => <td key={r.id} className="num" style={{ color: scoreColor(r.dimensions[d]) }}>{r.dimensions[d]}</td>)}</tr>)}</tbody>
        </table>
      </Card>
    </div>
  )

  return (
    <Screen testid="compare-page" eyebrow="Compare" title="Every option, side by side" sub={`${rows.length} designs scored for ${a.inputs.facility.name || a.location.name}`} actions={<ResultNav />}
      tabs={[{ id: 'table', label: 'Table', content: table }, { id: 'profiles', label: `Score profiles${picked.length ? ` (${picked.length})` : ''}`, content: profiles }]} />
  )
}
