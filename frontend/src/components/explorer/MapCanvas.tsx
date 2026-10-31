import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Circle, CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, ZoomControl, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import type { Facility, GridData, SitePoint, SiteSuggestion, WaterData } from '../../api/types'
import { strengthOf } from './GridScanPanel'

const newSiteIcon = L.divIcon({
  className: '',
  html: '<div style="width:18px;height:18px;border-radius:50%;background:#4ADE80;border:3px solid #fff;box-shadow:0 0 0 6px rgba(74,222,128,0.3),0 2px 6px rgba(8,17,31,0.6)"></div>',
  iconSize: [18, 18], iconAnchor: [9, 9],
})
const lensColor = (s: number) => (s >= 75 ? '#22C55E' : s >= 60 ? '#84CC16' : s >= 45 ? '#F59E0B' : '#EF4444')

const pinIcon = L.divIcon({
  className: '',
  html: '<div style="width:16px;height:16px;border-radius:50%;background:#fff;border:2px solid #FF9A3C;box-shadow:0 0 0 5px rgba(255,154,60,0.25),0 2px 6px rgba(8,17,31,0.6)"></div>',
  iconSize: [16, 16], iconAnchor: [8, 8],
})
// substation colour = how strong that node is: ≥132 kV transmission green, 33 kV distribution amber, unknown/low red
const subColor = (kv: number) => (kv >= 132 ? '#22C55E' : kv >= 33 ? '#F59E0B' : '#EF4444')
const subIcon = (kv: number) => L.divIcon({ className: '', html: `<div style="width:12px;height:12px;border-radius:3px;background:${subColor(kv)};border:1.5px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5)"></div>`, iconSize: [12, 12], iconAnchor: [6, 6] })

interface Props {
  lat: number; lng: number; onLatLng: (lat: number, lng: number) => void; chart: ReactNode; children?: ReactNode
  scan50: GridData | null; scan100: GridData | null; water: WaterData | null; hospitals: Facility[]; onPickHospital: (f: Facility) => void
  scanning: string | null; flyTo?: { lat: number; lng: number; zoom?: number } | null; locked?: boolean
  /** Brief 12 new-site lens: the hospital's new building site and the scored search areas around it */
  newSite?: SitePoint | null; candidates?: SiteSuggestion[]; onPickCandidate?: (c: SiteSuggestion) => void
}

/** Screen position of the pin and how many pixels one kilometre spans there, so overlays line up with the map. */
type PinPoint = { x: number; y: number; pxPerKm: number }

function MapBridge({ lat, lng, onLatLng, onPoint, flyTo }: { lat: number; lng: number; onLatLng: (a: number, b: number) => void; onPoint: (p: PinPoint) => void; flyTo?: Props['flyTo'] }) {
  const map = useMap()
  const update = () => {
    const p = map.latLngToContainerPoint([lat, lng])
    const east = map.latLngToContainerPoint([lat, lng + 100 / (111.32 * Math.cos((lat * Math.PI) / 180))])   // a point 100 km east
    onPoint({ x: p.x, y: p.y, pxPerKm: Math.abs(east.x - p.x) / 100 })
  }
  useMapEvents({
    move: update, zoom: update, moveend: update, zoomend: update, resize: update,
    click: (e) => onLatLng(+e.latlng.lat.toFixed(4), +e.latlng.lng.toFixed(4)),
  })
  useEffect(() => {
    if (!map.getBounds().pad(-0.15).contains([lat, lng])) map.flyTo([lat, lng], Math.max(map.getZoom(), 7), { duration: 0.9 })
    const t = setTimeout(update, 60)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng])
  useEffect(() => { if (flyTo) map.flyTo([flyTo.lat, flyTo.lng], flyTo.zoom ?? Math.max(map.getZoom(), 8), { duration: 1.1 }) }, [flyTo, map])
  useEffect(() => { update(); const t = setTimeout(() => { map.invalidateSize(); update() }, 200); const t2 = setTimeout(update, 600); return () => { clearTimeout(t); clearTimeout(t2) } }, [map]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

export function MapCanvas({ lat, lng, onLatLng, chart, children, scan50, scan100, water, hospitals, onPickHospital, scanning, flyTo, locked, newSite, candidates, onPickCandidate }: Props) {
  const [lensPos, setLensPos] = useState<PinPoint>({ x: -1000, y: -1000, pxPerKm: 0 })
  const markerRef = useRef<L.Marker>(null)
  const markerEvents = useMemo(() => ({
    dragend() { const m = markerRef.current; if (m) { const p = m.getLatLng(); onLatLng(+p.lat.toFixed(4), +p.lng.toFixed(4)) } },
  }), [onLatLng])

  const power = (scan100 ?? scan50)?.power
  const rings = [{ km: 100, g: scan100 }, { km: 50, g: scan50 }]

  return (
    <div className="gr-map" data-testid="map">
      <MapContainer center={[lat, lng]} zoom={8} minZoom={2} zoomControl={false} worldCopyJump attributionControl style={{ width: '100%', height: '100%' }}>
        <ZoomControl position="bottomleft" />
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={18} />
        <MapBridge lat={lat} lng={lng} onLatLng={onLatLng} onPoint={setLensPos} flyTo={flyTo} />
        <Marker position={[lat, lng]} icon={pinIcon} draggable={!locked} eventHandlers={markerEvents} ref={markerRef} />

        {rings.map(({ km, g }) => {
          const st = g ? strengthOf(g.reliability) : null
          return <Circle key={km} center={[lat, lng]} radius={km * 1000} interactive={false}
            pathOptions={{ color: st?.color ?? '#94A3B8', weight: 2, dashArray: g ? undefined : '6 8', fillColor: st?.color ?? '#94A3B8', fillOpacity: g ? 0.06 : 0.02 }} />
        })}
        {(water?.waterways.features ?? []).filter((f) => f.geometry && f.geometry.length > 1).map((f) => (
          <Polyline key={f.id} positions={f.geometry as [number, number][]} pathOptions={{ color: '#3A86E6', weight: f.kind === 'river' ? 4 : 2, opacity: 0.85 }}>
            <Popup><b>{f.name}</b><br />{f.kind} · {f.distance_km} km {f.bearing}</Popup>
          </Polyline>
        ))}
        {(water?.waterways.features ?? []).filter((f) => !f.geometry && f.lat != null).map((f) => (
          <CircleMarker key={f.id} center={[f.lat as number, f.lng as number]} radius={7} pathOptions={{ color: '#7FB2FF', fillColor: '#3A86E6', fillOpacity: 0.7, weight: 1.5 }}>
            <Popup><b>{f.name}</b><br />{f.kind} · {f.distance_km} km</Popup>
          </CircleMarker>
        ))}
        {(power?.lines ?? []).map((l) => (
          <Polyline key={l.id} positions={l.geometry} pathOptions={{ color: subColor(l.voltage_kv), weight: l.voltage_kv >= 132 ? 2.5 : 1.5, opacity: 0.8 }}>
            <Popup><b>{l.name || 'Power line'}</b><br />{l.voltage_kv ? `${l.voltage_kv} kV` : 'voltage n/a'} · {l.distance_km} km</Popup>
          </Polyline>
        ))}
        {(power?.substations ?? []).map((s: any) => (
          <Marker key={s.id} position={[s.lat, s.lng]} icon={subIcon(s.voltage_kv || 0)}><Popup><b>{s.name}</b><br />Substation {s.voltage_kv ? `${s.voltage_kv} kV` : '(voltage not mapped)'} · {s.distance_km} km {s.bearing}</Popup></Marker>
        ))}
        {(candidates ?? []).map((c) => (
          <CircleMarker key={`lens-${c.lat},${c.lng}`} center={[c.lat, c.lng]} radius={c.rank && c.rank <= 5 ? 8 : 5} pathOptions={{ color: '#0B1A2E', weight: 1.5, fillColor: lensColor(c.score), fillOpacity: 0.95 }}
            eventHandlers={{ click: () => onPickCandidate?.(c) }}>
            <Popup><b>New-site area #{c.rank} · {c.score}/100</b><br />{c.reasons.join(' · ')}</Popup>
          </CircleMarker>
        ))}
        {newSite && <Polyline positions={[[lat, lng], [newSite.lat, newSite.lng]]} pathOptions={{ color: '#4ADE80', weight: 3, dashArray: '8 8' }} />}
        {newSite && <Marker position={[newSite.lat, newSite.lng]} icon={newSiteIcon}><Popup><b>{newSite.label ?? 'New building site'}</b></Popup></Marker>}
        {hospitals.map((f) => (
          <CircleMarker key={f.id} center={[f.lat, f.lng]} radius={f.type === 'hospital' ? 6 : 4} pathOptions={{ color: '#fff', weight: 1.5, fillColor: '#60A5FA', fillOpacity: 0.95 }} eventHandlers={{ click: () => onPickHospital(f) }}>
            <Popup><b>{f.name}</b><br />{f.type} · {f.distance_km} km{f.beds ? ` · ${f.beds} beds` : ''}</Popup>
          </CircleMarker>
        ))}
      </MapContainer>

      <div className="gr-lens" style={{ left: lensPos.x, top: lensPos.y, visibility: lensPos.x < -500 ? 'hidden' : 'visible' }} data-testid="lens">{chart}</div>
      {/* the radar sweep sits on the pin and spans the ring being scanned (50 km, then 100 km) at the current zoom */}
      {scanning && lensPos.x > -500 && (() => {
        const r = Math.max(40, (scanning.includes('100') ? 100 : 50) * lensPos.pxPerKm)
        return (
          <div className="gr-scan" style={{ left: lensPos.x, top: lensPos.y }} data-testid="scan-sweep">
            <div className="gr-scan-ring" style={{ width: r * 2, height: r * 2 }} />
            <div className="gr-scan-label" style={{ top: r + 12 }} data-testid="scan-label">{scanning}</div>
          </div>
        )
      })()}
      {children}
    </div>
  )
}
