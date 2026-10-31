import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom'
import { AppBar } from './components/layout/AppBar'
import { AskPanel } from './components/ask/AskPanel'
import { useSiteStore } from './store/useSiteStore'
import { HomePage } from './pages/HomePage'
import { ExplorerPage } from './pages/ExplorerPage'
import { FacilityPage } from './pages/FacilityPage'
import { RecommendationPage } from './pages/RecommendationPage'
import { ComparePage } from './pages/ComparePage'
import { CostsPage } from './pages/CostsPage'
import { LearnPage } from './pages/LearnPage'
import { ReportPage } from './pages/ReportPage'
import { CasePage } from './case/CasePage'

const BuildPage = lazy(() => import('./build/BuildPage').then((m) => ({ default: m.BuildPage })))
const GesturePage = lazy(() => import('./gesture/GesturePage').then((m) => ({ default: m.GesturePage })))
const SimulationPage = lazy(() => import('./pages/SimulationPage').then((m) => ({ default: m.SimulationPage })))

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => { window.scrollTo({ top: 0 }) }, [pathname])
  return null
}

function BackendStatus() {
  const { backendMode, checkBackend } = useSiteStore()
  const { pathname } = useLocation()
  useEffect(() => { checkBackend(); const t = setInterval(checkBackend, 60000); return () => clearInterval(t) }, [checkBackend])
  const color = backendMode === 'live' ? 'var(--gr-rescue)' : backendMode === 'offline' ? 'var(--gr-sun-300)' : backendMode === 'down' ? 'var(--gr-danger)' : 'var(--gr-fg-4)'
  const label = backendMode === 'live' ? 'API live · open data' : backendMode === 'offline' ? 'API offline demo mode' : backendMode === 'down' ? 'API unreachable — start the backend' : 'checking API…'
  if (backendMode === 'live' && (pathname === '/simulation' || pathname === '/explorer' || pathname === '/build' || pathname === '/hands')) return null   // full-screen views: keep the corner free
  return <div className="gr-status gr-no-print" data-testid="backend-status"><span className="gr-dot" style={{ background: color }} />{label}</div>
}

export default function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <div className="gr-shell">
        <AppBar />
        <AskPanel />
        <Suspense fallback={<div className="gr-page"><div className="gr-empty">Loading 3D studio…</div></div>}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/explorer" element={<ExplorerPage />} />
            <Route path="/facility" element={<FacilityPage />} />
            <Route path="/recommendation" element={<RecommendationPage />} />
            <Route path="/compare" element={<ComparePage />} />
            <Route path="/costs" element={<CostsPage />} />
            <Route path="/build" element={<BuildPage />} />
            <Route path="/simulation" element={<SimulationPage />} />
            <Route path="/learn" element={<LearnPage />} />
            <Route path="/report" element={<ReportPage />} />
            <Route path="/case" element={<CasePage />} />
            <Route path="/hands" element={<GesturePage />} />
            <Route path="*" element={<HomePage />} />
          </Routes>
        </Suspense>
        <BackendStatus />
      </div>
    </BrowserRouter>
  )
}
