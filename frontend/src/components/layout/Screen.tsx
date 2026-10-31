import { useState, type ReactNode } from 'react'

export interface ScreenTab { id: string; label: string; content: ReactNode }

/**
 * One-screen page layout: a short header and tabs instead of a long scrolling page. Every panel stays mounted
 * (inactive ones are hidden), so printing shows all sections and lists keep their state between tabs.
 */
export function Screen({ eyebrow, title, sub, actions, tabs, aside, testid, tab: controlled, onTab }: {
  eyebrow?: ReactNode; title: ReactNode; sub?: ReactNode; actions?: ReactNode; tabs: ScreenTab[]; aside?: ReactNode; testid?: string
  /** optional controlled tab, so a page can jump to a tab (e.g. from an answer to its evidence) */
  tab?: string; onTab?: (id: string) => void
}) {
  const [own, setOwn] = useState(tabs[0]?.id)
  const tab = controlled ?? own
  const setTab = (id: string) => { setOwn(id); onTab?.(id) }
  return (
    <div className="gr-screen" data-testid={testid}>
      <header className="gr-screen-head">
        <div style={{ minWidth: 0 }}>
          {eyebrow && <div className="gr-eyebrow">{eyebrow}</div>}
          <h1 className="gr-screen-title">{title}</h1>
          {sub && <div className="gr-page-sub">{sub}</div>}
        </div>
        {actions && <div className="gr-screen-actions">{actions}</div>}
      </header>
      {tabs.length > 1 && (
        <nav className="gr-tabs gr-no-print" role="tablist">
          {tabs.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)} data-testid={`tab-${t.id}`}>{t.label}</button>)}
        </nav>
      )}
      <div className={`gr-screen-main ${aside ? 'with-aside' : ''}`}>
        <div className="gr-screen-body">
          {tabs.map((t) => <section key={t.id} role="tabpanel" className={`gr-tabpanel ${tab === t.id ? '' : 'hidden'}`}>{t.content}</section>)}
        </div>
        {aside && <aside className="gr-screen-aside">{aside}</aside>}
      </div>
    </div>
  )
}
