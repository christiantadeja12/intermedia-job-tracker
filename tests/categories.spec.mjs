import { test, expect } from '@playwright/test';
import { openOcean, unlockAdmin, tab } from './helpers.mjs';

const cat = (page, name) => page.locator('#cat .tp-item', {hasText: name});

test('categories: starts with the six areas, add one with checks, use it for a template', async ({ page }) => {
  await openOcean(page);
  await unlockAdmin(page);
  await tab(page, 'templates');
  await expect(page.locator('#cat .tp-item')).toHaveCount(6);
  await expect(cat(page, 'Fine motor')).toContainText('Pinong galaw');
  await expect(cat(page, 'Fine motor')).toContainText('4 templates');
  await page.click('#cat-add');
  await page.click('#cat-save');
  await expect(page.locator('#e-nameEn')).toHaveText('Add an English name.');
  await page.fill('#cat-en', 'fine MOTOR');
  await page.click('#cat-save');
  await expect(page.locator('#e-nameEn')).toHaveText('Another category already uses this name.');
  await page.fill('#cat-en', 'Feeding'); await page.fill('#cat-fil', 'Pagkain');
  await page.click('#cat-save');
  await expect(cat(page, 'Feeding')).toContainText('Pagkain');
  await expect(cat(page, 'Feeding')).toContainText('0 templates');
  // The new category is in the template form, the award form and the History edit.
  await page.click('#tp-add');
  const feeding = await page.locator('#tp-area option', {hasText: 'Feeding'}).getAttribute('value');
  expect(feeding).toMatch(/^ga_[a-z0-9]+$/);
  await page.fill('#tp-te', 'Used a spoon'); await page.fill('#tp-de', 'I ate with a spoon by myself.');
  await page.selectOption('#tp-area', feeding);
  await page.click('#tp-save');
  await expect(page.locator('section.tp-area', {hasText: 'Used a spoon'}).locator('h3')).toHaveText('Feeding');
  await tab(page, 'award');
  await expect(page.locator('#aw-area option', {hasText: 'Feeding'})).toHaveCount(1);
  const audit = await page.evaluate(() => window.__ocean.A.data.audit.map(a => a.action));
  expect(audit).toContain('category.created');
});

test('categories: rename in English and Filipino changes the name everywhere, tags stay', async ({ page }) => {
  await openOcean(page);
  await unlockAdmin(page);
  await tab(page, 'award');
  const tpl = await page.evaluate(() => window.__ocean.A.data.templates.find(t => t.titleEn === 'Caught a ball').id);
  await page.selectOption('#aw-tpl', tpl);
  await page.click('#aw-save');
  await page.locator('#dn-again').waitFor();
  await tab(page, 'templates');
  await cat(page, 'Gross motor').locator('[data-cat=edit]').click();
  await page.fill('#cat-en', 'Big movements'); await page.fill('#cat-fil', 'Malalaking kilos');
  await page.click('#cat-save');
  await expect(cat(page, 'Big movements')).toContainText('Malalaking kilos');
  await expect(page.locator('section.tp-area h3', {hasText: 'Big movements'})).toHaveCount(1);
  const r = await page.evaluate(() => { const o = window.__ocean, a = o.A.data.achievements.find(x => x.title === 'Caught a ball' && x.status === 'active');
    return {area: a.goalArea, name: o.AREAS.gross_motor}; });
  expect(r).toEqual({area: 'gross_motor', name: 'Big movements'});
  await tab(page, 'history');
  await expect(page.locator('.pill.area', {hasText: 'Big movements'}).first()).toBeVisible();
  const audit = await page.evaluate(() => window.__ocean.A.data.audit.find(a => a.action === 'category.renamed'));
  expect(audit.summary).toBe('Renamed category Gross motor to Big movements');
});

test('categories: hiding leaves the pickers but keeps stars and templates; restore brings it back', async ({ page }) => {
  await openOcean(page);
  await unlockAdmin(page);
  await tab(page, 'award');
  const tpl = await page.evaluate(() => window.__ocean.A.data.templates.find(t => t.titleEn === 'Caught a ball').id);
  await page.selectOption('#aw-tpl', tpl);
  await page.click('#aw-save');
  await page.locator('#dn-again').waitFor();
  await tab(page, 'templates');
  await cat(page, 'Gross motor').locator('[data-cat=hide]').click();
  await expect(cat(page, 'Gross motor')).toHaveCount(0);
  await expect(page.locator('.tp-item', {hasText: 'Caught a ball'})).toHaveCount(0);
  await tab(page, 'award');
  await expect(page.locator('#aw-area option', {hasText: 'Gross motor'})).toHaveCount(0);
  await expect(page.locator('#aw-tpl option', {hasText: 'Caught a ball'})).toHaveCount(0);
  // The star keeps its tag and still shows the name; Progress still counts it.
  const r = await page.evaluate(() => { const o = window.__ocean, a = o.A.data.achievements.find(x => x.title === 'Caught a ball' && x.status === 'active');
    return {area: a.goalArea, row: o.areaProgress(a.fishId).find(x => x.area === 'gross_motor')}; });
  expect(r.area).toBe('gross_motor'); expect(r.row.label).toBe('Gross motor (hidden)'); expect(r.row.all).toBeGreaterThan(0);
  await tab(page, 'history');
  await expect(page.locator('.pill.area', {hasText: 'Gross motor'}).first()).toBeVisible();
  // Quick award leaves the hidden category out.
  await page.click('#adm-lock');
  await page.evaluate(() => { location.hash = '#aquarium'; });
  await page.evaluate(() => { const o = window.__ocean; o.openProfile(o.fish.find(f => f.data.nick === 'Pip')); });
  await page.click('#p-give');
  await page.fill('#wp-pin', '2468'); await page.click('#wp-f button[type=submit]');
  await expect(page.locator('.qa-areas [data-a=gross_motor]')).toHaveCount(0);
  await expect(page.locator('.qa-item', {hasText: 'Caught a ball'})).toHaveCount(0);
  await expect(page.locator('.qa-areas [data-a=fine_motor]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  // Restore.
  await unlockAdmin(page);
  await tab(page, 'templates');
  await page.check('#tp-hidden');
  await expect(cat(page, 'Gross motor')).toContainText('Hidden');
  await cat(page, 'Gross motor').locator('[data-cat=show]').click();
  await page.uncheck('#tp-hidden');
  await expect(cat(page, 'Gross motor')).toHaveCount(1);
  await expect(page.locator('.tp-item', {hasText: 'Caught a ball'})).toHaveCount(1);
  const audit = await page.evaluate(() => window.__ocean.A.data.audit.map(a => a.action));
  expect(audit).toEqual(expect.arrayContaining(['category.hidden', 'category.restored']));
});

test('quick award shows category names in Filipino when Filipino is chosen', async ({ page }) => {
  await openOcean(page);
  await unlockAdmin(page);
  await page.click('#adm-lock');
  await page.evaluate(() => { location.hash = '#aquarium'; });
  await page.evaluate(() => { const o = window.__ocean; o.openProfile(o.fish.find(f => f.data.nick === 'Pip')); });
  await page.click('#p-give');
  await page.fill('#wp-pin', '2468'); await page.click('#wp-f button[type=submit]');
  await expect(page.locator('.qa-areas [data-a=fine_motor]')).toHaveText('Fine motor');
  await page.click('[data-l=fil]');
  await expect(page.locator('.qa-areas [data-a=fine_motor]')).toHaveText('Pinong galaw');
});
