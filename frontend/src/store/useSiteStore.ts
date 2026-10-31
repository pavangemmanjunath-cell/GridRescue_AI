import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { api } from '../api/client'
import type { Assessment, CaseData, FacilitiesData, FacilityInput, GridData, LocationInfo, SitePoint, SunData, WaterData, WeatherData, WindData } from '../api/types'

export type Mode = 'sun' | 'wind' | 'water'

/** Prices the cost calculator runs on (₦). Defaults: NBS national diesel average, NERC Band A tariff, CBN rate. */
export interface Prices { diesel_ngn_per_l: number; grid_ngn_per_kwh: number; usd_to_ngn: number }
export const DEFAULT_PRICES: Prices = { diesel_ngn_per_l: 3277, grid_ngn_per_kwh: 209.5, usd_to_ngn: 1330 }

/** Great-circle distance in km. */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

export const DEFAULT_LAT = 9.0765   // Abuja, Nigeria
export const DEFAULT_LNG = 7.3986

export const DEFAULT_FACILITY: FacilityInput = {
  type: 'hospital_general', name: '', beds: 150, avg_load_kw: null, critical_load_kw: null, daily_kwh: null, backup_hours: 12,
  existing: { grid_connection: true, generator_kva: 500, solar_kwp: 0, ups_kva: 0 },
  roof_area_m2: 3000, land_area_m2: 5000, water_source: 'borehole', budget_usd: null, priority: 'balanced', allow_new_generator: true,
}

interface SiteState {
  lat: number; lng: number; month: number; mode: Mode
  location: LocationInfo | null; sun: SunData | null; wind: WindData | null; weather: WeatherData | null
  water: WaterData | null; grid: GridData | null; facilities: FacilitiesData | null
  loading: boolean; layersLoading: boolean
  scan: { r50: GridData | null; r100: GridData | null; stage: 'idle' | '50' | '100' | 'done' }
  backendMode: 'unknown' | 'live' | 'offline' | 'down'
  facility: FacilityInput; outageStartHour: number; gridClassOverride: string | null
  assessment: Assessment | null; assessing: boolean; assessError: string | null
  locked: boolean; setLocked: (v: boolean) => void
  /** Brief 12 case: the hospital, its reported grid hours, prices, and the new building site. */
  caseData: CaseData | null; newSite: SitePoint | null; reportedDieselNgn: number | null
  /** generic Brief 12 inputs — any hospital can be moving, report its own grid hours and use local prices */
  moving: boolean; reportedGridHours: number | null; prices: Prices
  setMoving: (v: boolean) => void; setReportedGridHours: (h: number | null) => void; setPrices: (p: Partial<Prices>) => void
  loadCase: (c: CaseData) => void
  clearCase: () => void
  setNewSite: (p: SitePoint) => void
  setReportedDiesel: (ngnPerMonth: number | null) => void
  /** grid hours a day the case hospital reports (only at the hospital itself) */
  supplyHours: () => number | null
  setLatLng: (lat: number, lng: number, force?: boolean) => void
  setMonth: (m: number) => void
  setMode: (m: Mode) => void
  fetchSite: () => Promise<void>
  fetchLayers: () => Promise<void>
  scanGrid: () => Promise<void>
  checkBackend: () => Promise<void>
  setFacility: (patch: Partial<FacilityInput>) => void
  setExisting: (patch: Partial<FacilityInput['existing']>) => void
  setOutageStartHour: (h: number) => void
  setGridClassOverride: (c: string | null) => void
  runAssessment: () => Promise<Assessment | null>
  reset: () => void
}

let siteAbort: AbortController | null = null
let layerAbort: AbortController | null = null
let scanAbort: AbortController | null = null

export const useSiteStore = create<SiteState>()(
  persist(
    (set, get) => ({
      lat: DEFAULT_LAT, lng: DEFAULT_LNG, month: new Date().getMonth(), mode: 'sun',
      location: null, sun: null, wind: null, weather: null, water: null, grid: null, facilities: null,
      loading: false, layersLoading: false, scan: { r50: null, r100: null, stage: 'idle' }, backendMode: 'unknown',
      facility: DEFAULT_FACILITY, outageStartHour: 18, gridClassOverride: null,
      assessment: null, assessing: false, assessError: null,

      locked: false,
      setLocked: (locked) => set({ locked }),
      setLatLng: (lat, lng, force = false) => {
        if (get().locked && !force) return   // a locked site only moves on an explicit choice
        const la = Math.max(-85, Math.min(85, +lat.toFixed(4)))
        const ln = Math.max(-180, Math.min(180, +lng.toFixed(4)))
        if (la === get().lat && ln === get().lng) return
        const c = get().caseData
        // leaving the case hospital ends the case: its grid hours, prices, facility and move belong to that hospital only
        if (c && distanceKm({ lat: la, lng: ln }, c.hospital) > 3) set({ caseData: null, newSite: null, reportedDieselNgn: null, reportedGridHours: null, facility: DEFAULT_FACILITY, moving: false })
        // a named hospital belongs to its own pin: moving the pin away clears the name (picking a hospital sets it again)
        const moved = distanceKm({ lat: get().lat, lng: get().lng }, { lat: la, lng: ln }) > 0.3
        set((st) => ({ lat: la, lng: ln, assessment: null, ...(moved && st.facility.name ? { facility: { ...st.facility, name: '' } } : {}) }))
      },

      caseData: null, newSite: null, reportedDieselNgn: null,
      moving: false, reportedGridHours: null, prices: DEFAULT_PRICES,
      setMoving: (moving) => set({ moving }),
      setReportedGridHours: (h) => set({ reportedGridHours: h, assessment: null }),
      setPrices: (p) => set((st) => ({ prices: { ...st.prices, ...p }, assessment: null })),
      loadCase: (c) => set({
        caseData: c, newSite: { lat: c.new_site.lat, lng: c.new_site.lng, label: c.new_site.label }, reportedDieselNgn: c.options.relocation.reported_diesel_ngn_per_month ?? null,
        lat: c.hospital.lat, lng: c.hospital.lng, locked: true, mode: 'sun', month: c.options.month, facility: c.facility, moving: true,
        reportedGridHours: c.options.supply_hours_override ?? null,
        prices: { diesel_ngn_per_l: Math.round((c.options.diesel_price_usd_per_l ?? 2.464) * (c.options.usd_to_ngn ?? 1330)), grid_ngn_per_kwh: Math.round((c.options.grid_tariff_usd_per_kwh ?? 0.1203) * (c.options.usd_to_ngn ?? 1330)), usd_to_ngn: c.options.usd_to_ngn ?? 1330 },
        outageStartHour: c.options.outage_start_hour, gridClassOverride: null, assessment: null,
      }),
      clearCase: () => set({ caseData: null, newSite: null, reportedDieselNgn: null, assessment: null, moving: false, reportedGridHours: null, prices: DEFAULT_PRICES }),
      // the plan stays on screen while these change; the Enugu plan offers a re-run
      setNewSite: (p) => set({ newSite: { lat: +p.lat.toFixed(4), lng: +p.lng.toFixed(4), label: p.label ?? 'New building site' } }),
      setReportedDiesel: (v) => set({ reportedDieselNgn: v }),
      supplyHours: () => {
        const { caseData: c, lat, lng, reportedGridHours } = get()
        return c && distanceKm({ lat, lng }, c.hospital) <= 3 ? c.options.supply_hours_override ?? null : reportedGridHours
      },
      setMonth: (month) => set({ month }),
      setMode: (mode) => set({ mode }),

      checkBackend: async () => {
        try {
          const h = await api.health()
          set({ backendMode: h.mode === 'offline' ? 'offline' : 'live' })
        } catch {
          set({ backendMode: 'down' })
        }
      },

      fetchSite: async () => {
        siteAbort?.abort()
        siteAbort = new AbortController()
        const { lat, lng } = get()
        const sig = siteAbort.signal
        set({ loading: true })
        // location resolves first (fast), the rest in parallel
        api.location(lat, lng, sig).then((loc) => { if (!sig.aborted) set({ location: loc }) }).catch(() => { if (!sig.aborted) set({ location: null }) })
        const [sun, wind, weather] = await Promise.all([
          api.sun(lat, lng, sig).catch(() => null),
          api.wind(lat, lng, sig).catch(() => null),
          api.weather(lat, lng, sig).catch(() => null),
        ])
        if (sig.aborted) return
        set({ sun, wind, weather, loading: false })
      },

      fetchLayers: async () => {
        layerAbort?.abort()
        layerAbort = new AbortController()
        const { lat, lng, gridClassOverride } = get()
        const sig = layerAbort.signal
        set({ layersLoading: true })
        const [water, grid, facilities] = await Promise.all([
          api.water(lat, lng, sig).catch(() => null),
          api.grid(lat, lng, sig, gridClassOverride, 30, get().supplyHours()).catch(() => null),
          api.facilities(lat, lng, sig).catch(() => null),
        ])
        if (sig.aborted) return
        set({ water, grid, facilities, layersLoading: false })
      },

      // staged grid scan: 50 km first (fast answer), then widen to 100 km
      scanGrid: async () => {
        scanAbort?.abort()
        scanAbort = new AbortController()
        const { lat, lng, gridClassOverride } = get()
        const sig = scanAbort.signal
        set({ scan: { r50: null, r100: null, stage: '50' } })
        const res = await api.gridScan(lat, lng, sig, gridClassOverride, get().supplyHours()).catch(() => null)
        if (sig.aborted) return
        const ring = (i: number): GridData | null => (res ? { power: res.rings[i].power, country: res.country, reliability: res.rings[i].reliability } : null)
        set({ scan: { r50: ring(0), r100: null, stage: '100' } })   // show the 50 km answer first, then widen the ring
        await new Promise((r) => setTimeout(r, 500))
        if (sig.aborted) return
        set({ scan: { r50: ring(0), r100: ring(1), stage: 'done' } })
      },

      setFacility: (patch) => set((s) => ({ facility: { ...s.facility, ...patch }, assessment: null })),
      setExisting: (patch) => set((s) => ({ facility: { ...s.facility, existing: { ...s.facility.existing, ...patch } }, assessment: null })),
      setOutageStartHour: (h) => set({ outageStartHour: h, assessment: null }),
      setGridClassOverride: (c) => set({ gridClassOverride: c, assessment: null }),

      runAssessment: async () => {
        const { lat, lng, facility, month, outageStartHour, gridClassOverride, caseData: c, newSite, reportedDieselNgn, moving, prices } = get()
        const supply = get().supplyHours()
        // generic: the facility's reported grid hours, the local prices, and — if the hospital is moving — the new site
        const caseOpts = {
          supply_hours_override: supply, usd_to_ngn: prices.usd_to_ngn,
          diesel_price_usd_per_l: +(prices.diesel_ngn_per_l / prices.usd_to_ngn).toFixed(4), grid_tariff_usd_per_kwh: +(prices.grid_ngn_per_kwh / prices.usd_to_ngn).toFixed(4),
          relocation: moving || c ? { move_year: 5, horizon_years: 10, theatre_suites: 4, theatre_hours_per_day: 10, theatre_days_per_week: 6, ...(c?.options.relocation ?? {}), new_site: newSite, reported_diesel_ngn_per_month: reportedDieselNgn } : null,
        }
        set({ assessing: true, assessError: null })
        try {
          const a = await api.assess({ lat, lng }, facility, { month, outage_start_hour: outageStartHour, grid_class_override: gridClassOverride, radius_km: 30, charge_from_grid: true, ...caseOpts })
          set({ assessment: a, assessing: false })
          return a
        } catch (e: any) {
          set({ assessing: false, assessError: e?.message?.slice(0, 200) || 'Assessment failed' })
          return null
        }
      },
      reset: () => set({ facility: DEFAULT_FACILITY, assessment: null, gridClassOverride: null, outageStartHour: 18 }),
    }),
    {
      name: 'gridrescue-site-v2',   // v2: field names use backup_* (old sessions are ignored)
      storage: createJSONStorage(() => sessionStorage),
      partialize: (s) => ({ lat: s.lat, lng: s.lng, month: s.month, mode: s.mode, locked: s.locked, facility: s.facility, outageStartHour: s.outageStartHour, gridClassOverride: s.gridClassOverride, assessment: s.assessment,
        caseData: s.caseData, newSite: s.newSite, reportedDieselNgn: s.reportedDieselNgn, moving: s.moving, reportedGridHours: s.reportedGridHours, prices: s.prices }),
    },
  ),
)
