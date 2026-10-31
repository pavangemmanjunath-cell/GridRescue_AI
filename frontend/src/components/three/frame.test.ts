import { describe, expect, it } from 'vitest'
import { frameAt } from './SiteScene'
import type { SimRow } from '../../api/types'

const row = (hour: number, load: number, soc: number): SimRow => ({ hour, load_kw: load, critical_kw: load * 0.4, essential_kw: load * 0.3, non_essential_kw: load * 0.3, pv_kw: 0, wind_kw: 0, grid_available: hour < 18 ? 1 : 0, outage_event: hour >= 18 ? 1 : 0, grid_import_kw: 0, backup_charge_kw: 0, backup_discharge_kw: 0, soc_pct: soc, generator_kw: 0, fuel_cell_kw: 0, pumped_hydro_kw: 0, curtailed_kw: 0, unserved_kw: 0, unserved_critical_kw: 0 })

describe('frameAt', () => {
  const rows = Array.from({ length: 24 }, (_, h) => row(h, 100 + h * 10, 100 - h * 2))
  it('interpolates between hourly rows', () => {
    const f = frameAt(rows, 3.5)
    expect(f.load_kw).toBeCloseTo(135)
    expect(f.soc_pct).toBeCloseTo(93)
    expect(f.grid_available).toBe(1)
  })
  it('wraps around midnight', () => {
    const f = frameAt(rows, 23.5)
    expect(f.load_kw).toBeCloseTo((330 + 100) / 2)
    expect(f.outage_event).toBe(1)
  })
})
