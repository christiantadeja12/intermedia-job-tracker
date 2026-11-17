# Deployment and go-live guide

This guide covers running the prototype, moving it to GitHub with Supabase, and what has to happen before any real client data is entered. **Nothing here authorises a production launch**: going live, onboarding real clients or opening public access each need the project owner's separate, explicit approval.

---

## Sharing switches, link duration and deleting archived fish: what changes for you

This update changes how milestones are shared, how long a family link lasts, and adds a way to permanently delete archived fish. **Your existing fish, stars, evolutions and history stay as they are.**

1. **Upload the changed files to GitHub:** `index.html`, `supabase/014_sharing_expiry_delete.sql`, `supabase/003_sample_data.sql`, `supabase/test/`, `tests/`, `docs/` and `README.md`. Cloudflare rebuilds by itself.
2. **Run the database update:** Supabase → SQL Editor → New query → paste `supabase/014_sharing_expiry_delete.sql` → Run. Run it AFTER `013_evolve_at_3_5_stars.sql`. It only adds two switches per child, an expiry date on family links and the delete function; it removes nothing.
3. **Refresh the site and check each child's settings** (see below). Do not run `003_sample_data.sql` on a project with real data.

**What's new**
- **One switch per child instead of a tick on every achievement.** Therapist area → Fish & clients → **Edit**: **Show all milestones in the family aquarium (family link)** and **Also show milestones on the main aquarium**. One tick covers every milestone, past and future; untick to hide them all. The main aquarium also needs the family's sharing consent, as before. Private notes are never shown. The old "Approve the title and description for the shared profile" tick is gone from Award stars, Quick award and Edit details.
- **What stays visible on the first run:** a child's switches are turned on automatically only when ALL of that child's milestones were already approved. Every other child starts with both switches off, so nothing that was private becomes visible. Tick the switch for each child you want to share. Level-ups still show in the family aquarium either way.
- **Family link duration.** Family link → choose **1 day, 1 week or 1 month (30 days)** before making the link. The dialog and the "link is turned on" message show when it ends. When it expires the family sees "This link doesn't work any more"; make a new link to give them more time. Links made before this update never expire until you turn them off or make a new one.
- **Delete all archived fish.** Archive a fish first, as before (it can be restored). Then Fish & clients → tick **Show archived** → **Delete all archived fish…**. You get a warning that **once deleted it is gone and cannot be brought back**, then a separate final button. Therapists only. It deletes every archived fish with its stars, level-ups, history, family link, family aquarium settings, client record and its entries in the audit log, then records one audit entry that says only how many were deleted (no names). Active fish are never touched. Give the family their summary first if they may need it. Backups taken before the deletion still contain the data.

---

## Editable categories: what changes for you

Therapists can now rename the therapy-area categories (English and Filipino), add new ones, and hide ones they don't use. Everything is in **Therapist area → Templates → Categories**. Hiding a category takes it out of the pickers (award form, template form, quick award), but stars and templates already tagged with it keep the tag, still show the name, and still count in Progress. **Show hidden categories and templates** lets you restore one. Assistants can use categories but can't change them. Every change goes in the audit log.

1. **Upload the changed files to GitHub:** `index.html`, `supabase/007_phase4d.sql`, `supabase/008_categories.sql`, `supabase/test/`, `tests/`, `docs/` and `README.md`.
2. **Run the database update:** Supabase → SQL Editor → New query → paste `supabase/008_categories.sql` → Run. (Run `007_phase4d.sql` first if you haven't yet.) It's safe to run more than once, and your six current categories keep their names and every existing tag.
3. Wait for the Cloudflare build to finish, refresh the site, and open **Templates**: you should see the six categories at the top.

## Phase 4D: what changes for you

Phase 4D makes awarding stars fast during a session and progress notes easy to write.

1. **Upload the changed files to GitHub:** `index.html`, `supabase/007_phase4d.sql`, `supabase/test/`, `tests/`, `docs/` and `README.md`.
2. **Run the database update:** Supabase → SQL Editor → New query → paste `supabase/007_phase4d.sql` → Run. It adds 24 starter templates (4 per area) the first time; running it again never adds them twice.

**What's new**
- **Templates tab:** ready-made milestones grouped by therapy area (fine motor, gross motor, sensory regulation, self-care, handwriting, play and social), each in English and Filipino. Therapists can add, edit and hide them; assistants can use them.
- **Award stars:** "Start from a template" fills in the title, description, stars and area, in English or Filipino. You can still change anything before saving.
- **Give a star (quick award):** in the aquarium, double-tap a fish → **Give a star** → PIN → tap a template → **Give star**. Tick "Approve…" if it may appear on the shared profile; the device remembers your last choice. A double tap still adds the star only once.
- **Goal areas:** every star can be tagged with a therapy area. Older stars can be tagged in History → Edit details. A star whose size is corrected keeps its area.
- **Progress:** Fish & clients → **Progress** shows stars per area for the last 30 and 90 days and all time, with a summary you can copy into a progress note.

---

## Phase 4C: what changes for you

Phase 4C lets families follow their own child from their phone. **Sharing a link with a real family is a go-live step:** do it only after the privacy sign-off and with the signed consent form (box 3).

1. **Upload the new and changed files to GitHub:** `index.html`, `vendor/qrcode-generator-1.4.4.js` (new), `supabase/006_phase4c.sql`, `tests/`, `supabase/test/`, `docs/` and `README.md`.
2. **Run the database update:** Supabase → SQL Editor → New query → paste `supabase/006_phase4c.sql` → Run.

**Making a family link**
- Therapist area → Fish & clients → the child's fish → **Family link** → tick that the family agreed → **Make link**.
- Copy the link or save the QR code and send it **only** to that child's parents or guardians, in a private chat (for example Messenger, not a group chat).
- The link is shown only once. Lost it? Make a new one: the old link stops working at once. **Turn off link** stops it completely (for example when therapy ends or a phone is lost).
- The dialog shows when the link was last opened.

**What the family sees:** only their child's fish swimming, its level and stars, and the milestones you approved, in English or Filipino. Never other children, private notes or the client label. When the fish evolves, the family can open an **Evolution certificate** picture and save or share it.

**Good to know:** the database keeps only a scrambled fingerprint of each link, so nobody can read a link back out of Supabase. Backups don't include family links; after a restore, make new links.

---

## Phase 4B: what changes for you

Phase 4B makes the aquarium feel local and work on slow or no connections. Do these once, after approving 4B:

1. **Upload the new and changed files to GitHub:** `index.html`, `sw.js`, the `assets` folder (fonts), the `vendor` folder (database library), `scripts/build.mjs`, `supabase/005_phase4b.sql`, `tests/`, `supabase/test/`, `docs/` and `README.md`. Cloudflare rebuilds by itself; the build command stays `node scripts/build.mjs`.
2. **Run the database update:** Supabase → SQL Editor → New query → paste `supabase/005_phase4b.sql` → Run. It lets fish use the new pawikan, dugong and butanding looks once they reach the right level.
3. **Choose your settings:** Therapist area → Settings → Sensory defaults:
   - **Language for children:** English or Filipino. Each device can still choose in Comfort settings.
   - **The shared aquarium shows:** only fish whose families agreed to sharing (recommended, and the default), or every fish.

**What's new for you and the children**
- **Focus mode:** tap **Focus** (the target button) in the aquarium, enter the PIN, and pick a child. Only their fish swims during the session, even if their family hasn't agreed to sharing. Tap **Show everyone** to finish.
- **Filipino:** instructions, fish tricks, evolution messages, profiles and Comfort settings. The therapist area stays in English. Milestone titles and descriptions appear exactly as you type them, in either language.
- **Philippine calendar:** Early Christmas from 16 September (lanterns only), National Children's Month in November, Autism Consciousness Week (third week of January), National Disability Rights Week (17–23 July) and Buwan ng Wika in August. Change any dates in Themes.
- **Philippine sea life:** in Fish & clients → Edit, a fish at level 3 can become a **pawikan**, level 4 a **dugong**, and an Ocean Champion (level 5) a **butanding**. A nice reward to choose with the child.
- **Light on data:** fonts and the database library now come from your own site; the aquarium checks for updates 6 times less often after 5 minutes without a tap.
- **Brownouts:** a signed-in clinic device keeps the last saved aquarium. With no connection it still opens and shows the fish, marked **Offline**. Only share-safe details are kept (code names, looks, levels, approved milestones), never notes or labels, and signing out deletes them.

---

## Phase 4A: what changes for you

Phase 4A makes the site safe for real use. Do these once, in this order, **after** you have approved the Supabase connection on the live site.

1. **Run the database update.** Supabase → SQL Editor → New query → paste `supabase/004_phase4a.sql` → Run. From now on:
   - signed-out visitors see a welcome screen instead of the fish;
   - every staff account needs an authenticator-app code (two-step sign-in, MFA) as well as the password.
2. **Change the Cloudflare build command.** Cloudflare → Workers & Pages → little-ocean-of-achievements → Settings → Build → Build command: `node scripts/build.mjs`. This adds the Content-Security-Policy, computed from the page each time it builds.
3. **Upload the new files to GitHub:** `index.html`, `scripts/build.mjs`, `supabase/004_phase4a.sql`, `docs/`, `tests/`, `supabase/test/`, `wrangler.jsonc` and `package-lock.json`.
   - The keep-awake job must live in a hidden `.github` folder on GitHub, which Windows folders can't easily hold. Its contents are in `github-actions/keep-awake.yml` in your Phase 4A folder. On GitHub, choose **Add file → Create new file**, type `.github/workflows/keep-awake.yml` as the name (the slashes create the folders), paste the file's contents, and commit.
4. **Turn on the keep-awake job.** GitHub → your repository → **Actions** → if asked, enable workflows → **Keep Supabase awake** → **Run workflow**. A green tick means it works. It then runs every 2 days by itself; if it ever fails, GitHub emails you.
5. **Sign in on the live site.** You'll be asked to set up two-step sign-in: install Google Authenticator or Microsoft Authenticator on your phone, scan the code, and type the 6-digit code. Then enter your PIN as usual.
6. **Download your first backup:** Therapist area → Settings → Backups → Download backup. Save it on an encrypted or password-protected drive. The Overview tab reminds you when a week has passed.

**Important:** if you ever re-run `schema.sql` or `002_app_connection.sql`, run `004_phase4a.sql`, `005_phase4b.sql`, `006_phase4c.sql`, `007_phase4d.sql` and `008_categories.sql` again afterwards. The older files would otherwise switch two-step sign-in off and refuse the sea-life looks.

### If someone loses their authenticator

Their staff account can't open the therapist area or see the fish until their two-step sign-in is reset. In Supabase → SQL Editor, run (with their email):

```sql
delete from auth.mfa_factors where user_id = (select id from auth.users where email = 'their@email.com');
```

The next time they sign in, the app asks them to set it up again. This works for your own account too, because the Supabase dashboard has its own separate sign-in.

### Restoring from a backup

Supabase → SQL Editor → New query → paste the whole backup file → Run. It only adds records that are missing; it never changes or deletes what's already there. Then set the PIN again (backups never contain it). To restore into a brand-new Supabase project, first run `schema.sql`, `002_app_connection.sql`, `004_phase4a.sql`, `005_phase4b.sql`, `006_phase4c.sql`, `007_phase4d.sql` and `008_categories.sql`, and add yourself as therapist. Family links aren't in backups: make new ones afterwards.

### Giving a family their summary at discharge

Therapist area → Fish & clients → the child's fish → **Family summary** → **Print or save as PDF**. It shows the code name, level, stars and approved milestones only, never private notes or the client label. The Archive dialog offers it too.

---

## 1. Where things stand

The same `index.html` picks its data source automatically:

| Where it runs | Data source | Sign-in |
| --- | --- | --- |
| Claude artifact | The artifact's private database | Claude account: owner and Editors |
| Cloudflare / any other host | Supabase (`SUPABASE_DEFAULT` in `index.html`) | Supabase staff accounts (email + password + authenticator code), then the PIN child-lock |
| Supabase unreachable, or the library didn't load | Demo mode: fictional fish, nothing saved | — |

### Who can see what (Supabase build)

- **Anyone, signed in or not:** `public_settings`, `themes`, `theme_schedules` and theme images only, so the welcome screen can show the seasonal look. No fish, no milestones.
- **Staff (therapist or assistant), after two-step sign-in:** the share-safe aquarium views (`public_fish`, `public_milestones`), plus clients, fish, achievements (including private notes), evolutions and the audit log. Assistants can add fish and award or correct stars. With the password alone, the database treats a staff account like a visitor.
- **Families (Phase 4C):** with a valid private link, the `family_view` function returns that one child's share-safe fish and approved milestones. Links are stored only as SHA-256 fingerprints; staff make and turn them off.
- **Therapists only:** themes, sensory defaults, changing the PIN, removing sample data, and managing the staff list.
- Every write goes through a database function that checks the role, validates the input, locks per fish where it matters and writes the audit log in the same transaction.

---

## 2. Run and test

```bash
npm install
npx playwright install chromium   # or set CHROME_PATH to an installed Chrome
npm test                          # demo-mode tests, desktop + phone (includes the Content-Security-Policy check)
npm run serve                     # http://localhost:8080
```

### Integration tests (optional, for developers)

`npm run test:supabase` runs 22 end-to-end tests of the Supabase connection against a local copy of the stack, all under the live Content-Security-Policy:

- PostgreSQL 16 with Supabase-style roles;
- [PostgREST](https://postgrest.org) v12, the same API layer Supabase runs;
- `supabase/test/local-gateway.mjs`, which stands in for Supabase sign-in and storage.

`supabase/test/start-local.sh` builds the whole stack in one go (PostgreSQL 16 on port 5433, PostgREST on 3001, the gateway on 54321), loading every SQL file and two test staff accounts. The gateway also checks real authenticator codes, so the MFA tests are genuine. Then:

```bash
SB_RESET_CMD="$(supabase/test/start-local.sh --print-reset)" npm run test:supabase
```

---

## 3. Supabase setup (one-time)

Do these in the Supabase dashboard for your project.

1. **SQL Editor → New query:** paste and run `supabase/schema.sql`. Then do the same with `supabase/002_app_connection.sql`.
2. **Storage → New bucket:** create a public bucket named `theme-assets`, then run the three storage policies from the end of `schema.sql` in the SQL Editor.
3. **Authentication → Sign In / Providers → Email:** keep email sign-in on and **turn off "Allow new users to sign up"**. Staff accounts are created by you, not by visitors.
4. **Authentication → URL Configuration:** set **Site URL** to your Cloudflare address (`https://….workers.dev`) and add it under Redirect URLs. Password-reset emails link there.
5. **Authentication → Users → Add user → Create new user:** enter your email and a strong password, and tick auto-confirm.
6. **SQL Editor:** make yourself the therapist (use your own email and name):
   ```sql
   insert into public.staff (user_id, role, display_name)
   select id, 'therapist', 'Your Name' from auth.users where email = 'you@example.com';
   ```
   Add assistants the same way with `'assistant'`. Every person needs **both** a user under Authentication → Users **and** this staff line; without the staff line the app says they're not set up as staff.
7. **Optional sample data:** run `supabase/003_sample_data.sql` to load the 8 fictional fish. Remove them later in Therapist area → Settings.
8. Open the Cloudflare site, choose **Therapist**, sign in, set the PIN, and review.

### Hosting headers

`cloudflare/_headers` adds `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options` and `Permissions-Policy`. The build command `node scripts/build.mjs` adds a Content-Security-Policy: only the page's own script (by its hash) and files from your own site (fonts, `vendor/supabase-js-2.118.0.js` pinned with an integrity hash, `sw.js`) may load, and only your Supabase project may be contacted. Nothing comes from Google or a CDN. The hash is recomputed on every build, so editing `index.html` can't break it. If the build command is still the old one, the site works but without the policy.

---

## 4. Security measures already in place

- **Access:** private records are only readable by staff (Supabase row-level security) or by the owner and Editors (Claude artifact), enforced on the server rather than in the page.
- **Server-side rules (Supabase):** star values, dates, lengths, roles, duplicate awards and evolutions are all enforced by the database, so a modified page can't bypass them.
- **PIN:** stored with PBKDF2-SHA-256 (150,000 iterations, random salt). Older SHA-256 hashes upgrade on the next successful unlock. Five wrong tries lock entry for 60 seconds.
- **Auto-lock:** the therapist area relocks after 15 minutes without activity, or 2 minutes after switching to the aquarium. Locking clears private records from the page.
- **Input handling:** all user text is escaped before display. Lengths, dates, star values and schedule ranges are validated, and the SQL schema repeats these checks as constraints.
- **Uploads:** only PNG, JPEG or WebP up to 8 MB. Images are re-encoded, which removes hidden metadata such as photo location, and resized (2,400 px backgrounds, 600 px decorations).
- **Privacy defaults:** pseudonymous nicknames (with a warning when a nickname looks like the private label), no client names in shared views, and no referrer leakage.
- **Private aquarium (4A):** the fish and milestones need a staff sign-in; signed-out visitors get a welcome screen.
- **Two-step sign-in (4A):** staff rights need an authenticator-app code, enforced by the database (`aal2`), not just the page.
- **Content-Security-Policy (4A):** blocks injected scripts and limits where the page can connect.
- **Keep-awake and backups (4A):** a GitHub job stops the free project pausing; the therapist downloads a weekly restore file.
- **Data minimisation:** a confirmed "Remove sample data" action clears test records before real use, and the audit log keeps a note that it happened.

### Known limits (to close before go-live)

- In the Claude artifact version, content checks (lengths, dates, half or full only) run in the page; the hosting enforces *who* can write, not *what*. The Supabase build enforces both.
- The PIN is a device lock, not a second account password. Real security comes from the account sign-in.
- The artifact database has no multi-document transactions; totals are recalculated from the ledger after every change, so they self-correct, but simultaneous edits by two therapists to the same fish are last-writer-wins. The Supabase functions lock per fish.
- The Supabase build refreshes every 20–60 seconds rather than instantly; other devices see new stars within about half a minute.
- Uploaded theme images are readable by anyone who can open the aquarium. Never upload photos of children.

---

## 5. Philippine privacy checklist (before any real client)

Children's therapy progress is health-related information, which the Data Privacy Act of 2012 (RA 10173) treats as **sensitive personal information**. Get qualified privacy advice; this list is a starting point, not legal advice.

- [ ] Appoint a Data Protection Officer and document their contact details.
- [ ] Check whether registration with the National Privacy Commission is required. Under NPC Circular 2022-04 it applies to:
  - organisations with 250 or more employees;
  - organisations processing sensitive personal information of 1,000 or more individuals;
  - processing likely to pose a risk to data subjects' rights.
- [ ] Prepare a privacy notice for families (drafts in English and Filipino, plus consent, assent and breach plan, are in the shared doc "Little Ocean — Privacy Documents (Drafts)"), in plain language, covering what is stored, why, who sees it, how long it's kept, and their rights.
- [ ] Collect written parental consent, plus the child's assent where appropriate:
  - for using the tool at all;
  - separately, for sharing achievement details (the "sharing consent" switch).
- [ ] Use nicknames or pseudonyms only in the aquarium. Keep full names out of client labels where possible.
- [ ] Set a retention period, for example deleting or anonymising records a set time after discharge, and a process to honour access, correction and erasure requests.
- [ ] Sign a data processing agreement with the hosting provider (Supabase or other) and confirm where data is stored.
- [ ] Prepare a breach plan. NPC Circular 16-03 requires notifying the Commission within 72 hours of knowing about a qualifying breach, and notifying affected families.
- [ ] Run a privacy impact assessment and a security review of the deployed build.
- [ ] Train staff: no real data in demos, lock shared tablets, never upload photos of children.

---

## 6. Go-live gates (each needs explicit owner approval)

1. Phase 3 acceptance of this build.
2. Privacy sign-off (section 5) and the GitHub + Supabase build passing all tests on staging.
3. Removing sample data and onboarding the first real client.
4. Sharing the aquarium with families or opening any public access.
