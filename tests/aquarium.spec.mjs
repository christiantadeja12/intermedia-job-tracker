import { test, expect } from '@playwright/test';
import { openOcean, fishPos } from './helpers.mjs';

test('popups stay hidden on load without host styles', async ({ page }) => {
  await openOcean(page);
  for (const id of ['scrim', 'dlg', 'comfort', 'evo-banner', 'admin', 'preview-bar']) {
    expect(await page.evaluate(i => getComputedStyle(document.getElementById(i)).display, id), id).toBe('none');
  }
});

test('single tap plays after the double-tap window; it never opens the profile', async ({ page }) => {
  await openOcean(page);
  const [x, y] = await fishPos(page, 0);
  await page.mouse.click(x, y);
  expect(await page.evaluate(() => !!window.__ocean.fish[0].reaction)).toBe(false); // waits for a possible second tap
  await page.waitForTimeout(450);
  expect(await page.evaluate(() => !!window.__ocean.fish[0].reaction)).toBe(true);
  expect(await page.evaluate(() => window.__ocean.state.modalFish)).toBeNull();
});

test('double tap opens the share-safe profile and the X closes it', async ({ page }) => {
  await openOcean(page);
  const [x, y] = await fishPos(page, 2);
  await page.mouse.click(x, y); await page.waitForTimeout(90); await page.mouse.click(x, y);
  await page.waitForTimeout(450);
  expect(await page.evaluate(() => window.__ocean.state.modalFish && window.__ocean.state.modalFish.data.nick)).toBe('Lumi');
  expect(await page.evaluate(() => !!window.__ocean.fish[2].reaction)).toBe(false);
  await page.click('#p-close');
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('scrim')).display)).toBe('none');
});

test('reactions never repeat back to back and all ten appear', async ({ page }) => {
  await openOcean(page);
  const ok = await page.evaluate(() => {
    const o = window.__ocean; let last = -1, glob = -1, good = true; const seen = new Set();
    for (let i = 0; i < 3000; i++){ const k = o.pickReaction(last, glob); if (k === last || k === glob) good = false; seen.add(k); last = glob = k; }
    return good && seen.size === 10;
  });
  expect(ok).toBe(true);
});

test('every reaction keeps every fish inside the tank', async ({ page }) => {
  await openOcean(page);
  const outside = await page.evaluate(async () => {
    const o = window.__ocean, W = o.state.W, H = o.state.H; let bad = 0;
    for (let k = 0; k < 10; k++){
      o.fish.forEach(f => o.startReaction(f, k));
      const end = performance.now() + 3400;
      while (performance.now() < end){ await new Promise(r => requestAnimationFrame(r)); for (const f of o.fish) if (f.drawX < 0 || f.drawX > W || f.drawY < 0 || f.drawY > H) bad++; }
    }
    return bad;
  });
  expect(outside).toBe(0);
});

test('reduced-motion devices start in calm motion', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await openOcean(page);
  expect(await page.evaluate(() => window.__ocean.state.calm)).toBe(true);
  await ctx.close();
});
