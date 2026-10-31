import { test, expect } from '@playwright/test'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'

const __dirname = dirname(fileURLToPath(import.meta.url))

// The pitch film (docs/pitch/GridRescue_Pitch_Film.html), tested as a book: every spread opens without errors, shows its
// pop-up and graph, speaks lines that match the story, carries the Three A's, and the sky runs a real day — a morning
// wind when the sun is up, a blue breeze and stars at night, the hour on a tag; no viewer decisions, no ML claims. Its numbers must equal the live engine.
// Screens go to e2e-results/film/ (git-ignored). Needs the backend on :8000 for the live-number check.
// the pitch film lives outside the code repo, in 00_Final_PPT_DOC_Vedio/1_pitch_vedio/pitch (override with PITCH_DIR);
// on a fresh clone it is absent and these tests are skipped
const PITCH = process.env.PITCH_DIR || resolve(__dirname, '../../../00_Final_PPT_DOC_Vedio/1_pitch_vedio/pitch')
const HAVE = existsSync(resolve(PITCH, 'GridRescue_Pitch_Film.html')) && existsSync(resolve(PITCH, 'src/film_numbers.json'))
const FILM = pathToFileURL(resolve(PITCH, 'GridRescue_Pitch_Film.html')).href
const NUM = HAVE ? JSON.parse(readFileSync(resolve(PITCH, 'src/film_numbers.json'), 'utf8')).enugu : {}
const API = process.env.E2E_API || 'http://127.0.0.1:8000'
declare global { interface Window { __film: any } }

test.describe.configure({ mode: 'serial' })
test.skip(!HAVE, `pitch film not found at ${PITCH}`)
// the book is WebGL: use the real GPU (as render_video.mjs does); software SwiftShader is ~80x slower
test.use({ launchOptions: { args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] } })

test('the book: every spread, its pop-up, its words and the sky', async ({ page }) => {
  test.setTimeout(600_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error' && !/WebGL|GPU|fonts\.g/i.test(m.text())) errors.push(m.text()) })
  await page.setViewportSize({ width: 1600, height: 900 })
  await page.goto(FILM)
  await page.waitForFunction(() => window.__film && window.__film.ready, null, { timeout: 60_000 })
  await page.evaluate(() => window.__film.hideUi())

  const chapters: any[] = await page.evaluate(() => window.__film.chapters)
  const starts: number[] = await page.evaluate(() => window.__film.starts())
  const total: number = await page.evaluate(() => window.__film.total)
  const story = await page.evaluate(() => (window as any).__film.chapters.map((c: any) => [...c.talk, ...c.reveal].map((l: any) => l[1]).join(' ')).join(' '))
  expect(chapters.length).toBeGreaterThanOrEqual(16)

  // the story itself: the Three A's, the brief, no dates, no configurator, vendor-neutral
  const html = await page.content()
  expect(html.toLowerCase()).not.toContain('configurator')
  expect(story).not.toMatch(/\b20\d\d-\d\d-\d\d\b|\b\d{1,2}\/\d{1,2}\/20\d\d\b/)
  for (const a of ['Access', 'Affordability', 'Availability']) expect(story).toContain(a)
  for (const w of ['neutral', 'adapts', 'Utilities', 'stress-tests']) expect(story).toContain(w)
  expect(story, 'v6: never say 3D in the pitch').not.toMatch(/3D|three D/)
  expect(story, 'v6: no reactions').not.toMatch(/\bWow\b/)
  expect(story).not.toMatch(/\bML\b|machine learning|decision tree|CART/i)   // v5: no ML claims in the pitch
  expect(chapters.every((c) => !c.decision), 'no viewer decisions').toBe(true)

  const want: Record<string, { pop?: string; panel?: string; aaa?: string }> = {
    today: { pop: 'site1', panel: 'co2' }, shift: { pop: 'site1', panel: 'day' }, aaa: { pop: 'aaa' }, lens: { pop: 'lens', panel: 'grid', aaa: 'Access' },
    devices: { pop: 'devices', aaa: 'Affordability' }, how: { pop: 'site2', panel: 'compare', aaa: 'Affordability' }, hospital: { pop: 'hospital', panel: 'stack', aaa: 'Availability' },
    app_sun: { pop: 'app', aaa: 'Access' }, app_map: { pop: 'app', aaa: 'Access' }, app_sim: { pop: 'app', aaa: 'Availability' }, app_impact: { pop: 'app' },
    night: { pop: 'hospital', panel: 'tariff', aaa: 'Availability' }, calc: { pop: 'calc', aaa: 'Affordability' }, esg: { pop: 'esg', panel: 'esg' }, move: { pop: 'move', aaa: 'Availability' },
    crew: { pop: 'crew', panel: 'crew' },
  }
  for (let i = 0; i < chapters.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1] : total, t = starts[i] + (end - starts[i]) * 0.62
    await page.evaluate((x) => window.__film.seek(x), t)
    await page.waitForTimeout(120)
    const st = await page.evaluate(() => window.__film.state())
    expect(st.id, `chapter ${i}`).toBe(chapters[i].id)
    const w = want[st.id]
    if (w?.pop) expect(st.pops, `${st.id}: pop-up`).toContain(w.pop)
    if (w?.panel) expect(st.panel, `${st.id}: graph`).toBe(w.panel)
    if (w?.aaa) expect(st.eyebrow, `${st.id}: Three A's tag`).toContain(w.aaa)
    // the caption is one of this spread's spoken lines
    const lines = [...chapters[i].talk, ...chapters[i].reveal].map((l: any) => l[1])
    if (st.caption) expect(lines.some((l: string) => st.caption.endsWith(l)), `${st.id}: caption "${st.caption}"`).toBe(true)
    await page.screenshot({ path: `e2e-results/film/${String(i).padStart(2, '0')}-${st.id}.png` })
  }

  // the sky runs a real day: sample the hospital spread from sunrise to night
  const hi = chapters.findIndex((c) => c.id === 'hospital'), hEnd = starts[hi + 1]
  const seen: any[] = []
  for (let k = 0; k <= 16; k++) {
    await page.evaluate((x) => window.__film.seek(x), starts[hi] + ((hEnd - starts[hi]) * k) / 16.5)
    const st = await page.evaluate(() => window.__film.state())
    if (st.sky) seen.push({ ...st.sky, clock: st.clock })
  }
  const day = seen.find((s) => s.day && s.wind === 'morning'), night = seen.find((s) => !s.day && s.wind === 'night')
  expect(day, 'a morning wind when the sun is up').toBeTruthy()
  expect(night, 'a blue breeze at night').toBeTruthy()
  expect(seen.every((s) => s.birds === 0), 'no birds').toBe(true)
  for (const s of seen) expect(s.clock).toMatch(/^\d\d:\d\d · (night|sunrise|morning|midday|afternoon|sunset|evening)$/)
  await page.evaluate((x) => window.__film.seek(x), starts[hi] + (hEnd - starts[hi]) * 0.2)
  await page.screenshot({ path: 'e2e-results/film/sky-morning.png' })
  await page.evaluate((x) => window.__film.seek(x), starts[hi] + (hEnd - starts[hi]) * 0.75)
  await page.screenshot({ path: 'e2e-results/film/sky-night.png' })

  expect(errors, errors.join('\n')).toEqual([])
})

test('the film says what the live engine says', async ({ request }) => {
  test.setTimeout(300_000)
  const c = await (await request.get(`${API}/api/cases/noh-enugu`)).json()
  const h = c.hospital
  expect(h.name).toBe(NUM.name)
  expect(h.beds).toBe(NUM.beds)
  const sug = await (await request.get(`${API}/api/relocation/suggest?lat=${h.lat}&lng=${h.lng}`)).json()
  const best = sug.top[0]
  expect(`${best.direction}`).toBe(NUM.lens_top[0].dir)
  expect(best.score).toBe(NUM.lens_top[0].score)
  const opts = { ...c.options, relocation: { ...c.options.relocation, new_site: { lat: best.lat, lng: best.lng, label: `Lens area #1 · ${best.direction}, ${best.distance_km} km` } } }
  const a = await (await request.post(`${API}/api/assess`, { data: { location: { lat: h.lat, lng: h.lng }, facility: c.facility, options: opts }, timeout: 240_000 })).json()
  const rc = a.relocatable_case, fx = a.recommended.cost.assumptions.usd_to_ngn
  expect(Math.round((a.recommended.cost.capex_usd * fx) / 1e7) / 100).toBe(NUM.capex_bn)
  expect(rc.ownership.fee_ngn_m_per_month).toBe(NUM.fee_m)
  expect(Math.round(rc.cost_model.at_10.saving_vs_diesel_ngn_m / 100) / 10).toBe(NUM.save10_bn)
  expect(rc.impact.diesel_litres_avoided_per_year).toBe(NUM.litres)
  expect(Math.round(rc.impact.co2_avoided_t_per_year)).toBe(NUM.co2_t)
  expect(rc.move_plan.reuse_pct).toBe(NUM.reuse)
  expect(rc.adapt.rungs.length).toBe(3)
})
