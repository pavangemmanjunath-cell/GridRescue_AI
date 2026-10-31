import type { Assessment, CaseData, DataSource, EnergyData, FacilitiesData, FacilityInput, FeederCheck, GridData, HourlyProfile, LocationInfo, SolarCheck, Suggestions, SunData, Technology, WaterData, WeatherData, WindData, AssessOptions } from './types'

/** Backend base URL: dev → Vite proxy ('' → /api), prod → same host on :8000 unless VITE_API_URL is set. */
export const API_BASE: string =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  (import.meta.env.DEV ? '' : `${window.location.protocol}//${window.location.hostname}:8000`)

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

async function get<T>(path: string, params?: Record<string, string | number | boolean | undefined>, signal?: AbortSignal): Promise<T> {
  const url = new URL(`${API_BASE}${path}`, window.location.origin)
  if (params) for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
  const r = await fetch(url.toString(), { signal, headers: { Accept: 'application/json' } })
  if (!r.ok) throw new ApiError(r.status, await r.text())
  return r.json() as Promise<T>
}

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, signal })
  if (!r.ok) throw new ApiError(r.status, await r.text())
  const ct = r.headers.get('content-type') || ''
  return (ct.includes('application/json') ? r.json() : r.text()) as Promise<T>
}

export const api = {
  health: () => get<{ status: string; mode: string; version: string }>('/health'),
  location: (lat: number, lng: number, signal?: AbortSignal) => get<LocationInfo>('/api/location', { lat, lng }, signal),
  geocode: (q: string) => get<{ results: { name: string; lat: number; lng: number; country: string; country_code: string; admin1?: string; in_africa: boolean }[] }>('/api/geocode', { q }),
  sun: (lat: number, lng: number, signal?: AbortSignal) => get<SunData>('/api/sun', { lat, lng }, signal),
  wind: (lat: number, lng: number, signal?: AbortSignal) => get<WindData>('/api/wind', { lat, lng }, signal),
  weather: (lat: number, lng: number, signal?: AbortSignal) => get<WeatherData>('/api/weather', { lat, lng }, signal),
  water: (lat: number, lng: number, signal?: AbortSignal) => get<WaterData>('/api/water', { lat, lng, radius_km: 10 }, signal),
  grid: (lat: number, lng: number, signal?: AbortSignal, gridClass?: string | null, radiusKm = 30, supplyHours?: number | null) => get<GridData>('/api/grid', { lat, lng, radius_km: radiusKm, grid_class: gridClass ?? undefined, supply_hours: supplyHours ?? undefined }, signal),
  gridScan: (lat: number, lng: number, signal?: AbortSignal, gridClass?: string | null, supplyHours?: number | null) => get<{ source: string; country: any; rings: { radius_km: number; power: GridData['power']; reliability: GridData['reliability'] }[] }>('/api/grid/scan', { lat, lng, grid_class: gridClass ?? undefined, supply_hours: supplyHours ?? undefined }, signal),
  caseData: (id: string) => get<CaseData>(`/api/cases/${id}`),
  tariff: (lat: number, lng: number, hour?: number | null, signal?: AbortSignal) => get<any>('/api/tariff', { lat, lng, hour: hour ?? undefined }, signal),
  caseConsumption: (id: string, dailyKwh?: number | null) => get<any>(`/api/cases/${id}/consumption`, { daily_kwh: dailyKwh ?? undefined }),
  suggestSites: (lat: number, lng: number, signal?: AbortSignal) => get<Suggestions>('/api/relocation/suggest', { lat, lng }, signal),
  solarCheck: (lat: number, lng: number, signal?: AbortSignal) => get<SolarCheck>('/api/solar-check', { lat, lng }, signal),
  // the organisers' open data and tools: grid-first feeder load flow, ENERGYDATA.INFO datasets, the source list, GeoJSON for QGIS
  feeder: (lat: number, lng: number, kw: number, kwConnected?: number | null, signal?: AbortSignal) => get<FeederCheck>('/api/grid/feeder', { lat, lng, kw, kw_connected: kwConnected ?? undefined }, signal),
  energydata: (lat: number, lng: number, signal?: AbortSignal) => get<EnergyData>('/api/energydata', { lat, lng }, signal),
  sources: () => get<{ sources: DataSource[] }>('/api/sources'),
  geojsonUrl: (lat: number, lng: number, name?: string) => `${API_BASE}/api/grid/geojson?lat=${lat}&lng=${lng}${name ? `&name=${encodeURIComponent(name)}` : ''}`,
  facilities: (lat: number, lng: number, signal?: AbortSignal) => get<FacilitiesData>('/api/facilities', { lat, lng, radius_km: 25 }, signal),
  hourly: (lat: number, lng: number, month: number) => get<HourlyProfile>('/api/hourly', { lat, lng, month }),
  technologies: () => get<{ technologies: Technology[]; references: { id: string; title: string; url: string }[] }>('/api/technologies'),
  facilityTypes: () => get<{ types: any[] }>('/api/facility-types'),
  assess: (location: { lat: number; lng: number }, facility: FacilityInput, options: Partial<AssessOptions>, signal?: AbortSignal) =>
    post<Assessment>('/api/assess', { location, facility, options }, signal),
  report: (assessment: Assessment) => post<string>('/api/report', assessment),
  /** ML pick for a facility configuration at a site (Random Forest probabilities + CART rules), without the simulation. */
  mlPredict: (location: { lat: number; lng: number }, facility: FacilityInput, options: Record<string, unknown> = {}, signal?: AbortSignal) =>
    post<any>('/api/ml/predict', { location, facility, options }, signal),
  mlModel: () => get<any>('/api/ml/model'),
  /** Ask GridRescue: retrieval over the internal knowledge base, answer built only from the cited passages. */
  ask: (question: string, context?: { place?: string; facts: string[] } | null) => post<any>('/api/ask', { question, context: context ?? null }),
  kbStats: () => get<any>('/api/kb/stats'),
  history: (limit = 12) => get<{ assessments: any[] }>('/api/history', { limit }),
  esgReport: (assessment: Assessment, carbonPrice?: number | null, optionId?: string | null, lens?: string | null) =>
    post<string>('/api/report/esg', { assessment, carbon_price_usd_per_t: carbonPrice ?? null, option_id: optionId ?? null, lens: lens ?? null }),
  loadModel: (facility: FacilityInput, signal?: AbortSignal) => post<{ daily_kwh: number; peak_load_kw: number; critical_peak_kw: number; protected_peak_kw: number; facility_label: string }>('/api/load-model', facility, signal),
}
