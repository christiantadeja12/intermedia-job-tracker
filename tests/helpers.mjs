import fs from 'node:fs';
import path from 'node:path';

const PAGE = fs.readFileSync(path.resolve('index.html'), 'utf8');
// Deliberately minimal wrapper: no reset styles, so the page must hide its own popups.
const HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>${PAGE}</body></html>`;

// By default the demo is switched to "every fish swims" so older tests can tap any of the 8 sample fish.
// Pass {allFish: false} to keep the privacy default (only fish whose families agreed to sharing).
export async function openOcean(page, hash = '', {allFish = true, wait = true} = {}) {
  await page.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith('https://ocean.test/vendor/qrcode')) return route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.resolve('vendor', url.split('/').pop())) });
    if (url.startsWith('https://ocean.test/vendor/') || url.startsWith('https://ocean.test/assets/') || url.endsWith('/sw.js')) return route.abort(); // demo mode: no supabase-js
    if (url.startsWith('https://ocean.test/')) return route.fulfill({ contentType: 'text/html', body: HTML });
    return route.abort(); // fonts and anything external stay offline in tests (https keeps secure-context crypto on)
  });
  await page.goto('https://ocean.test/' + hash);
  if (!wait) return page.waitForFunction(() => window.__ocean && window.__ocean.store);
  await page.waitForFunction(() => window.__ocean && window.__ocean.allFish.length === 8 && window.__ocean.store);
  if (allFish){
    await page.evaluate(() => window.__ocean.store.saveConfig({defaults: {aquariumShows: 'all'}}, 'settings.updated', 'test: show every fish'));
    await page.waitForFunction(() => window.__ocean.fish.length === 8);
  }
}

export async function unlockAdmin(page, pin = '2468') {
  await page.evaluate(() => { location.hash = '#admin'; });
  await page.locator('#pin').waitFor();
  await page.fill('#pin', pin);
  if (await page.locator('#pin2').count()) await page.fill('#pin2', pin);
  await page.click('#pin-form button[type=submit]');
  await page.waitForFunction(() => window.__ocean.A.unlocked);
}

export async function tab(page, name) {
  await page.click(`#adm-tabs [data-tab=${name}]`);
  await page.waitForTimeout(150);
}

export const fishPos = (page, i) => page.evaluate(i => { const f = window.__ocean.fish[i]; return [f.drawX, f.drawY]; }, i);
