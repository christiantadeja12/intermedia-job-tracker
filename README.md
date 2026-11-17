# Little Ocean of Achievements

An interactive aquarium for occupational therapy. Every client has a friendly fish; the therapist awards half or full stars for milestones, and 3.5 stars make the fish evolve. There are no rankings or comparisons between children.

Built in reviewed phases (aquarium, therapist admin, themes and readiness), then Phase 4:

- **4A, safe for real use:** private aquarium, two-step sign-in for staff, Content-Security-Policy, keep-awake job and backups, family summaries, nickname guide.
- **4B, better for the child:** Focus mode, Filipino for children, the Philippine calendar, pawikan, dugong and butanding looks, self-hosted fonts and library, offline aquarium.
- **4C, connected to families:** private family links with QR codes, a family view, evolution certificates.
- **4D, faster for the therapist:** milestone templates in English and Filipino, goal areas, progress by area, quick awards from the aquarium. Therapists can rename, add and hide the categories.

## What's here

| Path | What it is |
| --- | --- |
| `index.html` | The whole app: aquarium, share-safe profiles, therapist area, themes, comfort settings. Runs as-is; no build needed locally. |
| `tests/` | Playwright tests (desktop and phone): taps, motion bounds, star maths, evolutions, duplicates, corrections, privacy, themes, comfort settings, accessibility, layout. |
| `supabase/schema.sql`, `002_app_connection.sql`, `004_phase4a.sql`, `005_phase4b.sql`, `006_phase4c.sql`, `007_phase4d.sql`, `008_categories.sql`, `011_family_house.sql`, `012_family_peo.sql`, `013_evolve_at_3_5_stars.sql`, `014_sharing_expiry_delete.sql` | Supabase database: tables, row-level security, the server-side functions the app calls, and the Phase 4A private aquarium and two-step sign-in rules. |
| `supabase/003_sample_data.sql` | Optional fictional sample fish for testing. |
| `supabase/test/` | Integration tests, a local gateway (sign-in, MFA, storage) and `start-local.sh` to run the whole stack locally. |
| `wrangler.jsonc`, `cloudflare/_headers`, `scripts/build.mjs` | Cloudflare deployment: the build publishes the app page, `sw.js`, `assets/` and `vendor/`, with security headers and a Content-Security-Policy. |
| `sw.js`, `assets/fonts/`, `vendor/` | Offline app shell, self-hosted fonts (SIL Open Font License), supabase-js 2.118.0 and qrcode-generator 1.4.4 (MIT, loaded only when making a family link). |
| `.github/workflows/keep-awake.yml` | Checks in with Supabase every 2 days so the free project never pauses. |
| `docs/DEPLOYMENT.md` | How to run, test, host and harden it, plus the privacy checklist before real use. |

## Run it locally

```bash
npm run serve        # then open http://localhost:8080
```

The page picks its data source automatically: on Cloudflare (or any normal host) it connects to Supabase; inside its Claude artifact it uses the artifact's private database; if neither is available it runs in **demo mode** with eight fictional fish and saves nothing. Setup steps are in `docs/DEPLOYMENT.md`.

## Test it

```bash
npm install
npx playwright install chromium      # or set CHROME_PATH to an installed Chrome
npm test                 # demo mode, desktop + phone
npm run test:supabase    # optional: 22 tests; start the local stack with supabase/test/start-local.sh (see docs)
```

## How the main rules work

- **Stars** are stored as whole half-star units (1 = half, 2 = full). Seven units (3.5 stars) fill one level; the number lives in `units_per_level()` in the database and `UNITS_PER_LEVEL` in `index.html` (migration `013_evolve_at_3_5_stars.sql`). Totals are always recalculated from the achievement ledger, so there is no running counter to drift.
- **Evolutions** are recorded once per level. A correction that lowers the stars marks the evolution "undone" instead of deleting it; reaching the level again restores it.
- **Duplicates**: every award form carries one idempotency key, so a double click or retry saves once.
- **Corrections** never delete: edits keep before/after values, voids and star changes keep the original row, and every change writes an audit event with a reason.
- **Privacy**: the aquarium and family profiles read a separate share-safe copy (nickname, species, colours, level, stars). Milestone titles and descriptions appear only where the therapist switches on "Show all milestones" for that child: one switch for the family aquarium and one for the main aquarium (which also needs the family's sharing consent). Private notes and client labels are never copied there.
- **Family links** last one day, one week or one month, chosen when the link is made. **Archived fish** can be permanently deleted by a therapist after a warning and a final confirmation (`delete_archived_fish()`).
- **Themes** follow Philippine time (Asia/Manila). A manual choice wins; otherwise the enabled theme whose dates include today, highest priority first, then the shortest range.

## Status

Prototype with fictional data only. Not approved for production, real client onboarding or public access. See `docs/DEPLOYMENT.md` before any of those.
