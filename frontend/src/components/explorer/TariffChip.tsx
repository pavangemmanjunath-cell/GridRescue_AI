import { useEffect, useState } from 'react'
import { api } from '../../api/client'

/** The published grid price at a place for the current local hour — rate, time-of-use period, night note and source. */
export function TariffChip({ lat, lng, label, testid, other }: { lat: number; lng: number; label: string; testid?: string; other?: { lat: number; lng: number; label: string } | null }) {
  const [t, setT] = useState<any>(null)
  const [o, setO] = useState<any>(null)
  useEffect(() => {
    const ctl = new AbortController()
    setT(null)
    const id = setTimeout(() => api.tariff(lat, lng, null, ctl.signal).then(setT).catch(() => setT({ available: false })), 400)
    return () => { clearTimeout(id); ctl.abort() }
  }, [lat, lng])
  useEffect(() => {
    if (!other) { setO(null); return }
    const ctl = new AbortController()
    api.tariff(other.lat, other.lng, null, ctl.signal).then(setO).catch(() => setO(null))
    return () => ctl.abort()
  }, [other?.lat, other?.lng]) // eslint-disable-line react-hooks/exhaustive-deps
  const fmtRate = (x: any) => (x?.rate_now != null ? `${x.symbol}${Number(x.rate_now).toLocaleString('en-US', { maximumFractionDigits: 2 })}/kWh` : x?.available ? 'rate from your bill' : 'no published tariff')
  const hh = (h?: number) => (h == null ? '' : `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`)
  return (
    <div className="gr-tariff" data-testid={testid} title={t?.source ? `Source: ${t.source}` : ''}>
      <small>{label}{t?.local_hour != null ? ` · ${hh(t.local_hour)} local` : ''}</small>
      {!t ? <b className="gr-muted">reading the tariff…</b> : (
        <>
          <b>{fmtRate(t)}{t.period && t.period !== 'flat' ? <em> {t.period}</em> : null}{t.state ? <em> · {t.state}</em> : t.country ? <em> · {t.country}</em> : null}</b>
          <span>{t.available ? `${t.label} · ${t.tou ? (t.tou_text ?? 'time-of-use') : 'flat — same price at night'}` : t.note}</span>
          {o && <span className="gr-tariff-other">{other?.label}: {fmtRate(o)}{o.state ? ` · ${o.state}` : ''}{t.rate_now != null && o.rate_now != null ? ` (${o.rate_now === t.rate_now ? 'same price' : o.rate_now < t.rate_now ? `${Math.round((1 - o.rate_now / t.rate_now) * 100)} % cheaper` : `${Math.round((o.rate_now / t.rate_now - 1) * 100)} % dearer`})` : ''}</span>}
        </>
      )}
    </div>
  )
}
