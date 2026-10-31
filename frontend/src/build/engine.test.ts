import { describe, expect, it } from 'vitest'
import { CITIES, CREW_SCENARIOS, HOSPITAL_SCENARIOS, PRESETS, partsFor, siteFromPoint, type Resource } from './catalog'
import { HOURS, simulate, type Build } from './engine'

const preset = (id: string) => PRESETS.find((p) => p.id === id)!
const city = (id: string) => CITIES.find((c) => c.id === id)!
const hosp = (parts: Partial<Build['parts']>, scenario = HOSPITAL_SCENARIOS[0], resource: Resource = 'sun', site = CITIES[0]): Build => ({
  preset: preset('cah'), dailyKwh: preset('cah').dailyKwh, site, scenario, resource,
  parts: { source: 'pv-roof', storage: 'st-lfp', control: 'ctl-micro', backup: 'gen-keep', ...parts },
})

describe('build engine', () => {
  it('simulates 72 hours and keeps the store inside its limits', () => {
    const r = simulate(hosp({}))
    expect(r.rows).toHaveLength(HOURS)
    for (const row of r.rows) { expect(row.soc).toBeGreaterThanOrEqual(0); expect(row.soc).toBeLessThanOrEqual(100.01) }
  })
  it('a 4 h LFP microgrid carries most of a 6 h storm before the generator starts', () => {
    const r = simulate(hosp({}))
    expect(r.essentialServedPct).toBeGreaterThan(99.9)
    expect(r.batteryOnlyHours).toBeGreaterThanOrEqual(4)
    expect(r.gallons).toBeLessThan(r.baselineGallons * 0.5)
  })
  it('grid-tied generation cannot help in an outage (anti-islanding)', () => {
    const r = simulate(hosp({ control: 'ctl-grid' }))
    expect(r.islanding).toBe(false)
    expect(r.rows.filter((x) => x.outage).every((x) => x.ren === 0 && x.battDis === 0)).toBe(true)
    expect(r.gallons).toBeCloseTo(r.baselineGallons, 0)
  })
  it('without any backup a long outage leaves essential load unserved', () => {
    const r = simulate(hosp({ storage: 'st-none', control: 'ctl-grid', backup: 'gen-small' }, HOSPITAL_SCENARIOS[3]))
    expect(r.essentialServedPct).toBeLessThan(99)
  })
  it('the federal credit applies to generation, storage and controls only', () => {
    const r = simulate(hosp({}))
    expect(r.incentive).toBeCloseTo((r.chosen.source.cost + r.chosen.storage.cost + r.chosen.control.cost) * 0.3, 0)
  })
  it('the generator starts in the same hour the store runs short, so a sound build covers every outage', () => {
    const p = preset('community')
    for (const scenario of HOSPITAL_SCENARIOS) {
      const r = simulate({ preset: p, dailyKwh: 33000, essentialShare: 0.6, site: CITIES[0], scenario, resource: 'sun', parts: { source: 'pv-roof', storage: 'st-lfp', control: 'ctl-micro', backup: 'gen-keep' } })
      expect(r.essentialServedPct, scenario.id).toBeGreaterThan(99.9)
    }
  })
  it('each resource offers only its own generation and storage', () => {
    const ids = (r: Resource) => partsFor('hospital', r).map((p) => p.id)
    expect(ids('sun')).toEqual(expect.arrayContaining(['pv-roof', 'st-lfp', 'st-na', 'st-pb', 'st-ice', 'st-hot', 'st-h2', 'st-sc']))
    expect(ids('sun')).not.toContain('wind-s')
    expect(ids('wind')).toEqual(expect.arrayContaining(['wind-m', 'st-lto', 'st-fly', 'st-flow', 'st-caes', 'st-h2']))
    expect(ids('water')).toEqual(expect.arrayContaining(['hydro-s', 'st-phes', 'st-mhb', 'st-tank', 'st-grav', 'st-h2w']))
    expect(ids('water')).not.toContain('st-na')
  })
  it('wind blows at night and the river runs all day', () => {
    const w = simulate(hosp({ source: 'wind-m', storage: 'st-flow' }, HOSPITAL_SCENARIOS[0], 'wind', city('kansascity')))
    expect(w.rows.filter((r) => r.h % 24 < 4).some((r) => r.renAvail > 0)).toBe(true)
    const h = simulate(hosp({ source: 'hydro-s', storage: 'st-mhb' }, HOSPITAL_SCENARIOS[0], 'water', city('seattle')))
    expect(Math.min(...h.rows.map((r) => r.renAvail))).toBeGreaterThan(0)
    expect(h.stats.source.cf).toBeGreaterThan(0.4)
  })
  it('blocked parts fall back: pumped hydro needs 50 m of head, compressed air is utility scale', () => {
    const flat = simulate(hosp({ source: 'hydro-s', storage: 'st-phes' }, HOSPITAL_SCENARIOS[0], 'water', city('miami')))
    expect(flat.chosen.storage.part.id).not.toBe('st-phes')
    const hill = simulate(hosp({ source: 'hydro-s', storage: 'st-phes' }, HOSPITAL_SCENARIOS[0], 'water', city('asheville')))
    expect(hill.chosen.storage.part.id).toBe('st-phes')
    const caes = simulate(hosp({ source: 'wind-m', storage: 'st-caes' }, HOSPITAL_SCENARIOS[0], 'wind'))
    expect(caes.chosen.storage.part.id).not.toBe('st-caes')
  })
  it('a thermal store only carries its share of the load', () => {
    const r = simulate(hosp({ storage: 'st-ice' }))
    for (const row of r.rows.filter((x) => x.outage)) expect(row.battDis).toBeLessThanOrEqual(row.essential * 0.3 + 1e-6)
  })
  it('a 90 kWh trailer carries a rail night shift with no generator', () => {
    const p = preset('rail')
    const r = simulate({ preset: p, dailyKwh: p.dailyKwh, site: CITIES[0], scenario: CREW_SCENARIOS[0], parts: { source: 'pv-none', storage: 'bess-trailer', control: 'ctl-plug', backup: 'gen-none' } })
    expect(r.essentialServedPct).toBeGreaterThan(99.9)
    expect(r.crew!.shiftsOnBattery).toBeGreaterThanOrEqual(2)
    expect(r.crew!.galYearAvoided).toBeGreaterThan(500)
  })
  it('maintenance work: batteries or a battery van, an optional generator, and depot charging from grid, sun, wind or water', () => {
    const crew = partsFor('crew')
    expect(crew.filter((p) => p.slot === 'storage').map((p) => p.id)).toEqual(['bess-cart', 'bess-trailer', 'bess-trailer-xl', 'bess-van'])
    expect(crew.filter((p) => p.slot === 'source').every((p) => p.size({} as never) === 0)).toBe(true)   // nothing generates at the work site
    expect(crew.filter((p) => p.slot === 'backup').map((p) => p.id)).toEqual(['gen-none', 'gen-keep'])
    const p = preset('rail'), run = (control: string, site = CITIES[0]) => simulate({ preset: p, dailyKwh: p.dailyKwh, site, scenario: CREW_SCENARIOS[0], parts: { source: 'pv-none', storage: 'bess-van', control, backup: 'gen-none' } })
    const grid = run('ctl-plug'), sun = run('ctl-sun')
    expect(grid.crew!.renShare).toBe(0)
    expect(sun.crew!.renShare).toBeGreaterThan(0.5)
    expect(sun.co2TonsYear).toBeGreaterThan(grid.co2TonsYear)
    expect(run('ctl-water', city('miami')).chosen.control.part.id).not.toBe('ctl-water')   // no river there: falls back to grid
  })
  it('the CO₂ saver: storage avoids diesel in the outage, solar avoids grid carbon every day', () => {
    const none = simulate(hosp({ source: 'pv-none', storage: 'st-none', control: 'ctl-grid' }, HOSPITAL_SCENARIOS[1]))
    const lfp = simulate(hosp({}, HOSPITAL_SCENARIOS[1])), h2 = simulate(hosp({ storage: 'st-h2' }, HOSPITAL_SCENARIOS[1]))
    expect(none.co2TestKg).toBeCloseTo(0, 0)
    expect(lfp.co2TestKg).toBeGreaterThan(500)
    expect(h2.co2OutageKg).toBeGreaterThan(lfp.co2OutageKg)          // hydrogen carries more of the 36 h
    expect(lfp.co2OutageKg).toBeCloseTo((lfp.baselineGallons - lfp.gallons) * 10.2, 0)
  })
  it('estimates sun, wind and tariff for any pin from nearby sites', () => {
    const s = siteFromPoint(33.5, -112, 'Pin')
    expect(s.psh).toBeGreaterThan(5.5)
    expect(s.windMs).toBeGreaterThan(3)
  })
})
