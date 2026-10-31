import { test, expect, type Page } from '@playwright/test'

// GUI tests of the ML model, Ask GridRescue (retrieval over the internal knowledge base) and the assessment history.
// The ML model must answer for the configuration on screen, change when the configuration changes in the way the
// engine would, and be checked against the hourly simulation on the Advisor page.
const OUT = 'e2e-results/ml-ask'
const shot = (page: Page, name: string) => page.screenshot({ path: `${OUT}/${name}.png` })
const pct = async (page: Page, testid: string) => parseInt(((await page.getByTestId(testid).textContent()) ?? '0').replace(/[^0-9]/g, ''), 10)
/** Probability (%) the live card gives to the families that keep a generator. */
async function genShare(page: Page) {
  const rows = page.getByTestId('ml-live-probs').locator('.gr-ml-prob')
  let s = 0
  for (let i = 0; i < await rows.count(); i++) {
    const t = (await rows.nth(i).textContent()) ?? ''
    if (/generator/i.test(t)) s += parseInt(t.replace(/.*?(\d+)%\s*$/, '$1'), 10)
  }
  return s
}

test('Facility page · the ML pick follows the configuration live', async ({ page }) => {
  await page.goto('/explorer?lat=9.0765&lng=7.3986')                  // Abuja
  await expect(page.getByTestId('place-name')).not.toHaveText(/Resolving|^$/, { timeout: 30000 })
  await page.goto('/facility')
  const card = page.getByTestId('ml-live')
  await expect(card).toBeVisible()
  await expect(page.getByTestId('ml-live-family')).toBeVisible({ timeout: 60000 })
  await expect(card).toContainText('Random Forest')
  await expect(page.getByTestId('ml-live-probs').locator('.gr-ml-prob')).toHaveCount(3)
  await expect(page.getByTestId('ml-live-accuracy')).toContainText(/% right on [\d,]+ unseen sites/)
  const conf = await pct(page, 'ml-live-confidence')
  expect(conf).toBeGreaterThan(20); expect(conf).toBeLessThanOrEqual(100)
  await shot(page, '01-facility-ml-live')

  // a longer outage (3 days) needs more energy: the generator families gain probability (as in the engine)
  await page.getByTestId('backup-hours').locator('button', { hasText: '12 h' }).click()
  await expect(card).not.toContainText('updating', { timeout: 30000 }); await page.waitForTimeout(800)
  const at12 = await genShare(page)
  await page.getByTestId('backup-hours').locator('button', { hasText: '3 days' }).click()
  await expect(card).not.toContainText('updating', { timeout: 30000 }); await page.waitForTimeout(800)
  const at72 = await genShare(page)
  expect(at72, `generator share 12 h ${at12} % → 3 days ${at72} %`).toBeGreaterThan(at12)
  await expect(page.getByTestId('ml-live-family')).toContainText(/generator/i)
  await shot(page, '02-facility-ml-72h')

  // a different kind of infrastructure is a different input
  await page.getByTestId('facility-type').selectOption('telecom_tower').catch(() => {})
  await expect(card).not.toContainText('updating', { timeout: 30000 })
  await expect(page.getByTestId('ml-live-family')).toBeVisible()
})

test('Advisor page · the ML pick sits beside the recommendation and is checked by the simulation', async ({ page }) => {
  await page.goto('/explorer?lat=9.0765&lng=7.3986')
  await expect(page.getByTestId('ring-100')).toContainText(/Strong|Moderate|Weak|Poor|Critical/, { timeout: 60000 })
  await page.goto('/facility')
  await page.getByTestId('run-assessment').click()
  await expect(page).toHaveURL(/\/recommendation/, { timeout: 120000 })
  const card = page.getByTestId('ml-card')
  await expect(card).toBeVisible()
  await expect(card).toContainText('ML pick')
  await expect(page.getByTestId('ml-card-family')).not.toBeEmpty()
  await expect(page.getByTestId('ml-card-verdict')).toContainText(/hourly simulation (agrees|picks)/)
  await expect(page.getByTestId('recommended-name')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1), 'Advisor stays one screen').toBe(true)
  await shot(page, '03-advisor-ml')
  // the agent tab explains the classify → verify steps
  await page.getByTestId('tab-agent').click()
  await expect(page.getByTestId('agent-step-classify')).toContainText(/Random Forest/)
  // the Simulate page names the ML pick too
  await page.goto('/simulation')
  await expect(page.getByTestId('sim-ml')).toContainText(/ML pick \(Random Forest\)/, { timeout: 60000 })
  // and the assessment is now in the history
  await page.goto('/report')
  await page.getByTestId('tab-history').click()
  await expect(page.getByTestId('history-row').first()).toBeVisible()
  await expect(page.getByTestId('history')).toContainText(/Abuja|Federal Capital/)
  await shot(page, '04-report-history')
})

test('Ask GridRescue · answers from the internal knowledge base with numbered sources', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('ask-open').click()
  const panel = page.getByTestId('ask-panel')
  await expect(panel).toBeVisible()
  await expect(page.getByTestId('ask-foot')).toContainText(/\d+ passages · SQLite FTS5/)
  await expect(page.getByTestId('ask-foot')).toContainText('no AI language model is used yet')
  // a suggested question
  await page.getByTestId('ask-suggest').getByRole('button', { name: /select the energy system/ }).click()
  await expect(page.getByTestId('ask-answer')).toContainText(/nine candidate architectures|hour by hour/, { timeout: 30000 })
  await expect(page.getByTestId('ask-answer').locator('.gr-ask-cite').first()).toBeVisible()
  await expect(page.getByTestId('ask-sources').locator('li').first()).toContainText(/selects the energy system/)
  await shot(page, '05-ask-method')
  // a typed question
  await page.getByTestId('ask-new').click()
  await page.getByTestId('ask-input').fill('Which ML algorithm is used and how accurate is it?')
  await page.getByTestId('ask-submit').click()
  await expect(page.getByTestId('ask-answer')).toContainText(/Random Forest/, { timeout: 30000 })
  await expect(page.getByTestId('ask-answer')).toContainText(/% correct/)
  await shot(page, '06-ask-ml')
  // something it does not know → it says so
  await page.getByTestId('ask-new').click()
  await page.getByTestId('ask-input').fill('qqqq zzzz')
  await page.getByTestId('ask-submit').click()
  await expect(page.getByTestId('ask-answer')).toContainText(/could not find this/)
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
})

test('Ask GridRescue · questions about my own site cite my assessment first', async ({ page }) => {
  await page.goto('/explorer?lat=9.0765&lng=7.3986')
  await expect(page.getByTestId('ring-100')).toContainText(/Strong|Moderate|Weak|Poor|Critical/, { timeout: 60000 })
  await page.goto('/facility')
  await page.getByTestId('run-assessment').click()
  await expect(page).toHaveURL(/\/recommendation/, { timeout: 120000 })
  await page.getByTestId('ask-open').click()
  await expect(page.getByTestId('ask-use-site')).toBeChecked()
  await page.getByTestId('ask-input').fill('How much CO2 does this site avoid?')
  await page.getByTestId('ask-submit').click()
  await expect(page.getByTestId('ask-sources').locator('li').first()).toContainText('Your assessment', { timeout: 30000 })
  await expect(page.getByTestId('ask-answer')).toContainText(/t CO₂/)
  await shot(page, '07-ask-my-site')
})
