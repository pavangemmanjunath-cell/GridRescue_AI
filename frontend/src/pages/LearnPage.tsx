import { useEffect, useState } from 'react'
import { api, API_BASE } from '../api/client'
import type { Technology } from '../api/types'
import { Screen } from '../components/layout/Screen'
import { Card, Chip } from '../components/ui/Primitives'

/** One compact card per technology: the numbers that decide fit, plus the Nigeria note. */
function TechCard({ t }: { t: Technology }) {
  return (
    <Card className="gr-tech-card gr-tech-compact" data-testid={`tech-${t.id}`}>
      <div className="gr-card-head"><h3 className="gr-h3" style={{ fontSize: 15 }}>{t.name}</h3>{t.evaluated ? <Chip kind="High">evaluated</Chip> : <Chip kind="model">watch-list</Chip>}</div>
      <div className="gr-tech-meta">
        <span>Duration <b>{t.duration_h[1] > 0 ? `${t.duration_h[0]}–${t.duration_h[1]} h` : 'n/a'}</b></span>
        <span>Response <b>{t.response}</b></span>
        <span>Round-trip <b>{Math.round(t.rte * 100)} %</b></span>
        <span>Life <b>{t.life_years} yr</b></span>
      </div>
      <div className="gr-tech-note">🇳🇬 {t.nigeria_note}</div>
    </Card>
  )
}

/** Learn — the storage technologies the engine knows, grouped by tab, plus data providers and references. */
export function LearnPage() {
  const [tech, setTech] = useState<Technology[]>([])
  const [refs, setRefs] = useState<{ id: string; title: string; url: string }[]>([])
  const [providers, setProviders] = useState<any[]>([])
  useEffect(() => {
    api.technologies().then((t) => { setTech(t.technologies); setRefs(t.references) }).catch(() => null)
    fetch(`${API_BASE}/api/health-data/providers`).then((r) => r.json()).then((j) => setProviders(j.providers)).catch(() => null)
  }, [])
  const grid = (g: string) => <div className="gr-tech-grid">{tech.filter((t) => t.group === g).map((t) => <TechCard key={t.id} t={t} />)}</div>

  const data = (
    <div className="gr-grid gr-grid-2" style={{ height: '100%' }}>
      <Card>
        <div className="gr-eyebrow">Health-facility data providers (Africa)</div>
        <table className="gr-table gr-table-tight" data-testid="providers-table">
          <thead><tr><th>Provider</th><th>Coverage</th><th>Role</th><th>Status</th></tr></thead>
          <tbody>{providers.map((p) => <tr key={p.id}><td><a href={p.url} target="_blank" rel="noreferrer" style={{ color: '#fff' }}>{p.name}</a></td><td>{p.coverage}</td><td>{p.role}</td><td><Chip kind={p.status === 'live' || p.status === 'installed' ? 'High' : p.status === 'bundled' ? 'Medium' : 'model'}>{p.status}</Chip></td></tr>)}</tbody>
        </table>
      </Card>
      <Card>
        <div className="gr-eyebrow">References</div>
        <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--gr-fg-2)', fontSize: 13, lineHeight: 1.7 }}>{refs.map((r) => <li key={r.id}><a href={r.url} target="_blank" rel="noreferrer">{r.title}</a></li>)}</ul>
      </Card>
    </div>
  )

  return (
    <Screen testid="learn-page" eyebrow="Learn" title="Which storage works in Nigeria — and why"
      sub="The engine evaluates the practical shortlist; the rest are a watch-list with the reason."
      tabs={[
        { id: 'ldes', label: 'Storage', content: grid('ldes') },
        { id: 'core', label: 'Core options', content: grid('core') },
        { id: 'source', label: 'Sources', content: grid('source') },
        { id: 'data', label: 'Data & references', content: data },
      ]} />
  )
}
