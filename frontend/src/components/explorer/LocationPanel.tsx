import { useEffect, useRef, useState } from 'react'
import { api } from '../../api/client'
import { MONTHS, flagEmoji, fmt, weatherDesc } from '../../lib/format'
import type { Mode } from '../../store/useSiteStore'
import type { LocationInfo, SunData, WaterData, WeatherData, WindData } from '../../api/types'
import { AnimatedNumber, Chip } from '../ui/Primitives'
import { Icon } from '../ui/Icon'

interface Props {
  lat: number; lng: number; onSubmit: (lat: number, lng: number) => void; month: number; setMonth: (m: number) => void; mode: Mode
  location: LocationInfo | null; sun: SunData | null; wind: WindData | null; weather: WeatherData | null; water: WaterData | null; loading: boolean
}

// Rough PV/wind capture used only for the explorer read-outs (1 MWp PV, 1 MW wind) — the engine does the real sizing.
const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
const solarMWh = (psh: number, m: number) => Math.round(psh * DAYS[m] * 1000 * 0.78) / 1000
const windMWh = (v: number, m: number) => { const cf = Math.min(0.45, Math.max(0.03, (v / 11) ** 3)); return Math.round(1 * DAYS[m] * 24 * cf * 10) / 10 }

export function LocationPanel({ lat, lng, onSubmit, month, setMonth, mode, location, sun, wind, weather, water, loading }: Props) {
  const [dLat, setDLat] = useState(String(lat)); const [dLng, setDLng] = useState(String(lng))
  useEffect(() => setDLat(lat.toFixed(4)), [lat]); useEffect(() => setDLng(lng.toFixed(4)), [lng])
  const [q, setQ] = useState(''); const [results, setResults] = useState<any[]>([]); const [searching, setSearching] = useState(false)
  const searchTimer = useRef<number>(0)
  useEffect(() => {
    window.clearTimeout(searchTimer.current)
    if (q.trim().length < 2) { setResults([]); return }
    searchTimer.current = window.setTimeout(async () => {
      setSearching(true)
      try { const r = await api.geocode(q.trim()); setResults(r.results) } catch { setResults([]) } finally { setSearching(false) }
    }, 350)
  }, [q])

  const submit = (e?: React.FormEvent) => { e?.preventDefault(); const a = parseFloat(dLat), b = parseFloat(dLng); if (Number.isFinite(a) && Number.isFinite(b)) onSubmit(Math.max(-85, Math.min(85, a)), Math.max(-180, Math.min(180, b))) }
  const chipCls = mode === 'wind' ? 'wind' : mode === 'water' ? 'water' : ''
  const cur = weather?.current
  const forecast = weather?.forecast?.slice(0, 5) ?? []

  type Track = { label: string; data: number[]; unit: string; color: string; sub: (v: number, i: number) => string; source?: string }
  const tracks: Track[] = []
  if (mode === 'sun') tracks.push({ label: 'Peak sun hours', data: sun?.monthly_psh ?? [], unit: 'h/day', color: 'var(--gr-sun-500)', sub: (v, i) => `${fmt.num(solarMWh(v, i), 1)} MWh/MWp capturable`, source: sun?.source })
  if (mode === 'wind') tracks.push({ label: 'Wind speed · 50 m', data: wind?.monthly_avg_ms ?? [], unit: 'm/s', color: 'var(--gr-wind)', sub: (v, i) => `${fmt.num(windMWh(v, i), 0)} MWh/MW capturable`, source: wind?.rose_source })
  if (mode === 'water') tracks.push({ label: 'Rainfall', data: water?.monthly_precip_mm_day ?? [], unit: 'mm/day', color: 'var(--gr-water)', sub: (v, i) => `${fmt.num(v * DAYS[i], 0)} mm in ${MONTHS[i]} · nearest water ${water?.waterways.nearest ? `${water.waterways.nearest.name} ${water.waterways.nearest.distance_km} km` : 'none in 10 km'}`, source: water?.discharge?.source })

  return (
    <aside className="gr-loc-panel" data-testid="location-panel">
      <section>
        <div className="gr-eyebrow">Location</div>
        <div className="gr-search">
          <div style={{ position: 'relative' }}>
            <input className="gr-input" placeholder="Search a city or hospital town…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search place" data-testid="place-search" />
            <span style={{ position: 'absolute', right: 10, top: 11, color: 'var(--gr-fg-3)' }}>{searching ? <Icon name="refresh" size={14} className="gr-spin" /> : <Icon name="search" size={14} />}</span>
          </div>
          {results.length > 0 && (
            <div className="gr-search-results" role="listbox">
              {results.map((r, i) => (
                <div key={i} className="gr-search-item" role="option" aria-selected={false} onClick={() => { onSubmit(r.lat, r.lng); setQ(''); setResults([]) }}>
                  <span>{flagEmoji(r.country_code)} <b>{r.name}</b>{r.admin1 ? `, ${r.admin1}` : ''}</span><small>{r.country}</small>
                </div>
              ))}
            </div>
          )}
        </div>
        <form onSubmit={submit} style={{ marginTop: 10 }}>
          <div className="gr-coord-grid">
            <label className="gr-field"><span className="gr-label">Latitude</span><input className="gr-input gr-input-mono" value={dLat} onChange={(e) => setDLat(e.target.value)} inputMode="decimal" data-testid="lat-input" /></label>
            <label className="gr-field"><span className="gr-label">Longitude</span><input className="gr-input gr-input-mono" value={dLng} onChange={(e) => setDLng(e.target.value)} inputMode="decimal" data-testid="lng-input" /></label>
          </div>
          <button type="submit" className="gr-btn" style={{ width: '100%', marginTop: 10 }} data-testid="go-btn"><Icon name="target" size={14} /> Go to location</button>
        </form>
        <div className="gr-place-card">
          <div className="gr-place-flag">{loading && !location ? <Icon name="refresh" size={20} className="gr-spin" /> : flagEmoji(location?.country_code)}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="gr-place-city" data-testid="place-name">{location ? location.name : loading ? 'Resolving…' : fmt.coord(lat, lng)}</div>
            <div className="gr-place-country">
              <span>{location ? [location.state, location.country].filter(Boolean).join(', ') : '—'}</span>
              {location?.country_code && location.country_code !== 'XX' && <span className="gr-place-cc">{location.country_code}</span>}
              {location?.grid_class && <span className="gr-chip" style={{ background: 'rgba(255,107,107,0.14)', color: 'var(--gr-grid)' }}>grid {location.grid_class}</span>}
            </div>
          </div>
        </div>
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--gr-fg-3)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <span className="gr-mono">{lat.toFixed(4)}°, {lng.toFixed(4)}°</span>
          {location && <span>{location.elevation_m} m a.s.l.</span>}
          {location?.disco && <span title="Distribution company">{location.disco.split('(')[1]?.replace(')', '') || location.disco}</span>}
        </div>
      </section>

      {cur && (
        <section className="gr-weather-card" data-testid="weather-card">
          <div className="gr-weather-now">
            <span style={{ fontSize: 24 }}>{weatherDesc(cur.weather_code).icon}</span>
            <span className="gr-weather-temp">{Math.round(cur.temperature_c)}°</span>
            <span>{weatherDesc(cur.weather_code).text}<br /><span style={{ color: 'var(--gr-fg-3)', fontSize: 12 }}>💧{cur.humidity_pct}% · 💨{cur.wind_speed_ms} m/s · UV {cur.uv_index}</span></span>
          </div>
          {forecast.length > 0 && (
            <div className="gr-forecast">
              {forecast.map((d, i) => (
                <div key={d.date} className="gr-forecast-day"><span>{i === 0 ? 'Today' : new Date(d.date + 'T00:00').toLocaleDateString('en', { weekday: 'short' })}</span><span style={{ fontSize: 16 }}>{weatherDesc(d.weather_code).icon}</span><b>{Math.round(d.temp_max_c)}° <span style={{ color: 'var(--gr-wind-light)', fontWeight: 400 }}>{Math.round(d.temp_min_c)}°</span></b></div>
              ))}
            </div>
          )}
        </section>
      )}

      <section>
        <div className="gr-eyebrow" style={{ display: 'flex', justifyContent: 'space-between' }}><span>Month</span><span style={{ color: 'var(--gr-fg-4)' }}>climatology 2001–2020</span></div>
        <div className="gr-month-grid" data-testid="month-grid">
          {MONTHS.map((m, i) => <button key={m} className={`gr-month-chip ${i === month ? `on ${chipCls}` : ''}`} onClick={() => setMonth(i)} aria-pressed={i === month}>{m}</button>)}
        </div>
      </section>

      {tracks.map((t) => {
        const data = t.data.length === 12 ? t.data : new Array(12).fill(0)
        const max = Math.max(...data, 0.1)
        const v = data[month] ?? 0
        return (
          <section key={t.label} data-testid={`track-${t.label.split(' ')[0].toLowerCase()}`}>
            <div className="gr-eyebrow" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span>{t.label} · monthly</span>{t.source && <Chip kind={t.source.includes('model') || t.source.includes('unavailable') || t.source.includes('fallback') ? 'model' : 'live'}>{t.source.includes('model') || t.source.includes('unavailable') || t.source.includes('fallback') ? 'model' : 'live'}</Chip>}</div>
            <div className="gr-bars">
              {data.map((x, i) => <div className="gr-bar-col" key={i} title={`${MONTHS[i]}: ${x.toFixed(1)} ${t.unit}`}><div className="gr-bar" style={{ height: `${(x / max) * 100}%`, background: i === month ? t.color : 'var(--gr-surface-3)' }} /><div className="gr-bar-label">{MONTHS[i][0]}</div></div>)}
            </div>
            <div className="gr-bar-readout"><AnimatedNumber value={v} decimals={1} className="gr-metric" style={{ color: t.color }} /><span className="gr-metric-unit">{t.unit} · {MONTHS[month]}</span></div>
            <div className="gr-track-note"><Icon name="zap" size={12} style={{ color: 'var(--gr-rescue)' }} /><span>{t.sub(v, month)}</span></div>
          </section>
        )
      })}

    </aside>
  )
}
