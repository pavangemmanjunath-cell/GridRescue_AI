import { describe, expect, it } from 'vitest'
import { loadLadder } from './ladder'

const items = [{ id: 'a', name: 'theatres', kw: 100 }, { id: 'b', name: 'icu', kw: 100 }, { id: 'c', name: 'wards', kw: 100 }]

describe('movable storage load ladder', () => {
  it('stops at the energy limit, theatres first', () => {
    const l = loadLadder(items, 500, 250, 4, 1)   // 427 kWh usable
    expect(l.rows.map((r) => r.carried)).toEqual([true, false, false])
    expect(l.limitedBy).toBe('energy')
  })
  it('stops at the power limit', () => {
    const l = loadLadder(items, 4000, 250, 4, 1)
    expect(l.rows.map((r) => r.carried)).toEqual([true, true, false])
    expect(l.limitedBy).toBe('power')
    expect(l.kwUsed).toBe(200)
  })
  it('carries everything when the units are big enough', () => {
    const l = loadLadder(items, 4000, 1000, 4, 0.8)
    expect(l.carried).toBe(3)
    expect(l.limitedBy).toBeNull()
    expect(l.kwhUsed).toBe(960)
  })
  it('never skips a load to fit a smaller one further down', () => {
    const l = loadLadder([{ id: 'big', name: 'big', kw: 300 }, { id: 'small', name: 'small', kw: 10 }], 4000, 250, 1, 1)
    expect(l.rows.map((r) => r.carried)).toEqual([false, false])
  })
})
