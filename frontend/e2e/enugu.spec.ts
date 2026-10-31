import { test, expect, type Page } from '@playwright/test'

// GUI test of Brief 12 — "Relocatable solar for a hospital on the move" (National Orthopaedic Hospital, Enugu):
// home → grid scan of today's site + the new-site lens → the plan answering the five starter questions and every
// deliverable → movable storage limits → the 3D simulation named with the building and its address → the report.
const shot = (page: Page, name: string) => page.screenshot({ path: `e2e-results/enugu/${name}.png`, fullPage: false })
const fitsOneScreen = (page: Page) => page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1)

test('Brief 12 · Enugu hospital on the move — full story', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error' && !/WebGL|GPU|favicon|tile\.openstreetmap/i.test(m.text())) errors.push(m.text()) })

  // ── Home: the brief, its numbers and the Three A's ─────────────────────────────────────
  await page.goto('/')
  await expect(page.getByTestId('home-case')).toContainText('National Orthopaedic Hospital, Enugu')
  await expect(page.getByTestId('kpis')).toContainText('₦3,277')
  await expect(page.getByTestId('kpis')).toContainText('6 h')
  for (const a of ['Access', 'Affordability', 'Availability']) await expect(page.getByTestId('three-as')).toContainText(a)
  await expect(page.getByTestId('steps')).toContainText("today's site and the new site")
  expect(await fitsOneScreen(page), 'home must fit one screen').toBe(true)
  await shot(page, '01-home')
  await page.getByTestId('cta-case').click()

  // ── Explorer: today's grid (6 h reported) and the new-site lens ────────────────────────
  await expect(page).toHaveURL(/\/explorer/)
  await expect(page.getByTestId('case-banner')).toContainText('Abakpa Junction, Abakaliki Road')
  await expect(page.getByTestId('site-readout')).toContainText('NOHE')
  await expect(page.getByTestId('grid-hours')).toContainText('6 h a day (reported by the hospital)', { timeout: 40000 })
  await expect(page.getByTestId('ring-50')).toContainText(/Strong|Moderate|Weak|Poor|Critical/, { timeout: 40000 })
  await expect(page.getByTestId('ring-100')).toContainText(/Strong|Moderate|Weak|Poor|Critical/, { timeout: 40000 })
  await expect(page.getByTestId('newsite-suggestions').locator('li').first()).toContainText('/100', { timeout: 40000 })
  await expect(page.getByTestId('tariff-today')).toContainText('₦160', { timeout: 40000 })   // EERC Band A for Enugu, flat
  await expect(page.getByTestId('build-3d')).toHaveCount(0)   // a moving hospital stays in the hackathon flow
  await expect(page.getByTestId('moving-toggle')).toHaveAttribute('aria-pressed', 'true')
  await page.waitForTimeout(800)
  await shot(page, '02-explorer-grid-and-new-site-lens')
  await page.getByTestId('lens-newsite').click()
  await expect(page.getByTestId('lens-newsite')).toHaveAttribute('aria-pressed', 'false')
  await page.getByTestId('lens-newsite').click()
  await expect(page.getByTestId('lens-newsite')).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('newsite-suggestions').locator('li').first().click()
  await expect(page.getByTestId('newsite-section')).toContainText('Suggested area #1')
  await page.getByTestId('open-plan').click()

  // ── The plan: five questions answered ────────────────────────────────────────────────
  await expect(page).toHaveURL(/\/case/, { timeout: 180000 })
  await expect(page.getByTestId('case-page')).toBeVisible()
  for (const q of ['q1', 'q2', 'q3', 'q4', 'q5']) await expect(page.getByTestId(`answer-${q}`)).toBeVisible()
  await expect(page.getByTestId('answer-q1')).toContainText('Never off')
  await expect(page.getByTestId('answer-q2')).toContainText('ground racks')
  await expect(page.getByTestId('answer-q3')).toContainText('energy-as-a-service')
  await expect(page.getByTestId('answer-q4')).toContainText('repay')
  await expect(page.getByTestId('answer-q5')).toContainText('Rural Electrification Agency')
  expect(await fitsOneScreen(page), 'plan must fit one screen').toBe(true)
  await shot(page, '03-plan-five-questions')

  // each answer jumps to its evidence
  await page.getByTestId('answer-q2').getByRole('button', { name: /See the evidence/ }).click()
  await expect(page.getByTestId('move-steps')).toBeVisible()
  await expect(page.getByTestId('move-kpis')).toContainText('Reused at new building')
  await expect(page.getByTestId('design-items')).toContainText('20-ft LFP container')
  await shot(page, '04-move-plan')

  await page.getByTestId('tab-sites').click()
  await expect(page.getByTestId('case-map')).toBeVisible()
  await expect(page.getByTestId('two-sites')).toContainText('km')
  await expect(page.getByTestId('price-today')).toContainText('/kWh', { timeout: 40000 })
  await expect(page.getByTestId('site-suggestions').locator('li').first()).toContainText('/100', { timeout: 40000 })
  await expect(page.getByTestId('solar-check')).toContainText(/NASA POWER|Climatology/, { timeout: 90000 })
  await expect(page.getByTestId('solar-check')).toContainText('Global Solar Atlas', { timeout: 90000 })
  // the organisers' tools: a grid-first feeder load flow from the nearest substation, the grid for QGIS, ENERGYDATA.INFO
  await expect(page.getByTestId('feeder-check')).toContainText('kV', { timeout: 40000 })
  await expect(page.getByTestId('feeder-check')).toContainText('% ·')
  await expect(page.getByTestId('qgis-geojson')).toHaveAttribute('href', /\/api\/grid\/geojson\?lat=/)
  await expect(page.getByTestId('energydata')).not.toContainText('Searching', { timeout: 60000 })
  await page.waitForTimeout(800)
  await shot(page, '05-two-sites-grid-lens')
  // choose another area: the plan stays on screen and offers a re-run
  await page.getByTestId('site-suggestions').locator('li').nth(1).click()
  await expect(page.getByTestId('rerun-new-site')).toBeVisible()
  await page.getByTestId('rerun-new-site').click()
  await expect(page.getByTestId('rerun-new-site')).toHaveCount(0, { timeout: 180000 })

  await page.getByTestId('tab-loads').click()
  await expect(page.getByTestId('load-list')).toContainText('Surgical theatres')
  await expect(page.getByTestId('phases')).toContainText('Theatres first')
  await shot(page, '06-theatres-first')

  // ── Movable storage: loads are added theatres-first up to the units' limit ──────────────
  await page.getByTestId('tab-storage').click()
  await expect(page.getByTestId('ladder-theatres')).toHaveClass(/on/)
  await page.getByTestId('unit-trailer').click()
  for (let i = 0; i < 10; i++) await page.getByTestId('units-minus').click()
  await expect(page.getByTestId('units-count')).toHaveText('1')
  // one trailer cannot carry the theatres through a 9-hour night — the page says so
  await expect(page.getByTestId('ladder-theatres')).not.toHaveClass(/on/)
  await expect(page.getByTestId('ladder-none')).toContainText('Not even the theatres fit')
  // for a 4-hour gap, one trailer carries the theatres and nothing else
  await page.getByTestId('ladder-hours').fill('4')
  await expect(page.getByTestId('ladder-theatres')).toHaveClass(/on/)
  await expect(page.getByTestId('ladder-icu')).not.toHaveClass(/on/)
  await shot(page, '07-movable-storage-one-trailer')
  for (let i = 0; i < 9; i++) await page.getByTestId('units-plus').click()
  await expect(page.getByTestId('units-count')).toHaveText('10')
  await expect(page.getByTestId('ladder-icu')).toHaveClass(/on/)
  await expect(page.getByTestId('move-bridge')).toContainText('trailer')
  await shot(page, '08-movable-storage-ten-trailers')

  // ── Ownership, funders, the hospital's real diesel bill ─────────────────────────────────
  await page.getByTestId('tab-money').click()
  await expect(page.getByTestId('ownership')).toContainText('Energy-as-a-service')
  await expect(page.getByTestId('ownership')).toContainText('breaks')
  await expect(page.getByTestId('funders')).toContainText('Rural Electrification Agency')
  await expect(page.getByTestId('funders')).toContainText('Solar for Health')
  await page.getByTestId('diesel-bill').fill('120')
  await page.getByTestId('diesel-bill-apply').click()
  await expect(page.getByTestId('diesel-bill-apply')).toHaveText('Recalculate', { timeout: 180000 })
  await shot(page, '09-owner-and-funders')

  await expect(page.getByTestId('years-kpis')).toContainText('10 years saved')
  await expect(page.getByTestId('years-chart')).toContainText(/reported diesel bill/i)
  await page.waitForTimeout(500)
  await shot(page, '10-money-five-and-ten-years')

  // energy type: the ML pick, every family's cost difference, why a UPS stays; and the no-sun night-charging case
  await page.getByTestId('tab-energy').click()
  await expect(page.getByTestId('energy-types').locator('tbody tr')).toHaveCount(await page.getByTestId('energy-types').locator('tbody tr').count())
  await expect(page.getByTestId('energy-types')).toContainText('plan')
  await expect(page.getByTestId('why-ups')).toContainText('0 ms')
  // adaptable: if storage can't be used, the plan steps down to grid-first
  await expect(page.getByTestId('adapt')).toContainText('No storage possible yet')
  await expect(page.getByTestId('adapt')).toContainText('feeder')
  await shot(page, '10b-energy-type-ml')
  await page.getByTestId('tab-nosun').click()
  await expect(page.getByTestId('no-sun')).toContainText('overnight')
  await shot(page, '10c-no-sun-night-charging')

  // every open data source and tool behind the numbers, with its status
  await page.getByTestId('tab-sources').click()
  for (const n of ['NLR PVWatts API', 'NASA POWER', 'Global Solar Atlas', 'ENERGYDATA.INFO', 'pandapower', 'QGIS']) await expect(page.getByTestId('data-sources')).toContainText(n)
  await shot(page, '10d-data-sources')

  await page.getByTestId('tab-impact').click()
  await expect(page.getByTestId('three-as-case')).toContainText('Theatres first')
  await expect(page.getByTestId('metrics')).toContainText('Scalability')
  await expect(page.getByTestId('input-sources')).toContainText('NBS')
  await expect(page.getByTestId('esg')).toContainText('t CO₂')
  await page.getByTestId('carbon-price').fill('10')
  await expect(page.getByTestId('carbon-value')).toContainText('US$')
  await shot(page, '11-impact-aaa')

  // ── 3D: the building is named, with its address; the questions sit beside the simulation ──
  await page.getByTestId('case-to-sim').click()
  await expect(page).toHaveURL(/\/simulation/)
  await expect(page.getByTestId('sim-site-name')).toContainText('National Orthopaedic Hospital, Enugu')
  await expect(page.getByTestId('sim-address')).toContainText('Abakpa Junction')
  await page.getByTestId('sim-questions-btn').click()
  await expect(page.getByTestId('sim-questions')).toContainText('Which loads must never lose power')
  await page.waitForTimeout(2000)
  await shot(page, '12-simulation-3d-questions')
  await page.getByTestId('sim-questions-btn').click()
  await page.waitForTimeout(800)
  await shot(page, '13-simulation-3d')

  // ── Report: the impact estimate ───────────────────────────────────────────────────────
  await page.goto('/report')
  await page.getByTestId('tab-brief12').click()
  await expect(page.getByTestId('report-brief12')).toContainText('Q5')
  await expect(page.getByTestId('report-brief12')).toContainText('Impact')
  await shot(page, '14-report-brief12')

  expect(errors, errors.join('\n')).toEqual([])
})


// The same flow for any hospital — nothing hard-coded: pin a site, describe it, say it is moving, place the new site, run.
test('generic flow · pinned hospital in Kano → moving → new site → relocation plan', async ({ page }) => {
  await page.goto('/explorer?lat=12.0&lng=8.52')
  await expect(page.getByTestId('ring-100')).toContainText(/Strong|Moderate|Weak|Poor|Critical/, { timeout: 40000 })
  await page.getByTestId('hospital-list').locator('li').first().click()
  await page.getByTestId('moving-toggle').click()
  await expect(page.getByTestId('newsite-suggestions').locator('li').first()).toContainText('/100', { timeout: 40000 })
  await page.getByTestId('newsite-suggestions').locator('li').first().click()
  await page.getByTestId('open-plan').click()
  await expect(page).toHaveURL(/\/case/, { timeout: 180000 })
  await expect(page.getByTestId('case-page')).toContainText('relocation plan')
  await expect(page.getByTestId('case-page')).not.toContainText('Abakpa')   // nothing of the worked example leaks in
  await expect(page.getByTestId('case-page')).not.toContainText('The hospital is in Enugu')
  for (const q of ['q1', 'q2', 'q3', 'q4', 'q5']) await expect(page.getByTestId(`answer-${q}`)).toBeVisible()
  await page.getByTestId('tab-energy').click()
  await expect(page.getByTestId('energy-types')).toContainText('plan')
  // the Facility page is the cost calculator: prices with sources, reported grid hours
  await page.goto('/facility')
  await page.getByTestId('tab-equipment').click()
  await expect(page.getByTestId('prices')).toContainText('NBS')
  await page.getByTestId('grid-hours-input').fill('8')
  await page.getByTestId('tab-hospital').click()
  await expect(page.getByTestId('load-source')).toContainText(/beds|entered/)
  await page.screenshot({ path: 'e2e-results/enugu/15-facility-cost-calculator.png' })
})
