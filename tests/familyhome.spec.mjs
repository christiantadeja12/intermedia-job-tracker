import { test, expect } from '@playwright/test';
import { openOcean, unlockAdmin, tab } from './helpers.mjs';

test('family house: therapist picks house and fence; saved per child; each family view shows its own', async ({ page }) => {
  await openOcean(page);
  await unlockAdmin(page);
  await tab(page, 'fish');
  const ids = await page.evaluate(() => Object.fromEntries(window.__ocean.A.data.fish.map(f => [f.nickname, f.id])));
  await page.click(`[data-act=fhouse][data-id="${ids.Tala}"]`);
  await expect(page.locator('#fh-prev')).toBeVisible();
  await page.check('input[name=fh-house][value=shell]', {force: true});
  await page.check('input[name=fh-fence][value=healthy]', {force: true});
  await page.click('#fh-save');
  await expect(page.locator('#dlg')).toBeHidden();
  const r = await page.evaluate(async ({tala, pip}) => {
    const s = window.__ocean.store, t1 = await s.createFamilyLink(tala), t2 = await s.createFamilyLink(pip);
    await s.setFamilyHome(pip, 'cabin', 'rigid');
    return {talaHome: (await s.familyView(t1)).home, pipHome: (await s.familyView(t2)).home, talaSaved: await s.getFamilyHome(tala)};
  }, {tala: ids.Tala, pip: ids.Pip});
  expect(r.talaHome).toEqual({house: 'shell', fence: 'healthy'});
  expect(r.pipHome).toEqual({house: 'cabin', fence: 'rigid'});
  expect(r.talaSaved).toEqual({house: 'shell', fence: 'healthy'});
});

test('family house: a new family gets the default cottage with no fence; all three fences paint differently', async ({ page }) => {
  await openOcean(page);
  const r = await page.evaluate(async () => {
    const o = window.__ocean, s = o.store, tala = o.allFish.find(p => p.nickname === 'Tala').id;
    const v = await s.familyView(await s.createFamilyLink(tala));
    const px = fence => { const c = document.createElement('canvas'); c.width = 300; c.height = 186; o.paintHome(c.getContext('2d'), 'cottage', fence, 300, 186); return c.toDataURL(); };
    return {home: v.home, porous: px('porous'), rigid: px('rigid'), healthy: px('healthy'), none: px(null), houses: Object.keys(o.HOUSES).length};
  });
  expect(r.home).toEqual({house: 'cottage', fence: null});
  expect(new Set([r.porous, r.rigid, r.healthy, r.none]).size).toBe(4);
  expect(r.houses).toBeGreaterThanOrEqual(4);
});

test('family bubbles: therapist sets size and colour; saved per child; bad values are cleaned; labels follow the language', async ({ page }) => {
  await openOcean(page);
  await unlockAdmin(page);
  await tab(page, 'fish');
  const ids = await page.evaluate(() => Object.fromEntries(window.__ocean.A.data.fish.map(f => [f.nickname, f.id])));
  await page.click(`[data-act=fhouse][data-id="${ids.Tala}"]`);
  await page.fill('#fh-sz-person', '5');
  await page.fill('#fh-sz-occupation', '1');
  await page.locator('#fh-col-environment').evaluate(el => { el.value = '#ff8800'; el.dispatchEvent(new Event('input', {bubbles: true})); });
  await page.click('#fh-save');
  await expect(page.locator('#dlg')).toBeHidden();
  const r = await page.evaluate(async ({tala, pip}) => {
    const s = window.__ocean.store, t1 = await s.createFamilyLink(tala), t2 = await s.createFamilyLink(pip);
    await s.setFamilyPeo(pip, {person: {size: 2, color: '#00ff00'}, environment: {size: 'x', color: 'bad'}, occupation: {size: 5, color: '#ABCDEF'}});
    return {tala: (await s.familyView(t1)).peo, pip: (await s.familyView(t2)).peo};
  }, {tala: ids.Tala, pip: ids.Pip});
  expect(r.tala).toEqual({person: {size: 5, color: '#7ccf8a'}, environment: {size: 3, color: '#ff8800'}, occupation: {size: 1, color: '#f4d94e'}});
  expect(r.pip).toEqual({person: {size: 2, color: '#00ff00'}, environment: {size: 3, color: '#6ab7f0'}, occupation: {size: 5, color: '#abcdef'}});
  const lang = await page.evaluate(() => [window.__ocean.tr('peo.person'), window.__ocean.tr('peo.environment'), window.__ocean.tr('peo.occupation')]);
  expect(lang).toEqual(['Person', 'Environment', 'Occupation']);
});
