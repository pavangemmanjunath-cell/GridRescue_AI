/**
 * Movable storage load ladder (Brief 12): add the hospital's loads in priority order — theatres first — until the
 * battery units run out of power (kW) or energy (kWh) for the chosen hours. Same rule as the backend's
 * `load_ladder` in backend/app/engine/relocatable.py.
 */
export interface LadderItem { id: string; name: string; kw: number; class?: string }
export interface LadderRow extends LadderItem { kwh: number; carried: boolean }
export interface Ladder { rows: LadderRow[]; kwUsed: number; kwhUsed: number; kwLimit: number; kwhLimit: number; carried: number; limitedBy: 'power' | 'energy' | null }

export const USABLE_SHARE = 0.9 * 0.95   // depth of discharge × inverter efficiency

export function loadLadder(items: LadderItem[], unitsKwh: number, unitsKw: number, hours: number, loadFactor: number): Ladder {
  const usable = unitsKwh * USABLE_SHARE
  let kw = 0, kwh = 0
  let limitedBy: Ladder['limitedBy'] = null
  const rows = items.map((it) => {
    const need = it.kw * loadFactor * hours
    const overKw = kw + it.kw > unitsKw + 1e-6
    const overKwh = kwh + need > usable + 1e-6
    const carried = limitedBy === null && !overKw && !overKwh
    if (carried) { kw += it.kw; kwh += need } else if (limitedBy === null) limitedBy = overKw ? 'power' : 'energy'   // the first load that does not fit names the limit
    return { ...it, kwh: Math.round(need), carried }
  })
  return { rows, kwUsed: Math.round(kw), kwhUsed: Math.round(kwh), kwLimit: Math.round(unitsKw), kwhLimit: Math.round(usable), carried: rows.filter((r) => r.carried).length, limitedBy }
}
