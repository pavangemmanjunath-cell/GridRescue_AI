import { test, expect, type Page } from '@playwright/test'

// GUI test of the hands-free simulation (Brief 12, last page) in mouse mode: a CI browser has no webcam, so the
// pointer stands in for the hand — the same five steps, the same engine sizing, the same cards.
const shot = (page: Page, name: string) => page.screenshot({ path: `e2e-results/hands/${name}.png`, fullPage: false })

test('hands-free simulation · use case → site → consumption → place parts → outage', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error' && !/WebGL|GPU|favicon|tile\.openstreetmap|mediapipe|wasm/i.test(m.text())) errors.push(m.text()) })

  await page.goto('/')
  await expect(page).toHaveTitle(/hospital on the move/)
  await expect(page.getByTestId('home-hands')).toContainText(/Hands-free simulation/)
  await page.getByTestId('home-hands').click()
  await expect(page).toHaveURL(/\/hands/)

  // camera on → in a headless browser there is no camera; the page offers the mouse
  await page.getByTestId('camera-on').click()
  await expect(page.getByTestId('camera-status')).toContainText(/no camera|mouse mode|loading|waiting|missing/, { timeout: 30000 })
  if (!(await page.getByTestId('camera-status').textContent())?.includes('mouse mode')) await page.getByTestId('use-mouse').click()
  await expect(page.getByTestId('camera-status')).toContainText('mouse mode')
  await expect(page.getByTestId('usecase')).toHaveValue('brief12')
  await expect(page.getByTestId('usecase').locator('option')).toHaveCount(2)   // both use cases, no detail
  await shot(page, '01-use-case')

  await page.getByTestId('step-next').click()
  await expect(page.getByTestId('site-list').locator('li').first()).toContainText('Abakpa Junction', { timeout: 40000 })
  await expect(page.getByTestId('site-list').locator('li')).toHaveCount(5)   // today, new building, 3 lens areas
  await expect(page.getByTestId('gesture-scene')).toBeVisible({ timeout: 60000 })
  await page.getByTestId('site-list').locator('li').nth(1).click()
  await shot(page, '02-site')

  await page.getByTestId('step-next').click()
  await expect(page.getByTestId('band-value')).toContainText('kWh a day', { timeout: 40000 })
  await expect(page.getByTestId('consumption-chart')).toBeVisible()
  await expect(page.getByTestId('site-data')).toContainText('Sun', { timeout: 60000 })
  await expect(page.getByTestId('site-data')).toContainText(/h a day/, { timeout: 60000 })
  // the wheel is the hand's openness: it dials the band
  const before = await page.getByTestId('band-value').textContent()
  await page.mouse.move(700, 400)
  await page.mouse.wheel(0, -1200)
  await expect(page.getByTestId('band-value')).not.toHaveText(before ?? '')
  await shot(page, '03-consumption')

  await page.getByTestId('step-next').click()
  await expect(page.getByTestId('part-list').locator('li')).toHaveCount(4)
  await expect(page.getByTestId('step-next')).toBeDisabled()
  await page.getByTestId('auto-place').click()
  await expect(page.getByTestId('part-list')).toContainText('right pad')
  await expect(page.getByTestId('step-next')).toBeEnabled({ timeout: 180000 })
  await page.waitForTimeout(1500)
  await shot(page, '04-parts-placed')

  await page.getByTestId('step-next').click()
  await expect(page.getByTestId('clock')).toContainText(/grid on|no grid|outage/)
  await expect(page.getByTestId('live-powers')).toContainText('Theatres')
  await expect(page.getByTestId('site-data')).toContainText('classifier')
  await page.waitForTimeout(1200)
  await shot(page, '05-outage')

  await page.getByTestId('step-back').click()
  await expect(page.getByTestId('part-list')).toBeVisible()
  expect(errors, errors.join('\n')).toEqual([])
})
