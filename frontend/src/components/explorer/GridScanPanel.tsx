import type { ReactNode } from 'react'
import type { Facility, GridData, WaterData } from '../../api/types'
import { Icon } from '../ui/Icon'

/** Grid strength = the engine's grid class (A Strong … E Critical), so the map, this panel and the Advisor agree. */
const CLASS_COLOR: Record<string, string> = { A: '#22C55E', B: '#84CC16', C: '#F59E0B', D: '#EF4444', E: '#B91C1C' }
export const strengthOf = (rel: GridData['reliability']) => ({ label: rel.class_label, color: CLASS_COLOR[rel.grid_class] ?? '#94A3B8' })

/** Outage cases Nigerian hospitals actually face — each maps to an outage start hour and a duration. */
export const OUTAGES = [
  { id: 'evening', label: 'Evening load-shedding', start: 18, hours: 6, why: 'DisCo feeders are cut most often in the evening peak' },
  { id: 'night', label: 'Overnight outage', start: 18, hours: 12, why: 'supply lost at dusk and not back until morning' },
  { id: 'collapse', label: 'National grid collapse', start: 18, hours: 24, why: 'the national grid collapsed 12 times in 2024 (NERC / TCN)' },
  { id: 'day', label: 'Daytime feeder fault', start: 10, hours: 4, why: 'transformer or feeder repair during clinic hours' },
] as const
export type OutageId = (typeof OUTAGES)[number]['id']

function HalfGauge({ rel, busy }: { rel: GridData['reliability'] | null; busy: boolean }) {
  const score = rel?.reliability_score ?? null
  const v = Math.max(0, Math.min(100, score ?? 0))
  const st = rel ? strengthOf(rel) : { label: '', color: '#94A3B8' }
  const a = Math.PI * (1 - v / 100)
  const x = 90 + 70 * Math.cos(a), y = 90 - 70 * Math.sin(a)
  return (
    <svg viewBox="0 0 180 104" width="100%" style={{ maxWidth: 220, display: 'block', margin: '0 auto' }} data-testid="grid-gauge">
      <path d="M20 90 A70 70 0 0 1 160 90" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="14" strokeLinecap="round" />
      {score != null && <path d={`M20 90 A70 70 0 0 1 ${x.toFixed(1)} ${y.toFixed(1)}`} fill="none" stroke={st.color} strokeWidth="14" strokeLinecap="round" />}
      <text x="90" y="78" textAnchor="middle" fill="#fff" fontSize="28" fontWeight="700">{score ?? (busy ? '…' : '—')}</text>
      <text x="90" y="98" textAnchor="middle" fill={score != null ? st.color : '#94A3B8'} fontSize="13" fontWeight="600">{score != null ? st.label : busy ? 'scanning' : 'no data'}</text>
    </svg>
  )
}

function Ring({ km, g, busy }: { km: number; g: GridData | null; busy: boolean }) {
  const s = g?.power.summary
  const score = g?.reliability.reliability_score
  const st = g ? strengthOf(g.reliability) : null
  return (
    <div className="gr-ring-row" data-testid={`ring-${km}`}>
      <div className="gr-row" style={{ justifyContent: 'space-between', fontSize: 13 }}>
        <b style={{ color: '#fff' }}>Within {km} km</b>
        <span style={{ color: st?.color ?? 'var(--gr-fg-3)', fontWeight: 600 }}>{busy ? <><Icon name="refresh" size={12} className="gr-spin" /> scanning…</> : st ? `${st.label} · ${score}` : 'not available'}</span>
      </div>
      <div className="gr-ring-bar"><div style={{ width: `${score ?? 0}%`, background: st?.color }} /></div>
      {s && <div className="gr-muted" style={{ fontSize: 12 }}>{s.substations} substations ({s.hv_substations} high-voltage) · {s.plants} power plants{s.nearest_substation_km != null ? ` · nearest ${s.nearest_substation_km} km` : ''}</div>}
    </div>
  )
}

interface Props {
  r50: GridData | null; r100: GridData | null; stage: string; water: WaterData | null
  hospitals: Facility[]; picked: Facility | null; onPick: (f: Facility) => void
  outage: OutageId; setOutage: (o: OutageId) => void; onSimulate: () => void; simulating: boolean; sizing?: ReactNode
  /** Brief 12: the new building site and the grid lens around the hospital */
  relocation?: ReactNode
}

export function GridScanPanel({ r50, r100, stage, water, hospitals, picked, onPick, outage, setOutage, onSimulate, simulating, sizing, relocation }: Props) {
  const rel = r50?.reliability
  return (
    <aside className="gr-scan-panel" data-testid="grid-panel">
      {relocation}
      <div className="gr-eyebrow" style={{ color: '#fff' }}>Grid strength at this site</div>
      <HalfGauge rel={rel ?? null} busy={stage === '50'} />
      {rel && <div className="gr-muted" style={{ fontSize: 12, textAlign: 'center', marginBottom: 10 }} data-testid="grid-hours">Grid class {rel.grid_class} · power ≈ {rel.expected_supply_hours_per_day} h a day{rel.reported_supply_hours != null ? ' (reported by the hospital)' : ''} · outage risk {rel.outage_risk}</div>}
      <Ring km={50} g={r50} busy={stage === '50'} />
      <Ring km={100} g={r100} busy={stage === '50' || stage === '100'} />
      <div className="gr-row" style={{ gap: 10, fontSize: 11, color: 'var(--gr-fg-3)', margin: '6px 0 14px' }}>
        <span><i className="gr-sw" style={{ background: '#22C55E' }} />≥132 kV</span><span><i className="gr-sw" style={{ background: '#F59E0B' }} />33 kV</span><span><i className="gr-sw" style={{ background: '#EF4444' }} />low / unknown</span><span><i className="gr-sw" style={{ background: '#60A5FA', borderRadius: 9 }} />hospital</span>
      </div>

      {water && (
        <div className="gr-ring-row" data-testid="water-row" style={{ marginBottom: 14 }}>
          <div className="gr-row" style={{ justifyContent: 'space-between', fontSize: 13 }}><b style={{ color: '#fff' }}>Water · hydrogen &amp; hydro</b><span style={{ color: 'var(--gr-water-light)', fontWeight: 600 }}>{water.scores.water_availability}/100</span></div>
          <div className="gr-muted" style={{ fontSize: 12 }}>{water.waterways.nearest ? `Nearest: ${water.waterways.nearest.name} · ${water.waterways.nearest.distance_km} km` : 'No river or lake within 10 km'} · water for hydrogen {water.scores.hydrogen_water}/100 · terrain head {water.scores.head_m} m (pumped hydro {water.scores.pumped_hydro}/100)</div>
        </div>
      )}

      <div className="gr-eyebrow" style={{ color: '#fff' }}>1 · Pick a hospital</div>
      <ul className="gr-layer-list" data-testid="hospital-list">
        {hospitals.slice(0, 6).map((f) => (
          <li key={f.id} onClick={() => onPick(f)} className={picked?.id === f.id ? 'on' : ''}><b>{f.name}</b><small>{f.distance_km} km</small></li>
        ))}
        {hospitals.length === 0 && <li><span className="gr-muted">Looking for hospitals within 25 km… or click anywhere on the map.</span></li>}
      </ul>

      <div className="gr-eyebrow" style={{ color: '#fff', marginTop: 14 }}>2 · Hospital &amp; daily power use</div>
      {sizing}

      <div className="gr-eyebrow" style={{ color: '#fff', marginTop: 14 }}>3 · Choose the outage</div>
      <div className="gr-stack" style={{ gap: 6 }} data-testid="outage-list">
        {OUTAGES.map((o) => (
          <button key={o.id} className={`gr-outage ${outage === o.id ? 'on' : ''}`} onClick={() => setOutage(o.id)} data-testid={`outage-${o.id}`}>
            <b>{o.label} · {o.hours} h</b><small>from {String(o.start).padStart(2, '0')}:00 — {o.why}</small>
          </button>
        ))}
      </div>
      <button className="gr-btn gr-btn-rescue" style={{ width: '100%', marginTop: 12 }} onClick={onSimulate} disabled={simulating} data-testid="simulate-outage">
        {simulating ? <><Icon name="refresh" size={14} className="gr-spin" /> Simulating…</> : <>4 · Simulate this outage <Icon name="arrow" size={14} /></>}
      </button>
      <div className="gr-muted" style={{ fontSize: 11, marginTop: 6 }}>{picked ? picked.name : 'The pinned site'} · uses live sun, wind and grid data for this location.</div>
    </aside>
  )
}
