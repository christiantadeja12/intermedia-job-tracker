import { test, expect } from '@playwright/test';
import { openOcean, unlockAdmin, tab } from './helpers.mjs';

test('nickname check: look-alike nicknames are flagged, made-up ones are not', async ({ page }) => {
  await openOcean(page);
  const w = await page.evaluate(() => { const f = window.__ocean.nicknameWarning;
    return [f('Juanito', 'Juan Dela Cruz'), f('Cruzy', 'Juan Dela Cruz'), f('Marisol', 'María Sol Reyes'), f('Bubbles', 'Juan Dela Cruz'),
            f('Tala', 'Sample client A (fictional)'), f('Jo', 'Jo Santos'), f('Sam', 'Sample client B (fictional)'), f('Andy', 'Andres Bonifacio')].map(Boolean); });
  expect(w).toEqual([true, true, true, false, false, false, false, true]);
});

test('nickname guide: one warning, then the therapist can still choose to keep it', async ({ page }) => {
  await openOcean(page);
  await unlockAdmin(page);
  await tab(page, 'fish');
  await page.click('#fx-add');
  await expect(page.locator('#ff')).toContainText('never use photos of children');
  await page.fill('#ff-label', 'Andres Bonifacio (fictional)');
  await page.fill('#ff-nick', 'Andy');
  await page.click('#ff-save');
  await expect(page.locator('#w-nickname')).toBeVisible();
  await expect(page.locator('#ff-save')).toHaveText('Use this nickname anyway');
  await page.fill('#ff-nick', 'Seashell');            // changing it clears the warning
  await expect(page.locator('#w-nickname')).toBeHidden();
  await page.fill('#ff-nick', 'Andy');
  await page.click('#ff-save'); await page.click('#ff-save'); // warned, then kept on purpose
  await page.waitForFunction(() => window.__ocean.A.data.fish.some(f => f.nickname === 'Andy'));
});

test('family summary: approved milestones only, no private notes or client label, prints cleanly', async ({ page }) => {
  await openOcean(page);
  await unlockAdmin(page);
  const facts = await page.evaluate(() => {
    const o = window.__ocean, f = o.A.data.fish.find(x => x.nickname === 'Tala'), achs = o.A.data.achievements.filter(a => a.fishId === f.id && a.status === 'active');
    return {id: f.id, shown: achs.filter(a => a.publicVisible).map(a => a.title), hidden: achs.filter(a => !a.publicVisible).map(a => a.title),
      notes: achs.map(a => a.privateNote).filter(Boolean), label: o.A.data.clients.find(c => c.id === f.clientId).label};
  });
  expect(facts.shown.length).toBeGreaterThan(0);
  await tab(page, 'fish');
  await page.click(`[data-act=summary][data-id="${facts.id}"]`);
  const prev = page.locator('#fs-prev');
  await expect(prev).toContainText('Tala’s Little Ocean journey');
  await expect(prev).toContainText('Vibrant Fish');
  for (const t of facts.shown) await expect(prev).toContainText(t);
  const text = await prev.innerText();
  for (const t of facts.hidden.filter(t => !facts.shown.includes(t))) expect(text).not.toContain(t);
  for (const n of facts.notes) expect(text).not.toContain(n);
  expect(text).not.toContain(facts.label);
  // Printing shows only the summary sheet.
  await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
  await page.click('#fs-print');
  expect(await page.evaluate(() => window.__printed)).toBe(1);
  await page.emulateMedia({media: 'print'});
  await expect(page.locator('#print-sheet')).toBeVisible();
  await expect(page.locator('#print-sheet')).toContainText('Tala’s Little Ocean journey');
  await expect(page.locator('#admin')).toBeHidden();
  await page.emulateMedia({media: 'screen'});
});

test('archiving offers the family summary first', async ({ page }) => {
  await openOcean(page);
  await unlockAdmin(page);
  await tab(page, 'fish');
  const id = await page.evaluate(() => window.__ocean.A.data.fish.find(x => x.nickname === 'Pip').id);
  await page.click(`[data-act=archive][data-id="${id}"]`);
  await page.click('#ar-sum');
  await expect(page.locator('#fs-prev')).toContainText('Pip’s Little Ocean journey');
});
