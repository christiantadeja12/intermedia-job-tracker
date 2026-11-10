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

test('family link: only that child, only approved milestones; new link and turning off stop old ones', async ({ page }) => {
  await openOcean(page);
  const r = await page.evaluate(async () => {
    const o = window.__ocean, s = o.store, fish = await s.all ? null : null;
    const pubs = o.allFish, tala = pubs.find(p => p.nickname === 'Tala').id;
    const t1 = await s.createFamilyLink(tala), v1 = await s.familyView(t1);
    const t2 = await s.createFamilyLink(tala), oldAfterNew = await s.familyView(t1), v2 = await s.familyView(t2);
    await s.revokeFamilyLink(tala); const afterOff = await s.familyView(t2);
    const achs = o.A.data.achievements.length ? o.A.data.achievements : (await s.byFish('achievements', tala));
    return {nick: v1.fish.nickname, ids: [...new Set([v1.fish.id])], items: v1.items, json: JSON.stringify(v1), oldAfterNew, v2ok: !!v2, afterOff,
      approved: achs.filter(a => a.fishId === tala && a.status === 'active' && a.publicVisible).length,
      hidden: achs.filter(a => a.fishId === tala && a.status === 'active' && !a.publicVisible).map(a => a.title), garbage: await s.familyView('nope')};
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
