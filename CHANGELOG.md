# Changelog

## v1.8.0 — Adaptive training, real 5v5 vs 7v7, Robber & Bracket

### 5v5 and 7v7 are different jobs now
- **5v5:**
  - quick reads and spacing vs simple shells (Man, Cover 1, Cover 2, Cover 3, underneath zone)
  - a fast rusher
  - when you get sacked with the center open, the coach tells you: "In 5v5 your center is your hot read."
- **7v7:**
  - no rush and a **4-second pass clock** by default, like most 7v7 formats, so all **seven defenders cover** (Settings → 7v7 Pass Rush can switch back to one rusher)
  - layered coverages: **Cover 4 (quarters)**, **Cover 1 Robber** (a robber in the middle reading your eyes), **Bracket** (two defenders on the biggest threat, one under, one over) and **2-Man** (two deep, man underneath), on top of the base coverages
  - more post-snap rotations, including Cover 1 → Robber or Bracket, Cover 2 → 2-Man or Cover 4, Cover 3 → Cover 4, and Robber → Cover 3
  - a little more disguise overall
  - when the clock runs out, the result reads **CLOCK RAN OUT** with a 7v7-specific coaching tip
- Bot testing: 7v7 completion rate is about 59% vs 68% in 5v5. The extra time doesn't make up for the smaller windows.

### Adaptive training (Settings → Adaptive Training)
- An optional layer on top of Rookie, Varsity and Elite. Every rep is built from your QB Profile, kept separately for 5v5 and 7v7:
  - **Weak against a coverage?** You see it more.
  - **Strong against one?** It gets disguised more.
  - **Stare down your first read?** Safeties and zone defenders read your eyes harder.
  - **Struggle with pressure?** The rush starts gentler and ramps up through 4 levels as you handle it.
  - **Struggle with rotations?** More disguised reps.
- The play tag tells you what Adaptive is doing (e.g. "ADAPTIVE: more Man & Cover 3 reps · Cover 2 gets disguised more · safeties read your eyes harder · pressure level 2/4"), and so does the QB Profile.

### Under the hood
- One training plan layer drives the coverage mix, disguises, eyes and pressure. Drills, Film Room and Adaptive all use it, so they work together.
- Manual: new **7v7: layered coverages** chapter with diagrams of Robber, Bracket, 2-Man and Cover 4 with seven defenders.

## v1.7.0 — Key defender reads, Film Room, QB Profile

Built around one loop: **see the defense → identify the key → process the movement → decide → get coached → improve the next rep.**

### Key defender reads
- Concepts now know **who you should be reading**:
  - Smash: the corner
  - Slant-Flat, Curl-Flat, Stick, Flood: the flat defender
  - Drive and Levels: the hook defender
  - Four Verticals: the deep safety
  - Your own plays and Big Dawz plays: QB Brain finds the high-low or inside-out pair automatically.
  - Run and trick plays (and Mesh, which beats man with rubs) don't get a key.
- The key is picked from the pre-snap **alignment**, then tracked after the snap to see when he commits and which way.
- The coach shows it after every play:
  > **KEY DEFENDER: CB** — CB sank with Y's corner at 1.3s → X's hitch was the correct read.
  > You threw Y's corner at 1.8s. ✗ wrong side of the key.
  > Late: CB declared at 1.3s; get it out on his first step.
- If the throw away from the key was covered by help, the coach says so and gives the real answer.
- **Coach View** traces the key defender's path, marks when he committed, and rings the correct read.
- With "show progression" on, the play tag shows the key plan before the snap (e.g. "KEY: CB (left) — sinks → hitch, jumps it → corner").

### Film Room (Drills → Film Room)
- Before the snap: **1** man or zone? **2** likely coverage? **3** tap your key defender. **4** tap your best first read. The first read comes from simulating the play against the look the defense is *showing*.
- Then run the play.
- After it: **5** what did they actually play? → **PRE-SNAP LOOK → POST-SNAP COVERAGE** with the clue that gave it away (e.g. "the right safety rotated down at 0.5s — two-high became one-high"), a scorecard, and PRE-SNAP / POST-SNAP replay frames with every defender's path.
- Film Room disguises more often (at least 35–50% of reps).

### Better disguises
- New post-snap changes:
  - **Cover 2 → Cover 3** and **Cover 3 → Cover 2** rotations
  - **Bluff man → zone** (Man or Cover 1 look → Cover 3 or underneath zone)
  - **Bluff zone → man** (Cover 2, Cover 3 or underneath look → Man or Cover 1)
- Every rep knows its pre-snap shell (zero-, one- or two-high) and what it became.

### QB Profile (home screen)
- Tracks your actual tendencies across sessions, on this device only:
  - average release time
  - coverage and man-vs-zone recognition
  - correct 1st-read decisions
  - key defender reads (and how often you're late or early)
  - open receivers missed
  - turnover-worthy throws
  - success under pressure vs clean pockets
  - stare-down rate
  - best and worst coverages (including rotated shells) and concepts
  - a trend line
- **Coach's diagnosis** names your biggest leaks and starts the right drill in one tap, e.g. "You struggle when two-high shells rotate after the snap → Post-Snap Rotation Drill".
- **Drills:** Post-Snap Rotation, Man or Zone? Bluff, Key Read, Pressure, Eyes Discipline, Find the Open Man, Ball Security, Man vs Zone ID, plus a drill for any coverage.
- These are training metrics only. No ratings.

### Manual
- New chapters: **Key defender reads** and **Disguises & rotations**.

## v1.6.0 — Learn: Tutorial, Coach's Manual, a real coach after every play, share codes

### Tutorial (Home → Learn)
- **8 hands-on lessons** run on the real game, with your coach guiding each step:
  1. Your first throw
  2. Lob or bullet
  3. Beat the rusher
  4. Man or zone?
  5. Count the safeties
  6. Your first progression (Smash vs Cover 2)
  7. Beat man with Mesh
  8. Audibles & hot routes
- The coach waits for you to actually do each thing: snap, aim, switch to a bullet, scramble, call the coverage, audible.
- If a rep doesn't go right, you retry without sitting through the intro again. Your progress is saved.
- First-time players get a "New here?" card on the home screen.

### Coach's Manual (31 chapters with diagrams)
- **Start here:** how flag football works (NFL FLAG rules and how leagues differ), your team and the defense, how to play QB Brain.
- **Throwing:** lob vs bullet, beating the rush (how fast the rusher gets home on each difficulty).
- **Routes:** the route tree with flag depths and a coaching point for each route.
- **Coverages:** man vs zone, Man, Cover 1, Cover 2, Cover 3 (including NFL FLAG's no-rush version) and underneath zone, each drawn by the game's own defense with its tells, weaknesses and the concepts that beat it. Plus Cover 4 and the 2-2 and 3-1 shells you'll see in real games.
- **Reading the defense:** counting the safeties, reading one key defender (high-low and horizontal stretches), leverage, and 1-2-3 progressions.
- **Concepts:** Slant-Flat, Smash, Stick, Snag, Flood, Levels, Mesh, Drive, Four Verticals and Spacing, each with what it beats, the key defender and the if/then read.
- **Pro:** common QB mistakes, coaching cues and drills, a glossary and sources.
- **Practice / Run it** buttons drop you straight into a drill against that coverage or with that concept.
- Every chapter is tagged ROOKIE, ALL or PRO and lists its sources: the NFL FLAG rulebook and guides, USA Football, PlaybookTech First Down, Youth Football Online, iFlag and others. Where a chapter uses our own coaching rule of thumb, it says so.

### Your coach after every play
- A **COACH** card explains:
  - what the defense was and its tell
  - the read for the play (the key defender and the if/then rule)
  - who was open when you threw, and how open
  - your timing vs the rusher
  - one coaching tip
- **Coach View** freezes the moment you threw and draws the coverage on the field (zones and man assignments) and marks:
  - the most open receiver
  - your throw
  - the key defender who decided the play
- **Learn** opens the manual chapter for that coverage.
- **Coach talk** setting: Auto (simple on Rookie), Simple or Full breakdown.
- **Coach's notes** on the session summary point out what to work on, with links to the right chapter.

### Share codes
- **Share code** on any play (yours or built-in) gives you a code to copy or send.
- Teammates paste it into **Playbook → My Plays → Import a play**.

## v1.5.0 — Create a Play, audibles and play calling

### Create a Play (Playbook → My Plays → + Create a play)
- Build **5v5 or 7v7** plays from scratch, or **copy and edit** any Big Dawz or standard play.
- **Formation:** pick a preset (Spread, Twins, Trips, Bunch, Stack, Offset, Empty) or drag any player anywhere behind the line. The center stays on the ball to snap it.
- **Routes:** choose from 18 routes, including go, slant, hitch, out, in, flat, sit, stick, curl, comeback, dig, corner, post, drag, seam, wheel and swing.
  - Set the **depth** yard by yard and **flip** the break.
  - Or **draw your own** path point by point and drag the points to fine-tune it.
  - For every receiver, choose what happens at the end (keep running, sit down or stop), when he releases (on the snap up to +1.5 s), and whether he gets a dashed fake/motion line.
- **QB:** pick the alignment (under center, pistol or shotgun) and what he does after the snap (3-step drop, 5-step drop, stay, rollout or bootleg either way), or draw his path.
- **Read order:** tap your receivers in the order you read them.
- **Pitch (trick play):** pitch to any player at a time you choose. He becomes the passer.
- Add a **name**, a **coaching note** and up to **4 audibles**.
- **Save & test it** runs the play right away. Plays are saved on your device.

### Audibles at the line
- Before the snap, tap **AUDIBLE** to:
  - **Check to another play:** your preset audibles for that play, or any play if you haven't set any. The defense stays the same, so you're audibling against the look you saw.
  - **Hot-route a receiver:** tap him on the field and pick go, slant, hitch, out, in, flat, sit, corner, post or drag.
- Set audibles for any play, built-in or yours, from the Playbook.

### Play calling in Full Drive
- Before every down, call your play from **My Plays**, **Big Dawz** or **Standard**, or hit **Surprise me**.

## v1.4.1 — Tap = bullet, hold = lob

- In **Tap receiver** throw mode, a **quick tap** on a receiver throws a **bullet** as soon as you lift your finger.
- **Press and hold** a receiver for a **lob**. A ring fills around him while you hold, and the lob goes out after about a quarter second without waiting for you to let go.
- Both throws lead the receiver to where he'll be when the ball arrives.
- Tap mode now throws a real ball in every mode, not just Full Drive. Drills grade where the ball actually lands, so defenders can break on it, tip it or pick it off, just like the pullback meter.

## v1.4.0 — Scramble joystick

- **Scramble with a joystick** instead of dragging the QB. It shows up at the snap in the bottom corner. Push further to run faster, and let go to settle. The QB still can't cross the line of scrimmage.
- **Two-thumb play:** the stick under one thumb, and pull back anywhere with the other to throw on the run. Tapping a third finger still switches lob and bullet.
- **Pick your stick side** in Settings: **Left thumb** (default) or **Right thumb**.
- On a computer: **WASD** or the **arrow keys** scramble.
- While the stick is showing, the lob/bullet hint moves to the top of the field.

## v1.3.2 — Safeties play deep, no more fake blitzes

- **Safeties line up deeper:** the Cover 1 and Cover 3 middle safety is at about 12½ yds, the Cover 2 halves safeties at 12, and the Cover 3 deep corners at 10 (they were at 9–10).
- **Only the rusher rushes.** Underneath zone defenders used to attack the throwing lane toward short routes and backfield players, which looked like a blitz. Now they hold their zone depth: flat defenders stay at least 2½ yds off the line and hook defenders at least 4. Man defenders following jet and swing motion stop at the line instead of drifting into the backfield.
- **QB eyes work again:** where you aim pulls nearby zone defenders toward it, so looking off a defender matters.

## v1.3.1 — Elite speed rusher, 3-step drop

- **Elite rusher gets home in about 1–1.5 seconds:** about 1.2 s straight up the middle, 1.4 s off the edge, and 1.4 s on a delay. Rookie (about 2.9 s) and Varsity (about 2.3 s) are unchanged.
- **The QB takes a 3-step drop:** he takes a quick snap about 2 yds behind the center, then three drop steps (not yards) back before he sets. His legs show each step. Plays where the QB has his own movement (rollout, bootleg, slide, pitch) keep it.
- After the catch, the rusher chases at normal pursuit speed, so the faster rush doesn't carry over into run-after-catch.

## v1.3.0 — Gameplay overhaul: live defense, scrambling, flag pulls

- **Defense that plays like real defenders.** Defenders move with momentum: they accelerate, backpedal, plant and break, so they don't snap onto routes anymore.
  - **Man** defenders play press or off and keep leverage.
  - **Zone** defenders carry, sink and pass off receivers through their areas, and they drift with the QB's eyes.
  - Defenders break on the ball once it's thrown, and deep help shows up a beat later.
  - Higher difficulty brings more press, quicker eyes, tighter throwing lanes and a smarter rusher (edge rush, delay, or dropping into coverage).
- **QB scramble.** Touch the QB and drag him to move around the backfield and buy time. Like in flag, the QB can never cross the line of scrimmage, so there are no QB runs. With a second thumb, pull back anywhere to **throw on the run**.
- **Pixel players** with flag belts and a running animation, replacing the circles and triangles.
- **Flag pull animation:** the flag rips off the ball carrier's belt and into the defender's hand, on sacks and at the end of every run after the catch.
- **Catch, swat and incompletion animations:** a catch burst, a "SWAT!" on broken-up passes, "PICKED!" on interceptions, and incompletions that bounce along the turf. The banner waits for the play to finish, and you can tap to skip.
- **Sound effects,** all synthesized with nothing to download: snap, throw whoosh, lob/bullet click, catch thump, flag rip, sack thud, whistle, and the crowd cheering or groaning. Turn them off with the new **Sound** switch in Settings.
- No player ratings. It's still a trainer.

## v1.2.0 — Retro arcade UI overhaul

- **New home screen** with big tiles: **Play Drive**, **Drills**, **Playbook** and **Settings** — each opens its own screen with a back button.
- **Retro arcade look** (Retro Bowl vibe): jersey-number pixel font, chunky pressable buttons, scoreboard-style HUD, speckled pixel turf, blue-tinted end zones.
- **Big result banners** across the field after every play — TOUCHDOWN!, FIRST DOWN, +12 YARDS, INCOMPLETE, SACKED, INTERCEPTED — then the breakdown slides up. Tap the field to skip.
- **Playbook browser:** every play (Big Dawz and standard) drawn as a mini diagram; tap one to see the routes, read progression and notes, then **Run this play**. A "Create a play" slot is waiting for the next update.
- Settings (format, difficulty, throw control, progression) moved to their own screen and are summarized on the home tile.
- Drive status text cleaned up (no more repeated "drive over").

## v1.1.0 — Retro Bowl throwing meter

- Pulling back now starts as a **lob** by default, drawn as a Retro Bowl–style dotted arc (hollow "ball in the air" dots over shadow dots on the ground, with a ring at the passer).
- **Tap with a second finger while pulling** to switch to a **bullet** (tight gold dots, flatter, faster). Tap again to switch back. Space bar / right-click does the same on a computer.
- Removed the old hold-still-to-lob timer.
- Bottom-of-screen hint shows the current throw type and how to switch.

## v1.0.0 — First release <!-- commit: 5a9c84040a83e188205930e3a2b1616ae9a21672 -->

- QB Brain, Coverage ID, Quick Read and **Full Drive** modes (customizable 50–100 yd field, 20–53 yd width, 10-yd end zones, downs, run after catch, drive scoring).
- 5v5 (center snaps and is eligible) and 7v7; Man, Cover 1/2/3 and underneath zone with disguises.
- **Big Dawz** playbook (15 plays) plus standard concepts.
- Receivers track and adjust to the ball; rusher goes on the snap.
- Installable on iPhone (Add to Home Screen), works offline, remembers settings.
