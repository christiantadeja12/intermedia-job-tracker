import { test, expect } from '@playwright/test';
import { openOcean, unlockAdmin, tab } from './helpers.mjs';

test('comfort settings apply now and persist on this device', async ({ page }) => {
  await openOcean(page);
  await page.click('#btn-comfort');
  await expect(page.locator('#comfort-sheet')).toBeVisible();
  await page.check('input[name=cf-fx][value=off]', { force: true });
  await page.click('.sw[data-k=hc]');
  await page.click('.sw[data-k=bubbles]');
  await page.keyboard.press('Escape');
  const s = await page.evaluate(() => ({e: window.__ocean.state.effects, hc: document.documentElement.classList.contains('hc'), b: window.__ocean.state.bubbles}));
  expect(s).toEqual({e: 'off', hc: true, b: false});
  await page.reload();
  await page.waitForFunction(() => window.__ocean && window.__ocean.allFish.length === 8);
  expect(await page.evaluate(() => [window.__ocean.state.effects, window.__ocean.state.hc, window.__ocean.state.bubbles])).toEqual(['off', true, false]);
});

test('effects Off stops seasonal particles', async ({ page }) => {
  await openOcean(page);
  await page.evaluate(() => { window.__ocean.setPref('effects', 'off'); });
  await unlockAdmin(page);
  await tab(page, 'themes');
  await page.click('[data-pv=newyear]');
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => window.__ocean.tparts.length)).toBe(0);
  await page.evaluate(() => window.__ocean.setPref('effects', 'full'));
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => window.__ocean.tparts.length)).toBeGreaterThan(0);
});

test('therapist defaults apply until a device chooses its own', async ({ page }) => {
  await openOcean(page);
  await unlockAdmin(page);
  await tab(page, 'settings');
  await page.check('input[name=st-fx][value=gentle]', { force: true });
  await page.uncheck('#st-names');
  await page.click('#st-save');
  await expect(page.locator('#st-ok')).toBeVisible();
  expect(await page.evaluate(() => [window.__ocean.state.effects, window.__ocean.state.names])).toEqual(['gentle', false]);
  await page.evaluate(() => window.__ocean.setPref('names', true));
  expect(await page.evaluate(() => window.__ocean.state.names)).toBe(true);
});

test('every button and form control has an accessible name', async ({ page }) => {
  await openOcean(page);
  const missing = async () => page.evaluate(() => [...document.querySelectorAll('button, input:not([type=hidden]), select, textarea, a[href]')]
    .filter(el => el.offsetParent !== null)
    .filter(el => { const lab = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || (el.labels && el.labels.length) || (el.textContent || '').trim(); return !lab; })
    .map(el => el.outerHTML.slice(0, 90)));
  expect(await missing()).toEqual([]);
  await page.click('#btn-comfort');
  expect(await missing()).toEqual([]);
  await page.keyboard.press('Escape');
  await unlockAdmin(page);
  for (const t of ['overview', 'fish', 'award', 'history', 'audit', 'themes', 'settings']){ await tab(page, t); expect(await missing(), t).toEqual([]); }
});

test('no sideways scrolling in the aquarium or any therapist screen', async ({ page }) => {
  await openOcean(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await unlockAdmin(page);
  for (const t of ['overview', 'fish', 'award', 'history', 'audit', 'themes', 'settings']){
    await tab(page, t);
    expect(await page.evaluate(() => document.getElementById('admin').scrollWidth <= innerWidth), t).toBe(true);
  }
});

test('sample data can be removed after typing REMOVE', async ({ page }) => {
  await openOcean(page);
  await unlockAdmin(page);
  await tab(page, 'settings');
  await page.click('#sd-rm');
  await expect(page.locator('#sd-go')).toBeDisabled();
  await page.fill('#sd-type', 'REMOVE');
  await page.click('#sd-go');
  await page.waitForFunction(() => window.__ocean.fish.length === 0, null, { timeout: 30_000 });
  const left = await page.evaluate(() => Object.keys(window.__ocean.store.db._dump()).filter(k => /_s\d/.test(k) && !k.startsWith('audit/')));
  expect(left).toEqual([]);
  expect(await page.evaluate(() => window.__ocean.A.data.audit.some(a => a.action === 'sample.removed'))).toBe(true);
});
