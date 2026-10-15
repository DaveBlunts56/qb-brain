# Pocket Gridiron

An original retro pixel-art American football game for iPhone, playable in Safari and installable to
the home screen. Read the coverage, throw with touch, run after the catch, and drive for the score.

**Phase 1 (this version):** a complete 7-on-7 passing game. You play offense through full
four-quarter games against a CPU team; the CPU's possessions are simulated and summarized. See
[DESIGN.md](DESIGN.md) for how it works and the six-phase roadmap.

Once deployed, the game lives at:
**https://daveblunts56.github.io/qb-brain/pocket-gridiron/**
(QB Brain stays at https://daveblunts56.github.io/qb-brain/.)

---

## Test it from your iPhone (no computer needed)

### One-time setup: turn on GitHub Pages deployment from Actions

The game is built by a GitHub Actions workflow. The repository currently serves QB Brain straight
from the `main` branch, so switch Pages to Actions once (QB Brain keeps working: the workflow
publishes it too, at the same address).

1. In Safari, open **github.com/daveblunts56/qb-brain** and sign in. (The GitHub iPhone app doesn't
   show repository settings; use Safari. If the page is the mobile layout, scroll down and tap
   **Desktop** / use "Request Desktop Website" from the **aA** menu.)
2. Tap **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **GitHub Actions**.
4. Merge the Pocket Gridiron pull request (or, if it's already merged, go to **Actions → Deploy
   GitHub Pages → Run workflow**).
5. Wait for the **Deploy GitHub Pages** run to turn green (about 2 minutes), then open the game link
   above.

If Pages isn't switched yet, the deploy workflow doesn't fail: it finishes with a yellow warning
telling you to make the switch, and nothing about the current site changes.

### Playing

1. Open the link in **Safari** and turn the phone sideways (landscape).
2. For full screen and offline play: **Share → Add to Home Screen**, then launch it from its icon.
   Installed copies update themselves the next time you open them while online.
3. Tap **PLAY → KICKOFF**.

### Controls

| | |
|---|---|
| **Left thumb** | Floating joystick (touch anywhere on the left half): drop back, slide in the pocket, scramble; after a catch it steers the runner. |
| **Right thumb** | One button per receiver; shapes and colors match the icons above their heads, ordered top to bottom like the field. **Tap = bullet**, **hold = touch**, **hold longer = lob**; the ring shows which. Release to throw. |
| **Lead the pass** | While holding a receiver button, drag your thumb: right = deeper, left = shorter, up/down = toward a sideline. A reticle shows the spot. |
| **Run** | **JUKE** makes tacklers miss, **DIVE** gets a last yard. You can't throw after crossing the line. |
| **Before the snap** | Read the safeties (shown on screen: two deep, one deep, or none = blitz). **PLAYS** changes the call, **SNAP** starts the play. |
| **Clock** | After an in-bounds play the clock runs until you snap: hurry, or use a **TIMEOUT**. |
| **Pause** | **II** (top right): resume, sound, volume, how to play, restart, quit. Leaving Safari pauses automatically. |
| **Settings** | Sound/volume, camera distance, left-handed layout, show routes after the snap. Saved on the device. |

Keyboard (desktop): WASD/arrows move · 1–4 throw (hold for touch/lob) · Space snap/continue ·
J juke · K dive · P pause · T timeout.

### Checking a build from your phone

Every push runs the **Pocket Gridiron CI** workflow (Actions tab): typecheck, unit tests, production
build, and a browser smoke test that plays the game on an emulated iPhone screen. Each run uploads
a **pocket-gridiron-screenshots** artifact (title, play call, routes, a two-finger throw, results,
pause, final score) that you can download and view on the phone.

If something goes wrong in the game, it shows an error panel instead of a blank screen; screenshot
it and include it in a bug report.

---

## Development

```bash
cd pocket-gridiron
npm install
npm run dev        # local dev server (vite --host, open the printed address on your phone on the same Wi-Fi)
npm run typecheck
npm test           # Vitest: rules, physics, sim behavior, full games, settings, font
npm run build      # production build to dist/ (relative base path)
npm run smoke      # browser smoke test against the build (needs Playwright + Chromium)
npm run icons      # regenerate the PNG icons in public/icons
```

`PG_BASE` sets the Vite base path; the Pages workflow derives it from the Pages site URL
(`/qb-brain/pocket-gridiron/`). Without it the build uses a relative base (`./`) and runs from any
folder.

| Folder | What's in it |
|---|---|
| `src/core/` | Pure TypeScript game logic (no Phaser): data, play simulation, rules, match flow |
| `src/game/` | Phaser scenes, programmatic pixel art, synthesized audio, UI kit |
| `src/platform/` | Storage, settings, viewport/safe areas, lifecycle, service worker |
| `tests/` | Vitest suites |
| `scripts/` | Icon generator, browser smoke test |

Stack: Phaser 3.90, TypeScript 5.9, Vite 6, Vitest 3. No backend, accounts, paid APIs or image/audio
files.

## Status and honesty notes

* Verified: TypeScript compile, 67 unit tests, production build, and the browser smoke test
  (Chromium emulating an iPhone 14 in landscape with real multi-touch events, including holding the
  joystick with one finger while throwing with the other).
* **Not yet verified on a physical iPhone.** Safari-specific behavior (audio unlock, safe areas
  with a real notch, home-screen install, rotation) is implemented per Apple's documented behavior
  but has only been exercised in emulation.
* Phase 1 limitations are listed at the end of [DESIGN.md](DESIGN.md).
