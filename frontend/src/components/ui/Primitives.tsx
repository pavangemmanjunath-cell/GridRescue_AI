import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { scoreColor, suitabilityClass } from '../../lib/format'

/** Smooth counter that animates between values. */
export function AnimatedNumber({ value, decimals = 0, duration = 600, prefix = '', suffix = '', className = '', style }: { value: number; decimals?: number; duration?: number; prefix?: string; suffix?: string; className?: string; style?: CSSProperties }) {
  const [display, setDisplay] = useState(value)
  const prev = useRef(value)
  useEffect(() => {
    const from = prev.current
    const to = value
    prev.current = to
    if (from === to || !Number.isFinite(from) || !Number.isFinite(to)) { setDisplay(to); return }
    const start = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1)
      const ease = t === 1 ? 1 : 1 - Math.pow(2, -10 * t)
      setDisplay(from + (to - from) * ease)
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    const safety = setTimeout(() => setDisplay(to), duration + 50)
    return () => { cancelAnimationFrame(raf); clearTimeout(safety) }
  }, [value, duration])
  const txt = Number.isFinite(display) ? display.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : '—'
  return <span className={`gr-metric-pop ${className}`} style={style}>{prefix}{txt}{suffix}</span>
}

export function Stat({ label, value, sub, accent, unit }: { label: string; value: ReactNode; sub?: ReactNode; accent?: string; unit?: string }) {
  return (
    <div className="gr-stat">
      <span className="gr-stat-label">{label}</span>
      <span className="gr-stat-value" style={accent ? { color: accent } : undefined}>{value}{unit && <span className="gr-metric-unit">{unit}</span>}</span>
      {sub && <span className="gr-stat-sub">{sub}</span>}
    </div>
  )
}

export function Chip({ children, kind, style }: { children: ReactNode; kind?: string; style?: CSSProperties }) {
  const cls = kind === 'live' ? 'gr-chip-live' : kind === 'model' ? 'gr-chip-model' : kind ? suitabilityClass(kind) : ''
  return <span className={`gr-chip ${cls}`} style={style}>{children}</span>
}

export function ScoreBar({ label, value, color }: { label: string; value: number; color?: string }) {
  const v = Math.max(0, Math.min(100, value))
  return (
    <div className="gr-score">
      <span className="gr-score-label">{label}</span>
      <div className="gr-score-track"><div className="gr-score-fill" style={{ width: `${v}%`, background: color ?? scoreColor(v) }} /></div>
      <span className="gr-score-val">{Math.round(v)}</span>
    </div>
  )
}

export function Skeleton({ width = '100%', height = 16, style }: { width?: string | number; height?: string | number; style?: CSSProperties }) {
  return <span className="gr-skeleton" style={{ width, height, display: 'inline-block', ...style }} />
}

let toastTimer: number | undefined
export function showToast(message: string) {
  document.querySelector('.gr-toast')?.remove()
  const el = document.createElement('div')
  el.className = 'gr-toast'
  el.textContent = message
  document.body.appendChild(el)
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => el.remove(), 2600)
}

export function Card({ children, className = '', style, accent, ...rest }: { children: ReactNode; className?: string; style?: CSSProperties; accent?: boolean } & Record<string, unknown>) {
  return <section className={`gr-card ${accent ? 'gr-card-accent' : ''} ${className}`} style={style} {...(rest as object)}>{children}</section>
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="gr-eyebrow">{children}</div>
}
