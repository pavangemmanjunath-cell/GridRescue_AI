/**
 * Build-your-system catalogue: use cases, sites, the energy resource (sun, wind or water) and the swappable parts the
 * configurator offers for each. Everything here is a typical benchmark for pre-feasibility (±30 %), never a measured
 * value for a real building; the user adjusts the load on the Load step.
 */

export type Family = 'hospital' | 'crew'
export type PresetId = 'clinic' | 'cah' | 'community' | 'regional' | 'rail' | 'road'
export type Resource = 'sun' | 'wind' | 'water'

export interface Preset {
  id: PresetId; family: Family; name: string; short: string; blurb: string
  /** typical daily electricity use and the range the slider allows (kWh / day) */
  dailyKwh: number; range: [number, number]
  /** share of the load that must stay on in an outage (NEC 517 essential system, or the crew's shift load) */
  essentialShare: number; floorAreaSqft?: number; beds?: number
  /** hours of the day the load runs (crew shifts); hospitals run all day */
  shift?: [number, number]
  basis: string
}

// Inpatient hospitals use ≈ 28.8 kWh per ft² a year and outpatient buildings ≈ 17.4 (EIA CBECS 2018, table C14); floor area
// ≈ 2,500 ft² per bed. The essential-system share (life-safety + critical + equipment branches) is an assumption the user can change.
export const PRESETS: Preset[] = [
  { id: 'clinic', family: 'hospital', name: 'Rural clinic / urgent care', short: 'Clinic', blurb: 'Single storey · 12,000 ft² · walk-in care, imaging, vaccine fridges',
    dailyKwh: 570, range: [400, 760], essentialShare: 0.6, floorAreaSqft: 12000, basis: 'EIA CBECS outpatient · 17.4 kWh/ft²·yr × 12,000 ft²' },
  { id: 'cah', family: 'hospital', name: 'Critical Access Hospital · 25 beds', short: 'Critical Access', blurb: 'Two storeys · 80,000 ft² · ER, lab, 25 inpatient beds',
    dailyKwh: 6300, range: [5000, 7600], essentialShare: 0.55, floorAreaSqft: 80000, beds: 25, basis: 'EIA CBECS inpatient · 28.8 kWh/ft²·yr × 80,000 ft²' },
  { id: 'community', family: 'hospital', name: 'Community hospital · 150 beds', short: 'Community', blurb: 'Four storeys · 375,000 ft² · surgery, ICU, maternity',
    dailyKwh: 29600, range: [24000, 35000], essentialShare: 0.5, floorAreaSqft: 375000, beds: 150, basis: 'EIA CBECS inpatient · 28.8 kWh/ft²·yr × 375,000 ft²' },
  { id: 'regional', family: 'hospital', name: 'Regional medical center · 400 beds', short: 'Regional', blurb: 'Tower + podium · 1,000,000 ft² · trauma centre, helipad, data centre',
    dailyKwh: 79000, range: [65000, 95000], essentialShare: 0.45, floorAreaSqft: 1000000, beds: 400, basis: 'EIA CBECS inpatient · 28.8 kWh/ft²·yr × 1,000,000 ft²' },
  { id: 'rail', family: 'crew', name: 'Rail track maintenance crew', short: 'Rail crew', blurb: 'Night possession 22:00–06:00 · 4 light towers, rail saw, welder, crew cabin',
    dailyKwh: 78, range: [40, 140], essentialShare: 1, shift: [22, 6], basis: 'Load list: 4 × 0.4 kW LED towers, 7 kW rail saw at ~40 % duty, 2 kW welder duty, 2.5 kW cabin, 0.5 kW comms' },
  { id: 'road', family: 'crew', name: 'Road / highway work-zone crew', short: 'Road crew', blurb: 'Night shift 20:00–05:00 · 6 light towers, arrow and message boards, tools',
    dailyKwh: 56, range: [30, 110], essentialShare: 1, shift: [20, 5], basis: 'Load list: 6 × 0.35 kW LED towers, 0.35 kW boards, 2 kW tools, 1.5 kW crew trailer' },
]

/** Other markets where storage or a UPS fits — shown as information next to the simulatable crew presets. */
export const MARKETS: { id: string; name: string; fit: string; storage: string; ups: string; preset?: PresetId }[] = [
  { id: 'rail', name: 'Rail track maintenance', fit: 'Night possessions far from any socket; diesel generators idle beside homes.', storage: 'Battery trailer 60–160 kWh, charged at the depot or by a solar mast', ups: 'Not needed — tools tolerate a short gap', preset: 'rail' },
  { id: 'road', name: 'Road and highway work zones', fit: 'Light towers, arrow and message boards all night, often under noise limits.', storage: 'Battery cart or trailer 30–100 kWh', ups: 'Built into message-board controllers', preset: 'road' },
  { id: 'telecom', name: 'Telecom towers', fit: 'Small constant load (2–5 kW) that must never drop; many sites on weak rural feeders.', storage: 'LFP or sodium-ion, 4–8 h, plus a small generator for long storms', ups: '−48 V DC rectifier with batteries is the UPS' },
  { id: 'data', name: 'Data rooms and clinic IT', fit: 'Servers, imaging archives and health records cannot reboot mid-transfer.', storage: 'LFP 10–30 min behind the UPS; longer only with solar', ups: 'Double-conversion UPS, 0 ms transfer — the core need' },
  { id: 'cold', name: 'Cold chain and vaccine stores', fit: 'Vaccines must stay at 2–8 °C through every outage.', storage: 'Ice or phase-change thermal storage, 8–24 h of cooling', ups: 'Small UPS for controllers and alarms' },
  { id: 'water', name: 'Water and wastewater pumping', fit: 'Pumps stop when the grid stops; towns lose pressure and fire-fighting water.', storage: 'Elevated water tank (the water is the storage) plus a battery for controls', ups: 'Only for SCADA and telemetry' },
  { id: 'shelter', name: 'Schools and emergency shelters', fit: 'Become resilience hubs after storms: lights, phone charging, medicine fridges.', storage: 'LFP 4–8 h with rooftop solar', ups: 'Not needed' },
]

export interface City {
  id: string; name: string; lat: number; lng: number
  /** peak-sun hours a day, mean wind at 50 m (m/s), river / micro-hydro score (0–100) and terrain head (m) */
  psh: number; windMs: number; hydro: number; headM: number
  tariff: number; hazard: string; source?: 'explorer' | 'reference'
  /** ISO country code; the US federal credit only applies to US sites */
  country?: string
}

/** Reference sites. Sun: NREL NSRDB annual means. Wind: NASA POWER 50 m means (rounded). Hydro score and head: rough
 *  regional judgements for illustration. Tariff: EIA commercial state averages (US$/kWh, rounded). */
export const CITIES: City[] = [
  { id: 'houston', name: 'Houston, TX', lat: 29.76, lng: -95.37, psh: 4.8, windMs: 5.6, hydro: 25, headM: 10, tariff: 0.09, hazard: 'Hurricanes · winter storms' },
  { id: 'neworleans', name: 'New Orleans, LA', lat: 29.95, lng: -90.07, psh: 5.0, windMs: 5.3, hydro: 45, headM: 5, tariff: 0.11, hazard: 'Hurricanes' },
  { id: 'miami', name: 'Miami, FL', lat: 25.76, lng: -80.19, psh: 5.3, windMs: 5.4, hydro: 10, headM: 5, tariff: 0.12, hazard: 'Hurricanes' },
  { id: 'asheville', name: 'Asheville, NC', lat: 35.6, lng: -82.55, psh: 4.6, windMs: 5.0, hydro: 70, headM: 180, tariff: 0.10, hazard: 'Flooding · hurricane remnants' },
  { id: 'atlanta', name: 'Atlanta, GA', lat: 33.75, lng: -84.39, psh: 4.8, windMs: 4.6, hydro: 40, headM: 40, tariff: 0.12, hazard: 'Storms · heat' },
  { id: 'phoenix', name: 'Phoenix, AZ', lat: 33.45, lng: -112.07, psh: 6.5, windMs: 4.4, hydro: 10, headM: 60, tariff: 0.12, hazard: 'Extreme heat' },
  { id: 'la', name: 'Los Angeles, CA', lat: 34.05, lng: -118.24, psh: 5.6, windMs: 4.6, hydro: 15, headM: 120, tariff: 0.23, hazard: 'Wildfire safety shut-offs' },
  { id: 'sacramento', name: 'Sacramento, CA', lat: 38.58, lng: -121.49, psh: 5.4, windMs: 5.2, hydro: 60, headM: 30, tariff: 0.23, hazard: 'Wildfire safety shut-offs' },
  { id: 'denver', name: 'Denver, CO', lat: 39.74, lng: -104.99, psh: 5.5, windMs: 6.6, hydro: 40, headM: 150, tariff: 0.12, hazard: 'Blizzards · wildfire' },
  { id: 'kansascity', name: 'Kansas City, MO', lat: 39.1, lng: -94.58, psh: 4.7, windMs: 7.0, hydro: 50, headM: 30, tariff: 0.11, hazard: 'Tornadoes · ice storms' },
  { id: 'chicago', name: 'Chicago, IL', lat: 41.88, lng: -87.63, psh: 4.1, windMs: 6.6, hydro: 30, headM: 10, tariff: 0.12, hazard: 'Ice storms · heat' },
  { id: 'newyork', name: 'New York, NY', lat: 40.71, lng: -74.01, psh: 4.2, windMs: 6.2, hydro: 35, headM: 30, tariff: 0.20, hazard: 'Coastal storms' },
  { id: 'boston', name: 'Boston, MA', lat: 42.36, lng: -71.06, psh: 4.1, windMs: 6.5, hydro: 35, headM: 30, tariff: 0.22, hazard: "Nor'easters" },
  { id: 'seattle', name: 'Seattle, WA', lat: 47.61, lng: -122.33, psh: 3.6, windMs: 5.0, hydro: 75, headM: 120, tariff: 0.11, hazard: 'Wind storms' },
  { id: 'anchorage', name: 'Anchorage, AK', lat: 61.22, lng: -149.9, psh: 2.6, windMs: 6.0, hydro: 65, headM: 150, tariff: 0.21, hazard: 'Cold · remote grid' },
  { id: 'honolulu', name: 'Honolulu, HI', lat: 21.31, lng: -157.86, psh: 5.8, windMs: 7.2, hydro: 20, headM: 200, tariff: 0.38, hazard: 'Island grid · hurricanes' },
]

/** Inverse-distance estimate for any pinned point from the reference sites. */
export function siteFromPoint(lat: number, lng: number, name: string): City {
  let w = 0, near = CITIES[0], best = Infinity
  const acc = { psh: 0, windMs: 0, hydro: 0, headM: 0, tariff: 0 }
  for (const c of CITIES) {
    const d = Math.hypot(c.lat - lat, (c.lng - lng) * Math.cos((lat * Math.PI) / 180)) + 0.05
    if (d < best) { best = d; near = c }
    const k = 1 / (d * d); w += k
    for (const key of Object.keys(acc) as (keyof typeof acc)[]) acc[key] += c[key] * k
  }
  return { id: 'pin', name, lat, lng, psh: +(acc.psh / w).toFixed(1), windMs: +(acc.windMs / w).toFixed(1), hydro: Math.round(acc.hydro / w), headM: Math.round(acc.headM / w), tariff: +(acc.tariff / w).toFixed(3), hazard: near.hazard, source: 'reference' }
}

export const RESOURCES: { id: Resource; label: string; badge: string; icon: string; color: string; what: string }[] = [
  { id: 'sun', label: 'Sun', badge: 'SUN-BASED ENERGY', icon: 'sun', color: '#F59E0B', what: 'Solar panels, a daily cycle: store midday sun for the night' },
  { id: 'wind', label: 'Wind', badge: 'WIND-BASED ENERGY', icon: 'wind', color: '#22B7E8', what: 'Turbines, gusty and often strongest at night' },
  { id: 'water', label: 'Water', badge: 'WATER-BASED ENERGY', icon: 'water', color: '#3A86E6', what: 'Run-of-river micro-hydro, steady day and night' },
]

// ---------- parts ----------
export type Slot = 'source' | 'storage' | 'control' | 'backup'
export interface SizeCtx { preset: Preset; dailyKwh: number; peakKw: number; essentialKw: number; site: City }

export interface Part {
  id: string; slot: Slot; name: string; detail: string
  /** label for the quick-pick chips over the 3D view */
  short?: string
  /** size for this preset and daily load (kWp, kW, kWh or kVA) */
  size: (ctx: SizeCtx) => number
  unit: string
  /** installed cost, US$ */
  cost: (size: number, ctx: SizeCtx) => number
  /** which 3D model stands in the scene */
  kind: string
  itc?: boolean
  /** which energy resources offer this part (absent = every resource) */
  resources?: Resource[]
  /** storage behaviour */
  tech?: { type: string; duration: string; hours: number; rte: number; dod: number; share?: number; role: string; co2?: string }
  /** why the part cannot be fitted here, if it cannot */
  blocked?: (ctx: SizeCtx) => string | null
  /** depot charging (maintenance work): extra on-site renewable that charges alongside the grid */
  charge?: { source: 'grid' | Resource; kw: number }
}

const round = (v: number, step: number) => Math.max(step, Math.round(v / step) * step)
/** Storage energy for `hours` of essential load at depth of discharge `dod` (only `share` of the load, for thermal stores). */
const store = (hours: number, dod: number, share = 1) => (c: SizeCtx) => round((c.essentialKw * share * hours) / dod, c.essentialKw > 200 ? 10 : 1)
const NONE_STORE: Part = { id: 'st-none', slot: 'storage', short: 'UPS + diesel · higher CO₂', name: 'No storage — UPS + diesel only', detail: 'How most sites run today: a few minutes of UPS, then the generator. Highest CO₂.', size: () => 0, unit: 'kWh', cost: () => 0, kind: 'none',
  tech: { type: 'Baseline', duration: 'minutes', hours: 0, rte: 1, dod: 1, role: 'Generator carries every outage', co2: 'higher CO₂' } }

/** Parts offered for a hospital; installed costs follow NREL ATB / Lazard commercial benchmarks (rounded). */
export const HOSPITAL_PARTS: Part[] = [
  // ---- generation: one family per resource
  { id: 'pv-none', slot: 'source', resources: ['sun'], name: 'No solar', detail: 'Keep buying all energy from the utility', size: () => 0, unit: 'kWp', cost: () => 0, kind: 'none' },
  { id: 'pv-roof', slot: 'source', resources: ['sun'], name: 'Rooftop array', detail: 'Uses the flat roof · lowest cost per watt', size: (c) => round(c.dailyKwh * 0.06, 5), unit: 'kWp', cost: (s) => s * 1000 * 1.9, kind: 'roof', itc: true },
  { id: 'pv-carport', slot: 'source', resources: ['sun'], name: 'Roof + parking canopy', detail: 'Adds shaded carports over the car park', size: (c) => round(c.dailyKwh * 0.12, 5), unit: 'kWp', cost: (s) => s * 1000 * 2.4, kind: 'carport', itc: true },
  { id: 'pv-ground', slot: 'source', resources: ['sun'], name: 'Roof + canopy + ground array', detail: 'Uses spare land next to the site', size: (c) => round(c.dailyKwh * 0.2, 5), unit: 'kWp', cost: (s) => s * 1000 * 2.1, kind: 'ground', itc: true },
  { id: 'wind-none', slot: 'source', resources: ['wind'], name: 'No turbine', detail: 'Keep buying all energy from the utility', size: () => 0, unit: 'kW', cost: () => 0, kind: 'none' },
  { id: 'wind-s', slot: 'source', resources: ['wind'], name: 'One mid-size turbine', detail: '30–40 m tower on the site boundary', size: (c) => round(c.dailyKwh * 0.015, 5), unit: 'kW', cost: (s) => s * 4500, kind: 'turbine-1', itc: true },
  { id: 'wind-m', slot: 'source', resources: ['wind'], name: 'Two turbines', detail: 'Needs open land and a planning consent', size: (c) => round(c.dailyKwh * 0.035, 5), unit: 'kW', cost: (s) => s * 3200, kind: 'turbine-2', itc: true },
  { id: 'wind-l', slot: 'source', resources: ['wind'], name: 'Small wind farm · three turbines', detail: 'Community-scale; surplus is sold to the grid', size: (c) => round(c.dailyKwh * 0.07, 5), unit: 'kW', cost: (s) => s * 2400, kind: 'turbine-3', itc: true },
  { id: 'hydro-none', slot: 'source', resources: ['water'], name: 'No hydro', detail: 'Keep buying all energy from the utility', size: () => 0, unit: 'kW', cost: () => 0, kind: 'none' },
  { id: 'hydro-s', slot: 'source', resources: ['water'], name: 'Micro-hydro · run of river', detail: 'Small intake and turbine house on the river bank', size: (c) => round(c.dailyKwh * 0.008, 5), unit: 'kW', cost: (s) => s * 5000, kind: 'hydro-1', itc: true },
  { id: 'hydro-m', slot: 'source', resources: ['water'], name: 'Micro-hydro · two units', detail: 'Larger intake; output follows the river flow', size: (c) => round(c.dailyKwh * 0.02, 5), unit: 'kW', cost: (s) => s * 4200, kind: 'hydro-2', itc: true,
    blocked: (c) => (c.site.hydro < 20 ? 'River too weak at this site for a larger plant' : null) },
  { id: 'hydro-l', slot: 'source', resources: ['water'], name: 'Mini-hydro with weir', detail: 'A low weir raises the head; needs a water licence', size: (c) => round(c.dailyKwh * 0.035, 5), unit: 'kW', cost: (s) => s * 3600, kind: 'hydro-3', itc: true,
    blocked: (c) => (c.site.hydro < 40 ? 'Needs a strong, year-round river (score 40+)' : null) },

  // ---- storage: the devices that suit each resource
  NONE_STORE,
  { id: 'st-lfp', slot: 'storage', short: 'LFP', resources: ['sun', 'wind'], name: 'LFP lithium-ion battery', detail: 'Main daily battery: moves midday solar or gusty wind to the night', size: store(4, 0.9), unit: 'kWh', cost: (s) => 120000 + s * 420, kind: 'container', itc: true,
    tech: { type: 'Battery', duration: '2–8 h', hours: 4, rte: 0.9, dod: 0.9, role: 'Main daily battery' } },
  { id: 'st-na', slot: 'storage', short: 'Sodium-ion', resources: ['sun'], name: 'Sodium-ion battery', detail: 'Heat-tolerant alternative to LFP, no lithium or cobalt', size: store(4, 0.9), unit: 'kWh', cost: (s) => 120000 + s * 390, kind: 'container-na', itc: true,
    tech: { type: 'Battery', duration: '2–8 h', hours: 4, rte: 0.88, dod: 0.9, role: 'Heat-tolerant daily battery' } },
  { id: 'st-pb', slot: 'storage', short: 'Lead-acid', resources: ['sun'], name: 'Lead-acid (carbon, AGM)', detail: 'Low upfront cost for small clinics; only half the energy is usable', size: store(3, 0.5), unit: 'kWh', cost: (s) => 40000 + s * 260, kind: 'racks', itc: true,
    tech: { type: 'Battery', duration: '2–6 h', hours: 3, rte: 0.8, dod: 0.5, role: 'Low-budget small clinics' } },
  { id: 'st-ice', slot: 'storage', short: 'Ice tank', resources: ['sun'], name: 'Ice / chilled-water tank', detail: 'Stores solar as cold; carries hospital cooling (about 30 % of the load)', size: store(8, 1, 0.3), unit: 'kWh', cost: (s) => 60000 + s * 140, kind: 'ice', itc: true,
    tech: { type: 'Thermal', duration: '4–10 h', hours: 8, rte: 0.85, dod: 1, share: 0.3, role: 'Hospital cooling only' } },
  { id: 'st-hot', slot: 'storage', short: 'Hot water / PCM', resources: ['sun'], name: 'Hot-water tank / phase-change', detail: 'Sterilisation, laundry and hot water (about 10 % of the load)', size: store(10, 1, 0.1), unit: 'kWh', cost: (s) => 30000 + s * 90, kind: 'hotwater', itc: true,
    tech: { type: 'Thermal', duration: '4–12 h', hours: 10, rte: 0.9, dod: 1, share: 0.1, role: 'Heat for sterilisation and laundry' } },
  { id: 'st-sc', slot: 'storage', short: 'Supercapacitor', resources: ['sun'], name: 'Supercapacitor bank', detail: 'Smooths the seconds when a cloud passes; no outage backup', size: store(0.02, 0.9), unit: 'kWh', cost: (s) => 50000 + s * 9000, kind: 'supercap', itc: true,
    tech: { type: 'Electrical', duration: 'seconds', hours: 0.02, rte: 0.95, dod: 0.9, role: 'Smooths cloud-passing dips' } },
  { id: 'st-lto', slot: 'storage', short: 'LTO', resources: ['wind'], name: 'LTO lithium-ion battery', detail: 'Very fast cycling: absorbs gusts tens of thousands of times', size: store(2, 0.95), unit: 'kWh', cost: (s) => 120000 + s * 780, kind: 'container-lto', itc: true,
    tech: { type: 'Battery', duration: '1–4 h', hours: 2, rte: 0.92, dod: 0.95, role: 'Absorbs gusts, very fast cycling' } },
  { id: 'st-fly', slot: 'storage', short: 'Flywheel', resources: ['wind'], name: 'Flywheel', detail: 'Ride-through for rapid power swings, minutes at most', size: store(0.08, 0.9), unit: 'kWh', cost: (s) => 80000 + s * 5000, kind: 'flywheel', itc: true,
    tech: { type: 'Mechanical', duration: 'seconds–minutes', hours: 0.08, rte: 0.85, dod: 0.9, role: 'Ride-through for power swings' } },
  { id: 'st-flow', slot: 'storage', short: 'Flow battery', resources: ['wind'], name: 'Vanadium or iron flow battery', detail: 'Holds a long windy night; 20+ years, non-flammable', size: store(10, 0.95), unit: 'kWh', cost: (s) => 180000 + s * 520, kind: 'flow', itc: true,
    tech: { type: 'Battery', duration: '6–12 h', hours: 10, rte: 0.72, dod: 0.95, role: 'Holds a long windy night' } },
  { id: 'st-caes', slot: 'storage', short: 'Compressed air', resources: ['wind'], name: 'Compressed air', detail: 'Underground caverns at utility scale', size: () => 0, unit: 'kWh', cost: () => 0, kind: 'none',
    tech: { type: 'Mechanical', duration: '4–24 h', hours: 12, rte: 0.6, dod: 1, role: 'Utility scale' }, blocked: () => 'Utility scale — not for one hospital' },
  { id: 'st-h2', slot: 'storage', short: 'Hydrogen', resources: ['sun', 'wind'], name: 'Hydrogen (electrolyser, tank, fuel cell)', detail: 'Turns surplus into fuel for multi-day outages; about 35 % round trip', size: store(48, 0.9), unit: 'kWh', cost: (s) => 650000 + s * 120, kind: 'h2', itc: true,
    tech: { type: 'Chemical', duration: 'days', hours: 48, rte: 0.35, dod: 0.9, role: 'Long outages only' } },
  { id: 'st-phes', slot: 'storage', short: 'Pumped hydro', resources: ['water'], name: 'Pumped hydro', detail: 'Pumps water uphill and runs it back down through a turbine', size: store(12, 0.9), unit: 'kWh', cost: (s) => 1500000 + s * 300, kind: 'phes', itc: true,
    tech: { type: 'Mechanical', duration: '6–24 h', hours: 12, rte: 0.78, dod: 0.9, role: 'Needs about 50 m of head and a large scale' },
    blocked: (c) => (c.site.headM < 50 ? `Only ${c.site.headM} m of head here — pumped hydro needs about 50 m` : null) },
  { id: 'st-mhb', slot: 'storage', short: 'Micro-hydro + battery', resources: ['water'], name: 'Micro-hydro with a battery', detail: 'Run-of-river power; an LFP battery smooths flow changes', size: store(2, 0.9), unit: 'kWh', cost: (s) => 100000 + s * 440, kind: 'container', itc: true,
    tech: { type: 'Mechanical + battery', duration: 'continuous', hours: 2, rte: 0.9, dod: 0.9, role: 'Smooths flow changes' } },
  { id: 'st-tank', slot: 'storage', short: 'Water tank', resources: ['water'], name: 'Elevated water tank', detail: 'Small gravity store tied to a pump and turbine', size: (c) => Math.min(250, store(1, 0.9)(c)), unit: 'kWh', cost: (s) => 90000 + s * 900, kind: 'watertower', itc: true,
    tech: { type: 'Mechanical', duration: 'hours', hours: 1, rte: 0.7, dod: 0.9, role: 'Small gravity storage' } },
  { id: 'st-grav', slot: 'storage', short: 'Gravity blocks', resources: ['water'], name: 'Gravity block storage', detail: 'Lifts heavy blocks with surplus power; where head exists but water does not', size: store(4, 0.9), unit: 'kWh', cost: (s) => 250000 + s * 480, kind: 'gravity', itc: true,
    tech: { type: 'Mechanical', duration: '2–8 h', hours: 4, rte: 0.8, dod: 0.9, role: 'Alternative where head exists but no water' } },
  { id: 'st-h2w', slot: 'storage', short: 'Hydrogen (water)', resources: ['water'], name: 'Hydrogen from river water', detail: 'Water is the feedstock for the electrolyser, not the store', size: store(48, 0.9), unit: 'kWh', cost: (s) => 650000 + s * 120, kind: 'h2', itc: true,
    tech: { type: 'Chemical', duration: 'days', hours: 48, rte: 0.35, dod: 0.9, role: 'Long outages only' } },

  // ---- controls and backup
  { id: 'ctl-grid', slot: 'control', name: 'Grid-tied inverters only', detail: 'Generation must shut off when the grid fails (IEEE 1547 anti-islanding)', size: (c) => c.peakKw, unit: 'kW', cost: () => 0, kind: 'none' },
  { id: 'ctl-micro', slot: 'control', name: 'Microgrid controller + grid-forming inverter', detail: 'Islands the site in < 10 s and keeps generation and storage running', size: (c) => c.peakKw, unit: 'kW', cost: (s) => 150000 + s * 160, kind: 'switchgear', itc: true },
  { id: 'ctl-ups', slot: 'control', name: 'Microgrid + static UPS on critical branch', detail: 'Zero-gap power for theatres, ICU and the data room', size: (c) => c.peakKw, unit: 'kW', cost: (s, c) => 150000 + s * 160 + c.essentialKw * 0.35 * 450, kind: 'ups', itc: true },
  { id: 'gen-keep', slot: 'backup', name: 'Keep existing diesel generators', detail: 'Sized for the whole essential system · NFPA 110 Level 1', size: (c) => round(c.essentialKw * 1.6, 50), unit: 'kVA', cost: () => 0, kind: 'diesel' },
  { id: 'gen-rd', slot: 'backup', name: 'Same generators on renewable diesel', detail: 'Drop-in HVO fuel · up to 80 % lower life-cycle CO₂', size: (c) => round(c.essentialKw * 1.6, 50), unit: 'kVA', cost: () => 0, kind: 'diesel-green' },
  { id: 'gen-small', slot: 'backup', name: 'Downsize to one smaller generator', detail: 'Storage and generation carry most hours; generator is last resort', size: (c) => round(c.essentialKw * 0.6, 50), unit: 'kVA', cost: (s) => s * 350, kind: 'diesel' },
]

/** Maintenance work: no sun or wind at the work site and no generator — a battery charged from the grid at the depot. */
export const CREW_PARTS: Part[] = [
  { id: 'pv-none', slot: 'source', name: 'No on-site generation', detail: 'Energy comes only from the grid at the depot', size: () => 0, unit: 'kW', cost: () => 0, kind: 'none' },
  { id: 'bess-cart', slot: 'storage', short: 'Cart 30 kWh', name: 'Battery cart · 30 kWh', detail: 'Rolls off the hi-rail truck · tools and two light towers', size: () => 30, unit: 'kWh', cost: (s) => 9000 + s * 750, kind: 'cart',
    tech: { type: 'Battery', duration: '2–4 h', hours: 3, rte: 0.92, dod: 0.92, role: 'Tools and lights' } },
  { id: 'bess-trailer', slot: 'storage', short: 'Trailer 90 kWh', name: 'Battery trailer · 90 kWh', detail: 'One full night shift with no engine running', size: () => 90, unit: 'kWh', cost: (s) => 15000 + s * 700, kind: 'trailer',
    tech: { type: 'Battery', duration: 'one shift', hours: 8, rte: 0.92, dod: 0.92, role: 'A whole night shift' } },
  { id: 'bess-trailer-xl', slot: 'storage', short: 'Trailer 160 kWh', name: 'Battery trailer · 160 kWh', detail: 'Two shifts between depot charges', size: () => 160, unit: 'kWh', cost: (s) => 20000 + s * 650, kind: 'trailer-xl',
    tech: { type: 'Battery', duration: 'two shifts', hours: 16, rte: 0.92, dod: 0.92, role: 'Two shifts between charges' } },
  { id: 'bess-van', slot: 'storage', short: 'Battery van 120 kWh', name: 'Mobile battery van · 120 kWh', detail: 'Electric utility van with an export battery: drives to the track, plugs in at the depot by day', size: () => 120, unit: 'kWh', cost: (s) => 60000 + s * 520, kind: 'van',
    tech: { type: 'Battery', duration: 'one shift + travel', hours: 10, rte: 0.92, dod: 0.9, role: 'Power and transport in one vehicle' } },
  // depot charging: grid, or grid plus the depot's own sun, wind or water read from the Explorer site
  { id: 'ctl-plug', slot: 'control', name: 'Depot grid charging · 20 kW', detail: 'Plug into the yard supply between shifts', size: () => 20, unit: 'kW', cost: () => 6000, kind: 'charger', charge: { source: 'grid', kw: 0 } },
  { id: 'ctl-fast', slot: 'control', name: 'Depot grid fast charging · 60 kW', detail: 'Full charge in 2–3 h for back-to-back shifts', size: () => 60, unit: 'kW', cost: () => 28000, kind: 'charger-fast', charge: { source: 'grid', kw: 0 } },
  { id: 'ctl-sun', slot: 'control', name: 'Grid + solar canopy at the depot · 30 kWp', detail: 'Charges the battery from the depot roof by day, the grid tops up', size: () => 20, unit: 'kW', cost: () => 6000 + 30 * 2200, kind: 'charger-sun', charge: { source: 'sun', kw: 30 } },
  { id: 'ctl-wind', slot: 'control', name: 'Grid + small wind turbine at the depot · 20 kW', detail: 'Uses wind at the depot; the grid fills the gaps', size: () => 20, unit: 'kW', cost: () => 6000 + 20 * 4500, kind: 'charger-wind', charge: { source: 'wind', kw: 20 },
    blocked: (c) => (c.site.windMs < 4 ? `Only ${c.site.windMs} m/s of wind at this site — too little for a turbine` : null) },
  { id: 'ctl-water', slot: 'control', name: 'Grid + micro-hydro near the depot · 10 kW', detail: 'A small run-of-river unit charges day and night', size: () => 20, unit: 'kW', cost: () => 6000 + 10 * 5000, kind: 'charger-water', charge: { source: 'water', kw: 10 },
    blocked: (c) => (c.site.hydro < 30 ? 'No usable river near this site (Explorer water score below 30)' : null) },
  { id: 'gen-none', slot: 'backup', name: 'No generator', detail: 'Battery only: zero-emission, quiet night work', size: () => 0, unit: 'kVA', cost: () => 0, kind: 'none' },
  { id: 'gen-keep', slot: 'backup', name: 'Add a 25 kVA diesel generator', detail: 'Tow-behind backup; runs only if the battery runs out', size: () => 25, unit: 'kVA', cost: () => 14000, kind: 'diesel' },
]

export const partsFor = (f: Family, r: Resource = 'sun') => (f === 'hospital' ? HOSPITAL_PARTS : CREW_PARTS).filter((p) => !p.resources || f === 'crew' || p.resources.includes(r))

/** The part fitted by default when a resource is chosen. */
export const DEFAULT_FOR: Record<Resource, { source: string; storage: string }> = {
  sun: { source: 'pv-roof', storage: 'st-lfp' },
  wind: { source: 'wind-m', storage: 'st-lfp' },
  water: { source: 'hydro-s', storage: 'st-mhb' },
}

export interface Scenario { id: string; label: string; start: number; hours: number; solarFactor: number; windFactor: number; waterFactor: number; note: string }
/** Outage events for hospitals; hours are counted from midnight of day 1 on a 72-hour clock. The factors scale each resource
 *  on the days the event lasts (storm clouds, turbines feathered above cut-out wind, debris or ice at the intake). */
export const HOSPITAL_SCENARIOS: Scenario[] = [
  { id: 'storm', label: 'Summer thunderstorm · 6 h', start: 15, hours: 6, solarFactor: 0.6, windFactor: 1.3, waterFactor: 1, note: 'Afternoon feeder trip during the cooling peak' },
  { id: 'psps', label: 'Wildfire safety shut-off · 36 h', start: 8, hours: 36, solarFactor: 0.8, windFactor: 1.4, waterFactor: 0.8, note: 'Utility de-energises lines on high fire-risk, windy days' },
  { id: 'winter', label: 'Winter storm · 48 h', start: 2, hours: 48, solarFactor: 0.35, windFactor: 0.8, waterFactor: 0.6, note: 'Ice on lines and intakes; diesel deliveries frozen' },
  { id: 'hurricane', label: 'Hurricane landfall · 72 h', start: 0, hours: 72, solarFactor: 0.45, windFactor: 0.15, waterFactor: 0.5, note: 'Turbines shut down above cut-out speed; fuel trucks delayed' },
]
export const CREW_SCENARIOS: Scenario[] = [
  { id: 'nights3', label: 'Three night shifts in a row', start: 0, hours: 72, solarFactor: 1, windFactor: 1, waterFactor: 1, note: 'Back to the depot each morning' },
  { id: 'cloudy', label: 'Three cloudy night shifts', start: 0, hours: 72, solarFactor: 0.35, windFactor: 1, waterFactor: 1, note: 'Solar mast barely helps' },
]
export const scenariosFor = (f: Family) => (f === 'hospital' ? HOSPITAL_SCENARIOS : CREW_SCENARIOS)

/** Economic assumptions (editable later); all US$. */
export const ECON = {
  dieselPerGal: 4.5, galPerKwh: 0.075, demandChargePerKwMonth: 15,
  itc: 0.3, co2KgPerGal: 10.2, gridCo2KgPerKwh: 0.37, crewShiftsPerYear: 230, crewGenServicePerYear: 2400,
}
