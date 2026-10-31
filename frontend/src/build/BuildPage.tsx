import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CircleMarker, MapContainer, Marker, TileLayer, Tooltip as MapTip, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import { Icon } from '../components/ui/Icon'
import { CITIES, MARKETS, PRESETS, RESOURCES, partsFor, scenariosFor, siteFromPoint, type Family, type Resource, type Slot } from './catalog'
import { HOURS, SLOTS, clock, frameOf, kw, kwh, loadShape, money, simulate, type Build, type Result, type Row } from './engine'
import { BuildScene, useWebGL, type Focus, type ZoomCmd } from './BuildScene'
import { useBuildStore } from './useBuildStore'

interface Step { id: Focus | 'usecase'; title: string; short: string; icon: string }
const SOURCE_WORD: Record<Resource, string> = { sun: 'solar', wind: 'wind', water: 'hydro' }
/** Hospital management walks every part; maintenance work has no sun, wind or generator — battery and grid charging only. */
const stepsFor = (f: Family, r: Resource): Step[] => ([
  { id: 'usecase', title: 'Choose the use case', short: 'Use case', icon: f === 'hospital' ? 'hospital' : 'fuel' },
  { id: 'site', title: f === 'hospital' ? 'Your site and energy source' : 'Your depot', short: f === 'hospital' ? 'Site' : 'Depot', icon: 'pin' },
  { id: 'load', title: f === 'hospital' ? 'Set the daily consumption' : 'Set the shift load', short: 'Load', icon: 'zap' },
  { id: 'source', title: `Add ${SOURCE_WORD[r]} generation`, short: r === 'sun' ? 'Solar' : r === 'wind' ? 'Wind' : 'Hydro', icon: RESOURCES.find((x) => x.id === r)!.icon },
  { id: 'storage', title: f === 'hospital' ? 'Choose the energy storage' : 'Choose the battery', short: f === 'hospital' ? 'Storage' : 'Battery', icon: 'backup_device' },
  { id: 'control', title: f === 'hospital' ? 'Islanding & UPS' : 'Grid charging at the depot', short: f === 'hospital' ? 'Controls' : 'Grid charging', icon: f === 'hospital' ? 'shield' : 'grid' },
  { id: 'backup', title: 'Backup generator', short: 'Generator', icon: 'fuel' },
  { id: 'simulate', title: f === 'hospital' ? 'Run the outage test' : 'Run the shift test', short: 'Simulate', icon: 'play' },
] as Step[]).filter((s) => f === 'hospital' || (s.id !== 'source' && s.id !== 'backup'))
const USE_CASES = [{ id: 'health', label: '1 · Hospital management' }, { id: 'markets', label: '2 · Maintenance work' }] as const
const pinIcon = L.divIcon({ className: '', html: '<div class="gr-b-pin"></div>', iconSize: [18, 18], iconAnchor: [9, 9] })
const COLORS = { grid: '#2F6FEB', battery: '#22C55E', gen: '#EF4444', unserved: '#94A3B8', load: '#F3F6FB', soc: '#4ADE80' }
const renColor = (r: Resource) => RESOURCES.find((x) => x.id === r)!.color
const TT = { background: '#0B1A2E', border: '1px solid #244065', borderRadius: 8, fontSize: 12 }

/**
 * Build your system — a step-by-step 3D configurator. The story starts in the Explorer (pick a location or a hospital and
 * a resource lens), then here: choose the use case, swap generation, storage, controls and generator parts for that
 * resource, and run a 72-hour outage. The simulation drawer slides up under the 3D view with the graphs and each
 * component's own data. Runs entirely in the browser.
 */
export function BuildPage() {
  const st = useBuildStore()
  const nav = useNavigate()
  const preset = PRESETS.find((p) => p.id === st.presetId)!
  const fam = preset.family
  const resource: Resource = fam === 'hospital' ? st.resource : 'sun'
  const steps = stepsFor(fam, resource)
  const step = Math.min(st.step, steps.length - 1)
  const scenario = scenariosFor(fam).find((s) => s.id === st.scenarioId[fam]) ?? scenariosFor(fam)[0]
  const build: Build = { preset, dailyKwh: st.dailyKwh, site: st.site, parts: st.parts[fam], scenario, resource, essentialShare: fam === 'hospital' ? st.essentialShare : undefined, existing: st.existing }
  const key = JSON.stringify(build)
  const result = useMemo(() => simulate(build), [key])   // eslint-disable-line react-hooks/exhaustive-deps

  // the simulated clock runs all the time, so day / night and the outage play while you build
  const [t, setT] = useState(fam === 'hospital' ? 13 : 21)
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(1.5)
  const [labels, setLabels] = useState(true)
  const [viewKey, setViewKey] = useState(0)
  const [drawer, setDrawer] = useState(false)
  const [inspect, setInspect] = useState<Inspect>('storage')
  const [zoom, setZoom] = useState<ZoomCmd>({ seq: 0, kind: 'fit' })
  const [wide, setWide] = useState(false)   // hide the side panel so the 3D view takes the whole width
  const zoomBy = (kind: ZoomCmd['kind']) => setZoom((z) => ({ seq: z.seq + 1, kind }))
  // the simulation drawer slides down before it unmounts; it can also be made taller
  const [closing, setClosing] = useState(false)
  const [tall, setTall] = useState(false)
  const closeDrawer = () => { setClosing(true); setTimeout(() => { setDrawer(false); setClosing(false) }, 280) }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, select, textarea')) return
      if (e.key === '+' || e.key === '=') zoomBy('in'); else if (e.key === '-' || e.key === '_') zoomBy('out'); else if (e.key === '0') zoomBy('fit')
      else if (e.key === 'Escape') { setClosing(true); setTimeout(() => { setDrawer(false); setClosing(false) }, 280) }
    }
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key)
  }, [])
  // the 3D scene reads the current frame inside its render loop; the HUD uses the same frame from state
  const f = frameOf(result.rows, t)
  const frameRef = useRef<Row>(f)
  useEffect(() => { frameRef.current = f })
  useEffect(() => {
    if (!playing) return
    let raf = 0, last = performance.now()
    const tick = (now: number) => { const dt = Math.min(0.1, (now - last) / 1000); last = now; setT((x) => (x + dt * speed) % HOURS); raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, speed])
  // jump to the interesting moment when the scenario changes; open the graphs on the test step
  const jumpTo = fam === 'hospital' ? Math.max(0, scenario.start - 1) : 21
  useEffect(() => { setT(jumpTo) }, [scenario.id, jumpTo])
  useEffect(() => { if (steps[step].id === 'simulate') setDrawer(true) }, [step])   // eslint-disable-line react-hooks/exhaustive-deps

  const shell = useRef<HTMLDivElement>(null)
  const webgl = useWebGL()
  const go = (n: number) => st.setStep(Math.max(0, Math.min(steps.length - 1, n)))
  const goTo = (id: Step['id']) => { const i = steps.findIndex((s) => s.id === id); if (i >= 0) go(i) }
  // switching use case or facility keeps you on the same step (Simulate stays Simulate)
  const keepStep = (change: () => void) => {
    const id = steps[step].id
    change()
    const s = useBuildStore.getState(), f2 = PRESETS.find((p) => p.id === s.presetId)!.family
    const next = stepsFor(f2, f2 === 'hospital' ? s.resource : 'sun')
    const i = next.findIndex((x) => x.id === id)
    s.setStep(i >= 0 ? i : Math.min(step, next.length - 1))
  }
  const focus: Focus = steps[step].id === 'usecase' ? 'overview' : (steps[step].id as Focus)
  const res = RESOURCES.find((x) => x.id === resource)!
  const fromExplorer = st.site.source === 'explorer'
  const chips = fam === 'hospital' ? partsFor('hospital', resource).filter((p) => p.slot === 'storage') : []

  return (
    <div className={`gr-build ${drawer && !closing ? 'drawer-open' : ''} ${drawer && tall ? 'drawer-tall' : ''} ${wide ? 'wide' : ''}`} ref={shell} data-testid="build-page">
      <header className="gr-b-head">
        <div className="gr-b-title">
          <span className="gr-b-logo"><Icon name="cube" size={18} /></span>
          <div><b>BUILD YOUR RESILIENCE SYSTEM</b><small>{preset.short} · {st.site.name}{fromExplorer ? ' · from Explorer' : ''}</small></div>
          <div className="gr-b-pick">
            <label className="gr-b-select"><span>Use case</span>
              <select value={st.useCase} onChange={(e) => keepStep(() => st.setUseCase(e.target.value as typeof st.useCase))} data-testid="usecase-select">
                {USE_CASES.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
              </select>
            </label>
            <label className="gr-b-select"><span>{fam === 'hospital' ? 'Facility' : 'Crew'}</span>
              <select value={st.presetId} onChange={(e) => keepStep(() => st.setPreset(e.target.value as typeof st.presetId))} data-testid="preset-select">
                {PRESETS.filter((p) => p.family === fam).map((p) => <option key={p.id} value={p.id}>{p.short}</option>)}
              </select>
            </label>
          </div>
          {fam === 'hospital'
            ? <span className="gr-b-res" style={{ ['--res' as string]: res.color }} data-testid="resource-badge"><Icon name={res.icon} size={13} />{res.badge}</span>
            : <span className="gr-b-res" style={{ ['--res' as string]: '#38BDF8' }} data-testid="resource-badge"><Icon name="grid" size={13} />GRID-CHARGED BATTERY</span>}
        </div>
        <div className="gr-b-tag" data-testid="price-tag">
          <div><small>Installed</small><b>{money(result.capex)}</b></div>
          {result.incentive > 0 && <div><small>After 30 % federal credit</small><b className="g">{money(result.net)}</b></div>}
          <div><small>Saves a year</small><b>{money(result.annualSaving)}</b></div>
          <div><small>Payback</small><b>{result.payback != null && result.payback < 40 ? `${result.payback.toFixed(1)} yr` : '—'}</b></div>
          <div className={`gr-b-score ${result.verdict}`} data-testid="score"><small>Resilience</small><b>{result.score}</b></div>
        </div>
      </header>

      <div className="gr-b-main">
        <div className="gr-b-stage">
          {webgl ? <BuildScene key={viewKey} result={result} frameRef={frameRef} focus={focus} labels={labels} zoom={zoom} onPick={(s) => { setInspect(s); goTo(s) }} />
            : <div className="gr-empty">This browser has WebGL turned off — the numbers on the right still work.</div>}
          <div className="gr-b-chip" data-testid="step-chip">{`${step + 1} — ${steps[step].title}`}</div>
          {chips.length > 0 && (
            <div className="gr-b-quick" role="toolbar" aria-label="Quick storage pick" data-testid="storage-chips">
              {chips.map((p) => {
                const blocked = p.blocked?.(result.ctx)
                const on = result.chosen.storage.part.id === p.id
                return (
                  <button key={p.id} className={`${on ? 'on' : ''} ${p.id === 'st-none' ? 'base' : ''}`} disabled={!!blocked} title={blocked ?? `${p.tech?.type} · ${p.tech?.duration} · ${p.tech?.role}`}
                    onClick={() => { st.setPart('storage', p.id); setInspect('storage') }} data-testid={`chip-${p.id}`}>
                    {p.short ?? p.name}
                  </button>
                )
              })}
            </div>
          )}
          {fam === 'crew' && (
            // maintenance work: pick the battery (the van drives in) and add or remove a backup generator in one click
            <div className="gr-b-quick" role="toolbar" aria-label="Quick pick for the crew" data-testid="crew-chips">
              {partsFor('crew').filter((p) => p.slot === 'storage').map((p) => (
                <button key={p.id} className={result.chosen.storage.part.id === p.id ? 'on' : ''} onClick={() => { st.setPart('storage', p.id); setInspect('storage') }} data-testid={`chip-${p.id}`}>
                  <Icon name={p.kind === 'van' ? 'arrow' : 'backup_device'} size={12} /> {p.short ?? p.name}
                </button>
              ))}
              <button className={`gen ${result.chosen.backup.size > 0 ? 'on' : ''}`} aria-pressed={result.chosen.backup.size > 0}
                onClick={() => { st.setPart('backup', result.chosen.backup.size > 0 ? 'gen-none' : 'gen-keep'); setInspect('backup') }} data-testid="chip-generator">
                <Icon name="fuel" size={12} /> {result.chosen.backup.size > 0 ? 'Generator added · remove' : '+ Diesel generator'}
              </button>
            </div>
          )}
          <Co2Saver result={result} t={t} />
          <div className="gr-b-zoom" role="group" aria-label="Zoom the 3D view">
            <button onClick={() => zoomBy('in')} aria-label="Zoom in" title="Zoom in (+)" data-testid="zoom-in">+</button>
            <button onClick={() => zoomBy('out')} aria-label="Zoom out" title="Zoom out (-)" data-testid="zoom-out">−</button>
            <button onClick={() => zoomBy('fit')} aria-label="Fit the whole site" title="Fit the whole site (0)" data-testid="zoom-fit"><Icon name="target" size={15} /></button>
          </div>
          <div className="gr-b-tools">
            <button className={wide ? 'on' : ''} onClick={() => setWide((v) => !v)} aria-pressed={wide} data-testid="toggle-panel"><Icon name="layers" size={13} /> {wide ? 'Show panel' : 'Hide panel'}</button>
            <button className={labels ? 'on' : ''} onClick={() => setLabels((v) => !v)} data-testid="toggle-labels"><Icon name="info" size={13} /> Labels</button>
            <button onClick={() => setViewKey((k) => k + 1)} data-testid="reset-view"><Icon name="refresh" size={13} /> Reset view</button>
            <button onClick={() => { if (document.fullscreenElement) document.exitFullscreen(); else shell.current?.requestFullscreen?.() }} data-testid="fullscreen"><Icon name="cube" size={13} /> Full screen</button>
          </div>
          <div className={`gr-b-live ${f.outage ? 'out' : ''}`} data-testid="live-hud">
            <span className="clk">{clock(t)}</span>
            {fam === 'hospital'
              ? <i className={f.gridOn ? 'on' : 'off'}>{f.gridOn ? 'Grid on' : 'OUTAGE · islanded'}</i>
              : <i className={f.onShift ? 'on' : 'idle'}>{f.onShift ? 'Crew on shift' : f.depot > 0 ? 'Charging at depot' : 'Parked'}</i>}
            {fam === 'hospital'
              ? <span><em style={{ background: renColor(resource) }} />{resource === 'sun' ? 'Solar' : resource === 'wind' ? 'Wind' : 'Hydro'} {kw(f.ren)}</span>
              : <span><em style={{ background: '#38BDF8' }} />Depot charging {kw(f.depot)}{result.crew && result.crew.renShare > 0 ? ` · ${Math.round(result.crew.renShare * 100)} % from ${result.crew.chargeSource === 'sun' ? 'solar' : result.crew.chargeSource === 'wind' ? 'wind' : 'hydro'}` : ''}</span>}
            <span><em style={{ background: COLORS.battery }} />Storage {Math.round(f.soc)} %</span>
            {f.gen > 0.5 && <span><em style={{ background: COLORS.gen }} />Generator {kw(f.gen)}</span>}
            {f.unserved > 0.5 && <span className="bad">Unserved {kw(f.unserved)}</span>}
          </div>
          {!drawer && <div className="gr-b-hint">Drag to rotate · scroll, pinch or + / − to zoom · 0 fits the whole site</div>}
          {!drawer && (
            <button className="gr-b-drawer-btn" onClick={() => setDrawer(true)} aria-expanded={false} data-testid="drawer-toggle">
              <Icon name="compare" size={13} /> Show simulation graphs
            </button>
          )}
          {drawer && <SimDrawer result={result} t={t} setT={(v) => { setT(v); setPlaying(false) }} inspect={inspect} setInspect={setInspect}
            closing={closing} tall={tall} onTall={() => setTall((v) => !v)} onClose={closeDrawer} />}
        </div>

        <aside className="gr-b-panel" data-testid="build-panel">
          <div className="gr-b-panel-head">
            <small>STEP {step + 1} OF {steps.length}</small>
            <h2>{steps[step].title}</h2>
          </div>
          <div className="gr-b-panel-body">
            {!fromExplorer && step <= 1 && (
              <div className="gr-b-story" data-testid="explorer-hint">
                <b>Start from your real site</b>
                <span>Pick a location or a hospital in the Explorer, choose Sun, Wind or Water, then come back to build. Until then a sample site is used.</span>
                <button className="gr-btn" onClick={() => nav('/explorer')} data-testid="go-explorer"><Icon name="globe" size={14} /> Open the Explorer</button>
              </div>
            )}
            {steps[step].id === 'usecase' && <UseCaseStep onSimulate={() => go(steps.length - 1)} onUseCase={(u) => keepStep(() => st.setUseCase(u))} />}
            {steps[step].id === 'site' && <SiteStep result={result} />}
            {steps[step].id === 'load' && <LoadStep />}
            {(SLOTS as string[]).includes(steps[step].id) && <PartStep slot={steps[step].id as Slot} build={build} current={result} onPicked={(s) => setInspect(s)} />}
            {steps[step].id === 'simulate' && <SimStep result={result} openDrawer={() => setDrawer(true)} />}          </div>
          <div className="gr-b-panel-foot">
            <button className="gr-btn gr-btn-ghost" disabled={step === 0} onClick={() => go(step - 1)} data-testid="prev-step">Back</button>
            {step < steps.length - 1
              ? <button className="gr-btn" onClick={() => go(step + 1)} data-testid="next-step">Next · {steps[step + 1].short} <Icon name="arrow" size={14} /></button>
              : <button className="gr-btn gr-btn-rescue" onClick={() => downloadSummary(result, build)} data-testid="download-summary"><Icon name="download" size={14} /> Download summary</button>}
          </div>
        </aside>
      </div>

      <footer className="gr-b-timeline">
        <button className="gr-b-play" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'pause' : 'play'} data-testid="play"><Icon name={playing ? 'pause' : 'play'} size={15} /></button>
        <ol className="gr-b-steps" data-testid="step-rail">
          {steps.map((s, i) => (
            <li key={s.id} className={i < step ? 'done' : i === step ? 'now' : ''}>
              <button onClick={() => go(i)} data-testid={`step-${s.id}`}><span><Icon name={i < step ? 'check' : s.icon} size={12} /></span><b>{s.short}</b></button>
            </li>
          ))}
        </ol>
        <div className="gr-b-scrub">
          <OutageStrip rows={result.rows} />
          <input type="range" min={0} max={HOURS - 0.01} step={0.05} value={t} onChange={(e) => { setT(Number(e.target.value)); setPlaying(false) }} aria-label="simulated hour" data-testid="time-slider" />
        </div>
        <select className="gr-b-speed" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="speed"><option value={0.75}>½×</option><option value={1.5}>1×</option><option value={3}>2×</option><option value={6}>4×</option></select>
      </footer>
    </div>
  )
}

const KG_PER_CAR = 4600   // EPA: a typical passenger vehicle emits about 4.6 t of CO₂ a year
/**
 * CO₂ saver: what the chosen storage and generation avoid compared with the same site on grid + UPS + diesel. The counter
 * follows the simulated clock; the outage line changes with the storage you pick.
 */
function Co2Saver({ result, t }: { result: Result; t: number }) {
  const rows = result.rows, n = Math.min(rows.length, Math.floor(t)), frac = t - Math.floor(t)
  const soFar = rows.slice(0, n).reduce((a, r) => a + r.co2, 0) + (rows[n]?.co2 ?? 0) * frac
  const total = Math.max(1, result.co2TestKg)
  const crew = result.ctx.preset.family === 'crew'
  const year = Math.max(0, result.co2TonsYear)
  const store = result.chosen.storage.part
  const storeName = store.id === 'st-none' ? 'UPS + diesel' : store.short ?? store.name
  return (
    <aside className="gr-b-co2" data-testid="co2-saver" aria-live="polite">
      <div className="hd"><small>CO₂ saver</small><em key={store.id}>{storeName}{!crew && result.chosen.source.size > 0 ? ` + ${result.resource === 'sun' ? 'sun' : result.resource === 'wind' ? 'wind' : 'hydro'}` : ''}</em></div>
      <b data-testid="co2-sofar">{Math.round(Math.max(0, soFar)).toLocaleString()} kg</b>
      <span>CO₂ saved so far in this {crew ? 'three-shift' : '72-hour'} test</span>
      <i className="bar"><em style={{ width: `${Math.max(0, Math.min(100, (soFar / total) * 100))}%` }} /></i>
      <dl>
        <dt>A year</dt><dd>{year >= 10 ? Math.round(year).toLocaleString() : year.toFixed(1)} t · ≈ {Math.max(0, year * 1000 / KG_PER_CAR).toFixed(year * 1000 / KG_PER_CAR >= 10 ? 0 : 1)} cars off the road</dd>
        <dt>{crew ? 'Per year, diesel' : 'This outage'}</dt>
        <dd data-testid="co2-outage">{crew
          ? `${Math.round(result.crew?.galYearAvoided ?? 0).toLocaleString()} gal avoided`
          : `${Math.round(result.co2OutageKg).toLocaleString()} kg · ${Math.round(Math.max(0, result.baselineGallons - result.gallons)).toLocaleString()} gal diesel`}</dd>
      </dl>
      <p>vs the same site on {crew ? 'a diesel generator' : 'grid + UPS + diesel'} · EPA 4.6 t per car a year</p>
    </aside>
  )
}

/** Thin coloured strip under the scrubber: outage or shift hours, and any hour with unserved load. */
function OutageStrip({ rows }: { rows: Row[] }) {
  return <div className="gr-b-strip">{rows.map((r) => <i key={r.h} className={r.unserved > 0.5 ? 'bad' : r.outage ? 'out' : r.onShift ? 'shift' : ''} />)}</div>
}

// ---------------- simulation drawer ----------------
type Inspect = Slot | 'grid' | 'load'
const hourTick = (h: number) => (h % 24 === 0 ? `D${h / 24 + 1}` : `${h % 24}h`)
const kwTick = (v: number) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)} MW` : `${Math.round(v)}`)
/** Vertical fade used by every area: strong at the top, almost clear at the base. */
const Fade = ({ id, color }: { id: string; color: string }) => (
  <linearGradient id={id} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity={0.9} /><stop offset="100%" stopColor={color} stopOpacity={0.18} /></linearGradient>
)

function SimDrawer({ result, t, setT, inspect, setInspect, closing, tall, onTall, onClose }: {
  result: Result; t: number; setT: (v: number) => void; inspect: Inspect; setInspect: (s: Inspect) => void
  closing: boolean; tall: boolean; onTall: () => void; onClose: () => void
}) {
  const [tab, setTab] = useState<'system' | 'components'>('system')
  const rc = renColor(result.resource)
  const renName = result.resource === 'sun' ? 'Solar' : result.resource === 'wind' ? 'Wind' : 'Hydro'
  const data = result.rows.map((r) => ({ h: r.h, Renewable: r.ren, Grid: r.grid, Storage: r.battDis, Generator: r.gen, Unserved: r.unserved, Load: r.gridOn ? r.load : r.essential, soc: r.soc, charge: -r.battChg }))
  const out = result.rows.filter((r) => r.outage || r.onShift)
  const now = frameOf(result.rows, t)
  const s = result.stats, c = result.chosen
  const SERIES = [['Grid', COLORS.grid], ['Renewable', rc], ['Storage', COLORS.battery], ['Generator', COLORS.gen], ['Unserved', COLORS.unserved]] as const
  const cards: { id: Inspect; title: string; name: string; color: string; key: keyof (typeof data)[number]; nowText: string; stats: [string, string][] }[] = [
    { id: 'source', title: renName, name: c.source.size > 0 ? `${c.source.part.name} · ${Math.round(c.source.size).toLocaleString()} ${c.source.part.unit}` : 'None fitted', color: rc, key: 'Renewable', nowText: kw(now.ren),
      stats: [['Produced', kwh(s.source.kwh)], ['Peak', kw(s.source.peak)], ['Capacity factor', `${Math.round(s.source.cf * 100)} %`], ['Unused', kwh(s.source.curtailedKwh)]] },
    { id: 'storage', title: 'Storage', name: c.storage.size > 0 ? `${c.storage.part.short ?? c.storage.part.name} · ${kwh(c.storage.size)}` : 'None — UPS + diesel', color: COLORS.battery, key: 'soc', nowText: `${Math.round(now.soc)} %`,
      stats: [['Delivered', kwh(s.storage.outKwh)], ['Lowest charge', `${Math.round(s.storage.minSoc)} %`], ['Full cycles', s.storage.cycles.toFixed(1)], ['Hours carried', `${s.storage.hoursCarried} h`]] },
    { id: 'backup', title: 'Generator', name: c.backup.size > 0 ? `${Math.round(c.backup.size)} kVA` : 'None', color: COLORS.gen, key: 'Generator', nowText: now.gen > 0.5 ? kw(now.gen) : 'off',
      stats: [['Energy', kwh(s.backup.kwh)], ['Run hours', `${s.backup.runHours} h`], ['Diesel', `${Math.round(s.backup.gallons).toLocaleString()} gal`], ['Starts', String(s.backup.starts)]] },
    { id: 'grid', title: 'Utility grid', name: result.ctx.preset.family === 'hospital' ? 'Utility feed' : 'Depot charging only', color: COLORS.grid, key: 'Grid', nowText: now.gridOn ? kw(now.grid) : 'down',
      stats: [['Imported', kwh(s.grid.kwh)], ['Outage', `${s.grid.outageHours} h`]] },
    { id: 'load', title: 'Load', name: result.ctx.preset.short, color: COLORS.load, key: 'Load', nowText: kw(now.gridOn ? now.load : now.essential),
      stats: [['Essential in test', kwh(s.load.essentialKwh)], ['Shed by design', kwh(s.load.shedKwh)], ['Unserved', kwh(s.load.unservedKwh)], ['Served', `${result.essentialServedPct.toFixed(1)} %`]] },
  ]
  if (result.ctx.preset.family === 'crew') cards.splice(0, cards.length, ...cards.filter((x) => x.id !== 'source' && x.id !== 'backup'))   // battery + grid only
  const focused = cards.find((x) => x.id === inspect) ?? cards.find((x) => x.id === 'storage')!
  const axis = { dataKey: 'h', type: 'number' as const, domain: [0, HOURS - 1] as [number, number], ticks: [0, 12, 24, 36, 48, 60], tickFormatter: hourTick, tick: { fill: '#8FA2C2', fontSize: 10 }, axisLine: false, tickLine: false }
  const click = (e: { activeLabel?: string | number } | null) => { const x = Number(e?.activeLabel); if (!Number.isNaN(x)) setT(x) }
  const band = out.length > 0 && <ReferenceArea x1={out[0].h} x2={out[out.length - 1].h} fill="#EF4444" fillOpacity={0.08} stroke="#EF4444" strokeOpacity={0.25} strokeDasharray="3 3" />
  const playhead = <ReferenceLine x={t} stroke="#F0CB72" strokeWidth={2} />
  return (
    <section className={`gr-b-drawer ${closing ? 'closing' : ''} ${tall ? 'tall' : ''}`} data-testid="sim-drawer" aria-label="Simulation graphs">
      <div className="gr-b-drawer-grip" aria-hidden="true" />
      <div className="gr-b-drawer-head">
        <div className="gr-seg2 gr-b-seg" role="tablist">
          <button className={tab === 'system' ? 'on' : ''} onClick={() => setTab('system')} data-testid="drawer-system">Whole system</button>
          <button className={tab === 'components' ? 'on' : ''} onClick={() => setTab('components')} data-testid="drawer-components">Each component</button>
        </div>
        <span className="gr-b-drawer-now"><b>{clock(t)}</b> · click a graph to jump there</span>
        <div className="gr-b-drawer-actions">
          <button onClick={onTall} aria-pressed={tall} title={tall ? 'Make the panel shorter' : 'Make the panel taller'} data-testid="drawer-tall">{tall ? '▾ Shorter' : '▴ Taller'}</button>
          <button className="x" onClick={onClose} aria-label="Close the simulation panel" title="Close (Esc)" data-testid="drawer-close">×</button>
        </div>
      </div>
      {tab === 'system' ? (
        <div className="gr-b-drawer-grid">
          <div className="gr-b-dchart">
            <div className="gr-b-dchart-head">
              <small>Who supplies the load</small>
              <span className="now">{SERIES.filter(([k]) => (now as unknown as Record<string, number>)[{ Grid: 'grid', Renewable: 'ren', Storage: 'battDis', Generator: 'gen', Unserved: 'unserved' }[k]] > 0.5).map(([k, col]) => (
                <em key={k} style={{ ['--c' as string]: col }}>{k === 'Renewable' ? renName : k} {kw((now as unknown as Record<string, number>)[{ Grid: 'grid', Renewable: 'ren', Storage: 'battDis', Generator: 'gen', Unserved: 'unserved' }[k]])}</em>
              ))}</span>
            </div>
            <div className="plot">
              <ResponsiveContainer>
                <ComposedChart data={data} margin={{ left: 0, right: 8, top: 6, bottom: 0 }} onClick={click}>
                  <defs>{SERIES.map(([k, col]) => <Fade key={k} id={`dw-${k}`} color={col} />)}</defs>
                  <CartesianGrid stroke="rgba(148,163,184,0.12)" vertical={false} />
                  {band}
                  <XAxis {...axis} />
                  <YAxis tick={{ fill: '#8FA2C2', fontSize: 10 }} width={46} axisLine={false} tickLine={false} tickFormatter={kwTick} />
                  <Tooltip contentStyle={TT} formatter={(v, k) => [`${Math.round(Number(v))} kW`, k === 'Renewable' ? renName : k]} labelFormatter={(h) => clock(Number(h))} />
                  {SERIES.map(([k, col]) => <Area key={k} type="monotone" dataKey={k} stackId="s" isAnimationActive={false} stroke={col} strokeWidth={1.2} fill={`url(#dw-${k})`} />)}
                  <Line dataKey="Load" stroke={COLORS.load} strokeWidth={1.6} strokeDasharray="5 3" dot={false} isAnimationActive={false} />
                  {playhead}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="gr-b-dchart">
            <div className="gr-b-dchart-head">
              <small>Storage charge</small>
              <span className="now"><em style={{ ['--c' as string]: COLORS.soc }}>{Math.round(now.soc)} % full</em>{now.battDis > 0.5 && <em style={{ ['--c' as string]: COLORS.battery }}>giving {kw(now.battDis)}</em>}{now.battChg > 0.5 && <em style={{ ['--c' as string]: '#38BDF8' }}>charging {kw(now.battChg)}</em>}</span>
            </div>
            <div className="plot">
              <ResponsiveContainer>
                <ComposedChart data={data} margin={{ left: 0, right: 4, top: 6, bottom: 0 }} onClick={click}>
                  <defs><Fade id="dw-soc" color={COLORS.soc} /></defs>
                  <CartesianGrid stroke="rgba(148,163,184,0.12)" vertical={false} />
                  {band}
                  <XAxis {...axis} />
                  <YAxis yAxisId="soc" domain={[0, 100]} ticks={[0, 50, 100]} tick={{ fill: '#8FA2C2', fontSize: 10 }} width={34} axisLine={false} tickLine={false} tickFormatter={(v) => `${v}%`} />
                  <YAxis yAxisId="kw" orientation="right" tick={{ fill: '#8FA2C2', fontSize: 10 }} width={40} axisLine={false} tickLine={false} tickFormatter={kwTick} />
                  <Tooltip contentStyle={TT} formatter={(v, k) => (k === 'soc' ? [`${Math.round(Number(v))} %`, 'Charge'] : [`${Math.round(Math.abs(Number(v)))} kW`, k === 'charge' ? 'Charging' : 'Discharging'])} labelFormatter={(h) => clock(Number(h))} />
                  <Area yAxisId="soc" dataKey="soc" type="monotone" stroke={COLORS.soc} strokeWidth={2} fill="url(#dw-soc)" isAnimationActive={false} />
                  <Bar yAxisId="kw" dataKey="Storage" fill={COLORS.battery} fillOpacity={0.9} radius={[2, 2, 0, 0]} isAnimationActive={false} />
                  <Bar yAxisId="kw" dataKey="charge" fill="#38BDF8" fillOpacity={0.8} radius={[0, 0, 2, 2]} isAnimationActive={false} />
                  <ReferenceLine yAxisId="soc" x={t} stroke="#F0CB72" strokeWidth={2} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="gr-b-legend">
            {SERIES.map(([k, col]) => <span key={k}><i style={{ background: col }} />{k === 'Renewable' ? renName : k}</span>)}
            <span><i style={{ background: '#38BDF8' }} />Charging</span><span><i className="line" />Load</span><span><i className="band" />{result.ctx.preset.family === 'hospital' ? 'Outage' : 'Shift'}</span>
          </div>
        </div>
      ) : (
        <div className="gr-b-comp" data-testid="component-grid">
          <div className="gr-b-comp-list">
            {cards.map((x) => (
              <button key={x.id} className={`gr-b-comp-card ${x.id === focused.id ? 'on' : ''}`} onClick={() => setInspect(x.id)} data-testid={`comp-${x.id}`} style={{ ['--c' as string]: x.color }}>
                <div className="top"><b>{x.title}</b><em>{x.nowText}</em></div>
                <span>{x.name}</span>
                <div className="spark">
                  <ResponsiveContainer>
                    <AreaChart data={data} margin={{ left: 0, right: 0, top: 2, bottom: 0 }}>
                      <defs><Fade id={`sp-${x.id}`} color={x.color} /></defs>
                      <Area type="monotone" dataKey={x.key} stroke={x.color} fill={`url(#sp-${x.id})`} strokeWidth={1.4} isAnimationActive={false} />
                      <ReferenceLine x={t} stroke="#F0CB72" strokeWidth={1} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </button>
            ))}
          </div>
          <div className="gr-b-comp-detail" data-testid="component-detail" style={{ ['--c' as string]: focused.color }}>
            <div className="hd"><b>{focused.title}</b><em>{focused.nowText}</em><span>{focused.name}</span></div>
            <dl>{focused.stats.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>
            {focused.id === 'storage' && c.storage.part.tech && <p className="gr-b-note">{c.storage.part.tech.type} · {c.storage.part.tech.duration} · round trip {Math.round(c.storage.part.tech.rte * 100)} % · {c.storage.part.tech.role}</p>}
            <div className="plot">
              <ResponsiveContainer>
                <AreaChart data={data} margin={{ left: 0, right: 6, top: 4, bottom: 0 }} onClick={click}>
                  <defs><Fade id="dw-focus" color={focused.color} /></defs>
                  <CartesianGrid stroke="rgba(148,163,184,0.12)" vertical={false} />
                  {band}
                  <XAxis {...axis} />
                  <YAxis tick={{ fill: '#8FA2C2', fontSize: 10 }} width={42} axisLine={false} tickLine={false} tickFormatter={(v) => (focused.key === 'soc' ? `${v}%` : kwTick(v))} />
                  <Tooltip contentStyle={TT} formatter={(v) => (focused.key === 'soc' ? `${Math.round(Number(v))} %` : `${Math.round(Number(v))} kW`)} labelFormatter={(h) => clock(Number(h))} />
                  <Area type="monotone" dataKey={focused.key} stroke={focused.color} fill="url(#dw-focus)" strokeWidth={2} isAnimationActive={false} />
                  {playhead}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

// ---------------- steps ----------------
function UseCaseStep({ onSimulate, onUseCase }: { onSimulate: () => void; onUseCase: (u: 'health' | 'markets') => void }) {
  const { presetId, setPreset, useCase } = useBuildStore()
  return (
    <>
      <div className="gr-seg2 gr-b-seg" role="tablist">
        <button className={useCase === 'health' ? 'on' : ''} onClick={() => onUseCase('health')} data-testid="usecase-health"><Icon name="hospital" size={12} /> 1 · Hospital management</button>
        <button className={useCase === 'markets' ? 'on' : ''} onClick={() => onUseCase('markets')} data-testid="usecase-markets"><Icon name="fuel" size={12} /> 2 · Maintenance work</button>
      </div>
      {useCase === 'health' ? (
        <div className="gr-b-group">
          <p>Four typical facilities. Consumption is a benchmark you can adjust on the Load step; sun, wind or water are chosen on the Site step.</p>
          <div className="gr-b-cards">
            {PRESETS.filter((p) => p.family === 'hospital').map((p) => (
              <button key={p.id} className={`gr-b-card ${presetId === p.id ? 'on' : ''}`} onClick={() => setPreset(p.id)} data-testid={`preset-${p.id}`}>
                <b>{p.name}</b><span>{p.blurb}</span>
                <em>≈ {kwh(p.dailyKwh)} a day · typical {kwh(p.range[0])}–{kwh(p.range[1])}</em>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="gr-b-group" data-testid="crews">
            <p>Night work far from any socket. No sun, no wind and no generator: a battery charged from the grid at the depot carries the whole shift, quietly and with no fumes.</p>
            <div className="gr-b-cards">
              {PRESETS.filter((p) => p.family === 'crew').map((p) => (
                <button key={p.id} className={`gr-b-card ${presetId === p.id ? 'on' : ''}`} onClick={() => setPreset(p.id)} data-testid={`preset-${p.id}`}>
                  <b>{p.name}</b><span>{p.blurb}</span>
                  <em>≈ {p.dailyKwh} kWh a shift · grid-charged battery only</em>
                </button>
              ))}
            </div>
            <button className="gr-btn gr-btn-ghost" onClick={onSimulate} data-testid="crew-simulate"><Icon name="play" size={13} /> Go straight to the shift test</button>
          </div>
          <div className="gr-b-group" data-testid="markets">
            <h3>Where else storage or a UPS fits</h3>
            <div className="gr-b-cards">
              {MARKETS.filter((m) => !m.preset).map((m) => (
                <div key={m.id} className="gr-b-card market" data-testid={`market-${m.id}`}>
                  <b>{m.name}</b><span>{m.fit}</span>
                  <dl><dt>Storage</dt><dd>{m.storage}</dd><dt>UPS</dt><dd>{m.ups}</dd></dl>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  )
}

function MapClicks({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(+e.latlng.lat.toFixed(4), +e.latlng.lng.toFixed(4)) })
  return null
}
function FlyTo({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap()
  useEffect(() => { map.flyTo([lat, lng], Math.max(map.getZoom(), 4), { duration: 0.8 }) }, [lat, lng, map])
  return null
}
function SiteStep({ result }: { result: Result }) {
  const { site, existing, setExisting, presetId, resource, setResource } = useBuildStore()
  const nav = useNavigate()
  const fam = PRESETS.find((p) => p.id === presetId)!.family
  const [samples, setSamples] = useState(site.source !== 'explorer')
  const metric: Record<Resource, string> = { sun: `${site.psh} peak-sun hours`, wind: `${site.windMs} m/s at 50 m`, water: `river ${site.hydro}/100 · head ${site.headM} m` }
  const strength: Record<Resource, number> = { sun: Math.min(100, (site.psh / 6.5) * 100), wind: Math.min(100, ((site.windMs - 3) / 5) * 100), water: site.hydro }
  return (
    <>
      <div className={`gr-b-sitecard ${site.source === 'explorer' ? 'live' : ''}`} data-testid="site-card">
        <small>{site.source === 'explorer' ? 'SITE FROM THE EXPLORER' : 'SAMPLE SITE'}</small>
        <b>{site.name}</b>
        <span>{site.lat.toFixed(3)}, {site.lng.toFixed(3)} · {site.hazard}</span>
        <button className="gr-btn gr-btn-ghost" onClick={() => nav('/explorer')} data-testid="change-in-explorer"><Icon name="globe" size={13} /> {site.source === 'explorer' ? 'Change location in Explorer' : 'Pick my site in Explorer'}</button>
      </div>
      {fam === 'hospital' && (
        <div className="gr-b-group">
          <h3>Energy source</h3>
          <p>Each source unlocks its own generation and storage devices. A sensible default is fitted when you switch.</p>
          <div className="gr-b-resources">
            {RESOURCES.map((r) => (
              <button key={r.id} className={`gr-b-rescard ${resource === r.id ? 'on' : ''}`} style={{ ['--res' as string]: r.color }} onClick={() => setResource(r.id)} data-testid={`resource-${r.id}`}>
                <Icon name={r.icon} size={18} /><b>{r.label}</b><span>{metric[r.id]}</span>
                <i><em style={{ width: `${Math.max(4, strength[r.id])}%` }} /></i>
              </button>
            ))}
          </div>
          <p className="gr-b-note">{RESOURCES.find((r) => r.id === resource)!.what}.</p>
        </div>
      )}
      {fam === 'crew' && <DepotEnergy metric={metric} strength={strength} />}
      <div className="gr-seg2 gr-b-seg">
        <button className={existing ? 'on' : ''} onClick={() => setExisting(true)} data-testid="site-existing">{fam === 'hospital' ? 'Existing facility' : 'Existing depot'}</button>
        <button className={!existing ? 'on' : ''} onClick={() => setExisting(false)} data-testid="site-new">New build</button>
      </div>
      <dl className="gr-b-facts" data-testid="site-facts">
        <dt>Site</dt><dd>{site.name}</dd>
        <dt>Sun</dt><dd>{site.psh} peak-sun hours a day</dd>
        <dt>Wind</dt><dd>{site.windMs} m/s at 50 m</dd>
        <dt>Water</dt><dd>river score {site.hydro}/100 · {site.headM} m head</dd>
        <dt>Power price</dt><dd>${site.tariff.toFixed(2)} / kWh</dd>
        <dt>Federal credit</dt><dd>{result.incentive > 0 || (site.country ?? 'US') === 'US' ? 'US site · 30 % applies' : 'Outside the US · not applied'}</dd>
      </dl>
      <button className="gr-b-more" onClick={() => setSamples((v) => !v)} aria-expanded={samples} data-testid="toggle-samples">{samples ? '▾' : '▸'} Or use a sample US site</button>
      {samples && <SampleSites />}
    </>
  )
}
/**
 * Maintenance work and the Explorer's Sun / Wind / Water: nothing generates at the work site, but the depot that charges
 * the battery can. Each card reads that resource for the Explorer site and fits the matching depot charger.
 */
function DepotEnergy({ metric, strength }: { metric: Record<Resource, string>; strength: Record<Resource, number> }) {
  const { parts, setPart } = useBuildStore()
  const now = parts.crew.control
  const cards: { id: string; res: Resource | 'grid'; label: string; color: string; icon: string; text: string; pct: number }[] = [
    { id: 'ctl-plug', res: 'grid', label: 'Grid only', color: '#38BDF8', icon: 'grid', text: 'Yard supply, 20 kW', pct: 100 },
    { id: 'ctl-sun', res: 'sun', label: '+ Sun', color: '#F59E0B', icon: 'sun', text: metric.sun, pct: strength.sun },
    { id: 'ctl-wind', res: 'wind', label: '+ Wind', color: '#22B7E8', icon: 'wind', text: metric.wind, pct: strength.wind },
    { id: 'ctl-water', res: 'water', label: '+ Water', color: '#3A86E6', icon: 'water', text: metric.water, pct: strength.water },
  ]
  return (
    <div className="gr-b-group" data-testid="depot-energy">
      <h3>How the depot charges the battery</h3>
      <p>No sun or wind reaches the track at night, so nothing generates at the work site. The depot can still use the sun, wind or river of your Explorer site to charge the battery alongside the grid.</p>
      <div className="gr-b-resources four">
        {cards.map((c) => (
          <button key={c.id} className={`gr-b-rescard ${now === c.id ? 'on' : ''}`} style={{ ['--res' as string]: c.color }} onClick={() => setPart('control', c.id)} data-testid={`depot-${c.res}`}>
            <Icon name={c.icon} size={18} /><b>{c.label}</b><span>{c.text}</span>
            <i><em style={{ width: `${Math.max(4, c.pct)}%` }} /></i>
          </button>
        ))}
      </div>
    </div>
  )
}
function SampleSites() {
  const { site, setSite } = useBuildStore()
  const pin = (lat: number, lng: number, name: string) => setSite(siteFromPoint(lat, lng, name))
  return (
    <>
      <div className="gr-b-map" data-testid="site-map">
        <MapContainer center={[site.lat, site.lng]} zoom={3} scrollWheelZoom style={{ height: '100%', width: '100%' }} worldCopyJump>
          <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" className="gr-b-tiles" />
          <MapClicks onPick={(a, b) => pin(a, b, `Pinned site ${a.toFixed(2)}, ${b.toFixed(2)}`)} />
          <FlyTo lat={site.lat} lng={site.lng} />
          {CITIES.map((c) => (
            <CircleMarker key={c.id} center={[c.lat, c.lng]} radius={5} pathOptions={{ color: '#F0CB72', fillColor: '#F0CB72', fillOpacity: 0.8, weight: 1 }} eventHandlers={{ click: () => setSite({ ...c, source: 'reference' }) }}>
              <MapTip>{c.name} · {c.psh} sun-h · {c.windMs} m/s</MapTip>
            </CircleMarker>
          ))}
          <Marker position={[site.lat, site.lng]} icon={pinIcon} />
        </MapContainer>
      </div>
      <div className="gr-b-cities">{CITIES.slice(0, 10).map((c) => <button key={c.id} className={site.id === c.id ? 'on' : ''} onClick={() => setSite({ ...c, source: 'reference' })} data-testid={`city-${c.id}`}>{c.name}</button>)}</div>
    </>
  )
}

function LoadStep() {
  const { presetId, dailyKwh, setDaily, essentialShare, setEssential } = useBuildStore()
  const p = PRESETS.find((x) => x.id === presetId)!
  const shape = loadShape(p, dailyKwh)
  const share = p.family === 'hospital' ? essentialShare : 1
  const data = shape.map((v, h) => ({ h, essential: v * share, other: v * (1 - share) }))
  const peak = Math.max(...shape)
  const step = p.family === 'hospital' ? (p.range[1] > 10000 ? 500 : p.range[1] > 2000 ? 100 : 10) : 2
  return (
    <>
      <div className="gr-b-slider">
        <label>{p.family === 'hospital' ? 'Electricity a day' : 'Energy per shift'} <b data-testid="daily-value">{kwh(dailyKwh)}</b></label>
        <input type="range" min={p.range[0]} max={p.range[1]} step={step} value={dailyKwh} onChange={(e) => setDaily(Number(e.target.value))} data-testid="daily-slider" />
        <div className="gr-b-range"><span>{kwh(p.range[0])}</span><span>typical {kwh(p.dailyKwh)}</span><span>{kwh(p.range[1])}</span></div>
      </div>
      {p.family === 'hospital' && (
        <div className="gr-b-slider">
          <label>Must stay on in an outage <b>{Math.round(essentialShare * 100)} %</b></label>
          <input type="range" min={0.3} max={0.8} step={0.05} value={essentialShare} onChange={(e) => setEssential(Number(e.target.value))} data-testid="essential-slider" />
          <div className="gr-b-range"><span>life safety + critical</span><span>+ equipment branch</span></div>
        </div>
      )}
      <div className="gr-b-mini">
        <ResponsiveContainer>
          <BarChart data={data} margin={{ left: 0, right: 0, top: 6, bottom: 0 }}>
            <XAxis dataKey="h" tick={{ fill: '#7A8AA8', fontSize: 10 }} ticks={[0, 6, 12, 18, 23]} tickFormatter={(h) => `${h}h`} axisLine={false} tickLine={false} />
            <YAxis hide />
            <Tooltip contentStyle={TT} formatter={(v) => `${Math.round(Number(v))} kW`} labelFormatter={(h) => `${h}:00`} />
            <Bar dataKey="essential" name="Essential" stackId="a" fill="#4ADE80" isAnimationActive={false} />
            <Bar dataKey="other" name="Can be shed" stackId="a" fill="#334B6E" isAnimationActive={false} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <dl className="gr-b-facts">
        <dt>Average</dt><dd>{kw(dailyKwh / (p.family === 'hospital' ? 24 : shape.filter((x) => x > 0.2).length))}</dd>
        <dt>Peak</dt><dd>{kw(peak)}</dd>
        {p.family === 'hospital' && <><dt>A year</dt><dd>{kwh(dailyKwh * 365)}</dd></>}
        <dt>Basis</dt><dd>{p.basis}</dd>
      </dl>
      <p className="gr-b-note">Typical benchmark, not a meter reading. Replace it with the number from your utility bill for a sharper answer.</p>
    </>
  )
}

function PartStep({ slot, build, current, onPicked }: { slot: Slot; build: Build; current: Result; onPicked: (s: Slot) => void }) {
  const setPart = useBuildStore((s) => s.setPart)
  const options = partsFor(build.preset.family, current.resource).filter((p) => p.slot === slot)
  const previews = options.map((o) => { const blocked = o.blocked?.(current.ctx) ?? null; return { o, blocked, r: blocked ? null : simulate({ ...build, parts: { ...build.parts, [slot]: o.id } }) } })
  const hosp = build.preset.family === 'hospital'
  const tip: Record<Slot, string> = hosp ? {
    source: current.resource === 'sun' ? 'Solar cuts the bill every day. On its own it cannot help in an outage — that needs islanding controls.'
      : current.resource === 'wind' ? 'Wind is gusty and often strongest at night; turbines feather and stop above cut-out speed in a hurricane.'
      : 'Run-of-river hydro runs day and night; output follows the river, and ice or flood debris can cut it.',
    storage: 'Each device suits a different job: daily shifting, seconds of smoothing, cooling, or days of backup. Thermal stores only carry the load they serve.',
    control: 'Without a microgrid controller, US interconnection rules switch generation off during a blackout.',
    backup: 'Codes still expect a generator for long events; storage means it starts rarely, if at all.',
  } : {
    source: 'A folding mast tops the battery up while the crew sleeps.',
    storage: 'Sized for a whole shift so no engine idles next to homes at night. The battery van carries the crew and the power in one vehicle.',
    control: 'How the battery refills at the depot between shifts: from the grid, or from the grid plus the sun, wind or river of your Explorer site.',
    backup: 'Keep a generator as insurance, or go fully zero-emission.',
  }
  return (
    <>
      <p className="gr-b-note">{tip[slot]}</p>
      <div className="gr-b-cards">
        {previews.map(({ o, r, blocked }) => {
          const on = current.chosen[slot].part.id === o.id
          const ch = r?.chosen[slot]
          const d = r ? r.net - current.net : 0
          return (
            <button key={o.id} className={`gr-b-card part ${on ? 'on' : ''} ${blocked ? 'blocked' : ''}`} disabled={!!blocked} onClick={() => { setPart(slot, o.id); onPicked(slot) }} data-testid={`part-${o.id}`}>
              <div className="row"><b>{o.name}</b>{on && <span className="sel"><Icon name="check" size={12} /> fitted</span>}</div>
              <span>{o.detail}</span>
              {o.tech && o.id !== 'st-none' && <span className="tech">{o.tech.type} · {o.tech.duration} · round trip {Math.round(o.tech.rte * 100)} %</span>}
              {blocked ? <div className="stats"><i className="fail">{blocked}</i></div> : (
                <div className="stats">
                  {ch && ch.size > 0 && <i>{o.unit === 'kWh' ? kwh(ch.size) : `${Math.round(ch.size).toLocaleString()} ${o.unit}`}</i>}
                  <i>{ch && ch.cost > 0 ? money(ch.cost) : 'no cost'}</i>
                  {r && <i className={r.verdict}>{r.verdict === 'ok' ? (hosp ? 'outage covered' : 'shifts covered') : r.verdict === 'partial' ? 'partly covered' : 'not covered'}</i>}
                  {r?.crew && o.charge && o.charge.source !== 'grid' && <i className="ok">{Math.round(r.crew.renShare * 100)} % of charging from {o.charge.source === 'sun' ? 'sun' : o.charge.source === 'wind' ? 'wind' : 'the river'}</i>}
                  {!on && Math.abs(d) > 500 && <i className={d > 0 ? 'up' : 'down'}>{d > 0 ? '+' : ''}{money(d)} net</i>}
                </div>
              )}
            </button>
          )
        })}
      </div>
    </>
  )
}

function SimStep({ result, openDrawer }: { result: Result; openDrawer: () => void }) {
  const { presetId, scenarioId, setScenario } = useBuildStore()
  const p = PRESETS.find((x) => x.id === presetId)!
  const fam = p.family
  const sc = scenariosFor(fam)
  const out = result.rows.filter((r) => r.outage)
  const hosp = fam === 'hospital'
  const current = sc.find((s) => s.id === scenarioId[fam]) ?? sc[0]
  const verdictText = result.verdict === 'ok' ? (hosp ? 'Essential care stayed on through the whole outage' : 'Every shift fully powered') : result.verdict === 'partial' ? 'Mostly covered — add storage or keep the generator' : 'Essential load goes dark — this build is not safe'
  return (
    <>
      <div className="gr-b-scen">{sc.map((s) => <button key={s.id} className={s.id === scenarioId[fam] ? 'on' : ''} onClick={() => setScenario(s.id)} data-testid={`scenario-${s.id}`}>{s.label}</button>)}</div>
      <p className="gr-b-note">{current.note}.</p>
      <div className={`gr-b-verdict ${result.verdict}`} data-testid="verdict">{result.verdict === 'ok' ? '✓' : '!'} {verdictText}</div>
      <div className="gr-b-kpis">
        {hosp ? (
          <>
            <div><small>Essential load served</small><b>{result.essentialServedPct.toFixed(1)} %</b></div>
            <div><small>Storage + {result.resource === 'sun' ? 'sun' : result.resource} alone</small><b>{result.batteryOnlyHours} h</b><em>of {out.length} h outage</em></div>
            <div><small>Diesel burned</small><b>{Math.round(result.gallons).toLocaleString()} gal</b><em>vs {Math.round(result.baselineGallons).toLocaleString()} generator-only</em></div>
            <div><small>CO₂ avoided a year</small><b>{Math.round(result.co2TonsYear).toLocaleString()} t</b></div>
          </>
        ) : (
          <>
            <div><small>Shifts on battery only</small><b>{result.crew!.shiftsOnBattery} / {result.crew!.shifts}</b></div>
            <div><small>Diesel avoided a year</small><b>{Math.round(result.crew!.galYearAvoided).toLocaleString()} gal</b></div>
            <div><small>Noise at 7 m</small><b>{result.crew!.dbaNow} dBA</b><em>generator {result.crew!.dbaGen} dBA</em></div>
            <div><small>CO₂ avoided a year</small><b>{Math.max(0, result.co2TonsYear).toFixed(1)} t</b></div>
          </>
        )}
      </div>
      <button className="gr-btn gr-btn-ghost" onClick={openDrawer} data-testid="open-graphs"><Icon name="compare" size={14} /> Open the simulation graphs</button>
      <dl className="gr-b-facts" data-testid="bill">
        {SLOTS.map((s) => <Fragment key={s}><dt>{result.chosen[s].part.name}</dt><dd>{result.chosen[s].cost > 0 ? money(result.chosen[s].cost) : '—'}</dd></Fragment>)}
        {result.incentive > 0 && <><dt>Federal investment tax credit (30 %)</dt><dd className="g">−{money(result.incentive)}</dd></>}
        <dt><b>Net investment</b></dt><dd><b>{money(result.net)}</b></dd>
      </dl>
      <p className="gr-b-note">{hosp
        ? 'US sites: storage keeps the 30 % federal credit (with prevailing wage); nonprofit hospitals can take it as a direct payment. Pre-feasibility estimate, ±30 %.'
        : 'Payback counts diesel and generator service avoided, minus depot charging power. Quiet, fume-free night work also eases local noise permits. Pre-feasibility estimate, ±30 %.'}</p>
    </>
  )
}

function downloadSummary(r: Result, b: Build) {
  const lines = [
    `GridRescue AI — system summary`, ``,
    `Use case: ${b.preset.name}`, `Site: ${b.site.name} (${b.site.psh} peak-sun hours, ${b.site.windMs} m/s wind, $${b.site.tariff}/kWh)`, `Energy source: ${r.resource}`,
    `Daily energy: ${kwh(b.dailyKwh)}`, `Outage test: ${b.scenario.label}`, ``,
    ...SLOTS.map((s) => `- ${r.chosen[s].part.name}: ${Math.round(r.chosen[s].size)} ${r.chosen[s].part.unit} · ${money(r.chosen[s].cost)}`), ``,
    `Installed: ${money(r.capex)}`, `Federal credit: ${money(r.incentive)}`, `Net: ${money(r.net)}`, `Annual saving: ${money(r.annualSaving)}`, `Payback: ${r.payback ? r.payback.toFixed(1) + ' years' : '—'}`,
    `Essential load served in the outage: ${r.essentialServedPct.toFixed(1)} %`, `Hours on storage + renewables alone: ${r.batteryOnlyHours}`, `Resilience score: ${r.score}/100`, ``,
    `Pre-feasibility estimate (±30 %). Not a substitute for an engineering study.`,
  ]
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain' }))
  a.download = `gridrescue-${b.preset.id}-summary.txt`
  a.click()
}
