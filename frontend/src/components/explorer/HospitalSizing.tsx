import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import { useSiteStore } from '../../store/useSiteStore'
import { fmt } from '../../lib/format'

/** Daily power-use bands a hospital can pick from (kWh per day). The midpoint is used for the simulation. */
export const USAGE = [
  { id: 'auto', label: 'From beds', kwh: null },
  { id: 's', label: 'under 500', kwh: 300 },
  { id: 'm', label: '500 – 1,500', kwh: 1000 },
  { id: 'l', label: '1,500 – 3,000', kwh: 2250 },
  { id: 'xl', label: '3,000 – 6,000', kwh: 4500 },
  { id: 'xxl', label: 'over 6,000', kwh: 8000 },
] as const
export type UsageId = (typeof USAGE)[number]['id']

/** Step 2 of the explorer flow: who the site is, what we assume, and how much power it uses a day. */
export function HospitalSizing({ usage, setUsage }: { usage: UsageId; setUsage: (u: UsageId) => void }) {
  const { facility, setFacility, location, lat, lng } = useSiteStore()
  const [est, setEst] = useState<Awaited<ReturnType<typeof api.loadModel>> | null>(null)
  const kwh = USAGE.find((u) => u.id === usage)?.kwh ?? null

  useEffect(() => {
    const ctl = new AbortController()
    const t = setTimeout(() => api.loadModel({ ...facility, daily_kwh: kwh }, ctl.signal).then(setEst).catch(() => null), 250)
    return () => { clearTimeout(t); ctl.abort() }
  }, [facility.type, facility.beds, kwh]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="gr-sizing" data-testid="hospital-sizing">
      <div className="gr-sizing-site">
        <b>{facility.name || 'Pinned site'}</b>
        <small>{location?.name ? `${location.name}${location.state ? `, ${location.state}` : ''} · ` : ''}{fmt.coord(lat, lng)}</small>
      </div>
      <div className="gr-row" style={{ gap: 8, fontSize: 12, alignItems: 'center' }}>
        <select className="gr-select gr-select-sm" value={facility.type} onChange={(e) => setFacility({ type: e.target.value as any })} aria-label="Facility type">
          <option value="hospital_tertiary">Teaching / tertiary hospital</option>
          <option value="hospital_general">General hospital</option>
          <option value="clinic_phc">Clinic / health centre</option>
        </select>
        <label className="gr-row" style={{ gap: 4 }}><input className="gr-input gr-input-sm" type="number" min={0} max={5000} value={facility.beds ?? 0} onChange={(e) => setFacility({ beds: Math.max(0, Number(e.target.value) || 0) })} aria-label="Beds" data-testid="sizing-beds" /> beds</label>
      </div>
      <div className="gr-muted" style={{ fontSize: 11, margin: '8px 0 4px' }}>Daily power use (kWh a day)</div>
      <div className="gr-usage" data-testid="usage-options">
        {USAGE.map((u) => <button key={u.id} className={usage === u.id ? 'on' : ''} onClick={() => setUsage(u.id)} data-testid={`usage-${u.id}`}>{u.id === 'auto' && est && usage === 'auto' ? `From beds ≈ ${fmt.num(est.daily_kwh, 0)}` : u.label}</button>)}
      </div>
      {est && <div className="gr-sizing-est" data-testid="sizing-estimate">≈ <b>{fmt.num(est.daily_kwh, 0)} kWh</b> a day · peak <b>{Math.round(est.peak_load_kw)} kW</b> · life-critical <b>{Math.round(est.critical_peak_kw)} kW</b><br /><span className="gr-muted">Estimate from typical loads for this type and size — refine it on the Facility page.</span></div>}
    </div>
  )
}
