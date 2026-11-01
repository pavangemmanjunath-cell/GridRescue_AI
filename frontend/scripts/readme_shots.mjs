// Captures the README screenshots with Playwright: every lens, the plan, the ESG report and each simulation type, at
// 1600×900 as JPEG, into <repo>/assets/readme/. Needs the backend on :8000 and the dev server on :5173.
// Usage (from the frontend folder):  node scripts/readme_shots.mjs     (E2E_BASE_URL for another app URL, SHOTS_GPU=0 for software rendering)
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(join(process.cwd(), 'package.json'))
const { chromium } = require('@playwright/test')
const base = process.env.E2E_BASE_URL || 'http://localhost:5173'
const out = resolve(process.cwd(), '..', 'assets', 'readme'); mkdirSync(out, { recursive: true })
// SHOTS_GPU=0 renders in software (slower, but leaves the GPU free for other work)
const gpuArgs = process.env.SHOTS_GPU === '0' ? ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist']
const browser = await chromium.launch({ args: gpuArgs })
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, acceptDownloads: true })
const page = await ctx.newPage()
const tid = (id) => page.getByTestId(id)
const sleep = (s) => page.waitForTimeout(s * 1000)
const settle = async () => { await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {}); await page.waitForFunction(() => [...document.querySelectorAll('img.leaflet-tile')].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 15000 }).catch(() => {}) }
const shot = async (name) => { await page.screenshot({ path: join(out, name + '.jpg'), type: 'jpeg', quality: 82 }); console.log('saved', name) }

// Home
await page.goto(base + '/'); await tid('home-case').waitFor(); await settle(); await sleep(1); await shot('01_home_aaa')

// Explorer · the Enugu worked example: sun, wind, water lenses and the grid scan
await tid('cta-case').click(); await tid('ring-100').waitFor({ timeout: 60000 }); await settle(); await sleep(2)
await tid('mode-sun').click(); await sleep(2); await shot('02_lens_sun_grid_scan')
await tid('mode-wind').click(); await settle(); await sleep(2); await shot('03_lens_wind')
await tid('mode-water').click(); await settle(); await sleep(2); await shot('04_lens_water')
await tid('mode-sun').click(); await sleep(1)
if ((await tid('lens-newsite').getAttribute('aria-pressed')) !== 'true') await tid('lens-newsite').click()
await tid('newsite-suggestions').locator('li').first().waitFor({ timeout: 60000 }); await tid('newsite-suggestions').locator('li').first().click()
if ((await tid('lock-btn').getAttribute('aria-pressed')) !== 'true') await tid('lock-btn').click()
await settle(); await sleep(2); await shot('05_new_site_lens_locked')

// The relocation plan
await tid('open-plan').click(); await page.waitForURL(/\/case/, { timeout: 180000 }); await tid('answer-q1').waitFor(); await settle(); await sleep(1.5); await shot('06_plan_five_questions')
await tid('tab-sites').click(); await settle(); await sleep(2); await shot('07_two_sites_grid_lens')
await tid('tab-energy').click(); await sleep(1.5); await shot('08_energy_type_compared')
await tid('tab-impact').click(); await sleep(1); await tid('carbon-price').fill('15'); await tid('esg').scrollIntoViewIfNeeded(); await sleep(1); await shot('09_impact_esg')
// the downloaded ESG report, opened like a board member would
const [dl] = await Promise.all([page.waitForEvent('download'), tid('esg-download').click()])
const html = readFileSync(await dl.path(), 'utf8'); const f = join(out, '_esg.html'); writeFileSync(f, html)
const v = await ctx.newPage(); await v.setViewportSize({ width: 1100, height: 1400 }); await v.goto(pathToFileURL(f).href); await sleep(0.5)
await v.screenshot({ path: join(out, '10_esg_report.jpg'), type: 'jpeg', quality: 82, fullPage: true }); await v.close(); console.log('saved 10_esg_report')
const { unlinkSync } = await import('node:fs'); unlinkSync(f)

// Simulation type 1 · the hospital's own 3D site through the overnight outage, then the 24 h national grid collapse
await tid('case-to-sim').click(); await page.waitForURL(/\/simulation/); await tid('sim-site-name').waitFor({ timeout: 60000 }); await settle(); await sleep(2)
await tid('time-slider').fill('20'); await sleep(2); await shot('11_sim_hospital_overnight_outage')
await tid('outage-select').selectOption('collapse'); await page.locator('.gr-sim3-ctl .gr-spin').waitFor({ state: 'detached', timeout: 60000 }).catch(() => {})
await tid('time-slider').fill('9'); await sleep(2); await shot('12_sim_national_grid_collapse_24h')

// Simulation type 2 · Build 3D: the hospital use case (72-hour test) and the night rail crew
await page.goto(base + '/explorer?lat=6.4684&lng=7.5256'); await tid('ring-100').waitFor({ timeout: 60000 })
if ((await tid('moving-toggle').getAttribute('aria-pressed')) === 'true') await tid('moving-toggle').click()
await tid('build-3d').click(); await tid('build-page').waitFor(); await page.locator('[data-testid="build-canvas"] canvas').waitFor({ timeout: 30000 })
await tid('usecase-select').selectOption('health'); await tid('step-simulate').click(); await sleep(1)
if (await tid('sim-drawer').isVisible().catch(() => false)) { await tid('drawer-close').click(); await sleep(0.6) }
await tid('time-slider').fill('20'); await sleep(1.5); await shot('13_build3d_hospital_outage_test')
await tid('drawer-toggle').click(); await sleep(1.5); await shot('14_build3d_simulation_graphs'); await tid('drawer-close').click(); await sleep(0.6)
await tid('usecase-select').selectOption('markets'); await tid('preset-select').selectOption('rail'); await tid('step-simulate').click(); await sleep(0.8)
await tid('scenario-nights3').click().catch(() => {}); await sleep(0.6)
if (await tid('sim-drawer').isVisible().catch(() => false)) { await tid('drawer-close').click(); await sleep(0.6) }
await tid('time-slider').fill('23.5'); await sleep(2); await shot('15_build3d_rail_crew_night_shift')

await browser.close()
console.log('done →', out)
