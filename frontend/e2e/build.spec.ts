import { test, expect, type Page } from '@playwright/test'

// GUI test of the story and the 3D configurator: Explorer → Build 3D hand-over, the use-case dropdown (hospital
// management / maintenance work), every resource with every storage device, zoom and the larger view, the simulation
// drawer (open, taller, close) and component inspector, layout at three widths, no console errors. Screenshots land in docs/screenshots/build/.
const shot = (page: Page, name: string) => page.screenshot({ path: `../docs/screenshots/build/${name}.png` })

function watchErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error' && !/WebGL|GPU|favicon|tile|basemaps|nominatim|ERR_|Failed to load resource/i.test(m.text())) errors.push(m.text()) })
  return errors
}

async function fresh(page: Page) {
  await page.goto('/build')
  await page.evaluate(() => sessionStorage.clear())
  await page.goto('/build')
  await expect(page.getByTestId('build-page')).toBeVisible()
  await expect(page.locator('[data-testid="build-canvas"] canvas')).toBeVisible({ timeout: 30000 })
}

test('story: pick a hospital in the Explorer, choose Wind, continue in Build 3D', async ({ page }) => {
  test.setTimeout(300_000)
  const errors = watchErrors(page)
  await page.goto('/')
  await page.getByTestId('cta-explore').click()
  await expect(page).toHaveURL(/\/explorer/)
  await page.goto('/explorer?lat=12.0&lng=8.52')
  await expect(page.getByTestId('ring-100')).toContainText(/Strong|Moderate|Weak|Poor|Critical/, { timeout: 60000 })
  await page.getByTestId('hospital-list').locator('li').first().click()
  await page.getByTestId('mode-wind').click()
  await expect(page.getByTestId('build-3d')).toContainText('Wind')
  await shot(page, '00-explorer-handover')
  await page.getByTestId('build-3d').click()
  await expect(page).toHaveURL(/\/build/)
  await expect(page.getByTestId('resource-badge')).toContainText('WIND')
  await expect(page.getByTestId('explorer-hint')).toHaveCount(0)
  await page.getByTestId('step-site').click()
  await expect(page.getByTestId('site-card')).toContainText('SITE FROM THE EXPLORER')
  await expect(page.getByTestId('site-facts')).toContainText('not applied')        // Nigeria: no US federal credit
  await page.getByTestId('step-source').click()
  await expect(page.getByTestId('part-wind-m')).toContainText('fitted')
  await page.waitForTimeout(1500)
  await shot(page, '01-wind-from-explorer')
  expect(errors, errors.join('\n')).toEqual([])
})

test('every resource fits its own generation and every storage device in 3D', async ({ page }) => {
  test.setTimeout(480_000)
  const errors = watchErrors(page)
  await fresh(page)
  await expect(page.getByTestId('explorer-hint')).toBeVisible()          // no Explorer site yet: the story nudges there first
  await page.getByTestId('preset-community').click()
  await page.getByTestId('step-site').click()
  await page.getByTestId('city-asheville').click()                        // hills and a river: pumped hydro is allowed here
  const plan: Record<string, { source: string[]; storage: string[]; blocked?: string[] }> = {
    sun: { source: ['pv-ground', 'pv-carport', 'pv-roof'], storage: ['st-none', 'st-na', 'st-pb', 'st-ice', 'st-hot', 'st-h2', 'st-sc', 'st-lfp'] },
    wind: { source: ['wind-s', 'wind-l', 'wind-m'], storage: ['st-lto', 'st-fly', 'st-h2', 'st-flow', 'st-lfp'], blocked: ['st-caes'] },
    water: { source: ['hydro-m', 'hydro-l', 'hydro-s'], storage: ['st-phes', 'st-tank', 'st-grav', 'st-h2w', 'st-mhb'] },
  }
  for (const [res, p] of Object.entries(plan)) {
    await page.getByTestId('step-site').click()
    await page.getByTestId(`resource-${res}`).click()
    await expect(page.getByTestId('resource-badge')).toContainText(res === 'sun' ? 'SUN' : res === 'wind' ? 'WIND' : 'WATER')
    await page.getByTestId('step-source').click()
    for (const id of p.source) { await page.getByTestId(`part-${id}`).click(); await expect(page.getByTestId(`part-${id}`)).toContainText('fitted') }
    await page.waitForTimeout(1200)
    await shot(page, `02-${res}-generation`)
    await page.getByTestId('step-storage').click()
    for (const id of p.blocked ?? []) await expect(page.getByTestId(`part-${id}`)).toBeDisabled()
    for (const id of p.storage) {
      await page.getByTestId(`part-${id}`).click()
      await expect(page.getByTestId(`part-${id}`)).toContainText('fitted')
      await expect(page.getByTestId(`chip-${id}`)).toHaveClass(/on/)        // the quick-pick chip over the 3D view follows
      await page.waitForTimeout(900)
      await shot(page, `03-${res}-${id}`)
    }
  }
  // quick-pick chips work too: the diesel + UPS baseline is the high-CO₂ option
  await page.getByTestId('chip-st-none').click()
  await expect(page.getByTestId('part-st-none')).toContainText('fitted')
  await page.getByTestId('chip-st-mhb').click()
  expect(errors, errors.join('\n')).toEqual([])
})

test('the outage test runs in the same window with graphs and per-component data', async ({ page }) => {
  test.setTimeout(420_000)
  const errors = watchErrors(page)
  await fresh(page)
  await page.getByTestId('step-simulate').click()
  await expect(page.getByTestId('sim-drawer')).toBeVisible()              // the drawer slides up on the test step
  for (const id of ['storm', 'psps', 'winter', 'hurricane']) {
    await page.getByTestId(`scenario-${id}`).click()
    await expect(page.getByTestId('verdict')).toContainText('stayed on')
  }
  await page.getByTestId('scenario-storm').click()
  await page.getByTestId('time-slider').fill('16')
  await expect(page.getByTestId('live-hud')).toContainText('OUTAGE')
  await page.waitForTimeout(900)
  await shot(page, '04-drawer-system')
  // taller and back
  await page.getByTestId('drawer-tall').click()
  await expect(page.getByTestId('sim-drawer')).toHaveClass(/tall/)
  await shot(page, '04b-drawer-tall')
  await page.getByTestId('drawer-tall').click()
  await expect(page.getByTestId('sim-drawer')).not.toHaveClass(/tall/)
  await page.getByTestId('drawer-components').click()
  for (const id of ['source', 'storage', 'backup', 'grid', 'load']) {
    await page.getByTestId(`comp-${id}`).click()
    await expect(page.getByTestId('component-detail')).toBeVisible()
  }
  await page.getByTestId('comp-storage').click()
  await expect(page.getByTestId('component-detail')).toContainText('Lowest charge')
  await shot(page, '05-drawer-components')
  // close with ×: it slides down and the open button comes back; Esc closes too
  await page.getByTestId('drawer-close').click()
  await expect(page.getByTestId('sim-drawer')).toHaveCount(0)
  await expect(page.getByTestId('drawer-toggle')).toBeVisible()
  await page.getByTestId('drawer-toggle').click()
  await expect(page.getByTestId('sim-drawer')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('sim-drawer')).toHaveCount(0)
  // an unsafe build is called out
  await page.getByTestId('step-storage').click(); await page.getByTestId('part-st-none').click()
  await page.getByTestId('step-control').click(); await page.getByTestId('part-ctl-grid').click()
  await page.getByTestId('step-backup').click(); await page.getByTestId('part-gen-small').click()
  await page.getByTestId('step-simulate').click()
  await page.getByTestId('scenario-hurricane').click()
  await expect(page.getByTestId('verdict')).not.toContainText('stayed on')
  await page.getByTestId('drawer-system').click()
  await shot(page, '06-unsafe-build')
  // tools and the downloadable summary
  await page.getByTestId('toggle-labels').click(); await page.getByTestId('toggle-labels').click()
  await page.getByTestId('reset-view').click()
  await page.getByTestId('play').click(); await page.getByTestId('play').click()
  const dl = page.waitForEvent('download')
  await page.getByTestId('download-summary').click()
  expect((await dl).suggestedFilename()).toContain('summary')
  expect(errors, errors.join('\n')).toEqual([])
})

test('zoom in / out, fit the whole site, and hide the panel for a larger view', async ({ page }) => {
  test.setTimeout(240_000)
  const errors = watchErrors(page)
  await fresh(page)
  const dist = () => page.evaluate(() => (window as unknown as { __buildCam: () => number }).__buildCam())
  await page.waitForTimeout(2000)
  const overview = await dist()
  // every step keeps the whole site in frame: the camera never moves in much closer than the overview
  for (const id of ['site', 'load', 'source', 'storage', 'control', 'backup', 'simulate']) {
    await page.getByTestId(`step-${id}`).click()
    await page.waitForTimeout(1900)
    expect(await dist(), `${id}: whole site stays in view`).toBeGreaterThan(overview * 0.9)
    if (id === 'storage') await shot(page, '09a-storage-centred')
  }
  if (await page.getByTestId('drawer-close').count()) await page.getByTestId('drawer-close').click()
  // zoom out, wait: the camera stays out (nothing pulls it back)
  const d0 = await dist()
  await page.getByTestId('zoom-out').click()
  await page.waitForTimeout(1500)
  const d1 = await dist()
  expect(d1, 'zoom out moves the camera away').toBeGreaterThan(d0 * 1.2)
  await page.waitForTimeout(2500)
  expect(Math.abs((await dist()) - d1), 'it stays zoomed out').toBeLessThan(d1 * 0.05)
  // zoom in twice
  await page.getByTestId('zoom-in').click(); await page.waitForTimeout(1200)
  await page.getByTestId('zoom-in').click(); await page.waitForTimeout(1200)
  expect(await dist(), 'zoom in moves the camera closer').toBeLessThan(d1 * 0.7)
  // keyboard: - zooms out, 0 fits the whole site again
  const d2 = await dist()
  await page.keyboard.press('-'); await page.waitForTimeout(1200)
  expect(await dist()).toBeGreaterThan(d2 * 1.2)
  await page.keyboard.press('0'); await page.waitForTimeout(2000)
  expect(Math.abs((await dist()) - overview), 'fit returns to the whole-site view').toBeLessThan(overview * 0.06)
  await shot(page, '09-zoom-fit')
  // hide the side panel for a larger view
  const w0 = (await page.getByTestId('build-canvas').boundingBox())!.width
  await page.getByTestId('toggle-panel').click()
  await expect(page.getByTestId('build-panel')).toBeHidden()
  await page.waitForTimeout(600)
  const w1 = (await page.getByTestId('build-canvas').boundingBox())!.width
  expect(w1, '3D view is wider with the panel hidden').toBeGreaterThan(w0 + 200)
  await shot(page, '10-panel-hidden')
  await page.getByTestId('toggle-panel').click()
  await expect(page.getByTestId('build-panel')).toBeVisible()
  expect(errors, errors.join('\n')).toEqual([])
})

test('use case dropdown: 1 hospital management, 2 maintenance work (grid-charged battery only)', async ({ page }) => {
  test.setTimeout(360_000)
  const errors = watchErrors(page)
  await fresh(page)
  await page.getByTestId('step-simulate').click()
  // switching from the header keeps you on the Simulate step
  await page.getByTestId('usecase-select').selectOption('markets')
  await expect(page.getByTestId('step-chip')).toContainText('shift test')
  await expect(page.getByTestId('resource-badge')).toContainText('GRID-CHARGED BATTERY')
  await expect(page.getByTestId('step-source')).toHaveCount(0)               // no sun or wind
  await expect(page.getByTestId('step-backup')).toHaveCount(0)               // no generator
  await expect(page.getByTestId('storage-chips')).toHaveCount(0)
  for (const id of ['rail', 'road']) {
    await page.getByTestId('preset-select').selectOption(id)
    await expect(page.getByTestId('step-chip')).toContainText('shift test')
    await page.getByTestId('step-storage').click()
    await expect(page.locator('[data-testid^="part-"]')).toHaveCount(4)      // battery cart, trailer, large trailer, battery van
    for (const p of ['bess-cart', 'bess-trailer-xl', 'bess-trailer']) { await page.getByTestId(`part-${p}`).click(); await expect(page.getByTestId(`part-${p}`)).toContainText('fitted') }
    await page.getByTestId('step-control').click()
    for (const p of ['ctl-fast', 'ctl-sun', 'ctl-plug']) { await page.getByTestId(`part-${p}`).click(); await expect(page.getByTestId(`part-${p}`)).toContainText('fitted') }
    await expect(page.getByTestId('part-ctl-sun')).toContainText('% of charging from sun')
    await page.getByTestId('step-simulate').click()
    await page.getByTestId('scenario-nights3').click()
    await expect(page.getByTestId('verdict')).toContainText('fully powered')
    await page.getByTestId('time-slider').fill('23.5')
    await expect(page.getByTestId('live-hud')).toContainText('Crew on shift')
    await expect(page.getByTestId('live-hud')).not.toContainText('Generator')
    await page.getByTestId('drawer-components').click()
    await expect(page.getByTestId('comp-backup')).toHaveCount(0)
    await page.waitForTimeout(1200)
    await shot(page, `08-${id}-night-shift`)
  }
  // quick-pick icons: the battery van drives in, a backup generator can be added and removed
  await page.getByTestId('chip-bess-van').click()
  await expect(page.getByTestId('chip-bess-van')).toHaveClass(/on/)
  await page.getByTestId('time-slider').fill('12')                         // daytime: the van parks at the depot charger
  await page.waitForTimeout(2500)
  await shot(page, '11-van-at-depot')
  await page.getByTestId('time-slider').fill('23.5')                       // night: it drives out to the track
  await page.waitForTimeout(3000)
  await shot(page, '12-van-on-shift')
  await page.getByTestId('chip-generator').click()
  await expect(page.getByTestId('chip-generator')).toHaveAttribute('aria-pressed', 'true')
  await page.getByTestId('chip-generator').click()
  await expect(page.getByTestId('chip-generator')).toHaveAttribute('aria-pressed', 'false')
  // the depot charges from the Explorer site's sun, wind or water alongside the grid
  await page.getByTestId('step-site').click()
  await expect(page.getByTestId('depot-energy')).toBeVisible()
  await page.getByTestId('depot-sun').click()
  await expect(page.getByTestId('depot-sun')).toHaveClass(/on/)
  await expect(page.getByTestId('live-hud')).toContainText('Depot charging')
  await page.waitForTimeout(1500)
  await shot(page, '13-depot-solar')
  await page.getByTestId('depot-grid').click()
  // the use-case step shows both use cases and where else storage / UPS fits
  await page.getByTestId('step-usecase').click()
  await expect(page.getByTestId('crews')).toBeVisible()
  for (const id of ['telecom', 'data', 'cold', 'water', 'shelter']) await expect(page.getByTestId(`market-${id}`)).toBeVisible()
  await shot(page, '07-maintenance-usecase')
  await page.getByTestId('usecase-health').click()
  await expect(page.getByTestId('usecase-select')).toHaveValue('health')
  await expect(page.getByTestId('step-backup')).toHaveCount(1)
  await page.getByTestId('usecase-select').selectOption('markets')
  await page.getByTestId('crew-simulate').click()
  await expect(page.getByTestId('step-chip')).toContainText('shift test')
  expect(errors, errors.join('\n')).toEqual([])
})

test('CO₂ saver: counts up with the clock and changes with the storage you pick', async ({ page }) => {
  const errors = watchErrors(page)
  await fresh(page)
  await expect(page.getByTestId('co2-saver')).toBeVisible()
  await page.getByTestId('step-simulate').click()
  await page.getByTestId('scenario-psps').click()
  await page.getByTestId('drawer-close').click()
  const num = async (id: string) => Number(((await page.getByTestId(id).innerText()).match(/[\d,]+/) || ['0'])[0].replace(/,/g, ''))
  await page.getByTestId('time-slider').fill('6'); const early = await num('co2-sofar')
  await page.getByTestId('time-slider').fill('40'); const later = await num('co2-sofar')
  expect(later, 'the counter rises as the test runs').toBeGreaterThan(early)
  await page.getByTestId('chip-st-lfp').click(); const lfp = await num('co2-outage')
  await page.getByTestId('chip-st-h2').click(); const h2 = await num('co2-outage')
  await page.getByTestId('chip-st-none').click(); const none = await num('co2-outage')
  expect(h2, 'hydrogen avoids more diesel in a 36 h outage').toBeGreaterThan(lfp)
  expect(none, 'without storage only daytime solar helps: less avoided than with a battery').toBeLessThan(lfp)
  await page.getByTestId('chip-st-lfp').click()
  await page.waitForTimeout(1200)
  await shot(page, '14-co2-saver')
  expect(errors, errors.join('\n')).toEqual([])
})

for (const sz of [{ w: 1920, h: 1000 }, { w: 1366, h: 768 }, { w: 390, h: 844 }]) {
  test(`configurator lays out cleanly at ${sz.w}×${sz.h}`, async ({ page }) => {
    await page.setViewportSize({ width: sz.w, height: sz.h })
    await fresh(page)
    await page.getByTestId('step-simulate').click()
    await page.waitForTimeout(1200)
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(sideways, 'page scrolls sideways').toBeLessThanOrEqual(1)
    if (sz.w > 900) expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1), 'must fit one screen').toBe(true)
    await shot(page, `20-layout-${sz.w}`)
  })
}
