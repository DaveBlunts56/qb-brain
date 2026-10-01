# QB Brain

A flag football quarterback trainer for 5v5 and 7v7: pre-snap coverage recognition, progressions, reads with bullet/lob throws, and a Full Drive mode with downs, yards and touchdowns. Includes the **Big Dawz** 5v5 playbook.

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
