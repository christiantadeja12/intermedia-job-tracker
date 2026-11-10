import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildCsp } from '../scripts/build.mjs';

// Serves the page exactly as Cloudflare will: the built index.html with the built Content-Security-Policy header.
function build(){
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lo-build-'));
  execFileSync(process.execPath, ['scripts/build.mjs', dir]);
  const csp = fs.readFileSync(path.join(dir, '_headers'), 'utf8').match(/Content-Security-Policy: (.+)/)[1];
  return {dir, html: fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), csp};
}
const TYPES = {'.js': 'application/javascript', '.woff2': 'font/woff2'};

async function openBuilt(page, {dir, html, csp}){
  await page.addInitScript(() => { window.__violations = []; document.addEventListener('securitypolicyviolation', e => window.__violations.push(e.violatedDirective + ' ' + e.blockedURI)); });
  await page.route('**/*', route => {
    const u = route.request().url();
    if (u === 'https://ocean.test/') return route.fulfill({contentType: 'text/html; charset=utf-8', body: html, headers: {'content-security-policy': csp}});
    // Every other file comes from the built folder, exactly as Cloudflare would serve it (fonts, library, sw.js).
    if (u.startsWith('https://ocean.test/')){ const f = path.join(dir, new URL(u).pathname); if (fs.existsSync(f)) return route.fulfill({contentType: TYPES[path.extname(f)] || 'application/octet-stream', body: fs.readFileSync(f)}); }
    if (u.includes('jsdelivr') || u.includes('fonts.g')) throw new Error('The page must not load anything from a CDN: ' + u);
    return route.abort(); // Supabase itself: offline in this test
  });
  await page.goto('https://ocean.test/');
}

test('the built site runs under its Content-Security-Policy with no violations', async ({ page }) => {
  const built = build();
  await openBuilt(page, built);
  await page.waitForFunction(() => window.__ocean && window.__ocean.store && window.__ocean.store.mode === 'supabase');
  await expect(page.locator('#tank-note-h')).toHaveText('Welcome to Little Ocean!');
  await page.click('#btn-comfort'); await page.keyboard.press('Escape');
  await page.click('#tank-note-act'); await page.locator('#si-email').waitFor();
  expect(await page.evaluate(() => window.__violations)).toEqual([]);
  // Fonts came from this site and loaded.
  const loaded = await page.evaluate(async () => { await document.fonts.load('600 16px Fredoka'); await document.fonts.load('800 16px Nunito'); return [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family.replace(/['"]/g, '')); });
  expect(loaded).toEqual(expect.arrayContaining(['Fredoka', 'Nunito']));
  // The policy is really on: an injected script is blocked.
  await page.evaluate(() => { const s = document.createElement('script'); s.textContent = 'window.__injected = 1'; document.body.appendChild(s); });
  expect(await page.evaluate(() => [window.__injected, window.__violations.length])).toEqual([undefined, 1]);
});

test('the script hash ignores Windows line endings, and changes when the code changes', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  expect(buildCsp(html.replace(/\n/g, '\r\n'))).toBe(buildCsp(html));
  expect(buildCsp(html.replace('const POLL_MS', 'const  POLL_MS'))).not.toBe(buildCsp(html));
});
