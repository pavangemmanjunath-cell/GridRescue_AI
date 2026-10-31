import { useEffect } from 'react'
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, ZoomControl, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import type { SitePoint, SiteSuggestion } from '../api/types'

const icon = (color: string, label: string) => L.divIcon({
  className: '',
  html: `<div style="display:flex;align-items:center;gap:6px;transform:translate(-9px,-9px)"><div style="width:18px;height:18px;border-radius:50%;background:${color};border:3px solid #fff;box-shadow:0 0 0 5px ${color}44,0 2px 6px rgba(8,17,31,.6)"></div><span style="font:700 12px DM Sans,sans-serif;color:#fff;background:rgba(11,26,46,.88);padding:2px 7px;border-radius:6px;white-space:nowrap">${label}</span></div>`,
  iconSize: [0, 0],
})
export const scoreColor = (s: number) => (s >= 75 ? '#22C55E' : s >= 60 ? '#84CC16' : s >= 45 ? '#F59E0B' : '#EF4444')

function Fit({ a, b }: { a: SitePoint; b: SitePoint | null }) {
  const map = useMap()
  useEffect(() => {
    if (b) map.fitBounds(L.latLngBounds([a.lat, a.lng], [b.lat, b.lng]).pad(0.9), { maxZoom: 13 })
    else map.setView([a.lat, a.lng], 12)
    const t = setTimeout(() => map.invalidateSize(), 150)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.lat, a.lng])
  return null
}

function Clicks({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onClick(+e.latlng.lat.toFixed(4), +e.latlng.lng.toFixed(4)) })
  return null
}

/** Today's site, the new building site and the grid-lens search points around the hospital (green = strong grid access). */
export function CaseMap({ today, newSite, candidates, onPick }: { today: SitePoint & { name: string }; newSite: SitePoint | null; candidates: SiteSuggestion[]; onPick: (p: SitePoint) => void }) {
  return (
    <div className="gr-map gr-case-map" data-testid="case-map">
      <MapContainer center={[today.lat, today.lng]} zoom={12} zoomControl={false} attributionControl style={{ width: '100%', height: '100%' }}>
        <ZoomControl position="bottomleft" />
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={18} />
        <Fit a={today} b={newSite} />
        <Clicks onClick={(lat, lng) => onPick({ lat, lng, label: 'New building site (chosen on the map)' })} />
        {candidates.map((c) => (
          <CircleMarker key={`${c.lat},${c.lng}`} center={[c.lat, c.lng]} radius={c.rank && c.rank <= 5 ? 9 : 6} pathOptions={{ color: '#fff', weight: 1.5, fillColor: scoreColor(c.score), fillOpacity: 0.9 }}
            eventHandlers={{ click: () => onPick({ lat: c.lat, lng: c.lng, label: `Suggested area #${c.rank} · ${c.direction}, ${c.distance_km} km` }) }}>
            <Tooltip direction="top">{`#${c.rank} · ${c.score}/100 · ${c.label}`}</Tooltip>
            <Popup><b>Area #{c.rank} · {c.score}/100</b><br />{c.reasons.join(' · ')}</Popup>
          </CircleMarker>
        ))}
        {newSite && <Polyline positions={[[today.lat, today.lng], [newSite.lat, newSite.lng]]} pathOptions={{ color: '#4ADE80', weight: 3, dashArray: '8 8' }} />}
        <Marker position={[today.lat, today.lng]} icon={icon('#FF9A3C', 'Today')} />
        {newSite && <Marker position={[newSite.lat, newSite.lng]} icon={icon('#4ADE80', 'New building')} />}
      </MapContainer>
    </div>
  )
}
