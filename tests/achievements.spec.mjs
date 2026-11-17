import { test, expect } from '@playwright/test';
import { openOcean, unlockAdmin, tab } from './helpers.mjs';

const PIP = 'f_s2'; // fictional sample fish: 6 half-star units (3 stars) at Level 1; a fish evolves at 7 units (3.5 stars)
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
  if (double) await page.evaluate(() => { const f = document.getElementById('aw'); f.requestSubmit(); f.requestSubmit(); });
  else await page.click('#aw-save');
  await page.locator('#dn-again').waitFor();
}

test('derived stars use whole half-star units', async ({ page }) => {
  await openOcean(page);
  const r = await page.evaluate(() => {
    const D = window.__ocean.deriveFish, a = (u, d, i) => ({id: 'x' + i, units: u, achievedAt: d, createdAt: d + 'T0' + i, status: 'active'});
    const six = D([a(2,'2026-01-01',1), a(2,'2026-01-02',2), a(2,'2026-01-03',3)]);
    const seven = D([a(2,'2026-01-01',1), a(2,'2026-01-02',2), a(2,'2026-01-03',3), a(1,'2026-01-04',4)]);
    const big = D([a(2,'2026-01-01',1), ...Array.from({length: 11}, (_, i) => a(2, '2026-02-' + String(i + 1).padStart(2, '0'), i + 2))]);
    const voided = D([{...a(2,'2026-01-01',1), status: 'voided'}, a(1,'2026-01-02',2)]);
    return {six: [six.level, six.currentUnits], seven: [seven.level, seven.currentUnits, seven.evolutions.length], big: [big.units, big.level, big.evolutions.map(e => e.toLevel).join(',')], voided: voided.units};
  });
  expect(r.six).toEqual([1, 6]);           // 3 stars, no evolution yet
  expect(r.seven).toEqual([2, 0, 1]);      // 3.5 stars: exactly one evolution, fresh row of stars
  expect(r.big).toEqual([24, 4, '2,3,4']); // each threshold processed once
  expect(r.voided).toBe(1);
});

test('awards: duplicate submit counts once, 3.5 stars evolves exactly once', async ({ page }) => {
  await openOcean(page);
  await unlockAdmin(page);
  expect(await pipState(page)).toEqual({units: 6, level: 1, current: 6});
  await award(page, 1, 'Evolving award', { double: true });   // 6 + one half star = 7: evolves, and the double submit counted once
  expect(await pipState(page)).toEqual({units: 7, level: 2, current: 0});
  expect(await evolutions(page)).toEqual(['2:active']);
  await expect(page.locator('.done h3')).toContainText('evolved');
  await award(page, 2, 'Next award');
  expect(await pipState(page)).toEqual({units: 9, level: 2, current: 2});
  await award(page, 1, 'Half award');
  expect(await pipState(page)).toEqual({units: 10, level: 2, current: 3});
  expect(await evolutions(page)).toEqual(['2:active']);   // still just the one evolution
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
  await award(page, 2, 'One'); // 6 + 2 = 8 units -> Level 2
  expect(await evolutions(page)).toEqual(['2:active']);
  await tab(page, 'history');
  await page.selectOption('#hx-fish', PIP);
  await page.locator('[data-led=points]').first().click();
  const cur = await page.evaluate(() => document.querySelector('input[name=cx-u]:checked').value);
  if (cur === '2') await page.check('input[name=cx-u][value="1"]', { force: true }); else await page.check('input[name=cx-u][value="2"]', { force: true });
  await page.fill('#cx-reason', 'Corrected amount');
  await page.click('#cx-save');
  await page.waitForFunction(() => document.getElementById('dlg').hidden);
  expect(await pipState(page)).toEqual({units: 7, level: 2, current: 0});   // exactly 3.5 stars: still evolved
  await page.locator('[data-led=void]').first().click();
  await page.click('#cx-save');
  await expect(page.locator('#e-reason')).toHaveText(/reason/);
  await page.fill('#cx-reason', 'Entered twice by mistake');
  await page.click('#cx-save');
  await page.waitForFunction(() => document.getElementById('dlg').hidden);
  expect(await pipState(page)).toEqual({units: 6, level: 1, current: 6});
  expect(await evolutions(page)).toEqual(['2:undone']);
  const statuses = await page.evaluate(id => window.__ocean.A.data.achievements.filter(a => a.fishId === id && a.createdBy !== 'sample').map(a => a.status).sort(), PIP);
  expect(statuses).toContain('voided');
  expect(statuses).toContain('corrected');
  const actions = await page.evaluate(() => window.__ocean.A.data.audit.map(a => a.action));
  for (const a of ['achievement.awarded', 'evolution.recorded', 'achievement.voided', 'evolution.reversed', 'achievement.points_changed']) expect(actions).toContain(a);
});

test('the shared copy never contains private fields; milestones show only where the child setting is on', async ({ page }) => {
  await openOcean(page);
  const r = await page.evaluate(() => {
    const d = window.__ocean.store.db._dump(), leaks = [];
    for (const [k, v] of Object.entries(d)) if (k.startsWith('pub/') && /privateNote|Fictional note|Sample client|clientId|"label"/.test(JSON.stringify(v))) leaks.push(k);
    // every achievement title that appears on a main-aquarium timeline must belong to a child whose aquarium switch is on and who has consented
    let wrong = 0, shown = 0;
    for (const [k, v] of Object.entries(d)) if (k.startsWith('achievements/') && v.status === 'active'){
      const f = d['fish/' + v.fishId], c = d['clients/' + f.clientId], tl = d['pub/aquarium/timelines/' + v.fishId];
      const on = !!(tl && tl.items.some(i => i.type === 'a' && i.title === v.title && i.date === v.achievedAt));
      if (on) shown++;
      if (on !== !!(c.shareConsent && c.aquariumShowcase)) wrong++;
    }
    return {leaks, wrong, shown, pebble: d['pub/aquarium/timelines/f_s6']};
  });
  expect(r.leaks).toEqual([]);
  expect(r.wrong).toBe(0);
  expect(r.shown).toBeGreaterThan(0);
  expect(r.pebble.shared).toBe(false);   // no family consent: no milestone details
  expect(r.pebble.items).toEqual([]);
});

test('award forms have no per-achievement approval tick any more', async ({ page }) => {
  await openOcean(page);
  await unlockAdmin(page);
  await tab(page, 'award');
  await expect(page.locator('#aw-share')).toHaveCount(0);
  await expect(page.locator('#aw')).not.toContainText('Approve the title and description');
});

test('one switch per child shows or hides ALL milestones: family aquarium and main aquarium are separate', async ({ page }) => {
  await openOcean(page);
  await unlockAdmin(page);
  const r = await page.evaluate(async () => {
    const o = window.__ocean, s = o.store, tala = o.allFish.find(p => p.nickname === 'Tala').id;
    const count = async () => {
      const tl = (await s.db.doc('pub/aquarium/timelines/' + tala).get()).data();
      const v = await s.familyView(token);
      return {main: tl.items.filter(i => i.type === 'a').length, family: v.items.filter(i => i.type === 'a').length, famEvo: v.items.filter(i => i.type === 'e').length};
    };
    const token = (await s.createFamilyLink(tala)).token;
    const active = (await s.byFish('achievements', tala)).filter(a => a.status === 'active').length;
    await s.setSharing(tala, true, true);   const both = await count();
    await s.setSharing(tala, true, false);  const familyOnly = await count();
    await s.setSharing(tala, false, true);  const mainOnly = await count();
    await s.setSharing(tala, false, false); const none = await count();
    return {active, both, familyOnly, mainOnly, none};
  });
  expect(r.both).toMatchObject({main: r.active, family: r.active});
  expect(r.familyOnly).toMatchObject({main: 0, family: r.active});
  expect(r.mainOnly).toMatchObject({main: r.active, family: 0});
  expect(r.none).toMatchObject({main: 0, family: 0});
  expect(r.none.famEvo).toBeGreaterThan(0);   // level-ups still show to the family
});

test('the fish form has the two milestone switches and saves them', async ({ page }) => {
  await openOcean(page);
  await unlockAdmin(page);
  await tab(page, 'fish');
  const pebble = await page.evaluate(() => window.__ocean.A.data.fish.find(f => f.nickname === 'Pebble').id);
  await page.click(`[data-act=edit][data-id="${pebble}"]`);
  await expect(page.locator('#ff-fam')).not.toBeChecked();
  await expect(page.locator('#ff-aq')).not.toBeChecked();
  await page.check('#ff-fam');
  await page.click('#ff-save');
  await expect(page.locator('#dlg')).toBeHidden();
  const c = await page.evaluate((id) => { const o = window.__ocean, f = o.A.data.fish.find(x => x.id === id); const c = o.A.data.clients.find(x => x.id === f.clientId); return [c.familyShowcase, c.aquariumShowcase]; }, pebble);
  expect(c).toEqual([true, false]);
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

test('star progress: 3.5 stars to evolve, shown as four star slots', async ({ page }) => {
  await openOcean(page);
  await page.evaluate(() => { const o = window.__ocean; o.openProfile(o.fish.find(f => f.data.nick === 'Tala')); });   // 16 half-stars: Level 3, 1 star into the next
  await expect(page.locator('#p-stars-sub')).toHaveText('1 of 3.5 · 2.5 to evolve');
  await expect(page.locator('#p-stars')).toHaveAttribute('aria-label', '1 of 3.5 stars toward the next evolution');
  expect(await page.locator('#p-stars svg').count()).toBe(4);
});
