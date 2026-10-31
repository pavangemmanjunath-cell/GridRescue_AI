import { MONTHS_UP } from '../../lib/format'
import type { SunData } from '../../api/types'

const polar = (deg: number, r: number): [number, number] => { const rad = (deg * Math.PI) / 180; return [Math.cos(rad) * r, Math.sin(rad) * r] }
const FALLBACK = [5.5, 5.6, 5.9, 5.8, 5.5, 5.0, 4.5, 4.1, 4.8, 5.4, 5.8, 5.6]

/** Signature radial sun chart: month band, 24-h ring, altitude grid and the day's sun-trace ribbon scaled by real PSH. */
export function RadialSunChart({ selectedMonth = 4, size = 280, sunData }: { selectedMonth?: number; size?: number; sunData: SunData | null }) {
  const monthly = sunData?.monthly_psh ?? FALLBACK
  const current = monthly[selectedMonth] ?? 0
  const max = Math.max(...monthly, 1)
  const traceHeight = 20 + (current / max) * 60
  const tracePath = `M -95,0 A 95,${traceHeight} 0 0 1 95,0`
  const sunDotX = 28
  const sunDotY = -Math.sin(((28 + 95) / 190) * Math.PI) * traceHeight * 0.95
  const opac = monthly.map((p) => 0.3 + (p / max) * 0.7)
  return (
    <svg viewBox="-180 -180 360 360" width={size} height={size} className="gr-radial" data-testid="lens-sun">
      <defs>
        <radialGradient id="gr-ring-grad" cx="50%" cy="35%" r="70%"><stop offset="0%" stopColor="#3A5A85" stopOpacity="0.85" /><stop offset="100%" stopColor="#0B1A2E" stopOpacity="0.75" /></radialGradient>
        <filter id="gr-sun-pulse" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="5"><animate attributeName="stdDeviation" values="4;7;4" dur="3s" repeatCount="indefinite" /></feGaussianBlur></filter>
      </defs>
      <circle r="150" fill="none" stroke="url(#gr-ring-grad)" strokeWidth="32" opacity="0.55" />
      {monthly.map((_, i) => {
        const s = -90 + i * 30; const [sx, sy] = polar(s, 150); const [ex, ey] = polar(s + 30, 150)
        return <path key={i} d={`M ${sx},${sy} A 150,150 0 0 1 ${ex},${ey}`} fill="none" stroke="#D4A056" strokeWidth="32" opacity={i === selectedMonth ? 0.78 : opac[i] * 0.15} style={{ transition: 'all 420ms cubic-bezier(0.65,0,0.35,1)' }} />
      })}
      <g stroke="#0B1A2E" strokeWidth="1.5" opacity="0.7">{Array.from({ length: 12 }).map((_, i) => <g key={i} transform={`rotate(${-90 + i * 30})`}><line x1="166" y1="0" x2="134" y2="0" /></g>)}</g>
      <g fontFamily="DM Sans, sans-serif" fontSize="10" fontWeight="700" letterSpacing="0.08em" textAnchor="middle" dominantBaseline="middle">
        {MONTHS_UP.map((m, i) => { const a = -90 + i * 30 + 15; const [x, y] = polar(a, 150); const sel = i === selectedMonth
          return <text key={m} x={x} y={y} fill={sel ? '#1A1108' : '#FFFFFF'} fontWeight={sel ? 800 : 700} transform={`rotate(${a + 90} ${x} ${y})`}>{m}</text> })}
      </g>
      <circle r="110" fill="rgba(11,26,46,0.18)" stroke="rgba(255,255,255,0.30)" strokeWidth="0.5" />
      <circle r="92" fill="none" stroke="rgba(255,255,255,0.30)" strokeWidth="0.5" />
      <g stroke="rgba(255,255,255,0.35)" strokeWidth="0.5">{Array.from({ length: 24 }).map((_, i) => <g key={i} transform={`rotate(${-90 + i * 15})`}><line x1="110" y1="0" x2="92" y2="0" /></g>)}</g>
      <g fontFamily="DM Sans, sans-serif" fontSize="10" fontWeight="600" fill="#FFFFFF" textAnchor="middle" dominantBaseline="middle">
        {[0, 3, 6, 9, 12, 15, 18, 21].map((h) => { const [x, y] = polar(-90 + h * 15, 101); return <text key={h} x={x} y={y}>{h}</text> })}
      </g>
      <g fill="none" stroke="rgba(255,255,255,0.22)" strokeWidth="0.5"><circle r="80" /><circle r="65" /><circle r="50" /><circle r="35" /><circle r="20" /></g>
      <g fontFamily="DM Sans, sans-serif" fontSize="9" fontWeight="600" fill="#FFFFFF" textAnchor="middle">
        <text x="0" y="-78">15°</text><text x="0" y="-63">30°</text><text x="0" y="-48">45°</text><text x="0" y="-33">60°</text><text x="0" y="-18">75°</text>
      </g>
      <path d="M -90,0 A 90,55 0 0 1 90,0" fill="rgba(212,160,86,0.18)" />
      <path d={tracePath} fill="none" stroke="#FF9A3C" strokeWidth="2.5" style={{ transition: 'all 420ms cubic-bezier(0.65,0,0.35,1)' }} />
      <circle cx={sunDotX} cy={sunDotY} r="18" fill="#FF9A3C" opacity="0.12" filter="url(#gr-sun-pulse)" />
      <circle cx={sunDotX} cy={sunDotY} r="6" fill="#F0CB72" stroke="#FF9A3C" strokeWidth="1.5" style={{ transition: 'all 420ms' }} />
      <g>
        <circle r="18" fill="rgba(11,26,46,0.85)" stroke="#D4A056" strokeWidth="1" />
        <text x="0" y="-2" textAnchor="middle" fontFamily="Space Grotesk, sans-serif" fontWeight="700" fontSize="14" fill="#F0CB72">{current.toFixed(1)}</text>
        <text x="0" y="10" textAnchor="middle" fontFamily="DM Sans, sans-serif" fontWeight="600" fontSize="6" fill="#D4A056" letterSpacing="0.1em">PSH</text>
      </g>
    </svg>
  )
}
