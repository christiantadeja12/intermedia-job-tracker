import { test, expect } from '@playwright/test';
import { openOcean, unlockAdmin, tab } from './helpers.mjs';

test('privacy default: only fish whose families agreed to sharing swim in the shared aquarium', async ({ page }) => {
  await openOcean(page, '', {allFish: false});
  await page.waitForFunction(() => window.__ocean.fish.length === 7);
  const names = await page.evaluate(() => window.__ocean.fish.map(f => f.data.nick));
  expect(names).not.toContain('Pebble');
  await expect(page.locator('#tray .chip')).toHaveCount(7);
});

test('Focus mode: needs the PIN, shows only one child (even a private family), and goes back to everyone', async ({ page }) => {
  await openOcean(page, '', {allFish: false});
  await unlockAdmin(page);                       // sets the PIN
  await page.click('#adm-lock');
  await page.evaluate(() => { location.hash = '#aquarium'; });
  await expect(page.locator('#btn-focus')).toBeVisible();
  await page.click('#btn-focus');
  await page.fill('#fp-pin', '0000'); await page.click('#fp-pin-f button[type=submit]');
  await expect(page.locator('#fp-err')).toHaveText('That PIN isn’t right.');
  await page.fill('#fp-pin', '2468'); await page.click('#fp-pin-f button[type=submit]');
  await expect(page.locator('.fp-item')).toHaveCount(8);
  await expect(page.locator('.fp-item', {hasText: 'Pebble'})).toContainText('Private family');
  await page.click('.fp-item:has-text("Pebble")');
  await page.waitForFunction(() => window.__ocean.fish.length === 1 && window.__ocean.fish[0].data.nick === 'Pebble');
  await expect(page.locator('#focus-bar')).toContainText('Pebble’s turn');
  await expect(page.locator('#tray .chip')).toHaveCount(1);
  await page.click('#fb-end');
  await page.waitForFunction(() => window.__ocean.fish.length === 7);
  await expect(page.locator('#focus-bar')).toBeHidden();
});

test('Focus mode skips the PIN while the therapist area is unlocked', async ({ page }) => {
  await openOcean(page);
  await unlockAdmin(page);
  await page.evaluate(() => { location.hash = '#aquarium'; });
  await page.click('#btn-focus');
  await expect(page.locator('.fp-item')).toHaveCount(8);
  await page.click('.fp-item:has-text("Tala")');
  await page.waitForFunction(() => window.__ocean.fish.length === 1);
});

test('therapist setting "every fish" brings all fish back', async ({ page }) => {
  await openOcean(page, '', {allFish: false});
  await unlockAdmin(page);
  await tab(page, 'settings');
  await page.check('input[name=st-aq][value=all]');
  await page.click('#st-save');
  await expect(page.locator('#st-ok')).toBeVisible();
  await page.waitForFunction(() => window.__ocean.fish.length === 8);
});

test('Filipino: a device can switch the children’s words; the therapist area stays English', async ({ page }) => {
  await openOcean(page);
  await page.click('#btn-comfort');
  await page.click('input[name=cf-lang][value=fil]', {force: true});
  await expect(page.locator('#cf-h')).toHaveText('Mga setting ng ginhawa');
  await page.keyboard.press('Escape');
  await expect(page.locator('#hint-tap')).toContainText('I-tap');
  await expect(page.locator('#lbl-pause')).toHaveText('Hinto');
  await expect(page.locator('#tray .chip-view').first()).toContainText('Tingnan');
  const toast = await page.evaluate(() => { const o = window.__ocean; o.startReaction(o.fish[0], 0); return document.querySelector('#toast').textContent; });
  expect(toast).toContain('Masayang ikot');
  await page.evaluate(() => { const o = window.__ocean; o.openProfile(o.fish.find(f => f.data.nick === 'Tala')); });
  await expect(page.locator('#p-evo-h')).toHaveText('Level 3 · Makulay na Isda');
  await expect(page.locator('#p-ladder')).toContainText('Kampeon ng Karagatan');
  await expect(page.locator('#p-stars-h')).toHaveText('Mga bituin');
  await page.click('#p-close');
  await page.reload();
  await page.waitForFunction(() => window.__ocean && window.__ocean.allFish.length === 8);
  await expect(page.locator('#lbl-pause')).toHaveText('Hinto');                 // remembered on this device
  await unlockAdmin(page);
  await expect(page.locator('#adm-tabs [data-tab=overview]')).toHaveText('Overview');
});

test('Filipino: the therapist can make it the default for every device', async ({ page }) => {
  await openOcean(page);
  await unlockAdmin(page);
  await tab(page, 'settings');
  await page.selectOption('#st-lang', 'fil');
  await page.click('#st-save');
  await expect(page.locator('#st-ok')).toBeVisible();
  await page.evaluate(() => { location.hash = '#aquarium'; });
  await expect(page.locator('#lbl-pause')).toHaveText('Hinto');
  const ev = await page.evaluate(() => { const o = window.__ocean, f = o.fish.find(x => x.data.nick === 'Tala'); return o.tr('evo.h', {nick: 'Tala', stage: 'Marilag na Isda', aStage: '', n: 4}); });
  expect(ev).toBe('Naging Marilag na Isda si Tala!');
});

test('every child-facing phrase has a Filipino version', async ({ page }) => {
  await openOcean(page);
  const missing = await page.evaluate(() => { const o = window.__ocean, en = o.TXT.en, fil = o.TXT.fil; return Object.keys(en).filter(k => !fil[k] || !fil[k].trim()); });
  expect(missing).toEqual([]);
});

test('sea-life looks unlock with the fish’s level', async ({ page }) => {
  await openOcean(page);
  const v = await page.evaluate(() => { const o = window.__ocean, base = {label: 'x', nickname: 'Testy', persona: 'Bouncy bobber', palette: {body: '#000000', fin: '#000000', pat: '#000000'}};
    const err = (species, level) => o.validateFish({...base, species, level}, []).species || '';
    return [err('pawikan', 2), err('pawikan', 3), err('dugong', 3), err('dugong', 4), err('butanding', 4), err('butanding', 5), err('clown', 1)]; });
  expect(v.map(Boolean)).toEqual([true, false, true, false, true, false, false]);
  expect(v[0]).toContain('unlocks at level 3');
  await unlockAdmin(page);
  await tab(page, 'fish');
  const tala = await page.evaluate(() => window.__ocean.A.data.fish.find(f => f.nickname === 'Tala').id);   // level 3
  await page.click(`[data-act=edit][data-id="${tala}"]`);
  expect(await page.locator('#ff-sp option[value=pawikan]').isDisabled()).toBe(false);
  expect(await page.locator('#ff-sp option[value=dugong]').isDisabled()).toBe(true);
  await page.selectOption('#ff-sp', 'pawikan');
  await page.click('#ff-save');
  await page.waitForFunction(id => window.__ocean.fish.some(f => f.id === id && f.data.sp === 'pawikan'), tala);
});

test('Philippine calendar: the right theme on the right day', async ({ page }) => {
  await openOcean(page);
  const r = await page.evaluate(() => { const o = window.__ocean, T = o.mergeThemes([]);
    return ['2026-09-20','2026-10-28','2026-11-01','2026-11-15','2026-12-10','2027-01-18','2027-07-20','2027-08-10','2027-10-05'].map(d => o.resolveTheme(T, null, d).theme.id); });
  expect(r).toEqual(['earlychristmas','halloween','halloween','childrensmonth','christmas','autismweek','disabilityweek','wika','earlychristmas']);
});
