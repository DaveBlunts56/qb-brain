# Pocket Gridiron — Design & Roadmap

Pocket Gridiron is an original, retro pixel-art American football simulation for phones. It aims for
the pick-up-and-play feel of 16-bit sports games, built on football that's simulated rather than
scripted: real routes, real coverages, real ball flight, and ratings that change what happens.

Everything in the game is original: teams, players, art (drawn in code), font, and sounds
(synthesized). No assets, names, logos or audio from other games or leagues.

---

## 1. Design pillars

1. **Football first.** Outcomes come from a simulation, never from scripted animations or
   "this play works 60% of the time" rolls. Any random number in the game perturbs a physical or
   skill model (a throw's error, a catch's difficulty, a tackle's success), never a result directly.
2. **Readable on a phone.** Two thumbs, landscape, big targets, crisp pixels, clear feedback.
3. **Skill expression.** Reading the coverage, timing the throw, choosing bullet/touch/lob,
   leading the receiver, buying time in the pocket, making a tackler miss.
4. **Ratings matter.** Every rating feeds a model (speed → top speed, route running → sharper
   breaks and a later defender reaction, throw power → velocity and range, accuracy → spread, …).
5. **Small and complete before big.** Each phase ships a fully playable loop.

---

## 2. Architecture

```
src/
  core/            Pure TypeScript. No Phaser, no DOM. Deterministic and unit-tested.
    math/          vectors, seeded RNG
    data/          ratings & teams, routes, formations & playbook, defensive coverages
    sim/           the play simulation (one snap)
    rules/         downs, scoring, clock, special teams, CPU drive model, CPU defensive play-caller
    match.ts       game flow state machine tying plays, rules and possessions together
  game/            Phaser presentation: scenes, programmatic art, audio, UI kit, input
  platform/        storage (IndexedDB → localStorage → memory), settings, viewport & safe areas,
                   lifecycle (background/foreground), PWA service worker
tests/             Vitest suites for core rules, physics, sim behavior, full games, settings, font
scripts/           icon generator, browser smoke test
```

**Separation of logic and rendering.** `core/` knows nothing about drawing. Scenes read state from a
`Match` and its current `PlaySim`, and send input back as plain commands. This is what lets the test
suite play thousands of snaps and complete games headlessly, and what will let the league phase run
CPU-vs-CPU games without rendering.

### 2.1 Coordinates and time

* Yards everywhere. Absolute `x` runs 0–120 (back of the left end zone to the back of the right),
  `y` runs 0–53.33 across the field. The user's offense always drives toward +x.
* Field position in the rules is a *yard line from the offense's own goal* (25 = own 25,
  75 = opponent 25), so the same code serves both teams.
* The play runs at a fixed **60 Hz** step with a seeded RNG: the same seed and inputs always give the
  same play (tests assert this; it is also the basis for replays later).

### 2.2 State machines

* **Play** (`PlaySim.phase`): `preSnap → live → passInAir → live → deadBall → result`.
  `live` covers both the QB holding the ball and any ball carrier (after a catch or interception).
* **Game flow** (`Match.flow`): `kickoff → playCall → preSnap → live → result → …` plus `pat`,
  `cpuDrive`, `quarter` (quarter breaks/halftime) and `final`. Every card waits for the player.

### 2.3 Simulation models (Phase 1)

| System | Model |
|---|---|
| Movement | Acceleration-limited steering toward a desired velocity; cutting uses agility; braking is easier than accelerating; momentum carries through breaks. |
| Collisions | Soft-body separation weighted by mass; planted players hold ground. Rubs and traffic emerge. |
| Routes | Waypoint routes relative to alignment, mirrored by side; "continue" vs "settle" endings; settled receivers drift away from the nearest defender; sideline awareness uses current lateral momentum. |
| Pass protection | Blockers step into the rusher's path and engage; engaged pairs move together, the rusher drives the pocket at a rate set by pass rush vs pass block, and sheds at a hazard rate that ramps up over time. |
| Man coverage | The defender starts with his alignment cushion and gives it up as the receiver closes; he matches speed instantly but reads changes of direction late (lag from man coverage vs route running). Cover 0 stays on top, otherwise trail. Press corners can jam. |
| Zone coverage | Landmarks per coverage (deep halves/thirds/quarters, flats, curl-flat, hook). Deep defenders hold depth and keep the deepest threat in front; underneath defenders wall off the most dangerous receiver from the QB. |
| Throwing | True 3D projectile under gravity. Bullet/touch/lob set the horizontal speed; the launch is solved to arrive at catch height; arm strength caps launch speed (long throws fall short). The lead point comes from predicting the receiver's route path. |
| Accuracy | Gaussian landing error (longer along the throw line than across) scaled by accuracy, distance, moving speed, throwing across the body, pressure, and pass type. |
| Ball reactions | After a reaction delay (awareness; longer for man defenders with their back to the QB), receivers track the catch point and defenders attack the ball's descent upstream of the receiver. |
| Catching | Resolved at the ball's closest approach while at catchable height: hands, distance from the body, ball speed, height, contested defenders. Dives only on a dying ball. Drops and tips pop the ball up—anyone can catch a tipped ball. |
| Interceptions | Defenders who saw the throw roll INT/break-up/miss from ball skills, position (undercutting is best) and difficulty. Most defended passes are broken up, not picked. |
| Tackling | Every defender in arm's reach gets one attempt (then a cooldown); a lunge from up to 1.75 yd when he can't otherwise close. Tackling vs elusiveness, strength, angle, help, a receiver still securing the catch, and juking. |
| Run after catch | User steers (auto-runs downfield if the stick is idle); JUKE gives a lateral burst, a tackle-evasion window and can freeze nearby defenders; DIVE gains a last yard. Teammates lead-block. |

**Calibration.** A window-reading autopilot QB (`sim/bot.ts`) plays hundreds of snaps in the test
suite. With near-perfect reads it completes ~75%, averages ~5 yards after catch, throws ~3% INTs and
gets sacked when it holds the ball; deep balls complete ~55%; zone defenses hold it to ~10–12 yards
per play while Cover 0 is boom-or-bust. Humans are less precise than that bot, which is the point.

### 2.4 Rules (Phase 1)

Downs and distance, first downs, goal-to-go, turnover on downs, touchdowns, PAT kick or a *played*
two-point try, field goals, punts, safeties, interceptions (returnable, pick-sixes, touchbacks),
kickoffs, four quarters with halftime, a live game clock plus a between-play runoff the offense can
cut short by snapping quickly, three timeouts per half, and the final whistle. All are pure functions
in `core/rules/` with unit tests.

The **CPU's possessions** are resolved in Phase 1 by a play-by-play statistical drive model driven by
team ratings (playable defense arrives in Phase 3). It still runs the real clock, downs, field
position, kicking decisions and turnovers, and it is shown to the player as a drive summary.

### 2.5 Presentation

* All art is generated at boot: a 5×7 pixel font, 16×18 player sprites (front/back/side run cycles,
  throw and down frames) painted in team colors and three skin tones with automatic outlines, a
  stadium texture (striped grass, numbers, hashes, team end zones, crowd), icons and markers.
* The canvas renders at the device's pixel ratio (up to 3×) with nearest-neighbor sampling, so pixel
  art stays crisp and text stays sharp. UI is laid out in CSS pixels × DPR inside the safe area.
* Audio is synthesized with WebAudio (whistle, hut, throw, catch, hits, crowd bed with swells,
  touchdown fanfare) and unlocks on the first touch as iOS requires.

### 2.6 Platform

* PWA: manifest (landscape, fullscreen), generated service worker that precaches the build, icons.
* iOS Safari hygiene: no page scroll, pinch or double-tap zoom, no callouts; rotate prompt in
  portrait; pause when Safari is backgrounded or the phone locks; audio suspends.
* Settings and records persist in IndexedDB (falls back to localStorage, then memory).

---

## 3. Roadmap

### Phase 1 — Core passing loop (7v7 prototype) — **this release**

| Req | Feature | Status |
|---|---|---|
| A | Title menu: Play, Controls (and Settings) | Done |
| B | Scrolling top-down pixel field: yard lines, numbers, hashes, sidelines, end zones | Done |
| C | Scorebug: score, quarter & clock, down & distance, ball on | Done |
| D | 7v7: QB, two blockers, four eligibles vs two rushers + five in coverage | Done |
| E | Snap button and pre-snap route visualization (plus a shell read hint) | Done |
| F | Left floating virtual joystick (mirrors for left-handed play) | Done |
| G | Receiver buttons: tap bullet / hold touch / hold longer lob, drag to lead, accuracy model | Done |
| H | Ball flight with real positions/velocities; completions and incompletions from contact | Done |
| I | Defensive AI: man and zone (Cover 0/1/2/3/4), pass rush, ball reaction, INTs, tackles | Done |
| J | Possession, yards after catch, ball-carrier control with juke and dive | Done |
| K | Downs, first downs, turnover on downs, TDs, scoring, resets between plays | Done |
| L | Nine passing plays across four formations, flippable | Done |
| M | Full drive from kickoff to score or turnover, inside a full four-quarter game | Done |
| N | Pause / restart / quit, sound on/off and volume | Done |
| O | Settings saved locally (IndexedDB); installable PWA with offline cache | Done |

### Phase 2 — Complete offense

* **Run game:** handoffs, pitches, QB draws; RB vision AI; run blocking schemes (inside/outside zone,
  power) with OL/DL leverage; gap integrity for the defense.
* **QB play:** QB eyes (defenders read where the QB looks), pump fakes, throwaways, slides,
  play-action with run fakes that affect linebacker reactions.
* **Pre-snap:** audibles, hot routes per receiver, pass-protection slides, motion and shifts.
* **Formations:** under center, pistol, empty, two-back sets, tight-end personnel.
* **Ball security:** fumbles from carry rating and hit power, loose-ball physics and recovery.
* **Penalties (first set):** holding, defensive pass interference (from contact during the ball's
  flight), offsides/false start, delay of game with a real play clock, intentional grounding.
* **Kicking:** playable field goals/PATs/punts with a two-tap meter and wind; kickoffs and returns.
* **Clock tools:** spike, kneel, two-minute warning.

### Phase 3 — Playable defense

* User controls a defender with switching (nearest to ball / tap to select).
* Defensive play-calling: the existing coverage library plus blitz packages, stunts, zone blitzes,
  pattern-matching rules (MOD/MEG, Cover 3 match), and **disguise** (show one shell, rotate post-snap).
* CPU offense AI: situational play-calling tendencies and a reading QB built on the window-evaluation
  logic already used by the test bot (`sim/bot.ts`), with progressions and ratings-based mistakes.
* User pass-rush moves (speed/bull/spin) and contain responsibilities.
* Replace the Phase 1 statistical CPU drive with fully simulated CPU possessions.

### Phase 4 — 11v11 and presentation

* Full 11-man formations and personnel groups; 5-man line vs 4-3 / 3-4 / nickel / dime fronts;
  expanded playbooks (~60 offensive, ~40 defensive plays) using the same route/coverage data model.
* Complete rules: all common penalties with enforcement, overtime, challenges/replay reviews.
* Broadcast presentation: animated scorebug, down markers, stadium variety, day/night, weather,
  crowd reactions, pixel cutscenes for big moments, music.
* Instant replay from recorded inputs (the sim is deterministic) and a box score.
* Performance budget: 60 fps on iPhone 12-class hardware with 22 players.

### Phase 5 — League and season

* 32 original teams in conferences/divisions with identities (colors, city, play style tendencies).
* Rosters (46+ players), depth charts, injuries.
* Schedule generator, standings with tiebreakers, playoffs and a championship game.
* CPU-vs-CPU games simulated headlessly (fast sim using the same engine at reduced fidelity).
* Season stats, records and awards.

### Phase 6 — Franchise and tools

* Scouting with fog of war, a draft with prospect generation, trades with AI valuation, free agency.
* Contracts and a salary cap; progression/regression and aging driven by usage and development traits.
* Multi-season saves in IndexedDB with versioned migrations and export/import.
* **Playbook editor:** draw routes on the field, build formations, save custom plays (the play data
  format already supports this).
* Quick Play / Practice (drills, coverage-ID trainer) / Franchise mode selection.

---

## 4. Cross-cutting engineering

* **Testing:** every rule and model change ships with Vitest coverage; statistical tests guard
  against "guaranteed" outcomes; a Playwright smoke test drives the real build with multitouch on an
  emulated iPhone viewport and saves screenshots.
* **Data versioning:** saved data is keyed and versioned (`settings.v1`, `records.v1`) and sanitized
  on load.
* **Accessibility:** marker shapes *and* colors for receivers, left-handed layout, adjustable camera.
  Planned: color-blind palettes, larger-text option, haptics where supported.
* **Originality:** all teams, names, art and audio are created for this project.

## 5. Known limitations (Phase 1)

* CPU offensive possessions are summarized by a statistical drive model, not played on the field.
* No running plays, fumbles, penalties, or playable kicking yet.
* Field goals, PATs and punts are resolved by rating-based models.
* Tested in Chromium with an emulated iPhone viewport and multitouch; not yet verified on a
  physical iPhone.
