import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { api } from '../../api/client'
import type { Assessment } from '../../api/types'
import { useSiteStore } from '../../store/useSiteStore'
import { Icon } from '../ui/Icon'

/** Open / closed state of the Ask drawer, shared by the app-bar button and the drawer. */
export const useAsk = create<{ open: boolean; toggle: (v?: boolean) => void }>((set) => ({ open: false, toggle: (v) => set((s) => ({ open: v ?? !s.open })) }))

const SUGGEST = [
  'How does GridRescue select the energy system?',
  'Which ML algorithm is used and how accurate is it?',
  'What outage stress tests are run?',
  'How is the ESG report calculated?',
  'What is the grid tariff in Enugu?',
  'What does a vanadium flow battery suit?',
]

/** The user's current assessment as facts the answer can cite ("this site"). */
function contextOf(a: Assessment | null) {
  if (!a) return null
  const rec = a.recommended, inv = a.investment_case?.investment ?? {}, ml = a.agent?.ml
  const place = [a.location.name, a.location.state, a.location.country].filter(Boolean).join(', ')
  return {
    place,
    facts: [
      `This site is ${a.inputs.facility.name || a.inputs.facility_label} at ${place} (${a.location.lat.toFixed(3)}, ${a.location.lng.toFixed(3)}).`,
      `The grid here gives about ${a.site.grid.supply_hours} h of supply a day (class ${a.site.grid.class}); the sun gives ${a.site.solar.annual_psh} peak-sun hours a day and the wind ${a.site.wind.annual_ws50} m/s at 50 m.`,
      `The recommended design for this site is ${rec.name}, serving ${rec.simulation_summary.critical_served_pct} % of the critical load in a ${a.inputs.facility.backup_hours} h outage.`,
      inv.co2_avoided_t_per_year != null ? `This site avoids about ${Math.round(inv.co2_avoided_t_per_year).toLocaleString()} t CO₂ and ${Math.round(inv.diesel_avoided_l_per_year ?? 0).toLocaleString()} L of diesel a year with the recommended design.` : '',
      rec.lifecycle?.simple_payback_years ? `The simple payback at this site is ${rec.lifecycle.simple_payback_years} years for a capital cost of about US$ ${Math.round(rec.cost.capex_usd).toLocaleString()}.` : '',
      ml ? `For this configuration the ML model (${ml.algorithm}) picks ${ml.family_label} with ${Math.round(ml.confidence * 100)} % of the vote.` : '',
    ].filter(Boolean),
  }
}

type Answer = { question: string; answer: string; mode: string; generator: string; sources: any[] }

/** Ask GridRescue — retrieval over the internal knowledge base; the answer cites the passages it was built from. */
export function AskPanel() {
  const { open, toggle } = useAsk()
  const a = useSiteStore((s) => s.assessment)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<Answer | null>(null)
  const [useSite, setUseSite] = useState(true)
  const [stats, setStats] = useState<any>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => { if (open) { api.kbStats().then(setStats).catch(() => null); window.setTimeout(() => input.current?.focus(), 50) } }, [open])
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') toggle(false) }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k) }, [toggle])

  const ask = async (question: string) => {
    if (question.trim().length < 2) return
    setQ(question); setBusy(true)
    try { setRes(await api.ask(question, useSite ? contextOf(a) : null)) }
    catch { setRes({ question, answer: 'The knowledge base is not reachable — is the backend running?', mode: 'none', generator: '', sources: [] }) }
    finally { setBusy(false) }
  }
  if (!open) return null
  // citations [n] become small links to the numbered source
  const parts = (res?.answer ?? '').split(/(\[\d+\])/g)
  return (
    <div className="gr-ask-scrim gr-no-print" onClick={() => toggle(false)}>
      <aside className="gr-ask" role="dialog" aria-label="Ask GridRescue" onClick={(e) => e.stopPropagation()} data-testid="ask-panel">
        <header className="gr-ask-head">
          <div><b>Ask GridRescue</b><small>Answers from GridRescue's own knowledge base, with sources</small></div>
          <button className="gr-ask-x" onClick={() => toggle(false)} aria-label="Close" data-testid="ask-close"><Icon name="x" size={16} /></button>
        </header>
        <form className="gr-ask-form" onSubmit={(e) => { e.preventDefault(); ask(q) }}>
          <input ref={input} className="gr-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about the method, a site, outages, tariffs, ESG…" data-testid="ask-input" />
          <button className="gr-btn" type="submit" disabled={busy} data-testid="ask-submit"><Icon name={busy ? 'refresh' : 'search'} size={14} className={busy ? 'gr-spin' : undefined} /> Ask</button>
        </form>
        <label className="gr-ask-ctx">
          <input type="checkbox" checked={useSite} onChange={(e) => setUseSite(e.target.checked)} disabled={!a} data-testid="ask-use-site" />
          {a ? <>Use my assessment of <b>{a.location.name}</b> as a source</> : 'Run an assessment to ask about your own site'}
        </label>
        {!res && (
          <div className="gr-ask-suggest" data-testid="ask-suggest">
            <small>Try</small>
            {SUGGEST.map((s) => <button key={s} onClick={() => ask(s)}>{s}</button>)}
          </div>
        )}
        {res && (
          <div className="gr-ask-body">
            <div className="gr-ask-q">{res.question}</div>
            <p className="gr-ask-a" data-testid="ask-answer">
              {parts.map((p, i) => /^\[\d+\]$/.test(p) ? <a key={i} href={`#src-${p.slice(1, -1)}`} className="gr-ask-cite">{p.slice(1, -1)}</a> : <span key={i}>{p}</span>)}
            </p>
            {res.sources.length > 0 && <>
              <small className="gr-ask-label">Sources</small>
              <ol className="gr-ask-sources" data-testid="ask-sources">
                {res.sources.map((s) => (
                  <li key={s.n} id={`src-${s.n}`}>
                    <span className="gr-ask-kind">{s.kind}</span>
                    <b>{s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.title}</a> : s.title}</b>
                    <small>{s.source}</small>
                  </li>
                ))}
              </ol>
            </>}
            <button className="gr-btn gr-btn-ghost" style={{ alignSelf: 'flex-start' }} onClick={() => { setRes(null); setQ(''); input.current?.focus() }} data-testid="ask-new">New question</button>
          </div>
        )}
        <footer className="gr-ask-foot" data-testid="ask-foot">
          Retrieval: {stats ? `${stats.documents} passages · ${stats.engine}` : 'internal knowledge base'} · {stats ? `${stats.assessments} assessments stored` : ''}<br />
          The answer is built only from the passages it cites; no AI language model is used yet, and one can be connected later.
        </footer>
      </aside>
    </div>
  )
}

/** The app-bar button that opens Ask GridRescue. */
export function AskButton() {
  const toggle = useAsk((s) => s.toggle)
  return <button className="gr-ask-btn" onClick={() => toggle()} data-testid="ask-open" title="Ask GridRescue (answers with sources)"><Icon name="search" size={14} /><span className="lbl">Ask</span></button>
}
