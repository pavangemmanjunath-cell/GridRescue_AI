import { Card, Chip } from '../ui/Primitives'
import { fmt } from '../../lib/format'

const STATUS_KIND: Record<string, string> = { done: 'High', agree: 'High', pass: 'High', override: 'Medium', warn: 'Medium', skipped: 'Low', fail: 'Low' }

/** Audit trail of the GridRescue agent: observe → classify (ML) → verify → stress-test outages → affordability → decide. */
export function AgentPanel({ agent }: { agent: any }) {
  if (!agent) return null
  const ml = agent.ml
  const meta = agent.model_card?.meta
  return (
    <Card style={{ marginBottom: 20 }} data-testid="agent-panel">
      <div className="gr-card-head">
        <div className="gr-eyebrow">AI agent · how this decision was reached</div>
        <span className="gr-muted" style={{ fontSize: 12 }}>{agent.mode}</span>
      </div>
      <div className="gr-grid gr-grid-sidebar">
        <div>
          {agent.steps.map((s: any, i: number) => (
            <div key={s.id} className="gr-agent-step" data-testid={`agent-step-${s.id}`}>
              <span className="gr-agent-num">{i + 1}</span>
              <div>
                <div style={{ fontWeight: 600, color: '#fff' }}>{s.title}</div>
                <div className="gr-agent-tool">tool: {s.tool}</div>
                <p className="gr-body" style={{ margin: '6px 0 0', fontSize: 13.5 }}>{s.summary}</p>
              </div>
              <Chip kind={STATUS_KIND[s.status] ?? 'Medium'}>{s.status}</Chip>
            </div>
          ))}
          <div className="gr-divider" />
          <div className="gr-eyebrow">Outage stress tests</div>
          <table className="gr-table" data-testid="stress-tests">
            <thead><tr><th>Scenario</th><th>Critical</th><th>Essential</th><th>Min SOC</th><th>Diesel</th><th>Result</th></tr></thead>
            <tbody>
              {agent.stress_tests.map((t: any) => (
                <tr key={t.scenario}>
                  <td><div style={{ color: '#fff' }}>{t.scenario}</div><div className="gr-muted" style={{ fontSize: 11.5 }}>{t.why}</div></td>
                  <td>{fmt.pct(t.critical_served_pct)}</td><td>{fmt.pct(t.essential_served_pct)}</td><td>{fmt.pct(t.min_soc_pct)}</td>
                  <td>{fmt.num(t.fuel_l)} L</td><td><Chip kind={STATUS_KIND[t.status]}>{t.status}</Chip></td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="gr-issues" style={{ marginTop: 12 }}>{agent.actions.map((a: string, i: number) => <li key={i}>{a}</li>)}</ul>
        </div>
        <div>
          <div className="gr-eyebrow">ML classifier · best-fit family</div>
          {ml ? (
            <>
              <div style={{ fontWeight: 600, color: '#fff', fontSize: 16 }}>{ml.family_label}</div>
              {ml.probabilities.map((p: any) => (
                <div key={p.family} className="gr-prob">
                  <div className="gr-row" style={{ justifyContent: 'space-between' }}><span>{p.label}</span><span>{Math.round(p.p * 100)} %</span></div>
                  <div className="gr-prob-bar"><span style={{ width: `${Math.round(p.p * 100)}%` }} /></div>
                </div>
              ))}
              <div className="gr-divider" />
              <div className="gr-stat-label">Decision path</div>
              <ol style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12.5, color: 'var(--gr-fg-2)', lineHeight: 1.6 }}>
                {ml.decision_path.map((d: any, i: number) => <li key={i}>{d.label} = <b style={{ color: '#fff' }}>{d.value}</b> {d.op} {d.threshold}</li>)}
              </ol>
              {meta && <p className="gr-muted" style={{ fontSize: 11.5, marginTop: 10 }}>Decision tree trained on {fmt.num(meta.n_train)} engine-labelled sites · held-out agreement {Math.round(meta.accuracy_test * 100)} % (top-2 {Math.round(meta.top2_accuracy_test * 100)} %) vs {Math.round(meta.majority_baseline_test * 100)} % baseline. The hourly simulation stays the authority.</p>}
            </>
          ) : <p className="gr-muted">Model not trained yet.</p>}
        </div>
      </div>
    </Card>
  )
}

/** Monthly affordability: today's diesel bill vs repayment + running cost under two financing structures. */
export function AffordabilityPanel({ af }: { af: any }) {
  if (!af) return null
  return (
    <Card style={{ marginBottom: 20 }} data-testid="affordability">
      <div className="gr-card-head"><div className="gr-eyebrow">Affordability · monthly view for the board</div><span className="gr-muted" style={{ fontSize: 12 }}>loan rates are editable assumptions, not offers</span></div>
      <p className="gr-body" style={{ color: '#fff' }}>{af.statement}</p>
      <table className="gr-table">
        <thead><tr><th>Financing</th><th>Rate · term</th><th>Repayment / month</th><th>Net vs today / month</th></tr></thead>
        <tbody>
          <tr><td>Do nothing (diesel for outage hours)</td><td>—</td><td>{fmt.usd(af.monthly_diesel_today_usd)} diesel</td><td>—</td></tr>
          {af.financing.map((f: any) => (
            <tr key={f.id}><td>{f.label}</td><td>{Math.round(f.rate * 100)} % · {f.years} yr</td><td>{fmt.usd(f.monthly_payment_usd)}</td>
              <td style={{ color: f.monthly_net_cashflow_usd >= 0 ? 'var(--gr-rescue)' : 'var(--gr-danger)' }}>{f.monthly_net_cashflow_usd >= 0 ? '+' : ''}{fmt.usd(f.monthly_net_cashflow_usd)} ({fmt.ngn(f.monthly_net_cashflow_ngn)})</td></tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}
