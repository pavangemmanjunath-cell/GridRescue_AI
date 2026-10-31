import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { distanceKm, useSiteStore, type Mode } from '../store/useSiteStore'
import { api } from '../api/client'
import type { Facility, SitePoint, SiteSuggestion, Suggestions } from '../api/types'
import { MapCanvas } from '../components/explorer/MapCanvas'
import { LocationPanel } from '../components/explorer/LocationPanel'
import { RadialSunChart } from '../components/explorer/RadialSunChart'
import { WindRose } from '../components/explorer/WindRose'
import { WaterLens } from '../components/explorer/WaterLens'
import { GridScanPanel, OUTAGES, type OutageId } from '../components/explorer/GridScanPanel'
import { LegendStrip } from '../components/explorer/Panels'
import { HospitalSizing, USAGE, type UsageId } from '../components/explorer/HospitalSizing'
import { Icon } from '../components/ui/Icon'
import { TariffChip } from '../components/explorer/TariffChip'
import { showToast } from '../components/ui/Primitives'
import { useBuildStore } from '../build/useBuildStore'
import { siteFromPoint, type PresetId } from '../build/catalog'

const tierToType = (f: Facility) => {
  const tier = f.tier || (f.type === 'hospital' ? 'secondary' : 'primary')
  return tier === 'tertiary' ? { type: 'hospital_tertiary' as const, beds: f.beds ?? 400 }
    : tier === 'secondary' ? { type: 'hospital_general' as const, beds: f.beds ?? 120 } : { type: 'clinic_phc' as const, beds: f.beds ?? 12 }
}

export function ExplorerPage() {
  const s = useSiteStore()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const [flyTo, setFlyTo] = useState<{ lat: number; lng: number; zoom?: number } | null>(null)
  const [picked, setPicked] = useState<Facility | null>(null)
  const [outage, setOutage] = useState<OutageId>('night')
  const [usage, setUsage] = useState<UsageId>('auto')

  // URL params (shareable link)
  useEffect(() => {
    const la = parseFloat(params.get('lat') || ''); const ln = parseFloat(params.get('lng') || '')
    if (Number.isFinite(la) && Number.isFinite(ln)) s.setLatLng(la, ln, true)
    const m = params.get('mode') as Mode | null
    if (m === 'sun' || m === 'wind' || m === 'water') s.setMode(m)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // every new site: climate + hospitals, then the staged 50 km → 100 km grid scan
  useEffect(() => {
    const t = setTimeout(() => { s.fetchSite(); s.fetchLayers(); s.scanGrid() }, 450)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.lat, s.lng, s.gridClassOverride, s.caseData?.id])

  // Brief 12: the hospital is moving — a grid lens over the area around it suggests where the new building should go
  const atCase = s.moving   // the hospital is moving: new-site lens + relocation plan (the case switches this on)
  const [lensOn, setLensOn] = useState(true)
  const [sugg, setSugg] = useState<Suggestions | null>(null)
  useEffect(() => {
    if (!atCase || !lensOn) return
    const ctl = new AbortController()
    api.suggestSites(s.lat, s.lng, ctl.signal).then(setSugg).catch(() => null)
    return () => ctl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atCase, lensOn, s.lat, s.lng])
  const pickArea = (c: SiteSuggestion) => { s.setNewSite({ lat: c.lat, lng: c.lng, label: `Suggested area #${c.rank} · ${c.direction}, ${c.distance_km} km` }); showToast(`New building site: area #${c.rank} (${c.score}/100)`) }
  const openPlan = async () => {
    if (!s.newSite) { showToast('Click a lens dot or the map to place the new building site first'); return }
    const a = await s.runAssessment()
    if (a) nav('/case')
    else showToast('The plan could not run — is the backend running?')
  }

  const hospitals = [...(s.facilities?.facilities ?? [])].sort((a, b) => (a.type === 'hospital' ? 0 : 1) - (b.type === 'hospital' ? 0 : 1) || a.distance_km - b.distance_km)

  const pickHospital = (f: Facility) => {
    setPicked(f)
    s.setLatLng(f.lat, f.lng, true)
    s.setLocked(true)   // a chosen hospital pins the site for every page
    setFlyTo({ lat: f.lat, lng: f.lng, zoom: 9 })
    s.setFacility({ name: f.name, ...tierToType(f) })
    showToast(`${f.name} selected — site locked`)
  }

  // the story continues in Build 3D: hand over the real site, its sun / wind / water, the lens and the facility size
  const buildIn3D = () => {
    const ref = siteFromPoint(s.lat, s.lng, '')
    const cc = s.location?.country_code ?? 'US'
    const rel = s.grid?.reliability ?? s.scan.r100?.reliability
    const tier = picked ? (picked.tier || (picked.type === 'hospital' ? 'secondary' : 'primary')) : null
    const preset: PresetId | undefined = tier === 'tertiary' ? 'regional' : tier === 'secondary' ? ((picked?.beds ?? 120) >= 100 ? 'community' : 'cah') : tier === 'primary' ? 'clinic' : undefined
    useBuildStore.getState().fromExplorer({
      id: 'explorer', name: picked?.name ?? s.location?.name ?? `Site ${s.lat.toFixed(2)}, ${s.lng.toFixed(2)}`, lat: s.lat, lng: s.lng,
      psh: +(s.sun?.annual_psh ?? ref.psh).toFixed(1), windMs: +(s.wind?.annual_avg_ms ?? ref.windMs).toFixed(1),
      hydro: Math.round(s.water?.scores.micro_hydro ?? ref.hydro), headM: Math.round(s.water?.scores.head_m ?? s.water?.terrain.head_up_m ?? ref.headM),
      tariff: cc === 'US' ? ref.tariff : cc === 'NG' ? 0.158 : 0.15,
      hazard: rel ? `${rel.class_label ?? 'Grid'} · ${rel.expected_outage_hours_per_day} h off a day` : 'Grid outages', source: 'explorer', country: cc,
    }, s.mode, preset)
    nav('/build')
  }

  const simulate = async () => {
    const o = OUTAGES.find((x) => x.id === outage)!
    s.setFacility({ backup_hours: o.hours, daily_kwh: USAGE.find((u) => u.id === usage)?.kwh ?? null })
    s.setOutageStartHour(o.start)
    const a = await s.runAssessment()
    if (a) nav('/simulation')
    else showToast('Simulation failed — is the backend running?')
  }

  const chart = s.mode === 'wind' ? <WindRose selectedMonth={s.month} size={220} windData={s.wind} />
    : s.mode === 'water' ? <WaterLens selectedMonth={s.month} size={220} water={s.water} /> : <RadialSunChart selectedMonth={s.month} size={220} sunData={s.sun} />
  const seg = (m: Mode, label: string, icon: string) => (
    <button key={m} className={`gr-seg gr-seg-${m} ${s.mode === m ? 'gr-seg-active' : ''}`} onClick={() => s.setMode(m)} data-testid={`mode-${m}`} aria-pressed={s.mode === m}><Icon name={icon} size={14} />{label}</button>
  )
  const scanning = s.scan.stage === '50' ? 'SCANNING GRID · 50 km' : s.scan.stage === '100' ? 'WIDENING SCAN · 100 km' : null

  return (
    <div className="gr-explorer" data-testid="explorer">
      <LocationPanel lat={s.lat} lng={s.lng} onSubmit={(a, b) => { setPicked(null); s.setLatLng(a, b, true); setFlyTo({ lat: a, lng: b, zoom: 8 }) }} month={s.month} setMonth={s.setMonth} mode={s.mode}
        location={s.location} sun={s.sun} wind={s.wind} water={s.water} weather={s.weather} loading={s.loading} />
      <MapCanvas lat={s.lat} lng={s.lng} onLatLng={(a, b) => { if (s.moving && s.locked) { s.setNewSite({ lat: a, lng: b, label: 'New building site (chosen on the map)' }); showToast('New building site placed'); return } if (s.locked) { showToast('Site is locked — unlock it to move the pin'); return } setPicked(null); s.setLatLng(a, b) }} chart={chart} scan50={s.scan.r50} scan100={s.scan.r100} water={s.water}
        hospitals={hospitals} onPickHospital={pickHospital} scanning={scanning} flyTo={flyTo} locked={s.locked}
        newSite={atCase ? s.newSite : null} candidates={atCase && lensOn ? sugg?.candidates ?? [] : []} onPickCandidate={pickArea}>
        <div className="gr-map-modes gr-no-print"><div className="gr-nav" data-testid="mode-switch">{seg('sun', 'Sun', 'sun')}{seg('wind', 'Wind', 'wind')}{seg('water', 'Water', 'water')}</div>
          <button className={`gr-btn-pill ${s.moving ? 'on' : ''}`} onClick={() => s.setMoving(!s.moving)} data-testid="moving-toggle" aria-pressed={s.moving} title="Brief 12: the hospital will move to a new building — place the new site and plan a relocatable system">🏥 Hospital is moving</button>
          {atCase && <button className={`gr-btn-pill ${lensOn ? 'on' : ''}`} onClick={() => setLensOn((v) => !v)} data-testid="lens-newsite" aria-pressed={lensOn}>🧭 New-site lens</button>}
          <button className={`gr-btn-pill ${s.locked ? 'on' : ''}`} onClick={() => s.setLocked(!s.locked)} data-testid="lock-btn" aria-pressed={s.locked}>{s.locked ? '🔒 Site locked' : '🔓 Lock this site'}</button>
          {!atCase && <Link to="/facility" className="gr-btn-pill" data-testid="continue-facility">Facility details <Icon name="arrow" size={12} /></Link>}
          <TariffChip lat={s.lat} lng={s.lng} label="Grid price here, now" testid="tariff-today" other={atCase && s.newSite ? { lat: s.newSite.lat, lng: s.newSite.lng, label: 'new site' } : null} />
        {atCase && s.caseData && s.supplyHours() != null && (
          <div className="gr-case-banner gr-no-print" data-testid="case-banner">
            <b>🏥 {s.caseData.hospital.name}</b>
            <small>{s.caseData.hospital.address} · {s.caseData.hospital.beds} beds · grid ≈ {s.caseData.hospital.grid_hours_per_day} h a day (reported) · moves building in {s.caseData.hospital.move_in_years} years</small>
          </div>
        )}
        {/* next chapter of the story: Brief 12 continues in the Enugu plan; elsewhere the site continues in Build 3D */}
        {atCase ? (
          <button className="gr-btn gr-b-cta gr-btn-rescue gr-no-print" onClick={openPlan} disabled={s.assessing} data-testid="open-plan">
            {s.assessing ? <><Icon name="refresh" size={15} className="gr-spin" /> Sizing the theatres-first system…</> : <><Icon name="shield" size={15} /> Run the relocation plan · {s.newSite ? 'both sites' : 'place the new site first'} <Icon name="arrow" size={14} /></>}
          </button>
        ) : (
          <button className="gr-btn gr-b-cta gr-no-print" onClick={buildIn3D} data-testid="build-3d">
            <Icon name="cube" size={15} /> {picked ? `Build ${picked.name.length > 26 ? picked.name.slice(0, 24) + '…' : picked.name} in 3D` : 'Build this site in 3D'} · {s.mode === 'sun' ? 'Sun' : s.mode === 'wind' ? 'Wind' : 'Water'} <Icon name="arrow" size={14} />
          </button>
        )}
        </div>
        <GridScanPanel r50={s.scan.r50} r100={s.scan.r100} stage={s.scan.stage} water={s.water} hospitals={hospitals} picked={picked} onPick={pickHospital}
          outage={outage} setOutage={setOutage} onSimulate={simulate} simulating={s.assessing}
          sizing={<HospitalSizing usage={usage} setUsage={setUsage} />}
          relocation={atCase ? <NewSiteSection newSite={s.newSite} sugg={sugg} lat={s.lat} lng={s.lng} onPick={pickArea} /> : undefined} />
        <LegendStrip month={s.month} mode={s.mode} />
      </MapCanvas>
    </div>
  )
}

/** Brief 12, in the grid panel: where the new building goes, and the best areas the grid lens found around the hospital. */
function NewSiteSection({ newSite, sugg, lat, lng, onPick }: { newSite: SitePoint | null; sugg: Suggestions | null; lat: number; lng: number; onPick: (c: SiteSuggestion) => void }) {
  return (
    <div className="gr-newsite" data-testid="newsite-section">
      <div className="gr-eyebrow" style={{ color: '#fff' }}>New building site · move in year 5</div>
      <div className="gr-muted" style={{ fontSize: 12, marginBottom: 6 }}>
        {newSite ? <>{newSite.label} · <b style={{ color: 'var(--gr-rescue)' }}>{distanceKm({ lat, lng }, newSite).toFixed(1)} km</b> from today's site</> : 'Not placed yet'}
      </div>
      <div className="gr-muted" style={{ fontSize: 11, marginBottom: 4 }}>Grid lens · best areas within 12 km (substations, lines, move distance)</div>
      <ul className="gr-layer-list" data-testid="newsite-suggestions">
        {(sugg?.top ?? []).slice(0, 3).map((c) => (
          <li key={`${c.lat},${c.lng}`} onClick={() => onPick(c)}><b>#{c.rank} · {c.direction}, {c.distance_km} km · {c.score}/100</b><small>{c.reasons[0]}</small></li>
        ))}
        {!sugg && <li><span className="gr-muted">Scanning the grid around the hospital…</span></li>}
      </ul>
    </div>
  )
}
