import { test, expect } from '@playwright/test';
import { openOcean, unlockAdmin, tab } from './helpers.mjs';

const PIP = 'f_s2'; // fictional sample fish: 6 half-star units (3 stars) at Level 1
const pipState = page => page.evaluate(id => {
  const d = window.__ocean.deriveFish(window.__ocean.A.data.achievements.filter(a => a.fishId === id));
  return {units: d.units, level: d.level, current: d.currentUnits};
}, PIP);
const evolutions = page => page.evaluate(id => window.__ocean.A.data.evolutions.filter(e => e.fishId === id).map(e => `${e.toLevel}:${e.reversedAt ? 'undone' : 'active'}`), PIP);

async function award(page, units, title, { double = false, share = false } = {}) {
  await tab(page, 'award');
  if (await page.locator('#dn-again').count()) { await page.click('#dn-again'); await page.waitForTimeout(100); }
  await page.selectOption('#aw-fish', PIP);
  await page.check(`input[name=aw-units][value="${units}"]`, { force: true });
  await page.fill('#aw-title', title);
  await page.fill('#aw-desc', 'I did it: ' + title);
  await page.fill('#aw-note', 'Fictional private note');
  if (share) await page.check('#aw-share');
  if (double) await page.evaluate(() => { const f = document.getElementById('aw'); f.requestSubmit(); f.requestSubmit(); });
  else await page.click('#aw-save');
  await page.locator('#dn-again').waitFor();
}

test('derived stars use whole half-star units', async ({ page }) => {
  await openOcean(page);
  const r = await page.evaluate(() => {
    const D = window.__ocean.deriveFish, a = (u, d, i) => ({id: 'x' + i, units: u, achievedAt: d, createdAt: d + 'T0' + i, status: 'active'});
    const nine = D([a(2,'2026-01-01',1), a(2,'2026-01-02',2), a(2,'2026-01-03',3), a(2,'2026-01-04',4), a(1,'2026-01-05',5)]);
    const ten = D([a(2,'2026-01-01',1), a(2,'2026-01-02',2), a(2,'2026-01-03',3), a(2,'2026-01-04',4), a(2,'2026-01-05',5)]);
    const big = D([a(2,'2026-01-01',1), ...Array.from({length: 11}, (_, i) => a(2, '2026-02-' + String(i + 1).padStart(2, '0'), i + 2))]);
    const voided = D([{...a(2,'2026-01-01',1), status: 'voided'}, a(1,'2026-01-02',2)]);
    return {nine: [nine.level, nine.currentUnits], ten: [ten.level, ten.currentUnits, ten.evolutions.length], big: [big.units, big.level, big.evolutions.map(e => e.toLevel).join(',')], voided: voided.units};
  });
  expect(r.nine).toEqual([1, 9]);          // 4.5 stars, no evolution yet
  expect(r.ten).toEqual([2, 0, 1]);        // exactly one evolution, fresh row of stars
  expect(r.big).toEqual([24, 3, '2,3']);   // each threshold processed once
  expect(r.voided).toBe(1);
});

test('awards: duplicate submit counts once, five stars evolves exactly once', async ({ page }) => {
  await openOcean(page);
  await unlockAdmin(page);
  await award(page, 2, 'First award', { double: true });
  expect(await pipState(page)).toEqual({units: 8, level: 1, current: 8});
  await award(page, 1, 'Half award');
  expect(await pipState(page)).toEqual({units: 9, level: 1, current: 9});
  await award(page, 2, 'Evolving award', { share: true });
  expect(await pipState(page)).toEqual({units: 11, level: 2, current: 1});
  expect(await evolutions(page)).toEqual(['2:active']);
  await expect(page.locator('.done h3')).toContainText('evolved');
});

test('award form blocks missing fields and future dates', async ({ page }) => {
  await openOcean(page);
  await unlockAdmin(page);
  await tab(page, 'award');
  await page.click('#aw-save');
  await expect(page.locator('#e-title')).toHaveText(/title/);
  await expect(page.locator('#e-desc')).toHaveText(/description/);
  const e = await page.evaluate(() => window.__ocean.validateAward({units: 2, fishId: 'x', title: 'a', desc: 'b', date: '2999-01-01'}, '2026-11-09'));
  expect(e.date).toMatch(/future/);
});

test('corrections keep history, undo and restore evolutions, and are audited', async ({ page }) => {
  await openOcean(page);
  await unlockAdmin(page);
  await award(page, 2, 'One'); await award(page, 2, 'Two'); // 10 units -> Level 2
  expect(await evolutions(page)).toEqual(['2:active']);
  await tab(page, 'history');
  await page.selectOption('#hx-fish', PIP);
  await page.locator('[data-led=void]').first().click();
  await page.click('#cx-save');
  await expect(page.locator('#e-reason')).toHaveText(/reason/);
  await page.fill('#cx-reason', 'Entered twice by mistake');
  await page.click('#cx-save');
  await page.waitForFunction(() => document.getElementById('dlg').hidden);
  expect(await pipState(page)).toEqual({units: 8, level: 1, current: 8});
  expect(await evolutions(page)).toEqual(['2:undone']);
  await page.locator('[data-led=points]').first().click();
  const cur = await page.evaluate(() => document.querySelector('input[name=cx-u]:checked').value);
  if (cur === '2') await page.check('input[name=cx-u][value="1"]', { force: true }); else await page.check('input[name=cx-u][value="2"]', { force: true });
  await page.fill('#cx-reason', 'Corrected amount');
  await page.click('#cx-save');
  await page.waitForFunction(() => document.getElementById('dlg').hidden);
  const statuses = await page.evaluate(id => window.__ocean.A.data.achievements.filter(a => a.fishId === id && a.createdBy !== 'sample').map(a => a.status).sort(), PIP);
  expect(statuses).toContain('voided');
  expect(statuses).toContain('corrected');
  const actions = await page.evaluate(() => window.__ocean.A.data.audit.map(a => a.action));
  for (const a of ['achievement.awarded', 'evolution.recorded', 'achievement.voided', 'evolution.reversed', 'achievement.points_changed']) expect(actions).toContain(a);
});

test('the shared copy never contains private fields or unapproved achievements', async ({ page }) => {
  await openOcean(page);
  const r = await page.evaluate(() => {
    const d = window.__ocean.store.db._dump(), leaks = [];
    for (const [k, v] of Object.entries(d)) if (k.startsWith('pub/') && /privateNote|Fictional note|Sample client|clientId|"label"/.test(JSON.stringify(v))) leaks.push(k);
    const hidden = Object.entries(d).filter(([k, v]) => k.startsWith('achievements/') && !v.publicVisible);
    let shown = 0;
    for (const [, v] of hidden){ const tl = d['pub/aquarium/timelines/' + v.fishId]; if (tl && tl.items.some(i => i.title === v.title && i.date === v.achievedAt)) shown++; }
    return {leaks, hidden: hidden.length, shown, pebble: d['pub/aquarium/timelines/f_s6']};
  });
  expect(r.leaks).toEqual([]);
  expect(r.hidden).toBeGreaterThan(0);
  expect(r.shown).toBe(0);
  expect(r.pebble.shared).toBe(false);   // no family consent: no milestone details
  expect(r.pebble.items).toEqual([]);
});

test('records survive a store reload (derived values rebuilt from the ledger)', async ({ page }) => {
  await openOcean(page);
  const ok = await page.evaluate(async () => {
    const o = window.__ocean, dump = o.store.db._dump();
    const db2 = o.createMemoryDB();
    for (const [path, doc] of Object.entries(dump)) await db2.doc(path).set(doc);
    const s2 = new o.Store(db2, null, 'demo'); await s2.init();
    const before = dump['pub/aquarium/fish/f_s3'];
    await s2.syncFish('f_s3');
    const after = db2._dump()['pub/aquarium/fish/f_s3'];
    return before.level === after.level && before.lifetimeUnits === after.lifetimeUnits && before.currentUnits === after.currentUnits;
  });
  expect(ok).toBe(true);
});

test('wrong PIN is refused and locking clears private data from the page', async ({ page }) => {
  await openOcean(page);
  await unlockAdmin(page);
  await page.click('#adm-lock');
  await page.locator('#pin').waitFor();
  expect(await page.evaluate(() => window.__ocean.A.data.achievements.length)).toBe(0);
  await page.fill('#pin', '1111'); await page.click('#pin-form button[type=submit]');
  await expect(page.locator('#pin-err')).toHaveText(/isn’t right/);
  const hash = await page.evaluate(() => window.__ocean.store.db._dump()['settings/admin']);
  expect(hash.algo).toBe('pbkdf2-sha256');
  expect(JSON.stringify(hash)).not.toContain('2468');
});
