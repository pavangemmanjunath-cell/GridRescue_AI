import { MONTHS_UP } from '../../lib/format'
import type { WaterData } from '../../api/types'

const polar = (deg: number, r: number): [number, number] => { const rad = (deg * Math.PI) / 180; return [Math.cos(rad) * r, Math.sin(rad) * r] }

/** Water lens — 12 rainfall bars around the ring (NASA POWER), centre = water score for hydrogen / hydro. */
export function WaterLens({ selectedMonth = 4, size = 280, water }: { selectedMonth?: number; size?: number; water: WaterData | null }) {
  const rain = water?.monthly_precip_mm_day ?? new Array(12).fill(0)
  const max = Math.max(...rain, 0.5)
  const score = water?.scores.water_availability ?? 0
  return (
    <svg viewBox="-180 -180 360 360" width={size} height={size} className="gr-radial" data-testid="lens-water">
      <circle r="150" fill="none" stroke="rgba(58,134,230,0.35)" strokeWidth="32" opacity="0.6" />
      <g fontFamily="DM Sans, sans-serif" fontSize="10" fontWeight="700" textAnchor="middle" dominantBaseline="middle">
        {MONTHS_UP.map((m, i) => { const a = -90 + i * 30 + 15; const [x, y] = polar(a, 150); const sel = i === selectedMonth
          return <text key={m} x={x} y={y} fill={sel ? '#7FB2FF' : '#FFFFFF'} fontWeight={sel ? 800 : 700} transform={`rotate(${a + 90} ${x} ${y})`}>{m}</text> })}
      </g>
      <circle r="120" fill="rgba(11,26,46,0.35)" stroke="rgba(255,255,255,0.25)" strokeWidth="0.5" />
      {rain.map((v, i) => {
        const a = -90 + i * 30 + 15, r0 = 40, r1 = 40 + (v / max) * 74
        const [x0, y0] = polar(a, r0); const [x1, y1] = polar(a, r1)
        return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} stroke={i === selectedMonth ? '#7FB2FF' : '#3A86E6'} strokeWidth="14" strokeLinecap="round" opacity={i === selectedMonth ? 1 : 0.65} />
      })}
      <circle r="32" fill="rgba(11,26,46,0.9)" stroke="#3A86E6" strokeWidth="1.5" />
      <text x="0" y="-3" textAnchor="middle" fontFamily="Space Grotesk, sans-serif" fontWeight="600" fontSize="17" fill="#FFFFFF">{score}</text>
      <text x="0" y="12" textAnchor="middle" fontFamily="DM Sans, sans-serif" fontWeight="600" fontSize="8" fill="#7FB2FF" letterSpacing="0.06em">WATER /100</text>
    </svg>
  )
}
