import { MONTHS } from '../../lib/format'
import type { Mode } from '../../store/useSiteStore'

export function LegendStrip({ month, mode }: { month: number; mode: Mode }) {
  const items = mode === 'wind' ? [{ color: '#22B7E8', label: 'prevailing wind' }, { color: 'rgba(91,212,255,0.5)', label: 'wind frequency' }]
    : mode === 'water' ? [{ color: '#7FB2FF', label: 'monthly rainfall' }, { color: '#3A86E6', label: 'rivers & lakes' }]
    : [{ color: '#FF9A3C', label: 'sun trace of day' }, { color: 'rgba(212,160,86,0.6)', label: 'all sun traces' }]
  return (
    <div className="gr-legend" data-testid="legend">
      <span className="gr-legend-item"><span className="gr-legend-swatch" style={{ background: items[0].color }} />{items[0].label}</span>
      <span className="gr-legend-day"><span className="gr-legend-day-num">15</span><span style={{ fontSize: 12 }}>{MONTHS[month]} · typical day</span></span>
      {items.slice(1).map((it) => <span key={it.label} className="gr-legend-item"><span className="gr-legend-swatch" style={{ background: it.color }} />{it.label}</span>)}
    </div>
  )
}
