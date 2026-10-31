export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const MONTHS_UP = MONTHS.map((m) => m.toUpperCase())

export const fmt = {
  coord: (lat: number, lng: number, d = 2) => `${Math.abs(lat).toFixed(d)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lng).toFixed(d)}°${lng >= 0 ? 'E' : 'W'}`,
  usd: (v: number | null | undefined, digits = 0) => (v == null ? '—' : `$${v.toLocaleString('en-US', { maximumFractionDigits: digits })}`),
  usdShort: (v: number | null | undefined) => {
    if (v == null) return '—'
    if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
    if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(2)}M`
    if (Math.abs(v) >= 1e3) return `$${(v / 1e3).toFixed(0)}k`
    return `$${v.toFixed(0)}`
  },
  ngn: (v: number | null | undefined) => (v == null ? '—' : `₦${v >= 1e9 ? (v / 1e9).toFixed(2) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`),
  num: (v: number | null | undefined, digits = 0) => (v == null || Number.isNaN(v) ? '—' : v.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits })),
  kw: (v: number | null | undefined) => (v == null ? '—' : v >= 1000 ? `${(v / 1000).toFixed(2)} MW` : `${v.toFixed(0)} kW`),
  kwh: (v: number | null | undefined) => (v == null ? '—' : v >= 1000 ? `${(v / 1000).toFixed(2)} MWh` : `${v.toFixed(0)} kWh`),
  pct: (v: number | null | undefined, d = 0) => (v == null ? '—' : `${v.toFixed(d)} %`),
  hours: (h: number) => (h < 1 ? `${Math.round(h * 60)} min` : h >= 48 ? `${(h / 24).toFixed(1)} days` : `${h.toFixed(h % 1 ? 1 : 0)} h`),
  m3s: (v: number | null | undefined) => (v == null ? '—' : `${v >= 100 ? v.toFixed(0) : v.toFixed(1)} m³/s`),
  hour: (h: number) => `${String(h).padStart(2, '0')}:00`,
}

export const flagEmoji = (cc?: string | null) => {
  if (!cc || cc.length !== 2 || cc === 'XX') return '🌍'
  const up = cc.toUpperCase()
  return String.fromCodePoint(127397 + up.charCodeAt(0)) + String.fromCodePoint(127397 + up.charCodeAt(1))
}

export const weatherDesc = (code?: number | null): { icon: string; text: string } => {
  if (code == null) return { icon: '☀️', text: 'Clear' }
  if (code === 0) return { icon: '☀️', text: 'Clear sky' }
  if (code <= 3) return { icon: '⛅', text: 'Partly cloudy' }
  if (code <= 49) return { icon: '🌫️', text: 'Fog / haze' }
  if (code <= 59) return { icon: '🌦️', text: 'Drizzle' }
  if (code <= 69) return { icon: '🌧️', text: 'Rain' }
  if (code <= 79) return { icon: '🌨️', text: 'Snow' }
  if (code <= 82) return { icon: '🌧️', text: 'Showers' }
  if (code <= 86) return { icon: '🌨️', text: 'Snow showers' }
  return { icon: '⛈️', text: 'Thunderstorm' }
}

export const suitabilityClass = (s: string) => (s === 'High' ? 'gr-chip-high' : s === 'Medium' ? 'gr-chip-medium' : s === 'Low' ? 'gr-chip-low' : 'gr-chip-not')

export const scoreColor = (v: number) => (v >= 70 ? 'var(--gr-rescue)' : v >= 45 ? 'var(--gr-sun-300)' : v >= 25 ? 'var(--gr-sun-trace)' : 'var(--gr-danger)')

export const PART_LABEL: Record<string, string> = {
  ups: 'UPS', li_ion: 'Li-ion backup device', flow: 'Flow backup device', hydrogen: 'Hydrogen', pumped_hydro: 'Pumped hydro', solar_pv: 'Solar PV', wind: 'Wind turbine', diesel_gen: 'Generator',
}
export const PART_COLOR: Record<string, string> = {
  ups: '#B8C4D9', li_ion: '#4ADE80', flow: '#2EE6A6', hydrogen: '#8B8BFF', pumped_hydro: '#3A86E6', solar_pv: '#F0CB72', wind: '#22B7E8', diesel_gen: '#FF6B6B',
}
