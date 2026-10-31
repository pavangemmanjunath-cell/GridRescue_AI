import { Card, Chip } from '../ui/Primitives'
import { Icon } from '../ui/Icon'

/** Short names for the ML model's system families. */
export const FAMILY_SHORT: Record<string, string> = {
  solar_backup: 'Solar + battery', solar_backup_gen: 'Solar + battery + generator', solar_flow: 'Solar + flow battery',
  grid_backup: 'Grid-charged battery', gen_backup: 'Generator + battery', wind_backup: 'Wind + battery',
  solar_wind_backup: 'Solar + wind + battery', hydrogen: 'Solar + hydrogen', pumped_hydro: 'Pumped hydro', ups_only: 'UPS only',
}
const COLOR: Record<string, string> = {
  solar_backup: '#F0CB72', solar_backup_gen: '#F59E0B', solar_flow: '#4ADE80', grid_backup: '#7FB2FF', gen_backup: '#EF6B5C',
  wind_backup: '#22B7E8', solar_wind_backup: '#38BDF8', hydrogen: '#8B8BFF', pumped_hydro: '#3A86E6', ups_only: '#B8C4D9',
}

export type MLPrediction = {
  family: string; family_label: string; confidence: number; algorithm?: string; explainer_family?: string
  probabilities: { family: string; label: string; p: number }[]
  decision_path: { feature: string; label: string; op: string; threshold: number; value: number }[]
}

/**
 * The ML classifier's pick for this configuration: a Random Forest of decision trees votes the system family
 * (with a probability for each), a single decision tree gives the readable rules, and — when the full engine has run —
 * the hourly simulation's verdict is shown beside it.
 */
export function MLCard({ pred, meta, verdict, title = 'ML pick for this configuration', live, testid = 'ml-card' }: {
  pred: MLPrediction | null | undefined; meta?: any; verdict?: { agrees: boolean; engineName: string } | null
  title?: string; live?: 'loading' | 'ready' | 'error'; testid?: string
}) {
  return (
    <Card className="gr-ml" data-testid={testid}>
      <div className="gr-card-head">
        <div className="gr-eyebrow"><Icon name="radar" size={12} /> {title}</div>
        <span title={pred?.algorithm}><Chip kind="live">{live === 'loading' ? 'updating…' : pred?.algorithm?.split(' · ')[0] ?? 'ML'}</Chip></span>
      </div>
      {!pred ? <div className="gr-muted" style={{ fontSize: 13 }}>{live === 'error' ? 'The ML model is not reachable — is the backend running?' : 'Reading the configuration…'}</div> : (
        <>
          <div className="gr-ml-top">
            <div>
              <div className="gr-ml-family" data-testid={`${testid}-family`} style={{ color: COLOR[pred.family] ?? '#fff' }}>{FAMILY_SHORT[pred.family] ?? pred.family_label}</div>
              <div className="gr-muted" style={{ fontSize: 12 }}>{pred.family_label}</div>
            </div>
            <div className="gr-ml-conf" data-testid={`${testid}-confidence`} style={{ ['--p' as string]: `${Math.round(pred.confidence * 100)}%`, ['--c' as string]: COLOR[pred.family] ?? '#4ADE80' }}>
              <b>{Math.round(pred.confidence * 100)}%</b><small>of the vote</small>
            </div>
          </div>
          <div className="gr-ml-probs" data-testid={`${testid}-probs`}>
            {pred.probabilities.slice(0, 3).map((p) => (
              <div key={p.family} className="gr-ml-prob">
                <span>{FAMILY_SHORT[p.family] ?? p.label}</span>
                <i><em style={{ width: `${Math.max(2, p.p * 100)}%`, background: COLOR[p.family] ?? '#7FB2FF' }} /></i>
                <b>{Math.round(p.p * 100)}%</b>
              </div>
            ))}
          </div>
          <div className="gr-ml-path" data-testid={`${testid}-path`}>
            <small>Why · decision-tree rules</small>
            {pred.decision_path.slice(0, 3).map((r, i) => <span key={i}>{r.label} <b>{r.value}</b> {r.op} {r.threshold}</span>)}
          </div>
          {verdict && (
            <div className={`gr-ml-verdict ${verdict.agrees ? 'ok' : 'diff'}`} data-testid={`${testid}-verdict`}>
              <Icon name={verdict.agrees ? 'check' : 'info'} size={13} />
              {verdict.agrees ? 'The hourly simulation agrees.' : `The hourly simulation picks ${verdict.engineName} — the simulation decides.`}
            </div>
          )}
          {meta && <div className="gr-muted" style={{ fontSize: 11 }} data-testid={`${testid}-accuracy`}>
            {Math.round(meta.accuracy_test * 1000) / 10} % right on {Number(meta.n_test).toLocaleString()} unseen sites (top-2 {Math.round(meta.top2_accuracy_test * 1000) / 10} %) · one decision tree {Math.round(meta.cart_accuracy_test * 1000) / 10} % · guessing {Math.round(meta.majority_baseline_test * 1000) / 10} %
          </div>}
        </>
      )}
    </Card>
  )
}
