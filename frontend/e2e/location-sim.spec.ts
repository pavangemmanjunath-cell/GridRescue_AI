import { test, expect, type Page } from '@playwright/test'
import { readFileSync, mkdirSync } from 'node:fs'

// Simulate follows the location the user selects: pick a different place in the Explorer, open Simulate from the menu,
// and the 3D simulation runs for that place — tagged with it, showing its details — and the lens (Sun · Wind · Water)
// picks the design that uses that resource, if it is viable there. The ESG report is for that place and that design.
const OUT = 'e2e-results/location-sim'
mkdirSync(OUT, { recursive: true })
const shot = (page: Page, name: string) => page.screenshot({ path: `${OUT}/${name}.png` })

/** In the Explorer, go to coordinates, then open Simulate from the top menu (as a user would). */
async function simulateAt(page: Page, lat: string, lng: string) {
  await page.getByTestId('lat-input').fill(lat)
  await page.getByTestId('lng-input').fill(lng)
  await page.getByTestId('go-btn').click()
  await expect(page.getByTestId('place-name')).not.toHaveText(/Resolving|^$/, { timeout: 30000 })
  await page.getByRole('link', { name: 'Simulate', exact: true }).click()
  await expect(page).toHaveURL(/\/simulation/)
  await expect(page.getByTestId('simulation-page')).toBeVisible({ timeout: 180000 })
}
async function canvasDrawn(page: Page) {
  await page.waitForTimeout(2500)
  return (await page.locator('.gr-sim3-canvas canvas').first().screenshot()).length
}

test('from the Enugu case to Jos: Simulate runs for Jos, tagged with it, and each lens picks its design', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('cta-case').click()                          // the Enugu worked example, site locked
  await expect(page.getByTestId('ring-100')).toContainText(/Strong|Moderate|Weak|Poor|Critical/, { timeout: 60000 })
  await simulateAt(page, '9.90', '8.86')                               // a different location: Jos

  // tagged with the selected location — not the Enugu hospital
  await expect(page.getByTestId('sim-location-tag')).toContainText('Jos')
  await expect(page.getByTestId('sim-location-tag')).toContainText('9.90°N, 8.86°E')
  await expect(page.getByTestId('sim-site-name')).not.toContainText('National Orthopaedic Hospital')
  await expect(page.getByTestId('sim-location')).toContainText('Plateau')
  await expect(page.getByTestId('sim-resources')).toContainText(/h\/day · [\d.]+ m\/s/)
  expect(await canvasDrawn(page), 'the 3D site draws').toBeGreaterThan(60000)

  // Sun lens: a solar design
  await page.getByTestId('sim-lens-sun').click()
  await expect(page.getByTestId('sim-lens-note')).toContainText('Sun lens')
  await expect(page.getByTestId('best-name')).toContainText('Solar')
  await shot(page, '01-jos-sun')

  // Wind lens: the best wind design here, with its own numbers, and the ESG report for it
  await page.getByTestId('sim-lens-wind').click()
  await expect(page.getByTestId('sim-lens-note')).toContainText(/Wind lens · [\d.]+ m\/s at 50 m/)
  await expect(page.getByTestId('best-name')).toContainText('Wind')
  await expect(page.getByTestId('grid-outages')).toContainText(/Wind\s*\d+ kW/)
  await expect(page.getByTestId('sim-diesel-avoided')).not.toHaveText('—')
  expect(await canvasDrawn(page), 'the wind site draws').toBeGreaterThan(60000)
  await shot(page, '02-jos-wind')
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.getByTestId('sim-esg-download').click()])
  const esg = readFileSync((await dl.path())!, 'utf8')
  expect(esg).toContain('Jos'); expect(esg).toContain('Wind lens'); expect(esg).toContain('UPS + Wind')
  expect(esg).not.toContain('National Orthopaedic Hospital')

  // Water lens: the water-based design (hydrogen from the site's water)
  await page.getByTestId('sim-lens-water').click()
  await expect(page.getByTestId('sim-lens-note')).toContainText('Water lens')
  await expect(page.getByTestId('best-name')).toContainText('Hydrogen')
  await shot(page, '03-jos-water')
})

test('Kano: the Wind lens says honestly that wind is not viable here and keeps the best design', async ({ page }) => {
  await page.goto('/explorer?lat=6.4684&lng=7.5256')
  await expect(page.getByTestId('place-name')).not.toHaveText(/Resolving|^$/, { timeout: 30000 })
  await simulateAt(page, '12.0', '8.52')
  await expect(page.getByTestId('sim-location-tag')).toContainText('12.00°N, 8.52°E')
  await expect(page.getByTestId('sim-location')).toContainText('Kano')
  await page.getByTestId('sim-lens-wind').click()
  await expect(page.getByTestId('sim-lens-note')).toContainText(/no wind design is viable here/)
  await expect(page.getByTestId('best-name')).not.toContainText('Wind')
  await shot(page, '04-kano-wind-not-viable')
})

test('Lokoja by the river: the Water lens shows the water design and the river beside the site', async ({ page }) => {
  await page.goto('/explorer?lat=6.4684&lng=7.5256')
  await expect(page.getByTestId('place-name')).not.toHaveText(/Resolving|^$/, { timeout: 30000 })
  await simulateAt(page, '7.8023', '6.7333')
  await expect(page.getByTestId('sim-location-tag')).toContainText('Lokoja')
  await page.getByTestId('sim-lens-water').click()
  await expect(page.getByTestId('sim-lens-note')).toContainText(/Water lens · water [\d.]+ km/)
  await expect(page.getByTestId('best-name')).toContainText('Hydrogen')
  await expect(page.getByTestId('sim-resources')).toContainText(/water [\d.]+ km/)
  expect(await canvasDrawn(page), 'the river site draws').toBeGreaterThan(60000)
  await shot(page, '05-lokoja-water')
})
