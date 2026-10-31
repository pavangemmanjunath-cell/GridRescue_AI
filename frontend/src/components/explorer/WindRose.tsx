import { MONTHS_UP } from '../../lib/format'
import type { WindData } from '../../api/types'

const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
const polar = (deg: number, r: number): [number, number] => { const rad = (deg * Math.PI) / 180; return [Math.cos(rad) * r, Math.sin(rad) * r] }

/** Wind rose lens — petal length = frequency, opacity = mean speed; centre shows the month's 50 m wind speed. */
export function WindRose({ selectedMonth = 4, size = 280, windData }: { selectedMonth?: number; size?: number; windData: WindData | null }) {
  const petals = windData?.wind_rose?.map((s) => ({ dir: s.direction, freq: s.frequency_pct, speed: s.avg_speed_ms })) ??
    DIRS.map((d) => ({ dir: d, freq: 12.5, speed: 3 }))
  const monthly = windData?.monthly_avg_ms?.[selectedMonth] ?? windData?.annual_avg_ms ?? 0
  const maxFreq = Math.max(...petals.map((p) => p.freq), 1)
  const start = -90 + selectedMonth * 30
  const [x1, y1] = polar(start, 150); const [x2, y2] = polar(start + 30, 150)
  return (
    <svg viewBox="-180 -180 360 360" width={size} height={size} className="gr-radial" data-testid="lens-wind">
      <defs>
        <radialGradient id="gr-wr-ring" cx="50%" cy="35%" r="70%"><stop offset="0%" stopColor="#3A5A85" stopOpacity="0.85" /><stop offset="100%" stopColor="#0B1A2E" stopOpacity="0.75" /></radialGradient>
        <linearGradient id="gr-wr-petal" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stopColor="#5BD4FF" stopOpacity="0.95" /><stop offset="100%" stopColor="#3A86E6" stopOpacity="0.4" /></linearGradient>
        <filter id="gr-wr-anim" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2"><animate attributeName="stdDeviation" values="2;4;2" dur="2s" repeatCount="indefinite" /></feGaussianBlur></filter>
      </defs>
      <circle r="150" fill="none" stroke="url(#gr-wr-ring)" strokeWidth="32" opacity="0.55" />
      <path d={`M ${x1},${y1} A 150,150 0 0 1 ${x2},${y2}`} fill="none" stroke="#22B7E8" strokeWidth="32" opacity="0.78" style={{ transition: 'all 420ms cubic-bezier(0.65,0,0.35,1)' }} />
      <g stroke="#0B1A2E" strokeWidth="1.5" opacity="0.7">{Array.from({ length: 12 }).map((_, i) => <g key={i} transform={`rotate(${-90 + i * 30})`}><line x1="166" y1="0" x2="134" y2="0" /></g>)}</g>
      <g fontFamily="DM Sans, sans-serif" fontSize="10" fontWeight="700" letterSpacing="0.08em" textAnchor="middle" dominantBaseline="middle">
        {MONTHS_UP.map((m, i) => { const a = -90 + i * 30 + 15; const [x, y] = polar(a, 150); const sel = i === selectedMonth
          return <text key={m} x={x} y={y} fill={sel ? '#08111F' : '#FFFFFF'} fontWeight={sel ? 800 : 700} transform={`rotate(${a + 90} ${x} ${y})`}>{m}</text> })}
      </g>
      <circle r="110" fill="rgba(11,26,46,0.18)" stroke="rgba(255,255,255,0.30)" strokeWidth="0.5" />
      <g fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="0.5"><circle r="80" /><circle r="60" /><circle r="40" /><circle r="20" /></g>
      <g fontFamily="JetBrains Mono, monospace" fontSize="8" fontWeight="600" fill="#FFFFFF" textAnchor="middle">
        <text y="-78">{Math.round(maxFreq)}%</text><text y="-58">{Math.round(maxFreq * 0.75)}%</text><text y="-38">{Math.round(maxFreq * 0.5)}%</text><text y="-18">{Math.round(maxFreq * 0.25)}%</text>
      </g>
      <g stroke="rgba(255,255,255,0.18)" strokeWidth="0.5" strokeDasharray="2 3"><line x1="-100" y1="0" x2="100" y2="0" /><line x1="0" y1="-100" x2="0" y2="100" /><line x1="-71" y1="-71" x2="71" y2="71" /><line x1="-71" y1="71" x2="71" y2="-71" /></g>
      <g>
        {petals.map((p, i) => { const angle = -90 + i * 45; const r = (p.freq / maxFreq) * 95; const [ax, ay] = polar(angle - 16, r); const [bx, by] = polar(angle + 16, r)
          return <path key={p.dir} d={`M 0,0 L ${ax},${ay} A ${r},${r} 0 0 1 ${bx},${by} Z`} fill="url(#gr-wr-petal)" stroke="#5BD4FF" strokeWidth="1" opacity={0.5 + Math.min(p.speed / 8, 1) * 0.5} filter="url(#gr-wr-anim)" /> })}
      </g>
      {petals.slice(0, 4).map((p, i) => { if (p.freq < 5) return null; const angle = -90 + i * 45; const r = (p.freq / maxFreq) * 95 * 0.6; const [ex, ey] = polar(angle, r)
        return <line key={'wl' + i} x1="0" y1="0" x2={ex} y2={ey} stroke="#5BD4FF" strokeWidth="0.8" opacity="0.4" strokeDasharray="4 6"><animate attributeName="stroke-dashoffset" values="0;-10" dur="1.5s" repeatCount="indefinite" /></line> })}
      <g fontFamily="DM Sans, sans-serif" fontSize="11" fontWeight="700" fill="#FFFFFF" textAnchor="middle" dominantBaseline="middle">
        {DIRS.map((d, i) => { const [x, y] = polar(-90 + i * 45, 102); return <text key={d} x={x} y={y}>{d}</text> })}
      </g>
      <circle r="22" fill="rgba(11,26,46,0.85)" stroke="#22B7E8" strokeWidth="1.5" />
      <text x="0" y="-2" textAnchor="middle" fontFamily="Space Grotesk, sans-serif" fontWeight="600" fontSize="16" fill="#FFFFFF">{monthly.toFixed(1)}</text>
      <text x="0" y="12" textAnchor="middle" fontFamily="DM Sans, sans-serif" fontWeight="600" fontSize="8" fill="#5BD4FF" letterSpacing="0.08em">M/S 50m</text>
    </svg>
  )
}
