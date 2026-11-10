import { test, expect } from '@playwright/test';
import { openOcean, unlockAdmin, tab } from './helpers.mjs';

test('theme schedule: priority, tie-break, manual mode and turned-off themes', async ({ page }) => {
  await openOcean(page);
  const r = await page.evaluate(() => {
    const o = window.__ocean, T = o.mergeThemes([]), pick = (d, cfg) => o.resolveTheme(T, cfg, d).theme.id;
    const off = o.mergeThemes([{id: 'halloween', enabled: false}]);
    const tie = o.mergeThemes([{id: 'christmas', priority: 40, schedules: [{start:'2026-12-01', end:'2026-12-31', enabled:true}]}, {id: 'newyear', priority: 40, schedules: [{start:'2026-12-30', end:'2027-01-02', enabled:true}]}]);
    return {
      today: pick('2026-11-09'), june12: pick('2026-06-12'), june20: pick('2026-06-20'), oct30: pick('2026-10-30'),
      easter: pick('2026-04-05'), summer: pick('2026-04-20'), xmas: pick('2026-12-24'), ny: pick('2027-01-01'), vday: pick('2027-02-14'),
      manual: pick('2026-11-09', {mode: 'manual', manualThemeId: 'easter'}), halloweenOff: o.resolveTheme(off, null, '2026-10-30').theme.id,
      tieShorter: o.resolveTheme(tie, null, '2026-12-31').theme.id,
    };
  });
  // Phase 4B calendar: 9 Nov is National Children's Month; with Halloween off, 30 Oct falls back to Early Christmas (it outranks Rainy Season).
  expect(r).toEqual({today: 'childrensmonth', june12: 'independence', june20: 'rainy', oct30: 'halloween', easter: 'easter', summer: 'summer',
    xmas: 'christmas', ny: 'newyear', vday: 'valentine', manual: 'easter', halloweenOff: 'earlychristmas', tieShorter: 'newyear'});
});

test('schedule validation catches bad ranges', async ({ page }) => {
  await openOcean(page);
  const r = await page.evaluate(() => {
    const v = window.__ocean.validateSchedule;
    return [v([{start:'2026-12-01', end:'2026-11-01'}]), v([{start:'2026-02-30', end:'2026-03-01'}]), v([{start:'2026-01-01', end:'2027-06-01'}]), v([{start:'2026-12-01', end:'2026-12-26'}])];
  });
  expect(r[0]).toMatch(/before/); expect(r[1]).toMatch(/pick both/); expect(r[2]).toMatch(/one year/); expect(r[3]).toBe('');
});

test('manual theme mode changes the aquarium without touching fish', async ({ page }) => {
  await openOcean(page);
  const before = await page.evaluate(() => JSON.stringify(window.__ocean.fish.map(f => f.data.prog)));
  await unlockAdmin(page);
  await tab(page, 'themes');
  await page.check('input[name=tm][value=manual]', { force: true });
  await page.selectOption('#tm-pick', 'christmas');
  await page.click('#tm-save');
  await page.waitForFunction(() => window.__ocean.currentTheme.id === 'christmas');
  const after = await page.evaluate(() => JSON.stringify(window.__ocean.fish.map(f => f.data.prog)));
  expect(after).toBe(before);
  const audit = await page.evaluate(() => window.__ocean.A.data.audit.map(a => a.action));
  expect(audit).toContain('theme.mode');
});

test('builtin theme dates and priority can be edited and validated', async ({ page }) => {
  await openOcean(page);
  await unlockAdmin(page);
  await tab(page, 'themes');
  await page.click('[data-sc=christmas]');
  await page.fill('#sc-pr', '140');
  await page.click('#sc-save');
  await expect(page.locator('#e-pr')).toHaveText(/0 to 100/);
  await page.fill('#sc-pr', '60');
  await page.click('#rg-add');
  const rows = page.locator('#rg .range');
  const last = rows.last();
  await last.locator('.rg-s').fill('2026-09-01');
  await last.locator('.rg-e').fill('2026-09-30');
  await page.click('#sc-save');
  await page.waitForFunction(() => document.getElementById('dlg').hidden);
  const t = await page.evaluate(() => window.__ocean.THEMES.find(x => x.id === 'christmas'));
  expect(t.priority).toBe(60);
  expect(t.schedules.some(s => s.start === '2026-09-01')).toBe(true);
});

test('custom theme: upload, preview, save, schedule and delete', async ({ page }) => {
  await openOcean(page);
  await unlockAdmin(page);
  await tab(page, 'themes');
  await page.click('#th-new');
  const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 320; c.height = 180; const g = c.getContext('2d'); g.fillStyle = '#ff7ab0'; g.fillRect(0, 0, 320, 180); g.fillStyle = '#ffd34d'; g.beginPath(); g.arc(160, 90, 60, 0, 7); g.fill(); return c.toDataURL('image/png').split(',')[1]; });
  await page.setInputFiles('#ct-bg', { name: 'bg.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await page.setInputFiles('#ct-dec', { name: 'sticker.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  await page.locator('#ct-decor .decor-row').waitFor();
  await page.setInputFiles('#ct-bg', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(page.locator('#e-ctimg')).toHaveText(/PNG, JPEG or WebP/);
  await page.fill('#ct-name', 'Clinic Birthday');
  await page.selectOption('#ct-fx', 'confetti');
  const [from, to] = await page.evaluate(() => { const f = d => new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Manila'}).format(new Date(Date.now() + d*864e5)); return [f(-5), f(5)]; });
  await page.click('#rg-add');
  await page.locator('#rg .rg-s').last().fill(from);
  await page.locator('#rg .rg-e').last().fill(to);
  await page.fill('#ct-pr', '70');
  await page.click('#ct-save');
  await page.waitForFunction(() => document.getElementById('dlg').hidden);
  await page.waitForFunction(() => window.__ocean.currentTheme.name === 'Clinic Birthday'); // scheduled around today at priority 70
  const saved = await page.evaluate(() => { const t = window.__ocean.currentTheme; return {bg: !!(t.bg && t.bg.url), decor: t.decorImgs.length, effect: t.effect}; });
  expect(saved).toEqual({bg: true, decor: 1, effect: 'confetti'});
  const id = await page.evaluate(() => window.__ocean.currentTheme.id);
  await page.click(`[data-del="${id}"]`);
  await page.click('#td-go');
  await page.waitForFunction(() => window.__ocean.currentTheme.id === window.__ocean.resolveTheme(window.__ocean.THEMES, null, new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Manila'}).format(new Date())).theme.id);
});

test('preview shows a theme on this device only, and can be ended', async ({ page }) => {
  await openOcean(page);
  await unlockAdmin(page);
  await tab(page, 'themes');
  await page.click('[data-pv=halloween]');
  await page.waitForFunction(() => location.hash === '#aquarium' && window.__ocean.currentTheme.id === 'halloween');
  await expect(page.locator('#preview-bar')).toBeVisible();
  expect(await page.evaluate(() => (window.__ocean.store.db._dump()['pub/aquarium/config/settings'] || {}).theme)).toBeUndefined(); // preview saves nothing
  await page.click('#pv-end');
  await page.waitForFunction(() => window.__ocean.currentTheme.id === window.__ocean.resolveTheme(window.__ocean.THEMES, null, new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Manila'}).format(new Date())).theme.id);
});
