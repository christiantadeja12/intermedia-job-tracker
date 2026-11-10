import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { buildCsp } from '../../scripts/build.mjs';

// The page is served at https://ocean.test/ and talks to "Supabase" at https://ocean.test/sb (same origin),
// which the test routes to the local gateway. supabase-js (vendor/ on the live site) is served from node_modules.
const GATEWAY = process.env.SB_GATEWAY || 'http://127.0.0.1:54321';
const PAGE = fs.readFileSync(path.resolve('index.html'), 'utf8');
const HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${PAGE}</body></html>`;
// Every test runs under the same Content-Security-Policy the live site sends (Supabase here is same-origin /sb).
const CSP = buildCsp(PAGE, 'https://ocean.test/sb');
const SBJS = fs.readFileSync(path.resolve(process.env.SUPABASE_JS || 'node_modules/@supabase/supabase-js/dist/umd/supabase.js'));
const RESET = process.env.SB_RESET_CMD; // e.g. psql ... -f supabase/test/reset.sql

const THERAPIST = ['therapist@example.test', 'therapist-pass-123'];
const HELPER = ['helper@example.test', 'helper-pass-123'];
const PARENT = ['parent@example.test', 'parent-pass-123'];

// Like page.waitForFunction, but without the eval() that the Content-Security-Policy (rightly) blocks.
async function waitFn(page, fn, arg, {timeout = 30_000} = {}){
  const end = Date.now() + timeout;
  for (;;){
    try { if (await page.evaluate(fn, arg)) return; } catch (e) { if (!/context was destroyed|navigat/i.test(String(e))) throw e; }
    if (Date.now() > end) throw new Error('Timed out waiting for: ' + fn);
    await page.waitForTimeout(100);
  }
}
async function open(page, hash = ''){
  await page.addInitScript(() => { window.LO_SUPABASE = {url: 'https://ocean.test/sb', key: 'sb_publishable_localtest'};
    window.__violations = []; document.addEventListener('securitypolicyviolation', e => window.__violations.push(e.violatedDirective + ' ' + e.blockedURI + ' ' + e.sourceFile + ':' + e.lineNumber + ':' + e.columnNumber + ' ' + (e.sample||''))); });
  await page.route('**/*', async route => {
    const u = route.request().url();
    if (u.startsWith('https://ocean.test/sb/')){
      const r = await route.fetch({url: GATEWAY + u.slice('https://ocean.test/sb'.length)});
      return route.fulfill({response: r});
    }
    if (u.includes('/vendor/supabase-js-')) return route.fulfill({contentType: 'application/javascript', body: SBJS});
    if (u.includes('/vendor/qrcode-generator-')) return route.fulfill({contentType: 'application/javascript', body: fs.readFileSync(path.resolve('vendor', u.split('/').pop()))});
    if (u.startsWith('https://ocean.test/assets/') || u.endsWith('/sw.js')) return route.abort();
    if (u.startsWith('https://ocean.test/')) return route.fulfill({contentType: 'text/html', body: HTML, headers: {'content-security-policy': CSP}});
    return route.abort();
  });
  await page.goto('https://ocean.test/' + hash);
  await waitFn(page, () => window.__ocean && window.__ocean.store && window.__ocean.store.mode === 'supabase');
}
// The local gateway checks real authenticator-app (TOTP) codes; /test/totp gives the current one for a test account.
const totpCode = async email => (await (await fetch(`${GATEWAY}/test/totp?email=${encodeURIComponent(email)}`)).json()).code;
async function passMfa(page, email){
  await page.fill('#mfa-code', await totpCode(email));
  await page.click('#mfa-go');
  await page.locator('#pin, #ns-out').first().waitFor();
}
async function signIn(page, [email, pw], pin = '2468'){
  await page.evaluate(() => { location.hash = '#admin'; });
  await page.locator('#si-email').waitFor();
  await page.fill('#si-email', email); await page.fill('#si-pw', pw); await page.click('#si-go');
  await page.locator('#pin, #ns-out, #mfa-code').first().waitFor();
  if (await page.locator('#mfa-code').count()) await passMfa(page, email);
  if (await page.locator('#pin').count()){
    await page.fill('#pin', pin); if (await page.locator('#pin2').count()) await page.fill('#pin2', pin);
    await page.click('#pin-form button[type=submit]');
    await waitFn(page, () => window.__ocean.A.unlocked && ['fish','clients','achievements','evolutions','audit'].every(k => window.__ocean.A.loaded[k] === true));
  }
}
const tab = async (page, t) => { await page.click(`#adm-tabs [data-tab=${t}]`); await page.waitForTimeout(150); };
const pipId = page => page.evaluate(() => window.__ocean.A.data.fish.find(f => f.nickname === 'Pip').id);
const pipState = page => page.evaluate(() => { const o = window.__ocean, id = o.A.data.fish.find(f => f.nickname === 'Pip').id, d = o.deriveFish(o.A.data.achievements.filter(a => a.fishId === id)); return [d.units, d.level, d.currentUnits]; });
const refreshAdmin = page => page.evaluate(async () => { const s = window.__ocean.store; await Promise.all(['fish','clients','achievements','evolutions','audit'].map(n => s.refresh(n))); });

test.beforeEach(async () => { if (RESET) execSync(RESET, {stdio: 'ignore'}); await fetch(GATEWAY + '/test/reset', {method: 'POST'}); });
test.afterEach(async ({ page }) => {
  const v = await page.evaluate(() => window.__violations || []).catch(() => []);
  await page.unrouteAll({behavior: 'ignoreErrors'});
  expect(v, 'Content-Security-Policy violations').toEqual([]);
});

test('private aquarium: signed-out visitors see a welcome screen and can read no fish data', async ({ page }) => {
  await open(page);
  await expect(page.locator('#tank-note-h')).toHaveText('Welcome to Little Ocean!');
  await expect(page.locator('#tank-note-act')).toBeVisible();
  expect(await page.evaluate(() => window.__ocean.fish.length)).toBe(0);
  const leaks = await page.evaluate(async () => {
    const sb = window.__ocean.store.sb, out = {};
    for (const t of ['public_fish','public_milestones','achievements','clients','fish','evolutions','audit_events','app_settings','staff']){ const r = await sb.from(t).select('*'); out[t] = r.error || !r.data.length ? 'hidden' : r.data.length; }
    out.award = (await sb.rpc('award_achievement', {p_fish: crypto.randomUUID(), p_units: 2, p_title: 'x', p_public_description: 'x', p_private_note: '', p_achieved_at: '2026-01-01', p_public_visible: true, p_idempotency_key: crypto.randomUUID()})).error ? 'refused' : 'ALLOWED';
    out.settings = (await sb.from('public_settings').select('theme_mode')).data.length; // the seasonal look still loads for the welcome screen
    return out;
  });
  expect(leaks).toEqual({public_fish: 'hidden', public_milestones: 'hidden', achievements: 'hidden', clients: 'hidden', fish: 'hidden', evolutions: 'hidden', audit_events: 'hidden', app_settings: 'hidden', staff: 'hidden', award: 'refused', settings: 1});
  await page.click('#tank-note-act');
  await page.locator('#si-email').waitFor();
});

test('private aquarium: a signed-in non-staff account still sees no fish', async ({ page }) => {
  await open(page);
  await signIn(page, PARENT);
  await page.evaluate(() => { location.hash = '#aquarium'; });
  await expect(page.locator('#tank-note-h')).toHaveText('Welcome to Little Ocean!');
  const r = await page.evaluate(async () => { const sb = window.__ocean.store.sb; return [(await sb.from('public_fish').select('*')).data.length, (await sb.from('public_milestones').select('*')).data.length]; });
  expect(r).toEqual([0, 0]);
});

test('staff see the share-safe aquarium; signing out hides it again', async ({ page }) => {
  await open(page);
  await signIn(page, THERAPIST);
  await page.evaluate(() => { location.hash = '#aquarium'; });
  await waitFn(page, () => window.__ocean.allFish.length === 8 && window.__ocean.fish.length === 7);   // Pebble's family hasn't agreed to sharing
  await waitFn(page, () => Object.keys(window.__ocean.TL).length === 8);
  await expect(page.locator('#tank-note')).toBeHidden();
  const r = await page.evaluate(() => { const o = window.__ocean, pebble = o.allFish.find(p => p.nickname === 'Pebble'), tala = o.allFish.find(p => p.nickname === 'Tala');
    return {pebble: o.TL[pebble.id], tala: o.TL[tala.id].items.length, levels: o.allFish.map(p => p.nickname + ':' + p.level).sort().join(',')}; });
  expect(r.pebble.shared).toBe(false); expect(r.pebble.items).toEqual([]);
  expect(r.tala).toBeGreaterThan(0);
  expect(r.levels).toBe('Bantay:2,Lumi:4,Mango:2,Pebble:1,Pip:1,Sunny:3,Tala:3,Ziggy:5');
  const notes = await page.evaluate(async () => JSON.stringify((await window.__ocean.store.sb.from('public_milestones').select('*')).data).includes('Fictional note'));
  expect(notes).toBe(false);
  await page.evaluate(() => { location.hash = '#admin'; });
  await page.click('#adm-signout');
  await page.locator('#si-email').waitFor();
  await waitFn(page, () => window.__ocean.fish.length === 0 && window.__ocean.allFish.length === 0 && Object.keys(window.__ocean.TL).length === 0);
  await page.evaluate(() => { location.hash = '#aquarium'; });
  await expect(page.locator('#tank-note-h')).toHaveText('Welcome to Little Ocean!');
});

test('MFA: staff must set up an authenticator app; the password alone opens nothing', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { location.hash = '#admin'; });
  await page.fill('#si-email', THERAPIST[0]); await page.fill('#si-pw', THERAPIST[1]); await page.click('#si-go');
  await expect(page.locator('#mfa h2')).toHaveText('Set up two-step sign-in');
  await expect(page.locator('#mfa-qr')).toBeVisible();
  expect(await page.locator('#mfa-qr').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true); // the QR image really loads
  await expect(page.locator('#mfa-secret')).toHaveText(/^[A-Z2-7 ]{20,}$/);
  // With only the password, the database still treats this session as a visitor.
  const r = await page.evaluate(async () => { const sb = window.__ocean.store.sb, out = {};
    for (const t of ['public_fish','fish','clients','achievements','audit_events']) out[t] = (await sb.from(t).select('*')).data.length;
    out.award = (await sb.rpc('create_fish', {p_label: 'x', p_consent: false, p_nickname: 'Nope', p_species: 'clown', p_palette: {}, p_personality: 'x'})).error ? 'refused' : 'ALLOWED';
    return out; });
  expect(r).toEqual({public_fish: 0, fish: 0, clients: 0, achievements: 0, audit_events: 0, award: 'refused'});
  expect(await page.evaluate(() => window.__ocean.fish.length)).toBe(0);
  await page.fill('#mfa-code', '000000'); await page.click('#mfa-go');
  await expect(page.locator('#mfa-err')).toHaveText(/didn’t work/);
  await passMfa(page, THERAPIST[0]);
  await expect(page.locator('#pin')).toBeVisible();
  await page.evaluate(() => { location.hash = '#aquarium'; });
  await waitFn(page, () => window.__ocean.allFish.length === 8 && window.__ocean.fish.length === 7);
});

test('MFA: the next sign-in asks only for the code, not a new set-up', async ({ page }) => {
  await open(page);
  await signIn(page, THERAPIST);
  await page.click('#adm-signout');
  await page.locator('#si-email').waitFor();
  await page.fill('#si-email', THERAPIST[0]); await page.fill('#si-pw', THERAPIST[1]); await page.click('#si-go');
  await expect(page.locator('#mfa h2')).toHaveText('Enter your sign-in code');
  await expect(page.locator('#mfa-qr')).toHaveCount(0);
  await passMfa(page, THERAPIST[0]);
  await expect(page.locator('#pin')).toBeVisible();
});

test('backup: reminder, download, then a full restore into an emptied database', async ({ page }) => {
  test.skip(!RESET, 'needs SB_RESET_CMD to reach the database');
  const PSQL = RESET.replace(/\s-f\s+\S+$/, '');
  const sql = q => execSync(`${PSQL} -tA -c "${q}"`).toString().trim();
  // A custom theme with a schedule, an O'Brien-style apostrophe and a manual theme setting, so restore covers them too.
  sql(`insert into public.themes (id, is_custom, name, priority, config) values ('th_backuptest', true, 'Coral''s Party', 55, '{\\"waterTint\\": \\"#33aacc\\"}')`);
  sql("insert into public.theme_schedules (theme_id, start_date, end_date) values ('th_backuptest', '2026-12-01', '2026-12-31')");
  sql("update public.app_settings set theme_mode = 'manual', manual_theme_id = 'th_backuptest' where id = 1");
  sql("update public.fish set species = 'butanding' where nickname = 'Ziggy'");   // a level-5 sea-life look must survive a restore
  const counts = () => sql("select (select count(*) from clients)||','||(select count(*) from fish)||','||(select count(*) from achievements)||','||(select count(*) from evolutions)||','||(select count(*) from audit_events)||','||(select count(*) from achievements where private_note like 'Fictional note%')||','||(select count(*) from themes)||','||(select count(*) from theme_schedules)");
  const before = counts();
  await open(page);
  await signIn(page, THERAPIST);
  await expect(page.locator('#ov-backup')).toContainText('Time for a backup');
  await tab(page, 'settings');
  await expect(page.locator('#bk-last')).toHaveText('No backup downloaded yet.');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#bk-go')]);
  expect(dl.suggestedFilename()).toMatch(/^little-ocean-backup-\d{4}-\d{2}-\d{2}\.sql$/);
  const file = await dl.path();
  const text = fs.readFileSync(file, 'utf8');
  expect(text).toContain('PRIVATE: this file holds client labels');
  expect(text).not.toContain('pbkdf2'); // the PIN hash is never in a backup
  await expect(page.locator('#bk-last')).toContainText('Last backup:');
  await refreshAdmin(page);
  await tab(page, 'overview');
  await expect(page.locator('#ov-backup')).toHaveCount(0);
  // Disaster: every record is gone. The backup puts it all back.
  sql('truncate public.evolutions, public.achievements, public.fish, public.clients, public.audit_events, public.theme_schedules, public.themes restart identity cascade');
  sql("update public.app_settings set theme_mode = 'auto', manual_theme_id = null where id = 1");
  expect(counts()).toBe('0,0,0,0,0,0,0,0');
  execSync(`${PSQL} -f ${file}`, {stdio: 'ignore'});
  const after = counts().split(','), b = before.split(','), same = a => [0, 1, 2, 3, 5, 6, 7].map(i => a[i]).join(',');
  expect(same(after)).toBe(same(b));
  expect(sql("select name || '|' || (config->>'waterTint') from themes where id = 'th_backuptest'")).toBe("Coral's Party|#33aacc");
  expect(sql("select theme_mode || '|' || manual_theme_id from app_settings where id = 1")).toBe('manual|th_backuptest');
  expect(sql("select species from fish where nickname = 'Ziggy'")).toBe('butanding');
  expect(Number(after[4])).toBeGreaterThanOrEqual(Number(b[4])); // audit log back, plus the download note
  // Running it again changes nothing, and it never overwrites newer edits.
  sql("update public.achievements set title = 'Edited after the backup' where title = 'Zipped my jacket'");
  execSync(`${PSQL} -f ${file}`, {stdio: 'ignore'});
  expect(counts()).toBe(after.join(','));
  expect(sql("select count(*) from achievements where title = 'Edited after the backup'")).not.toBe('0');
  // The app works on the restored data.
  await page.evaluate(() => { location.hash = '#aquarium'; });
  await waitFn(page, () => window.__ocean.allFish.length === 8 && window.__ocean.allFish.map(p => p.nickname + ':' + p.level).sort().join(',') === 'Bantay:2,Lumi:4,Mango:2,Pebble:1,Pip:1,Sunny:3,Tala:3,Ziggy:5', null, {timeout: 40_000});
});

test('backup: assistants don’t see the backup tools', async ({ page }) => {
  await open(page);
  await signIn(page, HELPER);
  await expect(page.locator('#ov-backup')).toHaveCount(0);
  await tab(page, 'settings');
  await expect(page.locator('#bk')).toHaveCount(0);
});

test('offline: a staff device keeps the last saved aquarium; signing out clears it', async ({ page }) => {
  await open(page);
  await signIn(page, THERAPIST);
  await page.evaluate(() => { location.hash = '#aquarium'; });
  await waitFn(page, () => window.__ocean.allFish.length === 8 && Object.keys(window.__ocean.TL).length === 8);
  await waitFn(page, () => { const c = JSON.parse(localStorage.getItem('lo.offline') || 'null'); return c && c.pubFish && c.pubFish.length === 8 && c.pubTl; });
  const cached = await page.evaluate(() => localStorage.getItem('lo.offline'));
  expect(cached).not.toContain('Fictional note');            // private notes are never kept on the device
  expect(cached).not.toContain('Sample client');             // nor private labels
  // Brownout: the database can't be reached, and the page reloads.
  await page.route('https://ocean.test/sb/**', r => r.abort('internetdisconnected'));
  await page.reload();
  await waitFn(page, () => window.__ocean && window.__ocean.allFish.length === 8);
  await expect(page.locator('#brand-sub')).toContainText('Offline');
  await expect(page.locator('#tank-note')).toBeHidden();
  // Back online: fresh data, the Offline label goes.
  await page.unroute('https://ocean.test/sb/**');
  await page.evaluate(() => window.__ocean.store.wake());
  await expect(page.locator('#brand-sub')).not.toContainText('Offline', {timeout: 15_000});
  await page.evaluate(() => { location.hash = '#admin'; });
  if (await page.locator('#pin').count()){ await page.fill('#pin', '2468'); await page.click('#pin-form button[type=submit]'); }
  await page.click('#adm-signout');
  await page.locator('#si-email').waitFor();
  expect(await page.evaluate(() => [localStorage.getItem('lo.offline'), localStorage.getItem('lo.role')])).toEqual(['null', 'null']);
});

test('data saving: feeds check 6 times less often after 5 idle minutes', async ({ page }) => {
  await open(page);
  const d = await page.evaluate(() => { const o = window.__ocean, busy = o.pollDelay('pubFish'); o.idleFor(6 * 60000); const idle = o.pollDelay('pubFish'); o.idleFor(0); return [busy, idle, o.pollDelay('pubFish')]; });
  expect(d).toEqual([20000, 120000, 20000]);
});

test('sea-life looks: the database refuses a look the fish hasn’t reached, and allows it once it has', async ({ page }) => {
  await open(page);
  await signIn(page, THERAPIST);
  const r = await page.evaluate(async () => {
    const sb = window.__ocean.store.sb, fish = (await sb.from('fish').select('id,nickname,species,client_id')).data, clients = (await sb.from('clients').select('id,private_label,share_consent')).data;
    const args = (f, sp) => { const c = clients.find(x => x.id === f.client_id); return {p_fish: f.id, p_label: c.private_label, p_consent: c.share_consent, p_nickname: f.nickname, p_species: sp, p_palette: {body: '#4f74ad', fin: '#3c5f95', pat: '#f4f8ff'}, p_personality: 'Graceful glider'}; };
    const pip = fish.find(f => f.nickname === 'Pip'), ziggy = fish.find(f => f.nickname === 'Ziggy'), tala = fish.find(f => f.nickname === 'Tala');
    const out = {};
    out.pipButanding = (await sb.rpc('update_fish', args(pip, 'butanding'))).error ? 'refused' : 'ALLOWED';         // level 1
    out.talaDugong = (await sb.rpc('update_fish', args(tala, 'dugong'))).error ? 'refused' : 'ALLOWED';            // level 3
    out.talaPawikan = (await sb.rpc('update_fish', args(tala, 'pawikan'))).error ? 'refused' : 'allowed';          // level 3
    out.ziggyButanding = (await sb.rpc('update_fish', args(ziggy, 'butanding'))).error ? 'refused' : 'allowed';    // level 5
    out.newFish = (await sb.rpc('create_fish', {p_label: 'x', p_consent: false, p_nickname: 'Sharky', p_species: 'butanding', p_palette: {body: '#4f74ad', fin: '#3c5f95', pat: '#f4f8ff'}, p_personality: 'Graceful glider'})).error ? 'refused' : 'ALLOWED';
    out.newClown = (await sb.rpc('create_fish', {p_label: 'y', p_consent: false, p_nickname: 'Clowny', p_species: 'clown', p_palette: {body: '#ff8a3d', fin: '#ff6b2c', pat: '#ffffff'}, p_personality: 'Graceful glider'})).error ? 'REFUSED' : 'allowed';
    return out;
  });
  expect(r).toEqual({pipButanding: 'refused', talaDugong: 'refused', talaPawikan: 'allowed', ziggyButanding: 'allowed', newFish: 'refused', newClown: 'allowed'});
  await page.evaluate(() => { location.hash = '#aquarium'; });
  await waitFn(page, () => window.__ocean.allFish.some(p => p.nickname === 'Ziggy' && p.species === 'butanding'), null, {timeout: 40_000});
});

test('family link: the family sees only their child; a new link or turning it off stops the old one', async ({ page, browser }) => {
  await open(page);
  await signIn(page, THERAPIST);
  await tab(page, 'fish');
  const tala = await page.evaluate(() => window.__ocean.A.data.fish.find(f => f.nickname === 'Tala').id);
  const makeLink = async () => {
    await page.click(`[data-act=flink][data-id="${tala}"]`);
    await page.check('#fl-ok'); await page.click('#fl-make');
    const url = await page.locator('#fl-url').inputValue();
    await waitFn(page, () => document.querySelector('#fl-qr') && !document.querySelector('#fl-qr').hidden && document.querySelector('#fl-qr').width > 100);  // QR code drawn under the live CSP
    await page.click('#dlg-body [data-close]');
    return url.split('#')[1];
  };
  const link1 = await makeLink();
  expect(link1).toMatch(/^f\/[0-9a-f]{64}$/);
  // The family's phone: a separate browser, never signed in.
  const ctx = await browser.newContext(), fam = await ctx.newPage();
  await open(fam, '#' + link1);
  await waitFn(fam, () => window.__ocean.familyMode && window.__ocean.fish.length === 1);
  const seen = await fam.evaluate(() => ({nick: window.__ocean.fish[0].data.nick, tl: Object.keys(window.__ocean.TL).length, items: JSON.stringify(window.__ocean.TL)}));
  expect(seen.nick).toBe('Tala'); expect(seen.tl).toBe(1);
  expect(seen.items).not.toMatch(/Fictional note|Sample client|private/i);
  await expect(fam.locator('#fam-bar')).toContainText('Tala’s aquarium');
  await expect(fam.locator('#brand-sub')).toHaveText('Family view');
  await expect(fam.locator('#btn-admin')).toBeHidden();
  // The link opens nothing else: the shared views stay closed to this visitor.
  const leak = await fam.evaluate(async () => { const sb = window.__ocean.store.sb; const n = r => (r.data || []).length; return [n(await sb.from('public_fish').select('*')), n(await sb.from('family_links').select('*'))]; });   // refused or empty
  expect(leak).toEqual([0, 0]);
  // Achievements and the certificate work for the family.
  await fam.click('#fam-view');
  await expect(fam.locator('#p-name')).toHaveText('Tala');
  await expect(fam.locator('#p-ms .ms').first()).toBeVisible();
  await fam.click('#p-cert');
  await expect(fam.locator('#cert-img')).toBeVisible();
  // The staff area shows it was opened.
  await page.click(`[data-act=flink][data-id="${tala}"]`);
  await expect(page.locator('#dlg-body')).toContainText('last opened');
  await page.click('#dlg-body [data-close]');
  // A new link stops the old one.
  const link2 = await makeLink();
  expect(link2).not.toBe(link1);
  await fam.reload();
  await waitFn(fam, () => window.__ocean && window.__ocean.familyMode && document.querySelector('#tank-note-h').textContent.includes('doesn’t work'));
  expect(await fam.evaluate(() => window.__ocean.fish.length)).toBe(0);
  // Turning it off stops the new one too.
  await open(fam, '#' + link2);
  await waitFn(fam, () => window.__ocean.fish.length === 1);
  await page.click(`[data-act=flink][data-id="${tala}"]`);
  await page.click('#fl-off');
  await waitFn(fam, () => window.__ocean.store.familyView(location.hash.slice(3)).then(v => v === null));
  const audit = await page.evaluate(async () => (await window.__ocean.store.sb.from('audit_events').select('action').like('action', 'family_link%')).data.map(r => r.action).sort());
  expect(audit).toEqual(['family_link.created', 'family_link.created', 'family_link.revoked']);
  await ctx.close();
});

test('family link: only staff can make one, and wrong codes get nothing', async ({ page }) => {
  await open(page);
  const r = await page.evaluate(async () => {
    const sb = window.__ocean.store.sb, fishId = '00000000-0000-0000-0000-000000000000';
    return {make: (await sb.rpc('create_family_link', {p_fish: fishId})).error ? 'refused' : 'ALLOWED',
            off: (await sb.rpc('revoke_family_link', {p_fish: fishId})).error ? 'refused' : 'ALLOWED',
            junk: (await sb.rpc('family_view', {p_token: "x' or 1=1 --"})).data, guess: (await sb.rpc('family_view', {p_token: 'f'.repeat(64)})).data};
  });
  expect(r).toEqual({make: 'refused', off: 'refused', junk: null, guess: null});
});

test('templates: the database starts with the same 24 templates as the app; only therapists change them', async ({ page }) => {
  await open(page);
  await signIn(page, THERAPIST);
  const r = await page.evaluate(async () => {
    const o = window.__ocean, db = await o.store.listTemplates(), app = o.starterTemplateRows();
    const key = t => [t.id, t.area, t.units, t.titleEn, t.descEn, t.titleFil, t.descFil].join('|');
    return {n: db.length, same: JSON.stringify(db.map(key).sort()) === JSON.stringify(app.map(key).sort())};
  });
  expect(r).toEqual({n: 24, same: true});
  await tab(page, 'templates');
  await page.click('#tp-add');
  await page.fill('#tp-te', 'Opened a lunchbox'); await page.fill('#tp-de', 'I opened my lunchbox by myself.');
  await page.click('#tp-save');
  await expect(page.locator('.tp-item', {hasText: 'Opened a lunchbox'})).toBeVisible();
});

test('templates: assistants can use them but not change them', async ({ page }) => {
  await open(page);
  await signIn(page, HELPER);
  const r = await page.evaluate(async () => {
    const sb = window.__ocean.store.sb;
    return {read: (await sb.from('milestone_templates').select('id')).data.length,
            save: (await sb.rpc('save_template', {p_id: null, p_area: 'sensory', p_units: 1, p_title_en: 'x', p_desc_en: 'y', p_title_fil: '', p_desc_fil: ''})).error ? 'refused' : 'ALLOWED',
            hide: (await sb.rpc('archive_template', {p_id: '00000000-0000-4d00-8000-000000000001', p_archived: true})).error ? 'refused' : 'ALLOWED'};
  });
  expect(r).toEqual({read: 24, save: 'refused', hide: 'refused'});
  await tab(page, 'templates');
  await expect(page.locator('#tp-add')).toHaveCount(0);
});

test('categories: therapists add, rename and hide them; tags survive; assistants are refused', async ({ page, browser }) => {
  await open(page);
  await signIn(page, THERAPIST);
  await tab(page, 'templates');
  await expect(page.locator('#cat .tp-item')).toHaveCount(6);
  await page.click('#cat-add');
  await page.fill('#cat-en', 'Feeding'); await page.fill('#cat-fil', 'Pagkain');
  await page.click('#cat-save');
  await expect(page.locator('#cat .tp-item', {hasText: 'Feeding'})).toContainText('Pagkain');
  const r = await page.evaluate(async () => {
    const sb = window.__ocean.store.sb, ga = (await sb.from('goal_areas').select('id,name_en,name_fil').eq('name_en', 'Feeding')).data[0];
    const dup = (await sb.rpc('save_goal_area', {p_id: null, p_name_en: ' feeding ', p_name_fil: ''})).error;
    const fish = (await sb.from('fish').select('id').eq('nickname', 'Tala')).data[0].id;
    const aw = await sb.rpc('award_achievement', {p_fish: fish, p_units: 1, p_title: 'Used a spoon', p_public_description: 'I ate with a spoon.', p_private_note: '',
      p_achieved_at: new Date().toISOString().slice(0, 10), p_public_visible: true, p_idempotency_key: crypto.randomUUID(), p_goal_area: ga.id});
    const bad = (await sb.rpc('award_achievement', {p_fish: fish, p_units: 1, p_title: 'x', p_public_description: 'y', p_private_note: '',
      p_achieved_at: new Date().toISOString().slice(0, 10), p_public_visible: true, p_idempotency_key: crypto.randomUUID(), p_goal_area: 'not_a_category'})).error;
    await sb.rpc('save_goal_area', {p_id: ga.id, p_name_en: 'Eating', p_name_fil: 'Pagkain'});
    await sb.rpc('archive_goal_area', {p_id: ga.id, p_archived: true});
    const star = (await sb.from('achievements').select('goal_area').eq('title', 'Used a spoon')).data[0];
    const after = (await sb.from('goal_areas').select('name_en,archived_at').eq('id', ga.id)).data[0];
    const audit = (await sb.from('audit_events').select('action').like('action', 'category.%')).data.map(a => a.action).sort();
    return {id: ga.id, dup: dup && dup.code, awarded: !aw.error, bad: !!bad, star: star.goal_area === ga.id, name: after.name_en, hidden: !!after.archived_at, audit};
  });
  expect(r.id).toMatch(/^ga_[0-9a-f]{12}$/);
  expect(r).toMatchObject({dup: '23505', awarded: true, bad: true, star: true, name: 'Eating', hidden: true, audit: ['category.created', 'category.hidden', 'category.renamed']});
  // An assistant can read categories but not change them.
  const ctx = await browser.newContext(); const p2 = await ctx.newPage();
  await open(p2); await signIn(p2, HELPER);
  const h = await p2.evaluate(async () => { const sb = window.__ocean.store.sb;
    return {read: (await sb.from('goal_areas').select('id')).data.length,
            add: (await sb.rpc('save_goal_area', {p_id: null, p_name_en: 'Nope', p_name_fil: ''})).error ? 'refused' : 'ALLOWED',
            hide: (await sb.rpc('archive_goal_area', {p_id: 'sensory', p_archived: true})).error ? 'refused' : 'ALLOWED'}; });
  expect(h).toEqual({read: 7, add: 'refused', hide: 'refused'});
  await tab(p2, 'templates');
  await expect(p2.locator('#cat-add')).toHaveCount(0);
  await ctx.close();
});

test('quick award from the aquarium saves the goal area; a correction keeps it', async ({ page }) => {
  await open(page);
  await signIn(page, THERAPIST);
  await page.evaluate(() => { location.hash = '#aquarium'; });
  await waitFn(page, () => window.__ocean.fish.some(f => f.data.nick === 'Tala'));
  await page.evaluate(() => { const o = window.__ocean; o.openProfile(o.fish.find(f => f.data.nick === 'Tala')); });
  await page.click('#p-give');
  if (await page.locator('#wp-pin').count()){ await page.fill('#wp-pin', '2468'); await page.click('#wp-f button[type=submit]'); }
  await page.click('.qa-item:has-text("Washed my hands")');
  await page.click('#qa-go');
  await expect(page.locator('#dlg')).toBeHidden();
  const row = await page.evaluate(async () => (await window.__ocean.store.sb.from('achievements').select('id,goal_area,units').eq('title', 'Washed my hands')).data);
  expect(row).toHaveLength(1); expect(row[0].goal_area).toBe('self_care');
  const corrected = await page.evaluate(async id => { const sb = window.__ocean.store.sb; await sb.rpc('change_achievement_units', {p_id: id, p_units: 2, p_reason: 'was a full star'});
    return (await sb.from('achievements').select('goal_area,status').eq('title', 'Washed my hands')).data.map(r => r.status + ':' + r.goal_area).sort(); }, row[0].id);
  expect(corrected).toEqual(['active:self_care', 'corrected:self_care']);
  const moved = await page.evaluate(async () => { const sb = window.__ocean.store.sb, a = (await sb.from('achievements').select('id').eq('title', 'Washed my hands').eq('status', 'active')).data[0];
    await sb.rpc('set_achievement_area', {p_id: a.id, p_area: 'fine_motor'}); return (await sb.from('achievements').select('goal_area').eq('id', a.id)).data[0].goal_area; });
  expect(moved).toBe('fine_motor');
});

test('sign-in: wrong password refused, non-staff account told to ask the therapist', async ({ page }) => {
  await open(page);
  await page.evaluate(() => { location.hash = '#admin'; });
  await page.fill('#si-email', THERAPIST[0]); await page.fill('#si-pw', 'wrong'); await page.click('#si-go');
  await expect(page.locator('#si-err')).toHaveText(/don’t match/);
  await page.fill('#si-email', PARENT[0]); await page.fill('#si-pw', PARENT[1]); await page.click('#si-go');
  await expect(page.locator('#admin')).toContainText('isn’t on the staff list');
  await page.click('#ns-out');
  await page.locator('#si-email').waitFor();
});

test('therapist awards: duplicate counted once, evolution once, aquarium updates', async ({ page }) => {
  await open(page);
  await signIn(page, THERAPIST);
  const award = async (units, title, double = false) => {
    await tab(page, 'award');
    if (await page.locator('#dn-again').count()){ await page.click('#dn-again'); }
    await page.selectOption('#aw-fish', await pipId(page));
    await page.check(`input[name=aw-units][value="${units}"]`, {force: true});
    await page.fill('#aw-title', title); await page.fill('#aw-desc', 'I did it: ' + title); await page.fill('#aw-note', 'Fictional private note');
    await page.check('#aw-share');
    if (double) await page.evaluate(() => { const f = document.getElementById('aw'); f.requestSubmit(); f.requestSubmit(); });
    else await page.click('#aw-save');
    await page.locator('#dn-again').waitFor();
    await refreshAdmin(page);
  };
  await award(2, 'Full', true); expect(await pipState(page)).toEqual([8, 1, 8]);
  await award(1, 'Half');       expect(await pipState(page)).toEqual([9, 1, 9]);
  await award(2, 'Evolve');     expect(await pipState(page)).toEqual([11, 2, 1]);
  await expect(page.locator('.done h3')).toContainText('evolved');
  const evo = await page.evaluate(async () => { const o = window.__ocean, id = o.A.data.fish.find(f => f.nickname === 'Pip').id; return o.A.data.evolutions.filter(e => e.fishId === id).map(e => e.toLevel + (e.reversedAt ? ':undone' : ':active')); });
  expect(evo).toEqual(['2:active']);
  await page.click('a[href="#aquarium"]');
  await waitFn(page, () => { const f = window.__ocean.fish.find(x => x.data.nick === 'Pip'); return f && f.data.prog.level === 2; }, null, {timeout: 30_000});
  await waitFn(page, () => !document.getElementById('evo-banner').hidden || window.__ocean.fish.some(f => f.evo), null, {timeout: 15_000});
  const shared = await page.evaluate(() => { const f = window.__ocean.fish.find(x => x.data.nick === 'Pip'); return window.__ocean.TL[f.id].items.map(i => i.title || 'evolution'); });
  expect(shared).toContain('Evolve');
  expect(JSON.stringify(shared)).not.toContain('Fictional private note');
});

test('corrections: void and change stars keep history and write the audit log', async ({ page }) => {
  await open(page);
  await signIn(page, THERAPIST);
  await tab(page, 'history');
  await page.selectOption('#hx-fish', await pipId(page));
  await page.locator('[data-led=void]').first().click();
  await page.fill('#cx-reason', 'Entered by mistake'); await page.click('#cx-save');
  await waitFn(page, () => document.getElementById('dlg').hidden);
  await refreshAdmin(page);
  expect((await pipState(page))[0]).toBeLessThan(6);
  await page.locator('[data-led=points]').first().click();
  const cur = await page.evaluate(() => document.querySelector('input[name=cx-u]:checked').value);
  await page.check(`input[name=cx-u][value="${cur === '2' ? 1 : 2}"]`, {force: true});
  await page.fill('#cx-reason', 'Corrected amount'); await page.click('#cx-save');
  await waitFn(page, () => document.getElementById('dlg').hidden);
  await page.locator('[data-led=edit]').first().click();
  await page.fill('#cx-title', 'Renamed milestone'); await page.fill('#cx-reason', 'Clearer title'); await page.click('#cx-save');
  await waitFn(page, () => document.getElementById('dlg').hidden);
  await refreshAdmin(page);
  const actions = await page.evaluate(() => window.__ocean.A.data.audit.map(a => a.action));
  for (const a of ['achievement.voided', 'achievement.points_changed', 'achievement.edited']) expect(actions).toContain(a);
  const statuses = await page.evaluate(() => { const o = window.__ocean, id = o.A.data.fish.find(f => f.nickname === 'Pip').id; return o.A.data.achievements.filter(a => a.fishId === id).map(a => a.status); });
  expect(statuses).toContain('voided'); expect(statuses).toContain('corrected');
});

test('fish management: add, duplicate nickname refused, edit, archive', async ({ page }) => {
  await open(page);
  await signIn(page, THERAPIST);
  await tab(page, 'fish');
  await page.click('#fx-add');
  await page.fill('#ff-label', 'Sample client J (fictional)'); await page.fill('#ff-nick', 'Coral'); await page.click('#ff-save');
  await waitFn(page, () => document.getElementById('dlg').hidden);
  await waitFn(page, () => window.__ocean.A.data.fish.some(f => f.nickname === 'Coral'), null, {timeout: 15_000});
  const coral = await page.evaluate(() => window.__ocean.A.data.fish.find(f => f.nickname === 'Coral').id);
  await page.click(`[data-act=edit][data-id="${coral}"]`);
  await page.fill('#ff-nick', 'Coralie'); await page.click('#ff-save');
  await waitFn(page, () => document.getElementById('dlg').hidden);
  // a second browser-level check bypassing the form's own duplicate check: the database refuses it
  const dup = await page.evaluate(async () => { try { await window.__ocean.store.createFish({label: 'X (fictional)', consent: false, nickname: 'Tala', species: 'clown', persona: 'Shy peeker', palette: {body:'#ff8a3d', fin:'#ff6b2c', pat:'#ffffff'}}); return 'saved'; } catch (e) { return e.message; } });
  expect(dup).toMatch(/nickname/);
  await refreshAdmin(page);
  await tab(page, 'fish');
  await page.click(`[data-act=archive][data-id="${coral}"]`); await page.click('#ar-go');
  await waitFn(page, () => document.getElementById('dlg').hidden);
  await page.evaluate(() => window.__ocean.store.refresh('pubFish'));
  await waitFn(page, () => !window.__ocean.fish.some(f => f.data.nick === 'Coralie'));
});

test('themes: manual mode, custom theme with uploaded image, delete', async ({ page }) => {
  await open(page);
  await signIn(page, THERAPIST);
  await tab(page, 'themes');
  await page.check('input[name=tm][value=manual]', {force: true});
  await page.selectOption('#tm-pick', 'christmas'); await page.click('#tm-save');
  await waitFn(page, () => window.__ocean.currentTheme.id === 'christmas', null, {timeout: 15_000});
  await page.check('input[name=tm][value=auto]', {force: true}); await page.click('#tm-save');
  await waitFn(page, () => window.__ocean.currentTheme.id === window.__ocean.resolveTheme(window.__ocean.THEMES, null, new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Manila'}).format(new Date())).theme.id, null, {timeout: 15_000});
  await page.click('#th-new');
  const png = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 320; c.height = 180; const g = c.getContext('2d'); g.fillStyle = '#a462ff'; g.fillRect(0, 0, 320, 180); return c.toDataURL('image/png').split(',')[1]; });
  await page.setInputFiles('#ct-bg', {name: 'bg.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64')});
  await page.fill('#ct-name', 'Clinic Party');
  const [from, to] = await page.evaluate(() => { const f = d => new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Manila'}).format(new Date(Date.now() + d*864e5)); return [f(-3), f(3)]; });
  await page.click('#rg-add'); await page.locator('#rg .rg-s').last().fill(from); await page.locator('#rg .rg-e').last().fill(to);
  await page.fill('#ct-pr', '80'); await page.click('#ct-save');
  await waitFn(page, () => document.getElementById('dlg').hidden);
  await waitFn(page, () => window.__ocean.currentTheme.name === 'Clinic Party', null, {timeout: 15_000});
  const bgUrl = await page.evaluate(() => window.__ocean.currentTheme.bg.url);
  expect(bgUrl).toContain('/storage/v1/object/public/theme-assets/');
  const img = await page.evaluate(async u => (await fetch(u)).status, bgUrl);
  expect(img).toBe(200);
  const id = await page.evaluate(() => window.__ocean.currentTheme.id);
  await page.click(`[data-del="${id}"]`); await page.click('#td-go');
  await waitFn(page, () => window.__ocean.currentTheme.id === window.__ocean.resolveTheme(window.__ocean.THEMES, null, new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Manila'}).format(new Date())).theme.id, null, {timeout: 15_000});
});

test('assistant can award stars but cannot change themes or settings', async ({ page }) => {
  await open(page);
  await signIn(page, THERAPIST); // therapist sets the PIN first
  await page.click('#adm-signout'); await page.locator('#si-email').waitFor();
  await signIn(page, HELPER);
  await tab(page, 'award');
  await page.fill('#aw-title', 'Helper award'); await page.fill('#aw-desc', 'Nice work'); await page.click('#aw-save');
  await page.locator('#dn-again').waitFor();
  await tab(page, 'themes');
  await page.check('input[name=tm][value=manual]', {force: true}); await page.click('#tm-save');
  await expect(page.locator('#tm-err')).toHaveText(/.+/);
  await tab(page, 'settings');
  await page.click('#st-save');
  await expect(page.locator('#st-err')).toHaveText(/allowed/);
});

test('settings: sensory defaults, PIN change, remove sample data', async ({ page }) => {
  await open(page);
  await signIn(page, THERAPIST);
  await tab(page, 'settings');
  await page.check('input[name=st-fx][value=gentle]', {force: true}); await page.click('#st-save');
  await expect(page.locator('#st-ok')).toBeVisible();
  await waitFn(page, () => window.__ocean.state.effects === 'gentle', null, {timeout: 15_000});
  await page.fill('#cp-old', '2468'); await page.fill('#cp-new', '13579'); await page.fill('#cp-new2', '13579');
  await page.click('#cp button[type=submit]');
  await expect(page.locator('#cp-ok')).toBeVisible();
  await page.click('#sd-rm'); await page.fill('#sd-type', 'REMOVE'); await page.click('#sd-go');
  await waitFn(page, () => document.getElementById('dlg').hidden, null, {timeout: 15_000});
  await page.evaluate(() => window.__ocean.store.refresh('pubFish'));
  await waitFn(page, () => window.__ocean.fish.length === 0, null, {timeout: 15_000});
  await page.click('#adm-lock');
  await page.fill('#pin', '2468'); await page.click('#pin-form button[type=submit]');
  await expect(page.locator('#pin-err')).toHaveText(/isn’t right/);
  await page.fill('#pin', '13579'); await page.click('#pin-form button[type=submit]');
  await waitFn(page, () => window.__ocean.A.unlocked);
});
