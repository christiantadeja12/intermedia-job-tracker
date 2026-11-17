import { test, expect } from '@playwright/test';
import { openOcean, unlockAdmin, tab } from './helpers.mjs';

test('family link: made once with consent, shows a link and a QR code', async ({ page }) => {
  await openOcean(page);
  await unlockAdmin(page);
  await tab(page, 'fish');
  const tala = await page.evaluate(() => window.__ocean.A.data.fish.find(f => f.nickname === 'Tala').id);
  await page.click(`[data-act=flink][data-id="${tala}"]`);
  await expect(page.locator('#fl-make')).toBeDisabled();           // consent first
  await page.check('#fl-ok');
  await page.click('#fl-make');
  const url = await page.locator('#fl-url').inputValue();
  expect(url).toMatch(/^https:\/\/ocean\.test\/#f\/[0-9a-f]{64}$/);
  await page.waitForFunction(() => document.querySelector('#fl-qr').width > 100);  // QR code drawn
  await page.click('[data-close]');
  await page.click(`[data-act=flink][data-id="${tala}"]`);
  await expect(page.locator('#dlg-body')).toContainText('A family link is turned on');
  await expect(page.locator('#fl-url')).toHaveCount(0);           // never shown again
});

test('family link: only that child, only when milestones are switched on; new link and turning off stop old ones', async ({ page }) => {
  await openOcean(page);
  const r = await page.evaluate(async () => {
    const o = window.__ocean, s = o.store, fish = await s.all ? null : null;
    const pubs = o.allFish, tala = pubs.find(p => p.nickname === 'Tala').id;
    const t1 = (await s.createFamilyLink(tala)).token, v1 = await s.familyView(t1);
    const t2 = (await s.createFamilyLink(tala)).token, oldAfterNew = await s.familyView(t1), v2 = await s.familyView(t2);
    await s.revokeFamilyLink(tala); const afterOff = await s.familyView(t2);
    const achs = o.A.data.achievements.length ? o.A.data.achievements : (await s.byFish('achievements', tala));
    return {nick: v1.fish.nickname, ids: [...new Set([v1.fish.id])], items: v1.items, json: JSON.stringify(v1), oldAfterNew, v2ok: !!v2, afterOff,
      approved: achs.filter(a => a.fishId === tala && a.status === 'active').length,
      hidden: [], garbage: await s.familyView('nope')};
  });
  expect(r.nick).toBe('Tala');
  expect(r.items.filter(i => i.type === 'a').length).toBe(r.approved);
  for (const t of r.hidden) expect(r.json).not.toContain(t);
  expect(r.json).not.toMatch(/privateNote|Fictional note|Sample client|label/);
  expect(r.oldAfterNew).toBeNull(); expect(r.v2ok).toBe(true); expect(r.afterOff).toBeNull(); expect(r.garbage).toBeNull();
});

test('family page: an old or wrong link says so kindly and shows no fish', async ({ page }) => {
  await openOcean(page, '#f/' + 'a'.repeat(64), {wait: false});
  await expect(page.locator('#tank-note-h')).toHaveText('This link doesn’t work any more');
  await expect(page.locator('#tank-note-p')).toContainText('Ask your child’s therapist');
  expect(await page.evaluate(() => [window.__ocean.familyMode, window.__ocean.fish.length])).toEqual([true, 0]);
  await expect(page.locator('#btn-admin')).toBeHidden();
  await expect(page.locator('#btn-focus')).toBeHidden();
});

test('evolution certificate: a 1080×1350 picture for evolved fish, in the chosen language', async ({ page }) => {
  await openOcean(page);
  await page.evaluate(() => { const o = window.__ocean; o.openProfile(o.fish.find(f => f.data.nick === 'Pip')); });   // level 1
  await expect(page.locator('#p-cert')).toBeHidden();
  await page.click('#p-close');
  await page.evaluate(() => { const o = window.__ocean; o.openProfile(o.fish.find(f => f.data.nick === 'Ziggy')); }); // level 5
  await expect(page.locator('#p-cert')).toBeVisible();
  await page.click('#p-cert');
  await expect(page.locator('#cert-img')).toBeVisible();
  const size = await page.locator('#cert-img').evaluate(img => [img.naturalWidth, img.naturalHeight]);
  expect(size).toEqual([1080, 1350]);
  await expect(page.locator('#cert-img')).toHaveAttribute('alt', /Ziggy, Level 5 · Ocean Champion/);
  await expect(page.locator('#cert-save')).toBeVisible();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#cert-save')]);
  expect(dl.suggestedFilename()).toBe('little-ocean-ziggy-level-5.png');
});

test('family link duration: a day, a week or a month; expired links stop working', async ({ page }) => {
  await openOcean(page);
  const r = await page.evaluate(async () => {
    const o = window.__ocean, s = o.store, tala = o.allFish.find(p => p.nickname === 'Tala').id, out = {};
    const days = x => Math.round((new Date(x.expiresAt) - Date.now()) / 864e5);
    for (const d of ['day', 'week', 'month']){ const l = await s.createFamilyLink(tala, d); out[d] = days(l); }
    out.bad = await s.createFamilyLink(tala, 'forever').then(() => 'allowed', () => 'refused');
    const l = await s.createFamilyLink(tala, 'week'), before = !!(await s.familyView(l.token));
    const live = (await s.db.collection('familyLinks').where('fishId', '==', tala).get()).docs.find(d => !d.data().revokedAt);
    await s.db.doc('familyLinks/' + live.id).update({expiresAt: new Date(Date.now() - 1000).toISOString()});
    out.before = before; out.after = await s.familyView(l.token);
    out.listed = (await s.familyLinks()).find(x => x.fishId === tala).expiresAt !== null;
    return out;
  });
  expect(r).toMatchObject({day: 1, week: 7, month: 30, bad: 'refused', before: true, after: null, listed: true});
});

test('family link dialog offers 1 day, 1 week or 1 month and shows when it ends', async ({ page }) => {
  await openOcean(page);
  await unlockAdmin(page);
  await tab(page, 'fish');
  const tala = await page.evaluate(() => window.__ocean.A.data.fish.find(f => f.nickname === 'Tala').id);
  await page.click(`[data-act=flink][data-id="${tala}"]`);
  expect(await page.locator('#fl-dur option').allTextContents()).toEqual(['1 day', '1 week', '1 month (30 days)']);
  await page.selectOption('#fl-dur', 'month');
  await page.check('#fl-ok');
  await page.click('#fl-make');
  await expect(page.locator('#dlg-body')).toContainText('until');
  await page.click('[data-close]');
  await page.click(`[data-act=flink][data-id="${tala}"]`);
  await expect(page.locator('#dlg-body')).toContainText('It works until');
});

test('delete archived fish: warning first, then a final button; only archived fish go', async ({ page }) => {
  await openOcean(page);
  await unlockAdmin(page);
  await tab(page, 'fish');
  const ids = await page.evaluate(() => Object.fromEntries(window.__ocean.A.data.fish.map(f => [f.nickname, f.id])));
  await expect(page.locator('#fx-del')).toHaveCount(0);                     // nothing archived yet
  await page.click(`[data-act=archive][data-id="${ids.Pebble}"]`);
  await page.click('#ar-go');
  await page.check('#fx-arch');
  await expect(page.locator('#fx-del')).toBeVisible();
  await page.click('#fx-del');
  await expect(page.locator('#dlg-body')).toContainText('cannot be brought back');
  await page.click('[data-close]');                                          // keep them archived
  expect(await page.evaluate(id => !!window.__ocean.A.data.fish.find(f => f.id === id), ids.Pebble)).toBe(true);
  await page.click('#fx-del');
  await page.click('#da-next');
  await expect(page.locator('#da-go')).toBeVisible();                        // the separate final button
  expect(await page.evaluate(id => !!window.__ocean.A.data.fish.find(f => f.id === id), ids.Pebble)).toBe(true);   // still there before the final press
  await page.click('#da-go');
  await expect(page.locator('#dlg')).toBeHidden();
  const r = await page.evaluate(async ({pebble, tala}) => {
    const d = window.__ocean.store.db._dump(), keys = Object.keys(d);
    const left = k => keys.filter(x => x.startsWith(k + '/') && JSON.stringify(d[x]).includes(pebble)).length;
    const pebbleClient = Object.entries(d).filter(([k, v]) => k.startsWith('clients/') && /Sample client F/.test(v.label || '')).length;
    return {fish: !!d['fish/' + pebble], ach: keys.filter(k => k.startsWith('achievements/') && d[k].fishId === pebble).length, evo: keys.filter(k => k.startsWith('evolutions/') && d[k].fishId === pebble).length,
      audit: keys.filter(k => k.startsWith('audit/') && d[k].fishId === pebble).length, pub: left('pub/aquarium/fish'), pebbleClient,
      tala: !!d['fish/' + tala], summary: Object.values(d).some(v => v && v.action === 'archived.deleted')};
  }, {pebble: ids.Pebble, tala: ids.Tala});
  expect(r).toEqual({fish: false, ach: 0, evo: 0, audit: 0, pub: 0, pebbleClient: 0, tala: true, summary: true});
});
