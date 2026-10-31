import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { EmptyAssessment, ResultNav, useAssessmentGuard } from '../components/results/Shared'
import { Screen } from '../components/layout/Screen'
import { Card, Stat } from '../components/ui/Primitives'
import { fmt } from '../lib/format'

const COLORS = ['#F0CB72', '#4ADE80', '#22B7E8', '#3A86E6', '#8B8BFF', '#FF6B6B', '#D4A056', '#B8C4D9', '#7FB2FF', '#2EE6A6', '#FF9A3C', '#A855F7']
const TT = { background: '#1A3052', border: '1px solid #244065', borderRadius: 8, color: '#fff' }

/** Costs — first the money question (with the system vs diesel only), then the split, the options and the line items. */
export function CostsPage() {
  const a = useAssessmentGuard()
  if (!a) return <EmptyAssessment />
  const rec = a.recommended
  const cost = rec.cost
  const life = rec.lifecycle
  const ic: any = a.investment_case
  const years = life.analysis_years
  // cumulative spend: the system (equipment, then running costs net of grid savings) vs keeping diesel only
  const curve = Array.from({ length: years + 1 }, (_, y) => ({
    year: y,
    withSystem: Math.round(cost.capex_usd + life.system_opex_usd_per_year * y - life.renewable_grid_savings_usd_per_year * y),
    dieselOnly: Math.round(life.baseline_diesel_usd_per_year * y),
  }))
  const saved = life.baseline_diesel_usd_15y - life.net_cost_15y_usd
  const byOption = a.ranked.slice(0, 6).map((r) => ({ name: r.short, capex: Math.round(r.cost.capex_usd), net15: Math.round(r.lifecycle.net_cost_15y_usd) }))

  const compare = (
    <div className="gr-fit" style={{ gridTemplateRows: 'auto 1fr' }}>
      <div className="gr-grid gr-grid-4" style={{ gap: 10 }}>
        <Stat label="Diesel only · 15 years" value={fmt.usdShort(life.baseline_diesel_usd_15y)} sub={`${fmt.usdShort(life.baseline_diesel_usd_per_year)} every year`} accent="var(--gr-danger)" />
        <Stat label="With this system · 15 years" value={fmt.usdShort(life.net_cost_15y_usd)} sub={`equipment ${fmt.usdShort(cost.capex_usd)} once`} accent="var(--gr-rescue)" />
        <Stat label="Saved over 15 years" value={fmt.usdShort(saved)} sub={ic ? `${fmt.num(ic.investment.diesel_avoided_l_per_year)} L diesel avoided a year` : ''} accent="var(--gr-sun-300)" />
        <Stat label="Pays back in" value={life.simple_payback_years ? `${life.simple_payback_years} yr` : '> 15 yr'} sub={`net savings ${fmt.usdShort(life.annual_net_savings_usd)}/yr`} />
      </div>
      <Card style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="gr-eyebrow">Money spent over {years} years · with the system vs diesel only</div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <ResponsiveContainer>
            <LineChart data={curve} margin={{ left: 8, right: 16, top: 8 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
              <XAxis dataKey="year" tick={{ fill: '#7A8AA8', fontSize: 11 }} tickFormatter={(v) => `yr ${v}`} />
              <YAxis tick={{ fill: '#7A8AA8', fontSize: 11 }} tickFormatter={(v) => fmt.usdShort(v)} width={64} />
              <Tooltip formatter={(v: any) => fmt.usd(Number(v))} contentStyle={TT} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line isAnimationActive={false} type="monotone" dataKey="dieselOnly" name="Diesel only" stroke="#FF6B6B" strokeWidth={3} dot={false} />
              <Line isAnimationActive={false} type="monotone" dataKey="withSystem" name="With solar + backup device system" stroke="#4ADE80" strokeWidth={3} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  )

  const split = (
    <div className="gr-grid gr-grid-2" style={{ height: '100%' }}>
      <Card style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="gr-eyebrow">Equipment cost split · {fmt.usd(cost.capex_usd)}</div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <ResponsiveContainer>
            <PieChart>
              <Pie isAnimationActive={false} data={cost.breakdown} dataKey="usd" nameKey="category" innerRadius="45%" outerRadius="80%" paddingAngle={2} stroke="none">
                {cost.breakdown.map((_: any, i: number) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v: any) => fmt.usd(Number(v))} contentStyle={TT} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card>
        <table className="gr-table gr-table-tight" data-testid="cost-table">
          <thead><tr><th>Category</th><th className="num">USD</th><th className="num">Share</th></tr></thead>
          <tbody>{cost.breakdown.map((c: any, i: number) => <tr key={c.category}><td><span className="gr-dot" style={{ background: COLORS[i % COLORS.length], marginRight: 8 }} />{c.category}</td><td className="num">{fmt.usd(c.usd)}</td><td className="num">{c.pct} %</td></tr>)}</tbody>
        </table>
      </Card>
    </div>
  )

  const options = (
    <div className="gr-grid gr-grid-sidebar" style={{ height: '100%' }}>
      <Card style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="gr-eyebrow">Equipment vs 15-year net cost by option</div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <ResponsiveContainer>
            <BarChart data={byOption} margin={{ left: 8, right: 8 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: '#7A8AA8', fontSize: 10 }} interval={0} />
              <YAxis tick={{ fill: '#7A8AA8', fontSize: 11 }} tickFormatter={(v) => fmt.usdShort(v)} width={64} />
              <Tooltip formatter={(v: any) => fmt.usd(Number(v))} contentStyle={TT} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar isAnimationActive={false} dataKey="capex" name="Equipment" fill="#F0CB72" radius={[3, 3, 0, 0]} />
              <Bar isAnimationActive={false} dataKey="net15" name="15-yr net cost" fill="#22B7E8" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card>
        <div className="gr-eyebrow">Unit economics</div>
        <div className="gr-stack" style={{ gap: 10 }}>
          <Stat label="Cost per resilient kWh" value={`$${life.cost_per_resilient_kwh_usd}`} sub="15-yr cost ÷ outage energy served" />
          <Stat label="Equipment per protected kW" value={fmt.usd(life.capex_per_protected_kw_usd)} />
          <Stat label="Diesel baseline" value={`$${life.baseline_diesel_usd_per_kwh}/kWh`} accent="var(--gr-danger)" />
          {ic && <Stat label="CO₂ avoided" value={`${ic.investment.co2_avoided_t_per_year} t/yr`} accent="var(--gr-rescue)" />}
        </div>
      </Card>
    </div>
  )

  const lines = (
    <Card style={{ height: '100%', boxSizing: 'border-box' }}>
      <table className="gr-table gr-table-tight"><thead><tr><th>Item</th><th>Category</th><th className="num">USD</th></tr></thead>
        <tbody>{cost.lines.map((l: any, i: number) => <tr key={i}><td style={{ color: '#fff' }}>{l.label}</td><td className="gr-muted">{l.category}</td><td className="num">{fmt.usd(l.usd)}</td></tr>)}</tbody></table>
      <div className="gr-muted" style={{ fontSize: 11, marginTop: 8 }}>Assumptions: diesel ${cost.assumptions.diesel_price_usd_per_l}/L · grid tariff ${cost.assumptions.grid_tariff_usd_per_kwh}/kWh · ₦{cost.assumptions.usd_to_ngn}/US$ · {years}-year analysis · Nigeria import / EPC premium included · ±30 %.</div>
    </Card>
  )

  return (
    <Screen testid="costs-page" eyebrow="Costs" title={`Saves ${fmt.usdShort(saved)} over ${years} years`} sub={`${rec.name} · equipment ${fmt.usd(cost.capex_usd)} (≈ ${fmt.ngn(cost.capex_ngn)})`} actions={<ResultNav />}
      tabs={[
        { id: 'compare', label: 'With vs without', content: compare },
        { id: 'split', label: 'Cost split', content: split },
        { id: 'options', label: 'By option', content: options },
        { id: 'lines', label: 'Line items', content: lines },
      ]} />
  )
}
