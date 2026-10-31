import { ECON, partsFor, type City, type Part, type Preset, type Resource, type Scenario, type SizeCtx, type Slot } from './catalog'

export const HOURS = 72
export const SLOTS: Slot[] = ['source', 'storage', 'control', 'backup']

export interface Build {
  preset: Preset; dailyKwh: number; site: City; parts: Record<Slot, string>; scenario: Scenario
  resource?: Resource; essentialShare?: number; existing?: boolean
}

export interface Row {
  h: number; load: number; essential: number
  /** renewable output used on site (solar, wind or hydro) and what was available before curtailment */
  ren: number; renAvail: number
  battDis: number; battChg: number; soc: number
  grid: number; gen: number; shed: number; unserved: number; gridOn: boolean; outage: boolean; onShift: boolean; depot: number
  /** kg of CO₂ avoided this hour versus the same site on grid + UPS + diesel only */
  co2: number
}

export interface Chosen { part: Part; size: number; cost: number; blocked: string | null }

/** Per-component figures over the 72-hour test, for the component inspector. */
export interface ComponentStats {
  source: { kwh: number; peak: number; cf: number; curtailedKwh: number }
  storage: { inKwh: number; outKwh: number; minSoc: number; cycles: number; hoursCarried: number }
  backup: { kwh: number; runHours: number; gallons: number; starts: number }
  grid: { kwh: number; outageHours: number }
  load: { kwh: number; essentialKwh: number; shedKwh: number; unservedKwh: number }
}

export interface Result {
  rows: Row[]; ctx: SizeCtx; chosen: Record<Slot, Chosen>; resource: Resource
  capex: number; incentive: number; net: number; annualSaving: number; payback: number | null
  essentialServedPct: number; batteryOnlyHours: number; gallons: number; baselineGallons: number; co2TonsYear: number
  islanding: boolean; score: number; verdict: 'ok' | 'partial' | 'fail'
  crew?: { shifts: number; shiftsOnBattery: number; galYearAvoided: number; dbaNow: number; dbaGen: number; renShare: number; chargeSource: string }
  renKwhYear: number; stats: ComponentStats
  /** CO₂ avoided over the 72-hour test (kg) and in the outage alone by the storage (kg) */
  co2TestKg: number; co2OutageKg: number
}

const inShift = (hod: number, s?: [number, number]) => !!s && (s[0] < s[1] ? hod >= s[0] && hod < s[1] : hod >= s[0] || hod < s[1])
const shiftLen = (s: [number, number]) => (s[1] - s[0] + 24) % 24 || 24
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

/** Hospital day shape: steady base, a midday cooling and clinic peak (mean 1.0 over the day). */
const HOSP_SHAPE = (() => {
  const raw = Array.from({ length: 24 }, (_, h) => 0.82 + 0.3 * Math.exp(-((h + 0.5 - 14) ** 2) / 20))
  const m = raw.reduce((a, b) => a + b, 0) / 24
  return raw.map((v) => v / m)
})()
/** Solar bell: fraction of the day's peak-sun hours falling in each hour (sums to 1). */
const SUN = (() => {
  const raw = Array.from({ length: 24 }, (_, h) => Math.max(0, Math.sin((Math.PI * (h + 0.5 - 6)) / 12)))
  const s = raw.reduce((a, b) => a + b, 0)
  return raw.map((v) => v / s)
})()
const PV_DERATE = 0.8

/** Wind capacity factor from the mean 50 m speed, a night-time bias and deterministic gusts (mean ≈ base over a day). */
export function windCf(ms: number, h: number) {
  const base = clamp(0.075 * (ms - 2.5), 0.03, 0.45)
  const hod = h % 24
  return clamp(base * (1 + 0.3 * Math.cos((2 * Math.PI * (hod - 2)) / 24) + 0.18 * Math.sin(h * 1.7) + 0.1 * Math.sin(h * 0.53)), 0, 0.95)
}
/** Run-of-river capacity factor from the site's river score; nearly flat through the day. */
export const hydroCf = (score: number, h: number) => clamp((0.3 + 0.55 * score / 100) * (1 + 0.04 * Math.sin(h * 0.26)), 0.05, 0.9)

export function loadShape(preset: Preset, dailyKwh: number) {
  if (preset.family === 'hospital') return HOSP_SHAPE.map((f) => (f * dailyKwh) / 24)
  const len = shiftLen(preset.shift!), kw = dailyKwh / len
  return Array.from({ length: 24 }, (_, h) => (inShift(h, preset.shift) ? kw * (0.85 + 0.3 * ((h * 7) % 5) / 4) : 0.15))
}

export function sizeCtx(preset: Preset, dailyKwh: number, site: City): SizeCtx {
  const shape = loadShape(preset, dailyKwh)
  const peakKw = Math.max(...shape)
  return { preset, dailyKwh, peakKw, essentialKw: preset.family === 'hospital' ? (dailyKwh / 24) * preset.essentialShare * 1.1 : peakKw, site }
}

/** Available renewable output (kW) in hour h for the chosen resource and generator size. */
function renewable(resource: Resource, size: number, site: City, h: number, sc: Scenario, eventDay: boolean) {
  if (size <= 0) return 0
  const hod = h % 24
  if (resource === 'wind') return size * windCf(site.windMs, h) * (eventDay ? sc.windFactor : 1)
  if (resource === 'water') return size * hydroCf(site.hydro, h) * (eventDay ? sc.waterFactor : 1)
  return size * site.psh * PV_DERATE * SUN[hod] * (eventDay ? sc.solarFactor : 1)
}

export function simulate(b: Build): Result {
  const { site, scenario } = b
  const preset = b.essentialShare != null ? { ...b.preset, essentialShare: b.essentialShare } : b.preset
  const hosp = preset.family === 'hospital'
  const resource: Resource = hosp ? b.resource ?? 'sun' : 'sun'
  const ctx = sizeCtx(preset, b.dailyKwh, site)
  const parts = partsFor(preset.family, resource)
  const chosen = {} as Record<Slot, Chosen>
  for (const slot of SLOTS) {
    const wanted = parts.find((p) => p.id === b.parts[slot] && p.slot === slot && !p.blocked?.(ctx))
    const part = wanted ?? parts.find((p) => p.slot === slot && !p.blocked?.(ctx))!
    const size = part.size(ctx)
    let cost = part.cost(size, ctx)
    // a new build has to buy the generator an existing site already owns
    if (slot === 'backup' && b.existing === false && cost === 0 && size > 0) cost = hosp ? size * 350 : 14000
    chosen[slot] = { part, size, cost, blocked: part.blocked?.(ctx) ?? null }
  }
  const tech = chosen.storage.part.tech
  const ren = chosen.source.size, cap = chosen.storage.size
  const share = tech?.share ?? 1                                     // thermal stores serve only cooling or heating
  const rte = tech?.rte ?? 0.9, floor = cap * (1 - (tech?.dod ?? 0.9))
  const battKw = hosp ? Math.min(ctx.essentialKw * 1.1 * share, cap * 4) : Math.min(cap * 0.5, 40)
  const islanding = hosp ? chosen.control.part.id !== 'ctl-grid' : true
  const genKw = chosen.backup.size * 0.8
  const charger = hosp ? 0 : chosen.control.size
  const shape = loadShape(preset, b.dailyKwh)

  let soc = cap, genOn = false, starts = 0
  const rows: Row[] = []
  for (let h = 0; h < HOURS; h++) {
    const hod = h % 24
    const outage = hosp && h >= scenario.start && h < scenario.start + scenario.hours
    const day = Math.floor(h / 24)
    const eventDay = hosp ? day >= Math.floor(scenario.start / 24) && day <= Math.floor((scenario.start + scenario.hours - 1) / 24) : true
    const avail = renewable(resource, ren, site, h, scenario, eventDay)
    const load = shape[hod]
    const onShift = !hosp && inShift(hod, preset.shift)
    const r: Row = { h, load, essential: hosp ? load * preset.essentialShare : load, ren: 0, renAvail: avail, battDis: 0, battChg: 0, soc: 0, grid: 0, gen: 0, shed: 0, unserved: 0, gridOn: hosp && !outage, outage, onShift, depot: 0, co2: 0 }
    const dischargeCap = (demand: number) => Math.min(battKw, demand * share)

    if (hosp && !outage) {
      // grid on: renewables first, the store shaves the afternoon peak, refills from surplus and cheap night power
      let net = load - avail
      r.ren = Math.min(avail, load + battKw)
      if (net < 0) { const c = Math.min(-net, battKw, (cap - soc) / rte); soc += c * rte; r.battChg = c; net = 0; r.ren = Math.min(avail, load + c) }
      if (hod >= 14 && hod < 20 && cap > 0) { const d = Math.min(dischargeCap(load), Math.max(0, net - ctx.peakKw * 0.85), Math.max(0, soc - cap * 0.85)); soc -= d; r.battDis = d; net -= d }
      if ((hod < 6 || hod >= 22) && soc < cap) { const c = Math.min(battKw, (cap - soc) / rte); soc += c * rte; r.battChg += c; net += c }
      r.grid = Math.max(0, net); genOn = false
    } else {
      // islanded (hospital outage) or off-grid (crew): only essential loads are carried
      const demand = r.essential
      r.shed = load - demand
      const pv = islanding ? avail : 0
      const useBatt = islanding && cap > 0
      let need = demand - pv
      r.ren = Math.min(pv, demand + (useBatt ? battKw : 0))
      if (!hosp && !onShift && hod >= 8 && hod < 17 && charger > 0 && soc < cap) {   // parked at the depot
        const c = Math.min(charger, (cap - soc) / rte); soc += c * rte; r.battChg += c; r.depot = c
      }
      if (need < 0) { const c = useBatt ? Math.min(-need, battKw, (cap - soc) / rte) : 0; soc += c * rte; r.battChg += c; r.ren = Math.min(pv, demand + c); need = 0 }
      const usable = () => Math.max(0, soc - floor)
      if (useBatt && usable() < cap * (hosp ? 0.08 : 0.06)) { if (!genOn && genKw > 0) starts++; genOn = genKw > 0 }
      if (!useBatt) { if (!genOn && genKw > 0 && need > 0) starts++; genOn = genKw > 0 && need > 0 }
      if (need > 0 && useBatt && !genOn) { const d = Math.min(need, dischargeCap(demand), usable()); soc -= d; r.battDis = d; need -= d }
      if (need > 0.01 && genKw > 0 && !genOn) { genOn = true; starts++ }   // the store cannot finish the hour: the transfer switch starts the generator within seconds
      if (genOn) {
        const g = Math.min(genKw, need + (useBatt ? Math.min(battKw, Math.max(0, (cap * 0.7 - soc) / rte)) : 0))
        r.gen = Math.max(0, g)
        const spare = r.gen - need
        if (spare > 0 && useBatt) { soc += spare * rte; r.battChg += spare }
        need = Math.max(0, need - r.gen)
        if (useBatt && soc >= cap * 0.65) genOn = false
      }
      if (need > 0 && useBatt) { const d = Math.min(need, dischargeCap(demand), usable()); soc -= d; r.battDis += d; need -= d }
      r.unserved = need
      if (!hosp && !onShift) r.unserved = 0
    }
    r.soc = cap > 0 ? clamp((soc / cap) * 100, 0, 100) : 0
    rows.push(r)
  }

  // ---- outage and fuel figures ----
  const out = rows.filter((r) => (hosp ? r.outage : r.onShift))
  const demand = out.reduce((a, r) => a + r.essential, 0)
  const unserved = out.reduce((a, r) => a + r.unserved, 0)
  const essentialServedPct = demand > 0 ? Math.max(0, 100 * (1 - unserved / demand)) : 100
  const firstGen = out.findIndex((r) => r.gen > 0.01 || r.unserved > 0.01)
  const batteryOnlyHours = firstGen < 0 ? out.length : firstGen
  const genKwh = rows.reduce((a, r) => a + r.gen, 0)
  const genHours = rows.filter((r) => r.gen > 0.01).length
  const fuel = (kwh: number, hrs: number) => kwh * ECON.galPerKwh + hrs * (hosp ? chosen.backup.size * 0.002 : 0.35)
  const gallons = fuel(genKwh, genHours)
  const baselineGallons = fuel(demand, out.length)

  // ---- money ----
  const capex = SLOTS.reduce((a, s) => a + chosen[s].cost, 0)
  const eligible = hosp ? (['source', 'storage', 'control'] as Slot[]).reduce((a, s) => a + (chosen[s].part.itc ? chosen[s].cost : 0), 0) : 0
  const incentive = (site.country ?? 'US') === 'US' ? eligible * ECON.itc : 0
  const net = capex - incentive
  const renKwhYear = (rows.slice(0, 24).reduce((a, _r, i) => a + renewable(resource, ren, site, i, scenario, false), 0)) * 365
  let annualSaving = 0, co2TonsYear = 0, crew: Result['crew'], renShare = 0
  if (hosp) {
    const demandSave = cap > 0 ? Math.min(battKw, ctx.peakKw * 0.15) * ECON.demandChargePerKwMonth * 12 : 0
    const genService = chosen.backup.part.id === 'gen-small' ? chosen.backup.size * 12 : 0
    annualSaving = Math.min(renKwhYear, b.dailyKwh * 365) * site.tariff * 0.97 + demandSave + genService
    co2TonsYear = (Math.min(renKwhYear, b.dailyKwh * 365) * ECON.gridCo2KgPerKwh) / 1000 + (chosen.backup.part.kind === 'diesel-green' ? (baselineGallons * 4 * ECON.co2KgPerGal * 0.8) / 1000 : 0)
  } else {
    const shifts = 3
    const perShiftGen = gallons / shifts, perShiftBase = baselineGallons / shifts
    const galYearAvoided = Math.max(0, (perShiftBase - perShiftGen) * ECON.crewShiftsPerYear)
    const depotKwh = rows.reduce((a, r) => a + r.depot, 0) / shifts * ECON.crewShiftsPerYear
    const service = chosen.backup.part.id === 'gen-none' ? ECON.crewGenServicePerYear : gallons < 0.5 ? ECON.crewGenServicePerYear * 0.6 : 0
    // depot charging can come partly from the depot's own sun, wind or water (the Explorer site), the rest from the grid
    const chg = chosen.control.part.charge ?? { source: 'grid', kw: 0 }
    const depotDay = depotKwh / ECON.crewShiftsPerYear
    const renDay = chg.source === 'sun' ? chg.kw * site.psh * PV_DERATE : chg.source === 'wind' ? chg.kw * windCf(site.windMs, 12) * 24 : chg.source === 'water' ? chg.kw * hydroCf(site.hydro, 12) * 24 : 0
    renShare = depotDay > 0 ? Math.min(1, renDay / depotDay) : 0
    annualSaving = cap > 0 ? galYearAvoided * ECON.dieselPerGal + service - depotKwh * site.tariff * (1 - renShare) : 0
    co2TonsYear = (galYearAvoided * ECON.co2KgPerGal - depotKwh * ECON.gridCo2KgPerKwh * (1 - renShare)) / 1000
    const shiftRows = (k: number) => rows.filter((r) => r.onShift && Math.floor(((r.h - preset.shift![0]) + 24) / 24) === k)
    let onBatt = 0
    for (let k = 0; k <= shifts; k++) { const s = shiftRows(k); if (s.length && s.every((r) => r.gen < 0.01 && r.unserved < 0.01)) onBatt++ }
    crew = { shifts, shiftsOnBattery: Math.min(shifts, onBatt), galYearAvoided, dbaNow: genHours > 0 ? 68 : 45, dbaGen: 68, renShare, chargeSource: chg.source }
  }
  const payback = annualSaving > 0 ? net / annualSaving : null

  // CO₂ avoided hour by hour versus the same site on grid + UPS + diesel: grid hours save the grid's carbon on every kWh
  // that solar or storage supplied; outage and shift hours save the diesel the generator would have burned
  const kgDiesel = ECON.galPerKwh * ECON.co2KgPerGal
  for (const r of rows) {
    if (hosp) r.co2 = r.gridOn ? (r.load - r.grid) * ECON.gridCo2KgPerKwh : Math.max(0, r.essential - r.unserved - r.gen) * kgDiesel
    else r.co2 = r.onShift ? Math.max(0, r.load - r.unserved - r.gen) * kgDiesel : -r.depot * ECON.gridCo2KgPerKwh * (1 - renShare)
  }
  const co2TestKg = rows.reduce((a, r) => a + r.co2, 0)
  const co2OutageKg = Math.max(0, baselineGallons - gallons) * ECON.co2KgPerGal
  const sum = (k: keyof Row) => rows.reduce((a, r) => a + (r[k] as number), 0)
  const stats: ComponentStats = {
    source: { kwh: sum('ren'), peak: Math.max(...rows.map((r) => r.ren)), cf: ren > 0 ? sum('ren') / (ren * HOURS) : 0, curtailedKwh: Math.max(0, sum('renAvail') - sum('ren')) },
    storage: { inKwh: sum('battChg'), outKwh: sum('battDis'), minSoc: cap > 0 ? Math.min(...rows.map((r) => r.soc)) : 0, cycles: cap > 0 ? sum('battDis') / cap : 0, hoursCarried: rows.filter((r) => r.battDis > 0.5 && (r.outage || r.onShift)).length },
    backup: { kwh: genKwh, runHours: genHours, gallons, starts },
    grid: { kwh: sum('grid'), outageHours: rows.filter((r) => r.outage).length },
    load: { kwh: sum('load'), essentialKwh: demand, shedKwh: sum('shed'), unservedKwh: unserved },
  }

  const dieselCut = baselineGallons > 0 ? 1 - gallons / baselineGallons : 1
  const score = Math.round(Math.min(100, essentialServedPct * 0.6 + Math.min(1, batteryOnlyHours / Math.max(1, out.length)) * 20 + Math.max(0, dieselCut) * 20))
  const verdict = essentialServedPct >= 99.9 ? 'ok' : essentialServedPct >= 90 ? 'partial' : 'fail'
  return { rows, ctx, chosen, resource, capex, incentive, net, annualSaving, payback, essentialServedPct, batteryOnlyHours, gallons, baselineGallons, co2TonsYear, islanding, score, verdict, crew, renKwhYear, stats, co2TestKg, co2OutageKg }
}

/** Interpolated frame for a fractional hour on the 72-h clock (for smooth 3D animation). */
export function frameOf(rows: Row[], t: number): Row {
  const i0 = Math.max(0, Math.min(HOURS - 1, Math.floor(t))), i1 = Math.min(HOURS - 1, i0 + 1), f = Math.max(0, Math.min(1, t - i0))
  const a = rows[i0], b = rows[i1]
  const L = (k: keyof Row) => (a[k] as number) * (1 - f) + (b[k] as number) * f
  return { ...a, h: t, load: L('load'), essential: L('essential'), ren: L('ren'), renAvail: L('renAvail'), battDis: L('battDis'), battChg: L('battChg'), soc: L('soc'), grid: L('grid'), gen: L('gen'), shed: L('shed'), unserved: L('unserved'), depot: L('depot'), co2: L('co2') }
}

export const money = (v: number) => {
  const a = Math.abs(v), s = v < 0 ? '−' : ''
  return a >= 1e6 ? `${s}$${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `${s}$${Math.round(a / 1e3).toLocaleString()}k` : `${s}$${Math.round(a)}`
}
export const kwh = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)} MWh` : v >= 10 ? `${Math.round(v)} kWh` : `${v.toFixed(1)} kWh`)
export const kw = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)} MW` : `${Math.round(v)} kW`)
export const clock = (t: number) => `Day ${Math.floor(t / 24) + 1} · ${String(Math.floor(t % 24)).padStart(2, '0')}:${String(Math.floor((t % 1) * 60)).padStart(2, '0')}`
