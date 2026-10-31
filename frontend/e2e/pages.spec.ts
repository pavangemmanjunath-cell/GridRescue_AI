import { test, expect, type Page } from '@playwright/test'

// Layout check of every page at a desktop and a laptop size: no console errors, no sideways scroll,
// app-bar items do not overlap, and a full-page screenshot of each page for review.
const PAGES = ['/', '/case', '/explorer', '/facility', '/recommendation', '/compare', '/costs', '/simulation', '/learn', '/report', '/hands']
const SIZES = [{ w: 1920, h: 1000 }, { w: 1366, h: 768 }]

async function layoutOk(page: Page, path: string) {
  const r = await page.evaluate(() => {
    const doc = document.documentElement
    const brand = document.querySelector('.gr-appbar-left')?.getBoundingClientRect()
    const center = document.querySelector('.gr-appbar-center')
    const c = center && getComputedStyle(center).display !== 'none' ? center.getBoundingClientRect() : null
    const nav = document.querySelector('.gr-appbar > nav')?.getBoundingClientRect()
    return { sideways: doc.scrollWidth - window.innerWidth, brandRight: brand?.right ?? 0, centerLeft: c?.left ?? 1e9, centerRight: c?.right ?? 0, navLeft: nav?.left ?? 1e9 }
  })
  expect(r.sideways, `${path}: page scrolls sideways`).toBeLessThanOrEqual(1)
  expect(r.brandRight, `${path}: logo overlaps the site readout`).toBeLessThanOrEqual(r.centerLeft)
  expect(r.centerRight, `${path}: site readout overlaps the menu`).toBeLessThanOrEqual(r.navLeft)
}

for (const sz of SIZES) {
  test(`all pages lay out cleanly at ${sz.w}×${sz.h}`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => { if (m.type() === 'error' && !/WebGL|GPU|favicon|tile\.openstreetmap/i.test(m.text())) errors.push(m.text()) })
    await page.setViewportSize({ width: sz.w, height: sz.h })

    // a real flow first, so the result pages have data: pick the nearest hospital, grid-collapse outage, simulate
    await page.goto('/explorer?lat=12.0&lng=8.52')
    await expect(page.getByTestId('ring-100')).toContainText(/Strong|Moderate|Weak|Poor|Critical/, { timeout: 30000 })
    await page.getByTestId('hospital-list').locator('li').first().click()
    await page.getByTestId('outage-collapse').click()
    await page.getByTestId('simulate-outage').click()
    await expect(page).toHaveURL(/\/simulation/, { timeout: 120000 })

    for (const path of PAGES) {
      await page.goto(path)
      await page.waitForLoadState('networkidle').catch(() => null)
      await page.waitForTimeout(path === '/simulation' || path === '/explorer' ? 1500 : 600)
      await layoutOk(page, path)
      expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1), `${path} must fit one screen`).toBe(true)
      await page.screenshot({ path: `e2e-results/pages/${sz.w}${path === '/' ? '/home' : path}.png`, fullPage: true })
    }
    expect(errors, errors.join('\n')).toEqual([])
  })
}
