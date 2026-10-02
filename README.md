# QB Brain

A flag football quarterback trainer for 5v5 and 7v7: pre-snap coverage recognition, progressions, reads with bullet/lob throws, and a Full Drive mode with downs, yards and touchdowns.

It's a web app — no App Store needed. Everything is in `index.html`; there's nothing to build.

## Install on iPhone

1. Open the site link in **Safari**.
2. Tap **Share** (the square with the arrow), then **Add to Home Screen**.
3. Make sure **Open as Web App** is on, then tap **Add**.

It launches full-screen from its own icon, remembers your settings, and works offline after the first launch.
(On iOS 26 every home-screen site opens as a web app by default; on older iOS the tags in `index.html` do the same job.)

**Android (Chrome):** menu ⋮ → **Add to Home screen** / **Install app**.

## How to play

- **Throwing (pullback meter, Retro Bowl style):** after the snap, pull back anywhere on the field to aim — it starts as a **lob** (hollow dotted arc).
  While you're still pulling, **tap anywhere with a second finger** to switch to a **bullet** (tight gold dots, flatter and faster). Tap again to switch back. Let go to throw.
  On a computer: **Space** or **right-click** switches while you drag.
- **Tap to throw (Settings → Throw control → Tap receiver):** quick tap on a receiver = **bullet**, press and hold = **lob**.
- **Scramble:** use the joystick (bottom-left, or bottom-right in Settings) to move the QB around the backfield. He can't cross the line of scrimmage, so there are no QB runs. Pull back with your other thumb to throw on the run. On a computer, use WASD or the arrow keys.
- **Sound:** synthesized whistle, catch, flag pull and crowd sounds. Toggle it in Settings.
- **Key defender reads:** the coach tells you who to read, what he did, the correct read and whether your ball came out on time.
- **Film Room:** pre-snap quiz (man/zone, coverage, key, first read) → live rep → PRE-SNAP → POST-SNAP reveal with the clue.
- **QB Profile:** your tendencies across sessions and recommended drills. No ratings — training metrics only.
- **Adaptive training:** optional; reps are built from your profile (weak coverages more often, strong ones disguised, eyes and pressure tuned to your habits).
- **5v5 vs 7v7:** 5v5 = quick game vs simple shells and a fast rush; 7v7 = no rush, 4-second clock, seven in coverage with robbers, brackets, quarters and rotations.
- **Learn:** Home → Learn has the interactive Tutorial (8 lessons) and the Coach's Manual (coverages, routes, reads, progressions, concepts — with diagrams and sources).
- **Your coach:** after every play you get a breakdown and Coach View (the moment you threw, with the coverage drawn on the field).
- **Share codes:** share any play as a code; import a teammate's code in My Plays.
- **Create a Play:** Playbook → My Plays → + Create a play. Drag players, pick or draw routes, set the QB's drop, the read order, a pitch, and audibles.
- **Audibles:** before the snap tap AUDIBLE to check to another play or hot-route a receiver.
- **Play calling:** in Full Drive you call the play before every down.
- **Home screen:** Play Drive · Drills (QB Brain, Coverage ID, Quick Read) · Playbook (every play drawn out; tap one to run it) · Settings.
- **Full Drive:** set field length (50–100 yds, plus two 10-yd end zones), width (20–53 yds) and the first-down rule (midfield or every 10).

## Hosting (GitHub Pages)

Settings → Pages → *Deploy from a branch* → `main` / root. The site appears at
`https://<your-username>.github.io/<repo-name>/`.

When you publish an update, bump `VERSION` in `sw.js` so installed copies refresh their offline cache. Every update gets a GitHub release automatically: add a `## vX.Y.Z — Title` section to the top of `CHANGELOG.md`, push, and `.github/workflows/release.yml` publishes it.

## Files

| File | What it is |
|---|---|
| `index.html` | The whole app (HTML, CSS and JavaScript in one file) |
| `manifest.webmanifest` | App name, icon and full-screen settings for home-screen installs |
| `sw.js` | Offline support |
| `icons/` | Home-screen and browser icons |

## Accounts & sync (switched off in the beta)

The beta build ships without accounts: everything is saved on the device. To switch them on later, set `"features": { "accounts": true }` in `package.json` and rebuild. Parents can then create an account and add a player for each kid, so progress syncs across phones, tablets and computers. It's off until a Supabase project is connected: see [docs/CLOUD_SETUP.md](docs/CLOUD_SETUP.md) (about 10 minutes). Privacy policy draft: [PRIVACY.md](PRIVACY.md).

## For developers

QB Brain is plain JavaScript (ES modules) with no framework and no runtime dependencies. The only build step is bundling.

```
npm install          # esbuild + Playwright (dev only)
npx playwright install chromium
npm run build        # src/ → index.html + sw.js (the installable app) and dist/qb_brain.html (single file)
npm test             # engine tests in Node + browser tests in Chromium
```

Feature switches live in `package.json` → `"features"`. A switched-off feature's code and screens are left out of the build entirely. `npm run build -- --with=accounts` makes a test copy with one switched on (`dist/qb_brain.accounts.html`).

`index.html` and `sw.js` at the repo root are **build output**, committed so GitHub Pages can serve them. Edit `src/`, then run `npm run build`. CI fails if you forget. The app version comes from `package.json`. It sets both the label on the home screen and the offline cache name, so installed copies update.

| Folder | What's in it |
|---|---|
| `src/js/` | The app as ES modules. `main.js` calls each module's `init()` in order. Modules only declare things when they load, so their order doesn't matter. |
| `src/js/` engine | `rep.js` (building a rep, movement), `defense.js` (coverages, rush, eyes), `paths.js` (routes), `input.js` (throwing, joystick, tap), `loop.js` (game loop), `evaluate.js` (grading a throw), `drive.js` (Full Drive) |
| `src/js/` training | `train.js` (training plans, disguises, Adaptive), `keyread.js` (key defender reads), `coach.js` (post-play coaching, Coach View), `film.js` (Film Room), `profile.js` (QB Profile, drills) |
| `src/js/` content | `plays.js` (built-in playbooks), `myplays.js` and `playbook.js` (Create a Play, audibles, play calling, share codes), `learn.js` (Coach's Manual and Tutorial) |
| `src/html`, `src/styles`, `src/fonts` | Markup, CSS, and the two pixel fonts (subset and embedded at build; SIL Open Font License, see `src/fonts/OFL-*.txt`) |
| `tests/unit` | The game engine running headless against a tiny fake DOM |
| `src/js/` accounts | `store.js` (everything saved, per player), `merge.js` (combining two devices' data), `cloud.js` (sign-in + sync over Supabase's API), `account.js` (screens) |
| `supabase/schema.sql` | Database tables + row-level security |
| `tests/e2e` | Real touch input in Chromium on an iPhone-sized screen, including offline install |

Features talk to each other through small hooks (`on("screen", …)`, `on("setup", …)` in `config.js`) instead of overriding each other's functions.
