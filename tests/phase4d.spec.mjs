import { test, expect } from '@playwright/test';
import { openOcean, unlockAdmin, tab } from './helpers.mjs';

test('starter templates: 24, four per area, each with English and Filipino', async ({ page }) => {
  await openOcean(page);
  const r = await page.evaluate(() => { const o = window.__ocean, rows = o.starterTemplateRows(); const by = {}; for (const t of rows) by[t.area] = (by[t.area] || 0) + 1;
    return {n: rows.length, by, missing: rows.filter(t => !t.titleFil || !t.descFil || t.titleEn.length > 60 || t.titleFil.length > 60 || t.descEn.length > 240 || t.descFil.length > 240).length, ids: new Set(rows.map(t => t.id)).size}; });
  expect(r.n).toBe(24); expect(Object.values(r.by)).toEqual([4, 4, 4, 4, 4, 4]); expect(r.missing).toBe(0); expect(r.ids).toBe(24);
});

test('Templates tab: add, edit and hide a template (with checks)', async ({ page }) => {
  await openOcean(page);
  await unlockAdmin(page);
  await tab(page, 'templates');
  await expect(page.locator('section.tp-area .tp-item')).toHaveCount(24);
  await page.click('#tp-add');
  await page.click('#tp-save');
  await expect(page.locator('#e-titleEn')).toHaveText('Add an English title.');
  await page.fill('#tp-te', 'Opened a lunchbox'); await page.fill('#tp-de', 'I opened my lunchbox by myself.');
  await page.fill('#tp-tf', 'Nabuksan ang baunan');
  await page.click('#tp-save');
  await expect(page.locator('#e-titleFil')).toContainText('both');
  await page.fill('#tp-df', 'Ako mismo ang nagbukas ng aking baunan.');
  await page.selectOption('#tp-area', 'self_care');
  await page.click('#tp-save');
  await expect(page.locator('.tp-item', {hasText: 'Opened a lunchbox'})).toContainText('Nabuksan ang baunan');
  const item = page.locator('.tp-item', {hasText: 'Opened a lunchbox'});
  await item.locator('[data-tp=hide]').click();
  await expect(page.locator('.tp-item', {hasText: 'Opened a lunchbox'})).toHaveCount(0);
  await page.check('#tp-hidden');
  await expect(page.locator('.tp-item', {hasText: 'Opened a lunchbox'})).toContainText('Hidden');
  const audit = await page.evaluate(() => window.__ocean.A.data.audit.map(a => a.action));
  expect(audit).toEqual(expect.arrayContaining(['template.created', 'template.hidden']));
});

test('Award stars: a template fills the form in English or Filipino and tags the goal area', async ({ page }) => {
  await openOcean(page);
  await unlockAdmin(page);
  await tab(page, 'award');
  const tpl = await page.evaluate(() => window.__ocean.A.data.templates.find(t => t.titleEn === 'Caught a ball').id);
  await page.check('input[name=aw-lang][value=fil]', {force: true});
  await page.selectOption('#aw-tpl', tpl);
  await expect(page.locator('#aw-title')).toHaveValue('Nasalo ang bola');
  await expect(page.locator('#aw-desc')).toHaveValue('Nasalo ko ang bola gamit ang dalawang kamay.');
  await expect(page.locator('#aw-area')).toHaveValue('gross_motor');
  await page.check('input[name=aw-lang][value=en]', {force: true});
  await expect(page.locator('#aw-title')).toHaveValue('Caught a ball');
  await page.click('#aw-save');
  await page.locator('#dn-again').waitFor();
  const a = await page.evaluate(() => window.__ocean.A.data.achievements.find(x => x.title === 'Caught a ball'));
  expect(a.goalArea).toBe('gross_motor'); expect(a.units).toBe(2);
});

test('goal areas: editable in History, kept through a star correction, summed in Progress', async ({ page }) => {
  await openOcean(page);
  await unlockAdmin(page);
  const tala = await page.evaluate(() => window.__ocean.A.data.fish.find(f => f.nickname === 'Tala').id);
  await tab(page, 'history');
  await page.selectOption('#hx-fish', tala); await page.waitForTimeout(200);
  const first = page.locator('[data-led=edit]').first();
  const achId = await first.getAttribute('data-id');
  await first.click();
  await page.selectOption('#cx-area', 'self_care');
  await page.fill('#cx-reason', 'Tagging for the progress note');
  await page.click('#cx-save');
  await page.waitForFunction(id => window.__ocean.A.data.achievements.find(a => a.id === id).goalArea === 'self_care', achId);
  // A star-size correction keeps the area on the replacement row.
  await page.evaluate(async id => { const s = window.__ocean.store, a = window.__ocean.A.data.achievements.find(x => x.id === id); await s.changePoints(id, a.units === 2 ? 1 : 2, 'size fix'); }, achId);
  await page.waitForFunction(id => window.__ocean.A.data.achievements.some(a => a.correctionOf === id && a.goalArea === 'self_care'), achId);
  const rows = await page.evaluate(id => window.__ocean.areaProgress(id), tala);
  const sc = rows.find(r => r.area === 'self_care');
  expect(sc.all).toBeGreaterThan(0);
  await tab(page, 'fish');
  await page.click(`[data-act=progress][data-id="${tala}"]`);
  await expect(page.locator('.prog-table')).toContainText('Self-care');
  await expect(page.locator('#pg-text')).toContainText('Tala: Level');
});

test('quick award: PIN, tap a template, tap Give star (and a double tap counts once)', async ({ page }) => {
  await openOcean(page);
  await unlockAdmin(page);
  await page.click('#adm-lock');
  await page.evaluate(() => { location.hash = '#aquarium'; });
  const before = await page.evaluate(() => window.__ocean.allFish.find(p => p.nickname === 'Pip').lifetimeUnits);
  await page.evaluate(() => { const o = window.__ocean; o.openProfile(o.fish.find(f => f.data.nick === 'Pip')); });
  await page.click('#p-give');
  await page.fill('#wp-pin', '2468'); await page.click('#wp-f button[type=submit]');
  await page.click('.qa-areas [data-a=gross_motor]');                                    // optional filter
  await expect(page.locator('.qa-item')).toHaveCount(4);
  await page.click('[data-l=fil]');
  await expect(page.locator('.qa-list')).toContainText('Nasalo ang bola');
  await page.click('[data-l=en]');
  await page.click('.qa-item:has-text("Caught a ball")');                                // tap 1
  await page.locator('#qa-go').dblclick();                                               // tap 2 (twice, on purpose)
  await page.waitForFunction(b => window.__ocean.allFish.find(p => p.nickname === 'Pip').lifetimeUnits === b + 2, before);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__ocean.allFish.find(p => p.nickname === 'Pip').lifetimeUnits)).toBe(before + 2);
  await expect(page.locator('#dlg')).toBeHidden();
});

test('quick award is for staff only: not shown to families or without edit rights', async ({ page }) => {
  await openOcean(page, '#f/' + 'b'.repeat(64), {wait: false});
  expect(await page.evaluate(() => window.__ocean.familyMode)).toBe(true);
  await expect(page.locator('#p-give')).toBeHidden();
});
