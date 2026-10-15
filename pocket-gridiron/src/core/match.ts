import type { CoverageId } from "./data/defense";
import { DEFENSE_CALLS } from "./data/defense";
import { getPlay, type Play } from "./data/playbook";
import { adjustTeam } from "./data/teams";
import type { Team } from "./data/types";
import { CENTER_Y, describeYardLine, xToYardLine, yardLineToX } from "./field";
import { Rng } from "./math/rng";
import { chooseCoverage } from "./rules/coordinator";
import { simulateCpuDrive, type CpuDriveResult } from "./rules/cpuDrive";
import {
  advanceQuarter, applyPlay, callTimeout, downAndDistance, formatClock, newGame, newSeries, tickBetweenPlays,
  type GameState, type PlayResultInput, type RuleEvent, type TeamKey,
} from "./rules/gameState";
import { extraPointChance, fieldGoalChance, fieldGoalDistance, kickoffReturn, punt } from "./rules/specialTeams";
import { PlaySim, SIM_DT } from "./sim/playSim";
import type { Command, ControlInput, PlayOutcome } from "./sim/types";

export type Difficulty = "rookie" | "pro" | "allpro";

export interface MatchOptions {
  home: Team;
  away: Team;
  quarterMinutes: number;
  difficulty: Difficulty;
  seed: number;
}

export type Tone = "good" | "bad" | "neutral";

/** Game flow (the match-level state machine). Card states wait for the player to continue. */
export type Flow =
  | { kind: "kickoff"; title: string; detail: string }
  | { kind: "playCall" }
  | { kind: "preSnap" }
  | { kind: "live" }
  | { kind: "result"; title: string; detail: string; tone: Tone }
  | { kind: "pat" }
  | { kind: "cpuDrive"; drive: CpuDriveResult; detail: string }
  | { kind: "quarter"; title: string; detail: string }
  | { kind: "final"; title: string; detail: string };

export type MatchEvent = RuleEvent | { kind: "flow"; flow: Flow["kind"] } | { kind: "cpuScore"; points: number };

export interface OffenseStats {
  plays: number;
  passAtt: number;
  passComp: number;
  passYds: number;
  passTd: number;
  ints: number;
  sacks: number;
  rushYds: number;
  firstDowns: number;
  thirdAtt: number;
  thirdConv: number;
  longest: number;
  receiving: Record<string, { name: string; number: number; rec: number; yds: number; td: number }>;
}

export interface DriveStats {
  plays: number;
  startYardLine: number;
  startClock: number;
  startQuarter: number;
}

type After = "next" | "pat" | "cpuDrive" | "kickoffToCpu" | "kickoffToUser" | "cpuKickoffAfterSafety";

const DIFFICULTY: Record<Difficulty, { ratingShift: number; reactionBias: number; cpuEdge: number }> = {
  rookie: { ratingShift: -7, reactionBias: 0.08, cpuEdge: -0.8 },
  pro: { ratingShift: 0, reactionBias: 0, cpuEdge: 0 },
  allpro: { ratingShift: 5, reactionBias: -0.04, cpuEdge: 0.6 },
};

export class Match {
  readonly opts: MatchOptions;
  readonly user: TeamKey = "home";
  readonly cpu: TeamKey = "away";
  /** The CPU team with difficulty applied. */
  readonly cpuTeam: Team;
  readonly userTeam: Team;
  state: GameState;
  flow: Flow;
  sim: PlaySim | null = null;
  play: Play | null = null;
  flipped = false;
  /** Coverage the CPU has called for the upcoming snap (kept if the user changes the play). */
  coverage: CoverageId | null = null;
  isTry = false;
  stats: OffenseStats = emptyStats();
  drive: DriveStats;
  lastOutcome: PlayOutcome | null = null;
  lastDrive: CpuDriveResult | null = null;

  private rng: Rng;
  private after: After = "next";
  private pendingDrive: CpuDriveResult | null = null;
  private acc = 0;
  private queued: Command[] = [];
  private events: MatchEvent[] = [];
  private recentCoverages: CoverageId[] = [];
  private playCount = 0;

  constructor(opts: MatchOptions) {
    this.opts = opts;
    this.rng = new Rng(opts.seed);
    const d = DIFFICULTY[opts.difficulty];
    this.userTeam = opts.home;
    this.cpuTeam = adjustTeam(opts.away, d.ratingShift);
    this.state = newGame(opts.quarterMinutes, this.user);
    this.drive = { plays: 0, startYardLine: 25, startClock: this.state.clock, startQuarter: 1 };
    this.flow = { kind: "kickoff", title: "", detail: "" };
    this.userReceivesKickoff(`${this.cpuTeam.city} ${this.cpuTeam.name} kick off`);
  }

  // ------------------------------------------------------------------ queries

  get difficulty() {
    return DIFFICULTY[this.opts.difficulty];
  }

  /** Clock to display: counts down live during a play. */
  get displayClock(): number {
    if (this.sim && (this.flow.kind === "live") && !this.isTry) return Math.max(0, this.state.clock - this.sim.liveTime);
    return this.state.clock;
  }

  get clockText(): string {
    return formatClock(this.displayClock);
  }

  get downText(): string {
    if (this.isTry) return "2-PT TRY";
    return downAndDistance(this.state);
  }

  get ballOnText(): string {
    return describeYardLine(this.state.yardLine);
  }

  get canTimeout(): boolean {
    return (this.flow.kind === "playCall" || this.flow.kind === "preSnap") && this.state.clockRunning && this.state.timeouts[this.user] > 0 && !this.isTry;
  }

  get fourthDown(): boolean {
    return this.state.down === 4 && !this.isTry;
  }

  get fieldGoalInfo(): { distance: number; chance: number } {
    const distance = fieldGoalDistance(this.state.yardLine);
    return { distance, chance: fieldGoalChance(distance, this.userTeam.kicker) };
  }

  get extraPointChance(): number {
    return extraPointChance(this.userTeam.kicker);
  }

  get losX(): number {
    return yardLineToX(this.state.yardLine);
  }

  get firstDownX(): number | null {
    if (this.isTry || this.state.lineToGain >= 100) return null;
    return yardLineToX(this.state.lineToGain);
  }

  drainEvents(): MatchEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  private setFlow(f: Flow): void {
    this.flow = f;
    this.events.push({ kind: "flow", flow: f.kind });
  }

  // ------------------------------------------------------------------ play calling

  /** Pick a play: lines both teams up. The defense's call is fixed until the snap. */
  selectPlay(playId: string, flipped = false): void {
    if (this.flow.kind !== "playCall" && this.flow.kind !== "preSnap") return;
    this.play = getPlay(playId);
    this.flipped = flipped;
    if (!this.coverage) {
      this.coverage = chooseCoverage(this.state, this.rng, this.recentCoverages);
    }
    this.playCount++;
    this.sim = new PlaySim(this.userTeam, this.cpuTeam, this.play, flipped, {
      losX: yardLineToX(this.state.yardLine),
      ballY: this.state.ballY,
      firstDownX: this.firstDownX ?? yardLineToX(100),
      coverage: this.coverage,
      isTry: this.isTry,
      seed: Math.floor(this.rng.next() * 2 ** 31),
      reactionBias: this.difficulty.reactionBias,
    });
    this.setFlow({ kind: "preSnap" });
  }

  /** Back to the play list (keeps the defense's call). */
  changePlay(): void {
    if (this.flow.kind !== "preSnap") return;
    this.sim = null;
    this.setFlow({ kind: "playCall" });
  }

  snap(): void {
    if (this.flow.kind !== "preSnap" || !this.sim) return;
    // Snapping early saves whatever is left of the between-play runoff.
    this.state.runoff = 0;
    this.sim.snap();
    this.acc = 0;
    this.queued = [];
    this.setFlow({ kind: "live" });
  }

  timeout(): boolean {
    if (!this.canTimeout) return false;
    return callTimeout(this.state, this.user);
  }

  queueCommand(c: Command): void {
    if (this.flow.kind === "live") this.queued.push(c);
  }

  // ------------------------------------------------------------------ frame update

  /** Advance real time. Runs the play at a fixed 60 Hz and the between-play clock. */
  update(realDt: number, move: ControlInput["move"]): void {
    const dt = Math.min(realDt, 0.1);
    if ((this.flow.kind === "playCall" || this.flow.kind === "preSnap") && !this.isTry) {
      if (tickBetweenPlays(this.state, dt)) {
        this.sim = null;
        this.handleQuarterEnd();
      }
      return;
    }
    if (this.flow.kind !== "live" || !this.sim) return;
    this.acc += dt;
    while (this.acc >= SIM_DT) {
      this.acc -= SIM_DT;
      const commands = this.queued;
      this.queued = [];
      this.sim.step(SIM_DT, { move, commands });
      if (this.sim.phase === "result") {
        this.resolvePlay(this.sim.outcome!);
        break;
      }
    }
  }

  /** Run the current play to completion with an input function (tests and demos). */
  runPlay(input: (sim: PlaySim) => ControlInput, maxSeconds = 30): PlayOutcome | null {
    if (this.flow.kind === "preSnap") this.snap();
    let guard = Math.round(maxSeconds / SIM_DT);
    while (this.flow.kind === "live" && guard-- > 0) {
      const inp = input(this.sim!);
      for (const c of inp.commands) this.queueCommand(c);
      this.update(SIM_DT, inp.move);
    }
    return this.lastOutcome;
  }

  // ------------------------------------------------------------------ results

  private resolvePlay(o: PlayOutcome): void {
    this.lastOutcome = o;
    const sim = this.sim!;
    if (this.isTry) return this.resolveTry(o);
    this.drive.plays++;
    this.recordStats(o, sim);
    const prev = this.state;
    const input: PlayResultInput = {
      kind: o.kind, spot: xToYardLine(o.spotX), spotY: o.spotY, elapsed: o.elapsed, clockStops: o.clockStops,
    };
    const { state, events } = applyPlay(prev, input);
    this.state = state;
    this.events.push(...events);
    this.recentCoverages.push(sim.call.id);
    this.coverage = null;
    const coverName = DEFENSE_CALLS[sim.call.id].name;
    const gain = Math.round(o.yards);
    let title = "";
    let tone: Tone = "neutral";
    const fd = events.some((e) => e.kind === "firstDown");
    switch (o.kind) {
      case "touchdown":
        title = "TOUCHDOWN!"; tone = "good"; this.after = "pat"; break;
      case "pickSix":
        title = "PICK SIX"; tone = "bad"; this.after = "kickoffToUser";
        this.cpuExtraPoint();
        break;
      case "safety":
        title = "SAFETY"; tone = "bad"; this.after = "cpuKickoffAfterSafety"; break;
      case "interception":
      case "interceptionTouchback":
        title = "INTERCEPTED"; tone = "bad"; this.after = "cpuDrive"; break;
      case "incomplete":
        title = "INCOMPLETE"; tone = "neutral"; this.after = "next"; break;
      case "sack":
        title = "SACKED"; tone = "bad"; this.after = "next"; break;
      default:
        title = fd ? "FIRST DOWN" : gain > 0 ? `GAIN OF ${gain}` : gain === 0 ? "NO GAIN" : `LOSS OF ${-gain}`;
        tone = fd || gain >= 5 ? "good" : gain <= 0 ? "bad" : "neutral";
        this.after = "next";
    }
    if (events.some((e) => e.kind === "turnoverOnDowns")) {
      title = "TURNOVER ON DOWNS"; tone = "bad"; this.after = "cpuDrive";
    }
    const where = this.after === "next" ? ` · ${downAndDistance(this.state)} at ${describeYardLine(this.state.yardLine)}` : "";
    const detail = `${o.text}.${where}\nDefense: ${coverName}`;
    this.setFlow({ kind: "result", title, detail, tone });
  }

  private resolveTry(o: PlayOutcome): void {
    this.isTry = false;
    const good = o.kind === "touchdown";
    if (good) this.state.score[this.user] += 2;
    this.events.push({ kind: "extraPoint", team: this.user, good, points: good ? 2 : 0 });
    this.after = "kickoffToCpu";
    this.setFlow({
      kind: "result", title: good ? "2-POINT GOOD" : "2-POINT FAILED", tone: good ? "good" : "bad",
      detail: `${o.text}.`,
    });
    this.restoreAfterTry();
  }

  private savedBeforeTry: Pick<GameState, "yardLine" | "down" | "lineToGain" | "ballY"> | null = null;

  private restoreAfterTry(): void {
    if (this.savedBeforeTry) Object.assign(this.state, this.savedBeforeTry);
    this.savedBeforeTry = null;
  }

  private recordStats(o: PlayOutcome, sim: PlaySim): void {
    const st = this.stats;
    st.plays++;
    const third = this.state.down === 3;
    if (third) st.thirdAtt++;
    if (o.passAttempt) {
      st.passAtt++;
      if (o.completion) {
        st.passComp++;
        st.passYds += Math.round(o.yards);
        const r = sim.get(o.receiverId!)!;
        const rec = (st.receiving[r.profile.id] ??= { name: r.profile.name, number: r.profile.number, rec: 0, yds: 0, td: 0 });
        rec.rec++;
        rec.yds += Math.round(o.yards);
        if (o.kind === "touchdown") { rec.td++; st.passTd++; }
      }
      if (o.kind === "interception" || o.kind === "pickSix" || o.kind === "interceptionTouchback") st.ints++;
    } else if (o.kind === "sack") {
      st.sacks++;
    } else if (o.qbScramble) {
      st.rushYds += Math.round(o.yards);
    }
    st.longest = Math.max(st.longest, Math.round(o.yards));
    const after = this.state.yardLine + o.yards;
    if (o.kind === "touchdown" || (o.kind !== "incomplete" && after >= this.state.lineToGain && !o.kind.startsWith("interception"))) {
      st.firstDowns++;
      if (third) st.thirdConv++;
    }
  }

  /** Continue from a card (kickoff, result, CPU drive, quarter break). */
  continue(): void {
    switch (this.flow.kind) {
      case "kickoff":
        this.setFlow({ kind: "playCall" });
        return;
      case "result":
        this.afterResult();
        return;
      case "cpuDrive":
        this.finishCpuDrive();
        return;
      case "quarter":
        if (this.flow.title === "HALFTIME") this.cpuReceivesKickoff();
        else this.setFlow({ kind: "playCall" });
        return;
      default:
        return;
    }
  }

  private afterResult(): void {
    switch (this.after) {
      case "pat":
        this.setFlow({ kind: "pat" });
        return;
      case "cpuDrive":
        if (this.state.clock <= 0 && this.halfOrGameEnds()) return this.handleQuarterEnd();
        this.runCpuDrive();
        return;
      case "kickoffToCpu":
        if (this.state.clock <= 0) return this.handleQuarterEnd();
        this.cpuReceivesKickoff();
        return;
      case "kickoffToUser":
        if (this.state.clock <= 0) return this.handleQuarterEnd();
        this.userReceivesKickoff(`${this.cpuTeam.name} kick off`);
        return;
      case "cpuKickoffAfterSafety":
        if (this.state.clock <= 0 && this.halfOrGameEnds()) return this.handleQuarterEnd();
        // Free kick from our 20: CPU starts around their 40.
        this.state = newSeries(this.state, this.cpu, Math.round(35 + this.rng.range(0, 12)));
        this.runCpuDrive();
        return;
      case "next":
      default:
        if (this.state.clock <= 0) return this.handleQuarterEnd();
        this.setFlow({ kind: "playCall" });
    }
  }

  private halfOrGameEnds(): boolean {
    return this.state.quarter === 2 || this.state.quarter === 4;
  }

  // ------------------------------------------------------------------ kicks

  choosePat(kind: "kick" | "two"): void {
    if (this.flow.kind !== "pat") return;
    if (kind === "kick") {
      const good = this.rng.chance(this.extraPointChance);
      if (good) this.state.score[this.user] += 1;
      this.events.push({ kind: "extraPoint", team: this.user, good, points: good ? 1 : 0 });
      this.after = "kickoffToCpu";
      this.setFlow({ kind: "result", title: good ? "EXTRA POINT GOOD" : "EXTRA POINT NO GOOD", tone: good ? "good" : "bad", detail: `${this.userTeam.kicker.name} from 33 yards.` });
      return;
    }
    // Two-point try: one snap from the 2.
    this.savedBeforeTry = { yardLine: this.state.yardLine, down: this.state.down, lineToGain: this.state.lineToGain, ballY: this.state.ballY };
    this.isTry = true;
    this.state.yardLine = 98;
    this.state.down = 1;
    this.state.lineToGain = 100;
    this.state.ballY = CENTER_Y;
    this.coverage = null;
    this.setFlow({ kind: "playCall" });
  }

  punt(): void {
    if (this.flow.kind !== "playCall" || !this.fourthDown) return;
    const p = punt(this.state.yardLine, this.userTeam.punter, this.rng);
    this.state.clock = Math.max(0, this.state.clock - 7);
    this.state.clockRunning = false;
    this.state.runoff = 0;
    this.state = newSeries(this.state, this.cpu, p.receiverYardLine);
    this.events.push({ kind: "turnover", reason: "punt" });
    this.after = "cpuDrive";
    this.coverage = null;
    this.setFlow({ kind: "result", title: "PUNT", tone: "neutral", detail: `${this.userTeam.punter.name}: ${p.text}. ${this.cpuTeam.name} ball at their ${Math.round(p.receiverYardLine)}.` });
  }

  fieldGoal(): void {
    if (this.flow.kind !== "playCall" || this.isTry) return;
    const { distance, chance } = this.fieldGoalInfo;
    const good = this.rng.chance(chance);
    this.state.clock = Math.max(0, this.state.clock - 5);
    this.state.clockRunning = false;
    this.state.runoff = 0;
    this.coverage = null;
    this.events.push({ kind: "fieldGoal", team: this.user, good, distance });
    if (good) {
      this.state.score[this.user] += 3;
      this.after = "kickoffToCpu";
      this.setFlow({ kind: "result", title: "FIELD GOAL GOOD", tone: "good", detail: `${this.userTeam.kicker.name} from ${distance} yards.` });
    } else {
      const cpuYL = Math.max(20, 100 - (this.state.yardLine - 7));
      this.state = newSeries(this.state, this.cpu, cpuYL);
      this.events.push({ kind: "turnover", reason: "missedFG" });
      this.after = "cpuDrive";
      this.setFlow({ kind: "result", title: "NO GOOD", tone: "bad", detail: `${distance}-yard attempt misses. ${this.cpuTeam.name} take over at their ${cpuYL}.` });
    }
  }

  private cpuExtraPoint(): void {
    if (this.rng.chance(extraPointChance(this.cpuTeam.kicker))) this.state.score[this.cpu] += 1;
  }

  // ------------------------------------------------------------------ possessions

  private userReceivesKickoff(lead: string): void {
    const k = kickoffReturn(this.rng);
    this.state = newSeries(this.state, this.user, k.yardLine);
    this.state.clockRunning = false;
    this.state.runoff = 0;
    this.startDrive();
    this.setFlow({ kind: "kickoff", title: "KICKOFF", detail: `${lead}. ${k.text}. Your ball at ${describeYardLine(k.yardLine)}.` });
  }

  private cpuReceivesKickoff(): void {
    // CPU kickoff returns use the same model as ours.
    const k = kickoffReturn(this.rng);
    this.state = newSeries(this.state, this.cpu, k.yardLine);
    this.runCpuDrive();
  }

  private runCpuDrive(): void {
    this.state.possession = this.cpu;
    this.state.clockRunning = false;
    this.state.runoff = 0;
    const drive = simulateCpuDrive(this.state, this.cpuTeam, this.userTeam, this.rng, this.difficulty.cpuEdge);
    this.pendingDrive = drive;
    this.lastDrive = drive;
    if (drive.points > 0) this.events.push({ kind: "cpuScore", points: drive.points });
    const mins = formatClock(drive.timeUsed);
    const detail = `${drive.plays} plays, ${drive.yards} yds, ${mins}`;
    this.setFlow({ kind: "cpuDrive", drive, detail });
  }

  private finishCpuDrive(): void {
    const d = this.pendingDrive;
    if (!d) return;
    this.pendingDrive = null;
    this.state = { ...d.state, score: { ...d.state.score }, timeouts: { ...d.state.timeouts } };
    if (d.end === "endOfHalf" || this.state.clock <= 0) {
      this.state.clock = 0;
      return this.handleQuarterEnd();
    }
    if (d.userYardLine === null) {
      this.userReceivesKickoff(`${this.cpuTeam.name} kick off`);
      return;
    }
    this.state = newSeries(this.state, this.user, d.userYardLine);
    this.state.clockRunning = false;
    this.state.runoff = 0;
    this.startDrive();
    this.setFlow({ kind: "kickoff", title: "YOUR BALL", detail: `${d.summary}. You take over at ${describeYardLine(d.userYardLine)}.` });
  }

  private startDrive(): void {
    this.drive = { plays: 0, startYardLine: this.state.yardLine, startClock: this.state.clock, startQuarter: this.state.quarter };
  }

  private handleQuarterEnd(): void {
    const q = this.state.quarter;
    const t = advanceQuarter(this.state);
    if (t === "final") {
      this.state.clock = 0;
      this.events.push({ kind: "final" });
      const h = this.state.score[this.user];
      const a = this.state.score[this.cpu];
      const title = h > a ? "YOU WIN!" : h < a ? "FINAL" : "TIE GAME";
      this.setFlow({ kind: "final", title, detail: `${this.userTeam.name} ${h}, ${this.cpuTeam.name} ${a}` });
      return;
    }
    if (t === "halftime") {
      this.events.push({ kind: "halftime" });
      this.setFlow({ kind: "quarter", title: "HALFTIME", detail: `${this.userTeam.name} ${this.state.score[this.user]}, ${this.cpuTeam.name} ${this.state.score[this.cpu]}. ${this.cpuTeam.name} receive the second-half kickoff.` });
      return;
    }
    this.events.push({ kind: "endQuarter", quarter: q });
    // Possession and field position carry over to the next quarter.
    this.state.possession = this.user;
    this.setFlow({ kind: "quarter", title: `END OF Q${q}`, detail: `${downAndDistance(this.state)} at ${describeYardLine(this.state.yardLine)}.` });
  }
}

export function emptyStats(): OffenseStats {
  return { plays: 0, passAtt: 0, passComp: 0, passYds: 0, passTd: 0, ints: 0, sacks: 0, rushYds: 0, firstDowns: 0, thirdAtt: 0, thirdConv: 0, longest: 0, receiving: {} };
}
