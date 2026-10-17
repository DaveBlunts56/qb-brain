# BroadcastForge Studio

Local-first, real-time sports broadcast graphics. Import your scorebug artwork, mark which parts are live, generate broadcast-style animations, and run the game from a browser-based control room while OBS Studio shows a transparent, animated overlay.

Built for real high-school football broadcasts. No account, subscription or internet connection is needed during a game.

```
 Studio (design)  ─┐                       ┌─> OBS Browser Source  /overlay/PROJECT_ID
 Animation Editor ─┼─>  BroadcastForge  ───┤   (display only, transparent, animated)
 Control Room     ─┘    server (Node)      └─> OBS WebSocket v5 (create/update the source)
 (this PC or a          SQLite · Socket.IO
  paired tablet)        authoritative state & clocks
```

## Contents

- [Features](#features)
- [Requirements](#requirements)
- [Install and run](#install-and-run) (macOS, Linux, Windows)
- [First game in 5 minutes](#first-game-in-5-minutes)
- [OBS Studio setup](#obs-studio-setup)
- [Local network operation (tablets / phones)](#local-network-operation)
- [Importing your own scorebug](#importing-your-own-scorebug)
- [Animations](#animations)
- [Control Room reference](#control-room-reference)
- [External controllers (Stream Deck / Companion)](#external-controllers)
- [Architecture](#architecture)
- [Security](#security)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Known limitations](#known-limitations)

## Features

- **Project dashboard**: project library with live thumbnails, new-project wizard, 1920×1080 / 1280×720 canvases, duplicate, export/import (`.bfproject.json` with embedded artwork), delete.
- **Studio editor**: zoomable canvas, accurate selection of rotated shapes/ellipses/polygons, move/resize/rotate with snapping guides, safe-zone guides, layers (drag to reorder or regroup), assets, inspector, autosave, and undo/redo.
- **Graphics import**: PNG/JPEG/WebP (locked base layer with region detection and colour-sampled masks), SVG (editable shapes, text, groups, gradients, embedded images/fonts), and layered PSD (pixel layers, groups, opacity, blend modes, optional editable text) with explicit warnings.
- **Make It Live**: assign 25+ football roles (scores, abbreviations, logos, team colours, clocks, period, down & distance, ball on, possession, timeout pips, flag, records, labels) to existing elements or detected regions, or add new ones.
- **Animation generator and timeline editor**: role-aware animations (rolling scores, flipping quarter, sliding possession, pulsing timeouts, FLAG wipe, staggered entrance/exit, TOUCHDOWN takeover, FIELD GOAL / SAFETY / custom banners). You can edit keyframes, durations, easing curves, delays and stagger, and save your own presets.
- **Live Control Room**:
  - Scoring: +1/+2/+3/+6 buttons, direct correction and undo.
  - Clocks: server-authoritative game clock with stadium sync, and a 40/25 play clock.
  - Situation: periods including overtime, down, distance, ball on and possession.
  - Penalties and graphics: flag, timeouts and graphics cues.
  - On-air control: show/hide the scorebug, and hold-to-clear emergency button.
  - Operation: event history, configurable hotkeys and large touch controls.
- **OBS integration**: connect with host, port and password, auto-reconnect, and scene list. Creates or updates the Browser Source automatically and never duplicates it. Manual URL setup also works.
- **Overlay**: transparent, has no controls, recovers its full state after a refresh or reconnect, and keeps working without the dashboard open. It also has a checkerboard preview and fullscreen mode.

## Requirements

- **Node.js 22.13 or newer** (22 LTS or 24 LTS). The built-in `node:sqlite` module is used, so there is nothing to compile.
- A current browser (Chrome, Edge, Firefox or Safari) for the dashboard.
- **OBS Studio 28 or newer** (it includes obs-websocket v5). Optional: you can always use the browser preview.

## Install and run

### macOS

```bash
# 1. Install Node.js 22+: download from https://nodejs.org or use Homebrew
brew install node@22
# 2. Get the code and install
cd broadcastforge
npm install
# 3. Build and start
npm run build
npm start
```

### Linux (Ubuntu / Debian / Fedora)

```bash
# Node.js 22+ via NodeSource, nvm, or your distribution
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -   # Debian/Ubuntu
sudo apt-get install -y nodejs
cd broadcastforge
npm install
npm run build
npm start
```

### Windows

Install Node.js 22 LTS from <https://nodejs.org>, then in PowerShell:

```powershell
cd broadcastforge
npm install
npm run build
npm start
```

Open **http://localhost:3000**. The first run creates an example project ("Gridiron Pro — Example").

| Command | What it does |
|---|---|
| `npm start` | Production server (local only) on `PORT` (default 3000) |
| `npm run start:lan` | Production server reachable from your local network |
| `npm run dev` | Development: live-reloading server + UI on the same port |
| `npm run build` | Build the web UI and the server bundle |
| `npm run check` | Typecheck + lint + unit/integration tests |
| `npm run test:e2e` | Browser end-to-end test against a production build |
| `npm run mock:obs` | A stand-in OBS WebSocket server for trying the OBS page without OBS |

Configuration: copy `.env.example` to `.env`. The common settings are `PORT`, `HOST`, `BF_DATA_DIR` and `OBS_PASSWORD`. Command-line flags `--port 3100`, `--lan` and `--data ./other-folder` also work: `node packages/server/dist/server.mjs --port 3100`.

All data lives in `broadcastforge/data/` (SQLite database plus uploaded artwork). Back up that folder to back up everything.

## First game in 5 minutes

1. Open <http://localhost:3000>. The example project is already there; click **Go live**.
2. In the **Control Room**, click the overlay icon in the PROGRAM monitor, or open <http://localhost:3000/overlay/PROJECT_ID?checker=1> in a new window. Press **F** for fullscreen and **C** to toggle the checkerboard.
3. Press **+6** for a team. The score rolls; the toast offers **Play TOUCHDOWN** (graphics never change the score).
4. Press **START**: the game clock runs on the server. Type the stadium clock (e.g. `4:07`) and press Enter to sync while it runs.
5. Edit team names, colours and logos with the pencil on each team card.

## OBS Studio setup

### Enable the OBS WebSocket server

1. In OBS: **Tools → WebSocket Server Settings**.
2. Tick **Enable WebSocket server**. The default port is **4455**.
3. Tick **Enable Authentication**, then click **Show Connect Info** to copy the password.
4. If OBS runs on a different computer, note that computer's IP address and allow TCP port 4455 in its firewall.

### Connect BroadcastForge

1. Open **OBS** in the left navigation.
2. Enter host (`127.0.0.1` when OBS is on the same computer), port and password, then press **Save & connect**. The password is stored only on this computer and is never sent to overlay pages. You can also set it with `OBS_PASSWORD` in `.env`.
3. Status shows the OBS version, canvas size, current program scene and latency. With **Reconnect automatically** on, BroadcastForge reconnects with back-off when OBS restarts.

### Select a scene and create the Browser Source

1. Under **Add the overlay to a scene**, choose the project and the **OBS scene** (for example your "Game Camera" scene).
2. Keep or change the **Source name**, choose the overlay address (this computer or a network address) and the frame rate (60 fps is recommended; choose 30 fps on slow PCs).
3. Press **Create / update Browser Source**. BroadcastForge then does one of three things:
   - creates a Browser Source with the right URL, width and height, puts it at 0,0 on top of the scene, and scales it if the OBS canvas size differs;
   - updates an existing source with the same name (URL/size) instead of creating another;
   - reuses a source that already shows this overlay under a different name, so no duplicate is made.
4. **Reload in OBS** refreshes the source (cache bypass) if ever needed.

### Manual Browser Source (no WebSocket needed)

1. In OBS: select a scene, click **+** under Sources, then choose **Browser**.
2. URL: copy it from the OBS page, e.g. `http://localhost:3000/overlay/proj_xxxxx`.
3. Width/Height: the project size (1920×1080 or 1280×720). Leave Custom CSS at the OBS default (transparent).
4. Untick **Shutdown source when not visible** so the overlay stays in sync.
5. Move the source to the top of the list, above your cameras.

The overlay needs no dashboard to be open. It reconnects automatically and always shows the current state (scores, clock, flag…) after a refresh, without replaying old animations.

## Local network operation

By default BroadcastForge listens on `127.0.0.1` (this computer only). To run the Control Room from a tablet or phone on the same **trusted** network:

1. Start with `npm run start:lan` (or set `HOST=0.0.0.0`). The console prints the network address, e.g. `http://192.168.1.20:3000`.
2. On the BroadcastForge computer open **Settings → Remote control** to see the **pairing code** (e.g. `K7Q2-9XMP`).
3. On the tablet open `http://192.168.1.20:3000/pair`, enter the code, then open the Control Room. The device stays paired (HttpOnly cookie) until you **Revoke all devices**.
4. OBS on another PC can load `http://192.168.1.20:3000/overlay/PROJECT_ID` (read-only, no pairing needed; set `BF_PUBLIC_OVERLAY=false` to require pairing).

Never forward the port to the internet. Remote devices cannot change OBS settings unless `BF_REMOTE_OBS=true`.

## Importing your own scorebug

Open a project → **Studio** → **Import design**.

- **PNG / JPEG / WebP**: becomes a **locked base layer**. A flattened image's original layers cannot be recovered, and BroadcastForge doesn't pretend otherwise. In **Make It Live**:
  - **Detect regions** finds likely text, large numbers, logos and flat panels using edge and colour analysis. Review the results and assign or dismiss each one.
  - Assigning a role to a region creates a live element there. It can also add a **cover mask** whose colour is sampled from the surrounding pixels, so the baked-in "14" disappears under the live score.
  - Over gradients or photos a flat cover would show, so you get a warning. Draw a replacement panel, crop the artwork, or rebuild that part.
  - Use the **Region (R)**, **Polygon (P)** and **Mask (K)** tools for manual control.
- **SVG**:
  - Converted into editable elements: rectangles, circles, ellipses, paths and polygons with their transforms, text (font, size, weight, alignment), groups, and linear gradients.
  - Embedded images and `@font-face` fonts with `data:` URLs are imported.
  - Scripts and external links are removed.
  - Filters, masks, clip paths, patterns and `<use>` are listed in a warning. Choose "Single image" if the design depends on them.
- **PSD** (parsed in the browser by `ag-psd`):
  - Kept: visible pixel layers at their exact positions, groups, opacity, and blend modes that have a CSS equivalent.
  - Optional: text layers can be converted to editable text, with font mapping to the bundled fonts.
  - Reported, never flattened silently: layer effects (shadow, stroke, glow), adjustment layers, layer masks and clipping masks.
  - If the layers cannot be read, the flattened composite is imported with a clear note.

Then **Generate animations** and **Publish to air**. The live overlay only ever shows *published* versions, so you can edit safely during a game.

## Animations

The generator follows explicit rules based on each element's role; it does not "read" motion from artwork.

| Role | Generated behaviour |
|---|---|
| Scores | Old digits roll out, new roll in, then a pulse. The team panel flashes and the score glows (score-change accent). |
| Quarter | Text flips; a light sweep crosses the period box |
| Down & distance / ball on | Slide up on change; fade when hidden |
| Possession | Marker slides out towards the other team and in from the other side |
| Timeout pips | Used pip pulses then dims; restored pip flashes back |
| Flag | Yellow FLAG panel wipes in over down & distance, wipes out |
| Scorebug show/hide | Coordinated staggered slide + fade in/out |
| Touchdown | Scorebug slides away, team panel expands with logo, TOUCHDOWN and team name, shine and glow, hold, then everything returns |
| Field goal / safety / PAT / 2-PT / timeout / turnover / first down / penalty / custom | Event banner in the team colours, with accents on the team's score or timeout pips |

Everything is editable in the **Animation Editor**:

- Timelines with draggable clips, duration handles and stagger.
- Presets: Slide, Roll, Scale, Fade, Wipe, Flip, Glow, Expand, Pulse, Flash and Sweep, each with parameters.
- Easing curves (or your own `cubic-bezier`) and raw keyframes.
- Saved custom presets.
- Preview on a simulated game, which runs the real game reducer locally, without going live.

**Rules for rapid or simultaneous events** (unit-tested in `packages/shared/test/lanes.test.ts`):

- Value changes are *latest wins*. A new score cancels the running roll and animates from what is on screen to the newest value; bursts are coalesced.
- Show/hide toggles reverse smoothly from their current point when flipped mid-animation.
- Takeover graphics are exclusive:
  - Equal or higher priority preempts.
  - Lower priority waits in a short queue; anything queued for more than 15 s is dropped.
  - A double-press within 1.5 s is ignored.
- Emergency clear cancels everything at once. Hiding the scorebug blocks new takeovers.
- After a reconnect or refresh, state is applied without animation. Graphics cues are never replayed.

## Control Room reference

| Area | Controls |
|---|---|
| Teams | Score +1/+2/+3/+6/−1, click score to correct, timeouts −/+ and **Timeout** (charges one, stops clock, plays graphic), possession, edit name/colours/logo |
| Clock | Period selector (PRE, 1ST–4TH, HALF, OT, 2OT…, FINAL), START/STOP, ±1s/±10s, set/sync while running, reset; play clock 40/25 (reset & start), start/stop, ±1, hide |
| Situation | 1ST–4TH, 1ST & 10 (computes GOAL near the goal line), next down, yards to gain, GOAL, INCHES, ball on (side + yard), FLAG, switch possession, show/hide D&D |
| Graphics | Per team: TOUCHDOWN, FIELD GOAL, SAFETY, PAT GOOD, 2-PT GOOD, TURNOVER; FIRST DOWN, PENALTY, custom banner text, title tab, SHOW/HIDE BUG, HOLD TO CLEAR |
| Top bar | LIVE indicator, server/overlay/OBS status, Undo (with label), History, Program monitor, hotkeys toggle, Reset (type RESET) |

Clock formats (gear icon): High School (NFHS, 12:00, untimed OT), College (15:00), Pro style (15:00, 10:00 OT), Youth (10:00), or custom lengths, play-clock values and timeouts.

Default hotkeys (remap in **Settings**):

- Away score: Q W E R (+1 +2 +3 +6)
- Home score: U I O P (+1 +2 +3 +6)
- Clock: **Space** starts/stops the game clock; K / L reset the play clock to 40 / 25.
- Situation: X switches possession, D is next down, Shift+D is 1st & 10, F toggles the flag.
- Scorebug: B shows/hides it.
- Undo: Ctrl/⌘+Z.

## External controllers

Any local tool (Bitfocus Companion, scripts) can send the same commands as the Control Room:

```bash
curl -X POST http://localhost:3000/api/projects/PROJECT_ID/command \
  -H 'Content-Type: application/json' \
  -d '{"commandId":"btn-123-unique","command":{"type":"score.add","team":"home","delta":6}}'
```

`commandId` is optional; when provided, retries with the same id are applied only once. Command types are defined in `packages/shared/src/game/commands.ts`. Examples: `clock.toggle`, `period.step`, `possession.toggle`, `flag.set`, `graphic.trigger`, `overlay.visibility` and `undo`.

## Architecture

```
broadcastforge/
  packages/shared   Pure TypeScript used everywhere:
                    game reducer, commands (zod), events, clock math, time sync,
                    scene graph, bindings, roles, geometry, animation presets,
                    lanes (interruption rules) and generator, football template
  packages/server   Node: SQLite (node:sqlite), match runtime, Socket.IO, HTTP API,
                    OBS manager (obs-websocket-js), uploads, security, Vite dev middleware
  packages/web      React UI (dashboard, Studio, Animation Editor, Control Room,
                    OBS, Settings) + a separate tiny overlay bundle (overlay.html)
  scripts           e2e test, mock OBS server
```

- **Authoritative state.** Each project has a live match owned by a `MatchRuntime` on the server. Commands are validated (zod), applied by a pure reducer, and committed to SQLite as one transaction: new state, events and the undo patch. Only then are they broadcast.
- **Events.** Persistent events (`SCORE_CHANGED`, `CLOCK_STARTED`, `PERIOD_CHANGED`, `POSSESSION_CHANGED`, `DOWN_CHANGED`, `FLAG_CHANGED`, `OVERLAY_VISIBILITY_CHANGED`…) are *derived from the state diff*, so they can never disagree with state. Transient cues are `TOUCHDOWN_TRIGGERED`, `FIELD_GOAL_TRIGGERED`, `SAFETY_TRIGGERED`, `ANIMATION_TRIGGERED` and `GRAPHICS_CLEARED`. Every event has an id, a sequence number and a timestamp. Clients ignore any sequence number they have already seen.
- **Dedupe.** Every command carries a client-generated id. A retry after a disconnect returns the original result instead of scoring twice.
- **Undo.** This is field-level: it restores only the fields an action changed. Undoing "+6" two minutes later reverts the score without rewinding a running clock. The undo history is persisted.
- **Clocks.** Remaining time is anchored to the server's monotonic clock (`performance.now()`) and never counts ticks.
  - The server schedules expiry from the computed zero time and broadcasts sync messages every second while a clock runs.
  - Clients estimate server time NTP-style (ping/pong, lowest-RTT sample, gentle slewing) and render the clock locally every frame.
  - After a server restart, running clocks are recovered from wall-clock time, with a log warning to verify against the stadium.
- **Overlay.** A plain-DOM `SceneRenderer` (no React) drives every animation with the Web Animations API, inside the browser source.
  - Each element has layered wrappers (position → timeline → toggle → body), so concurrent animations compose.
  - The same renderer draws the Studio canvas and all previews, so what you edit is what airs.
  - If the machine can't hold the frame rate during animations, blur-based effects are dropped automatically.
- **Draft vs. published.** The Studio autosaves a draft with optimistic concurrency. Overlays receive only *published* scenes, pushed live without a refresh.

## Security

- Listens on `127.0.0.1` by default; `--lan` must be chosen explicitly.
- **Trust:** loopback clients are trusted. Remote devices must pair with a code; attempts are rate-limited and sessions use an HttpOnly, SameSite=Strict cookie.
- **Overlays** are read-only sockets and never receive OBS details. The OBS password stays in the local database, or in `.env` (which is gitignored).
- **DNS rebinding:** `Host` headers are checked against this machine's names and addresses. State-changing requests and sockets must come from the same origin.
- **Uploads:**
  - Files are validated by content (magic bytes), size and pixel dimensions.
  - SVGs are served with `Content-Security-Policy: default-src 'none'` and only ever drawn through `<img>`.
  - SVG import strips scripts and event handlers.
- **Input:** all commands and scenes are validated with strict schemas.

## Testing

```bash
npm run check      # typecheck (3 packages) + ESLint + 96 unit/integration tests
npm run test:e2e   # builds if needed, starts the production server, drives Chromium
```

- Unit tests cover the game reducer, clock math and formatting, time sync, undo patches, animation interruption rules (fake clock), the generator, scene validation and geometry.
- Integration tests boot the real server: socket events, dedupe, undo, clock expiry, restart recovery, projects/assets API, upload validation, host/origin checks and the OBS integration (against `scripts/mock-obs.ts`: auth, no-duplicate source creation, reconnect).
- The e2e test drives a real browser: live score updates, touchdown graphic, clock and refresh recovery, dedupe, undo, publish, emergency clear and every page.

## Troubleshooting

| Problem | Fix |
|---|---|
| `Port 3000 is already in use` | `PORT=3100 npm start` (and use that port in OBS) |
| OBS: “Authentication failed” | Copy the password from OBS → Tools → WebSocket Server Settings → Show Connect Info |
| OBS: “Could not reach OBS” | Is OBS running with the WebSocket server enabled? Correct IP? Firewall allows 4455? |
| Overlay blank in OBS | Open the overlay URL in a normal browser with `?status=1` to see the connection state. In OBS, right-click the source → Refresh. |
| Overlay works here but not on another PC | Start with `npm run start:lan` and use the Network URL |
| “Host … is not allowed” | You're using a custom hostname: add it to `BF_ALLOWED_HOSTS` |
| Graphics stutter on an old PC | Use 30 fps in the OBS source; the overlay also reduces effects automatically |
| “This device is not paired” | Open `/pair` and enter the code from Settings on the host computer |

## Known limitations

- Only American football is implemented; the data model and UI are structured for more sports.
- Region detection is heuristic (edges and colours, no OCR). It proposes areas; you confirm them.
- PSD import does not render layer effects, adjustment layers or smart-object transforms. Text layers converted to editable text can differ from Photoshop's typesetting.
- SVG filters, masks, clip paths, patterns and `<use>` references are not converted. Import the SVG as a single image when needed.
- Shape strokes on rectangles and ellipses are drawn inside the box (CSS borders), which differs slightly from SVG's centred strokes.
- The Studio's undo/redo history lives in the browser tab and is not kept after a reload (the design itself is autosaved). The live match's undo history is persistent.
- A single server process is assumed (one machine runs BroadcastForge; any number of overlays and control devices can connect).

## License

MIT. Bundled fonts are under the SIL Open Font License (Fontsource). Example teams and logos are fictional and original.
