import { test, expect } from '@playwright/test'

// Regression: the grid-scan radar sweep must sit on the pin (where the lens is) and span the ring being scanned,
// even after the map has been panned so the pin is no longer in the middle of the view.
test('the scan sweep follows the pin, not the middle of the map', async ({ page }) => {
  await page.goto('/explorer?lat=8.28&lng=13.25')
  await page.route('**/api/grid/scan**', async (r) => { await new Promise((x) => setTimeout(x, 5000)); await r.continue() })   // keep the scan running
  await page.waitForTimeout(2000)
  const box = (await page.locator('.leaflet-container').boundingBox())!
  // pan the map, then drop the pin away from the centre
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 - 250, box.y + box.height / 2 + 60, { steps: 10 }); await page.mouse.up()
  await page.mouse.click(box.x + 260, box.y + 380)
  await page.locator('[data-testid=scan-sweep] .gr-scan-ring').waitFor({ state: 'attached', timeout: 15000 })
  await page.waitForTimeout(800)   // let the sweep glide onto the pin
  const r = await page.evaluate(() => {
    const ring = document.querySelector('[data-testid=scan-sweep] .gr-scan-ring')!.getBoundingClientRect()
    const pin = document.querySelector('.leaflet-marker-icon')!.getBoundingClientRect()
    const lens = document.querySelector('[data-testid=lens]')!.getBoundingClientRect()
    return { ring: { x: ring.x + ring.width / 2, y: ring.y + ring.height / 2, w: ring.width }, pin: { x: pin.x + pin.width / 2, y: pin.y + pin.height / 2 }, lens: { x: lens.x + lens.width / 2, y: lens.y + lens.height / 2 } }
  })
  expect(Math.abs(r.ring.x - r.pin.x), 'sweep centre vs pin (x)').toBeLessThan(4)
  expect(Math.abs(r.ring.y - r.pin.y), 'sweep centre vs pin (y)').toBeLessThan(4)
  expect(Math.abs(r.lens.x - r.pin.x), 'lens centre vs pin (x)').toBeLessThan(4)
  expect(r.ring.w, 'sweep spans the 50 km ring, not a fixed size').not.toBe(420)
})
