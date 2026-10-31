import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { CITIES, DEFAULT_FOR, PRESETS, scenariosFor, type City, type Family, type PresetId, type Resource, type Slot } from './catalog'

/** A sensible starting system for each family, so the 3D site is never empty. */
export const DEFAULT_PARTS: Record<Family, Record<Slot, string>> = {
  hospital: { source: 'pv-roof', storage: 'st-lfp', control: 'ctl-micro', backup: 'gen-keep' },
  crew: { source: 'pv-none', storage: 'bess-trailer', control: 'ctl-plug', backup: 'gen-none' },
}

export type UseCase = 'health' | 'markets'

interface BuildState {
  useCase: UseCase; presetId: PresetId; dailyKwh: number; essentialShare: number; site: City; existing: boolean; resource: Resource
  parts: Record<Family, Record<Slot, string>>; scenarioId: Record<Family, string>; step: number
  setUseCase: (u: UseCase) => void; setPreset: (id: PresetId) => void; setDaily: (v: number) => void; setEssential: (v: number) => void
  setSite: (c: City) => void; setExisting: (v: boolean) => void; setResource: (r: Resource) => void
  /** the site picked in the Explorer: location, its resources, the lens (sun / wind / water) and the facility size */
  fromExplorer: (site: City, resource: Resource, preset?: PresetId) => void
  setPart: (slot: Slot, id: string) => void; setScenario: (id: string) => void; setStep: (n: number) => void; reset: () => void
}

const start = PRESETS.find((p) => p.id === 'cah')!
const INITIAL = {
  useCase: 'health' as UseCase, presetId: start.id, dailyKwh: start.dailyKwh, essentialShare: start.essentialShare,
  site: { ...CITIES[0], source: 'reference' as const }, existing: true, resource: 'sun' as Resource,
  parts: DEFAULT_PARTS, scenarioId: { hospital: 'storm', crew: 'nights3' } as Record<Family, string>, step: 0,
}
const familyOf = (id: PresetId) => PRESETS.find((x) => x.id === id)!.family

export const useBuildStore = create<BuildState>()(persist((set, get) => ({
  ...INITIAL,
  // use case 1 = hospital management, use case 2 = maintenance work (rail and road crews)
  setUseCase: (u) => {
    set({ useCase: u })
    if (u === 'health' && familyOf(get().presetId) !== 'hospital') get().setPreset('cah')
    if (u === 'markets' && familyOf(get().presetId) !== 'crew') get().setPreset('rail')
  },
  setPreset: (id) => { const p = PRESETS.find((x) => x.id === id)!; set({ presetId: id, dailyKwh: p.dailyKwh, essentialShare: p.essentialShare, useCase: p.family === 'hospital' ? 'health' : 'markets' }) },
  setDaily: (v) => set({ dailyKwh: v }),
  setEssential: (v) => set({ essentialShare: v }),
  setSite: (c) => set({ site: c }),
  setExisting: (v) => set({ existing: v }),
  setResource: (r) => {
    // switching the resource fits that resource's default generation and storage
    const d = DEFAULT_FOR[r]
    set({ resource: r, parts: { ...get().parts, hospital: { ...get().parts.hospital, source: d.source, storage: d.storage } } })
  },
  fromExplorer: (site, resource, preset) => {
    if (preset) get().setPreset(preset)
    get().setResource(resource)
    set({ site, step: 0, useCase: 'health' })
  },
  setPart: (slot, id) => { const fam = familyOf(get().presetId); set({ parts: { ...get().parts, [fam]: { ...get().parts[fam], [slot]: id } } }) },
  setScenario: (id) => { const fam = familyOf(get().presetId); if (scenariosFor(fam).some((s) => s.id === id)) set({ scenarioId: { ...get().scenarioId, [fam]: id } }) },
  setStep: (n) => set({ step: n }),
  reset: () => set(INITIAL),
}), { name: 'gridrescue-build-v3', storage: createJSONStorage(() => { try { return sessionStorage } catch { return undefined as unknown as Storage } }) }))
