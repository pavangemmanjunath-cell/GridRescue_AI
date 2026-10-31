import { test, expect, type Page } from '@playwright/test'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

// QA pass over what a judge will try: the three lenses read real numbers, the cost calculator reacts to prices,
// the ESG report downloads for whichever site was picked (two different cities), and the 3D scenes actually draw.
const OUT = 'e2e-results/qa'
mkdirSync(OUT, { recursive: true })
const shot = (page: Page, name: string) => page.screenshot({ path: `${OUT}/${name}.png` })
/** The number in a lens track's readout, after its count-up animation has settled. */
async function readout(page: Page, track: string) {
  const el = page.getByTestId(track).locator('.gr-bar-readout .gr-metric')
  await expect(el).toBeVisible({ timeout: 40000 })
  await page.waitForTimeout(1500)
  return parseFloat((await el.textContent())!.replace(/[^0-9.]/g, ''))
}
/** A WebGL canvas that drew something: a blank or single-colour canvas compresses to a tiny PNG. */
async function drawn(page: Page, selector: string) {
  const png = await page.locator(selector).first().screenshot()
  return png.length
}
/** Click a download button and return the file name and its text. */
async function download(page: Page, testid: string) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.getByTestId(testid).click()])
  const text = readFileSync((await dl.path())!, 'utf8')
  return { name: dl.suggestedFilename(), text }
}

test('lenses · sun, wind and water each read the site, month by month', async ({ page }) => {
  await page.goto('/explorer?lat=6.4684&lng=7.5256')   // Enugu
  await expect(page.getByTestId('place-name')).not.toHaveText(/Resolving|^$/, { timeout: 30000 })

  await page.getByTestId('mode-sun').click()
  await expect(page.getByTestId('lens-sun')).toBeVisible()
  const psh = await readout(page, 'track-peak')
  expect(psh, 'peak-sun hours in a tropical city').toBeGreaterThan(3); expect(psh).toBeLessThan(8)
  await expect(page.getByTestId('track-peak')).toContainText('MWh/MWp capturable')
  expect(await page.getByTestId('lens-sun').locator('path, circle, line, rect').count()).toBeGreaterThan(20)
  await shot(page, '01-lens-sun')

  await page.getByTestId('mode-wind').click()
  await expect(page.getByTestId('lens-wind')).toBeVisible()
  const ws = await readout(page, 'track-wind')
  expect(ws, 'wind speed at 50 m').toBeGreaterThan(0.5); expect(ws).toBeLessThan(20)
  await expect(page.getByTestId('track-wind')).toContainText('MWh/MW capturable')
  expect(await page.getByTestId('lens-wind').locator('path, circle, line, rect').count()).toBeGreaterThan(10)
  await shot(page, '02-lens-wind')

  await page.getByTestId('mode-water').click()
  await expect(page.getByTestId('lens-water')).toBeVisible()
  const rain = await readout(page, 'track-rainfall')
  expect(rain, 'rainfall mm/day').toBeGreaterThanOrEqual(0); expect(rain).toBeLessThan(40)
  await expect(page.getByTestId('track-rainfall')).toContainText(/nearest water/)
  await expect(page.getByTestId('water-row')).toBeVisible({ timeout: 30000 })
  await shot(page, '03-lens-water')

  // the month chips drive every lens: a different month gives a different reading somewhere in the year
  await page.getByTestId('mode-sun').click()
  const chips = page.getByTestId('month-grid').locator('button')
  const vals: number[] = []
  for (const m of [0, 7]) { await chips.nth(m).click(); vals.push(await readout(page, 'track-peak')) }
  expect(vals[0], 'January and August differ in Enugu (dry season vs rains)').not.toBe(vals[1])
})

test('Enugu plan · ESG report downloads for the site, carbon price included · 3D simulation draws', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('cta-case').click()
  await expect(page.getByTestId('newsite-suggestions').locator('li').first()).toContainText('/100', { timeout: 60000 })
  await page.getByTestId('newsite-suggestions').locator('li').first().click()
  await page.getByTestId('open-plan').click()
  await expect(page).toHaveURL(/\/case/, { timeout: 180000 })

  await page.getByTestId('tab-impact').click()
  await expect(page.getByTestId('esg')).toContainText('t CO₂')
  await page.getByTestId('carbon-price').fill('15')
  await expect(page.getByTestId('carbon-value')).toContainText('US$')
  const { name, text } = await download(page, 'esg-download')
  expect(name).toMatch(/^GridRescue_ESG_.+\.html$/)
  for (const s of ['ESG report', 'National Orthopaedic Hospital, Enugu', 'Scope 1', 'Scope 2', 'Environment', 'Social', 'Governance',
                   'Access', 'Affordability', 'Availability', 'US$ 15.00 per tonne', 'Save as PDF', 'not issued'])
    expect(text, `ESG report should contain “${s}”`).toContain(s)
  expect(text).toMatch(/6\.4\d*°, 7\.5\d*°/)   // the selected site's coordinates
  expect(text).not.toMatch(/\b20\d\d-\d\d-\d\d\b/)   // no timestamp in the report
  // open the downloaded file like a board member would, and keep a picture of it
  const file = resolve(`${OUT}/GridRescue_ESG_Enugu.html`); writeFileSync(file, text)
  const viewer = await page.context().newPage()
  await viewer.setViewportSize({ width: 1100, height: 1400 })
  await viewer.goto(pathToFileURL(file).href)
  await expect(viewer.locator('h1')).toContainText('National Orthopaedic Hospital')
  await viewer.screenshot({ path: `${OUT}/04-esg-report-enugu.png`, fullPage: true })
  await viewer.close()

  // the 3D simulation of this hospital: it draws, the clock runs through an outage, and all four outage cases are covered
  await page.getByTestId('case-to-sim').click()
  await expect(page.getByTestId('sim-site-name')).toContainText('National Orthopaedic Hospital, Enugu')
  await expect(page.locator('.gr-sim3-canvas canvas')).toBeVisible({ timeout: 30000 })
  await page.waitForTimeout(3000)
  expect(await drawn(page, '.gr-sim3-canvas canvas'), '3D site canvas is not blank').toBeGreaterThan(60000)
  await page.getByTestId('time-slider').fill('20')
  await expect(page.getByTestId('hud')).toContainText(/20:\d\d (outage|no grid|grid on)/)
  await expect(page.getByTestId('use-cases')).toContainText(/4\/4 passed/)
  for (const o of ['collapse', 'night']) {
    await page.getByTestId('outage-select').selectOption(o)
    await expect(page.getByTestId('outage-verdict')).toBeVisible({ timeout: 60000 })
  }
  await shot(page, '05-simulation-3d-enugu')

  // the general report page offers the same ESG report
  await page.goto('/report')
  const r2 = await download(page, 'download-esg')
  expect(r2.text).toContain('National Orthopaedic Hospital, Enugu')
})

test('another city · Kano: ESG report is for Kano, and the cost calculator reacts to the diesel price', async ({ page }) => {
  await page.goto('/explorer?lat=12.0&lng=8.52')
  await expect(page.getByTestId('ring-100')).toContainText(/Strong|Moderate|Weak|Poor|Critical/, { timeout: 60000 })
  await page.getByTestId('hospital-list').locator('li').first().click()
  await page.getByTestId('moving-toggle').click()
  await expect(page.getByTestId('newsite-suggestions').locator('li').first()).toContainText('/100', { timeout: 60000 })
  await page.getByTestId('newsite-suggestions').locator('li').first().click()
  await page.getByTestId('open-plan').click()
  await expect(page).toHaveURL(/\/case/, { timeout: 180000 })
  await page.getByTestId('tab-impact').click()
  const { text } = await download(page, 'esg-download')
  expect(text).toContain('Kano')
  expect(text).not.toContain('Abakpa')            // nothing of the Enugu example leaks into another site's report
  expect(text).toMatch(/1[12]\.\d+°, 8\.\d+°/)   // the hospital picked in Kano (its pin, near 12.0°, 8.5°)
  expect(text).toContain('enter your buyer')      // no price entered → the report asks for one

  // calculator: the same site at a lower diesel price must pay back more slowly
  const payback = async () => {
    await page.goto('/recommendation')
    const t = (await page.getByTestId('investment-case').textContent()) ?? ''
    const m = t.match(/pays back in ([\d.]+) years/)
    return m ? parseFloat(m[1]) : Infinity
  }
  const before = await payback()
  await page.goto('/facility')
  await page.getByTestId('tab-equipment').click()
  await expect(page.getByTestId('prices')).toContainText('NBS')
  await page.getByTestId('price-diesel').fill('1200')
  await page.getByTestId('run-assessment').click()
  await expect(page).toHaveURL(/\/recommendation/, { timeout: 120000 })
  const after = await payback()
  expect(before, 'payback at today’s diesel price').toBeLessThan(Infinity)
  expect(after, 'cheaper diesel → slower payback').toBeGreaterThan(before)
  await shot(page, '06-calculator-kano-cheaper-diesel')
  await page.goto('/costs')
  await expect(page.getByTestId('costs-page')).toContainText(/Saved over 15 years/)
  await page.getByTestId('tab-split').click()
  await expect(page.getByTestId('cost-table').locator('tbody tr').first()).toBeVisible()
})

test('Build 3D · hospital and rail crew scenes draw, play and fill the screen', async ({ page }) => {
  await page.goto('/explorer?lat=6.4684&lng=7.5256')
  await expect(page.getByTestId('ring-100')).toContainText(/Strong|Moderate|Weak|Poor|Critical/, { timeout: 60000 })
  if ((await page.getByTestId('moving-toggle').getAttribute('aria-pressed')) === 'true') await page.getByTestId('moving-toggle').click()
  await page.getByTestId('build-3d').click()
  const canvas = '[data-testid="build-canvas"] canvas'
  await expect(page.locator(canvas)).toBeVisible({ timeout: 30000 })
  await page.getByTestId('usecase-select').selectOption('health')
  await page.getByTestId('step-simulate').click()
  await page.waitForTimeout(2500)
  expect(await drawn(page, canvas), 'hospital scene draws').toBeGreaterThan(60000)
  await page.getByTestId('time-slider').fill('20')
  await expect(page.getByTestId('live-hud')).toContainText(/OUTAGE|Grid on/)
  await page.getByTestId('toggle-panel').click()                     // the site full width
  await expect(page.getByTestId('build-panel')).toBeHidden()
  await shot(page, '07-build-hospital-wide')
  await page.getByTestId('toggle-panel').click()

  await page.getByTestId('usecase-select').selectOption('markets')
  await page.getByTestId('preset-select').selectOption('rail')
  await page.getByTestId('step-simulate').click()
  await page.getByTestId('scenario-nights3').click()
  await expect(page.getByTestId('build-panel')).toContainText(/fully powered/)
  await page.getByTestId('time-slider').fill('23.5')
  await expect(page.getByTestId('live-hud')).toContainText(/Crew on shift/)
  await page.waitForTimeout(2000)
  expect(await drawn(page, canvas), 'rail scene draws').toBeGreaterThan(60000)
  await shot(page, '08-build-rail-night')
})
