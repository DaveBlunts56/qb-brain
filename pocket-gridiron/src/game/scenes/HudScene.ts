import Phaser from "phaser";
import { DEFENSE_CALLS } from "../../core/data/defense";
import { PLAYBOOK } from "../../core/data/playbook";
import { describeYardLine } from "../../core/field";
import type { Flow } from "../../core/match";
import { formatClock } from "../../core/rules/gameState";
import { app } from "../app";
import { MARKER_COLORS } from "../art/sprites";
import { COLORS, toWorldX, toWorldY } from "../config";
import { buildControlsHelp } from "../ui/controlsHelp";
import { PixelButton, UI } from "../ui/kit";
import { drawMarker, drawPlayDiagram } from "../ui/playDiagram";
import { HOLD_LOB, HOLD_TOUCH, passTypeForHold, type Session } from "../session";

interface CircleButton {
  cx: number;
  cy: number;
  r: number;
}

interface ReceiverButton extends CircleButton {
  receiverId: string;
  marker: number;
  label: Phaser.GameObjects.BitmapText;
}

const TONE_COLOR = { good: COLORS.good, bad: COLORS.bad, neutral: COLORS.ink };
/** Drag distance (CSS px) for the maximum 6-yard lead. */
const AIM_DRAG_CSS = 70;

/**
 * Heads-up display and touch controls. Lays everything out in CSS pixels × device ratio inside
 * the safe area, and rebuilds when the game flow or the screen changes.
 */
export class HudScene extends Phaser.Scene {
  private session!: Session;
  private ui!: UI;
  private root!: Phaser.GameObjects.Container;
  private overlay!: Phaser.GameObjects.Container;
  private controlsG!: Phaser.GameObjects.Graphics;
  private bugTexts: Record<string, Phaser.GameObjects.BitmapText> = {};
  private banner!: Phaser.GameObjects.BitmapText;
  private bannerAt = 0;
  private hint!: Phaser.GameObjects.BitmapText;
  private aimLabel!: Phaser.GameObjects.BitmapText;
  private recvButtons: ReceiverButton[] = [];
  private juke: CircleButton = { cx: 0, cy: 0, r: 0 };
  private dive: CircleButton = { cx: 0, cy: 0, r: 0 };
  private actionLabels: Phaser.GameObjects.BitmapText[] = [];
  private stick = { active: false, pointerId: -1, baseX: 0, baseY: 0, knobX: 0, knobY: 0, homeX: 0, homeY: 0, R: 0 };
  private aimPointer: { id: number; x: number; y: number } | null = null;
  private builtFlow: Flow | null = null;
  private builtPaused = false;
  private builtHelp = false;
  private showHelp = false;
  private flipNext = false;
  private overlayReadyAt = 0;
  private preSnapButtons: PixelButton[] = [];
  private keys: Record<string, Phaser.Input.Keyboard.Key> = {};
  private keyAim: number | null = null;

  constructor() {
    super("hud");
  }

  create(data: { session: Session }): void {
    this.session = data.session;
    this.ui = new UI(this);
    this.input.addPointer(3);
    this.layout();
    const relayout = () => this.layout();
    this.game.events.on("pg-layout", relayout);
    this.events.once("shutdown", () => this.game.events.off("pg-layout", relayout));
    this.input.on("pointerdown", this.onDown, this);
    this.input.on("pointermove", this.onMove, this);
    this.input.on("pointerup", this.onUp, this);
    this.input.on("pointerupoutside", this.onUp, this);
    this.setupKeyboard();
  }

  private get match() {
    return this.session.match;
  }

  // ------------------------------------------------------------------ layout

  private layout(): void {
    this.children.removeAll(true);
    this.recvButtons = [];
    this.actionLabels = [];
    this.bugTexts = {};
    this.builtFlow = null;
    const ui = this.ui;
    const u = ui.u;
    this.root = this.add.container(0, 0);
    this.controlsG = this.add.graphics();
    this.overlay = this.add.container(0, 0).setDepth(100);
    this.buildScorebug();
    const safe = ui.safe;
    const pause = ui.button(this.scale.width - safe.right - 40 * u, safe.top, 40 * u, 30 * u, "II", () => this.setPaused(true), { size: "md" });
    this.root.add(pause.container);
    this.banner = ui.text(this.scale.width / 2, this.scale.height * 0.3, "", "xl", COLORS.gold, 0.5, 0.5).setDepth(50).setAlpha(0);
    this.hint = ui.text(this.scale.width / 2, this.scale.height - safe.bottom, "", "xs", COLORS.ink, 0.5, 1).setDepth(40);
    this.aimLabel = ui.text(0, 0, "", "md", COLORS.ink, 0.5, 1).setDepth(60).setVisible(false);
    this.buildControls();
  }

  private buildScorebug(): void {
    const ui = this.ui;
    const u = ui.u;
    const m = this.match;
    const g = this.add.graphics();
    this.root.add(g);
    const segs: [string, number, number][] = [
      ["home", 70, m.userTeam.colors.primary],
      ["away", 70, m.cpuTeam.colors.primary],
      ["clock", 76, 0x16251d],
      ["down", 96, 0x16251d],
      ["spot", 70, 0x16251d],
    ];
    const total = segs.reduce((s, [, w]) => s + w, 0) * u;
    const h = 22 * u;
    let x = Math.round((this.scale.width - total) / 2);
    const y = ui.safe.top;
    g.fillStyle(0x0a0e0c, 0.9);
    g.fillRect(x - 2 * u, y - 2 * u, total + 4 * u, h + 4 * u);
    for (const [key, w, color] of segs) {
      const ww = w * u;
      g.fillStyle(color, 1);
      g.fillRect(x, y, ww - u, h);
      if (key === "home" || key === "away") {
        const team = key === "home" ? m.userTeam : m.cpuTeam;
        g.fillStyle(team.colors.secondary, 1);
        g.fillRect(x, y + h - 2 * u, ww - u, 2 * u);
      }
      const t = ui.text(x + ww / 2, y + h / 2, "", "sm", COLORS.ink, 0.5, 0.5);
      this.bugTexts[key] = t;
      this.root.add(t);
      x += ww;
    }
  }

  private updateScorebug(): void {
    const m = this.match;
    const s = m.state;
    const set = (k: string, v: string, color: number = COLORS.ink) => {
      const t = this.bugTexts[k];
      if (!t) return;
      const up = v.toUpperCase();
      if (t.text !== up) t.setText(up);
      t.setTint(color);
    };
    set("home", `${m.userTeam.abbr} ${s.score.home}`);
    set("away", `${m.cpuTeam.abbr} ${s.score.away}`);
    const running = s.clockRunning && (m.flow.kind === "playCall" || m.flow.kind === "preSnap");
    set("clock", `Q${s.quarter} ${formatClock(m.displayClock)}`, running ? COLORS.gold : COLORS.ink);
    const ourBall = s.possession === m.user;
    set("down", ourBall || m.isTry ? m.downText : "CPU BALL", m.isTry ? COLORS.gold : COLORS.ink);
    set("spot", ourBall ? describeYardLine(s.yardLine) : "--");
  }

  private buildControls(): void {
    const ui = this.ui;
    const u = ui.u;
    const W = this.scale.width;
    const H = this.scale.height;
    const safe = ui.safe;
    const left = app().store.settings.leftHanded;
    // Joystick home (ghost) position.
    this.stick.R = 50 * u;
    this.stick.homeX = left ? W - safe.right - 80 * u : safe.left + 80 * u;
    this.stick.homeY = H - safe.bottom - 74 * u;
    // Receiver buttons: a column on the throwing side, top-to-bottom like the receivers on the field.
    const r = Math.min(29 * u, (H - safe.top - safe.bottom - 70 * u) / 9);
    const colX = left ? safe.left + r + 14 * u : W - safe.right - r - 14 * u;
    const top = safe.top + 44 * u + r;
    const bottom = H - safe.bottom - r - 6 * u;
    for (let i = 0; i < 4; i++) {
      const cy = top + ((bottom - top) * i) / 3;
      // Gentle arc toward the thumb.
      const arc = [16, 4, 0, 10][i] * u * (left ? -1 : 1);
      const label = ui.text(colX - arc, cy + r * 0.62, "", "xs", COLORS.ink, 0.5, 0.5);
      this.recvButtons.push({ cx: colX - arc, cy, r, receiverId: "", marker: i, label });
    }
    // Ball carrier actions.
    const jr = 36 * u;
    this.juke = { cx: left ? safe.left + jr + 18 * u : W - safe.right - jr - 18 * u, cy: H - safe.bottom - jr - 10 * u, r: jr };
    this.dive = { cx: this.juke.cx + (left ? 1 : -1) * (jr * 1.9), cy: this.juke.cy - jr * 0.9, r: 27 * u };
    this.actionLabels = [
      ui.text(this.juke.cx, this.juke.cy, "JUKE", "md", COLORS.ink, 0.5, 0.5),
      ui.text(this.dive.cx, this.dive.cy, "DIVE", "sm", COLORS.ink, 0.5, 0.5),
    ];
  }

  // ------------------------------------------------------------------ frame

  override update(): void {
    const s = this.session;
    const m = this.match;
    this.updateScorebug();
    if (s.paused !== this.builtPaused || m.flow !== this.builtFlow || this.showHelp !== this.builtHelp) this.buildOverlay();
    // Touch joystick wins; otherwise the keyboard (desktop). Nothing moves outside live play.
    if (m.flow.kind !== "live") s.move = { x: 0, y: 0 };
    else if (!this.stick.active) s.move = this.keyboardMove();
    this.drawControls();
    this.updateBanner();
    this.updatePreSnapButtons();
  }

  private updateBanner(): void {
    const b = this.session.banner;
    if (b && b.at !== this.bannerAt) {
      this.bannerAt = b.at;
      this.banner.setText(b.text).setTint(b.color).setAlpha(1).setScale(this.ui.scaleFor("xl") * 0.6);
      this.tweens.killTweensOf(this.banner);
      this.tweens.add({ targets: this.banner, scale: this.ui.scaleFor("xl"), duration: 180, ease: "Back.Out" });
      this.tweens.add({ targets: this.banner, alpha: 0, delay: 1100, duration: 400 });
    }
  }

  private drawControls(): void {
    const g = this.controlsG;
    g.clear();
    const s = this.session;
    const m = this.match;
    const sim = m.sim;
    const u = this.ui.u;
    const live = m.flow.kind === "live" && !s.paused && !!sim;
    // Joystick.
    const st = this.stick;
    const showStick = live && (sim!.controlledId !== null);
    if (showStick) {
      const bx = st.active ? st.baseX : st.homeX;
      const by = st.active ? st.baseY : st.homeY;
      g.lineStyle(2 * u, 0xffffff, st.active ? 0.45 : 0.2);
      g.strokeCircle(bx, by, st.R);
      g.fillStyle(0xffffff, st.active ? 0.5 : 0.18);
      g.fillCircle(st.active ? st.knobX : bx, st.active ? st.knobY : by, 22 * u);
    }
    // Receiver buttons.
    const canThrow = live && sim!.canThrow;
    const receivers = sim ? sim.receivers : [];
    for (const b of this.recvButtons) {
      const rec = receivers.find((r) => r.marker === b.marker);
      b.receiverId = rec?.id ?? "";
      const visible = canThrow && !!rec && rec.mode !== "passBlock";
      b.label.setVisible(visible);
      if (!visible) continue;
      const held = s.aim?.receiverId === b.receiverId;
      g.fillStyle(0x0a0e0c, 0.55);
      g.fillCircle(b.cx, b.cy, b.r);
      g.lineStyle(2 * u, MARKER_COLORS[b.marker], held ? 1 : 0.85);
      g.strokeCircle(b.cx, b.cy, b.r);
      drawMarker(g, b.marker, b.cx, b.cy - b.r * 0.12, b.r * 0.42);
      b.label.setText(`#${rec!.profile.number}`);
      if (held) this.drawHoldRing(g, b);
    }
    if (!s.aim) this.aimLabel.setVisible(false);
    if (sim && (m.flow.kind === "preSnap" || canThrow)) this.drawOffscreenReceivers(g);
    // Ball-carrier actions.
    const ctl = sim?.controlled;
    const carrier = live && !!ctl && sim!.ball.carrierId === ctl.id && ctl.side === "offense" && (ctl.id !== sim!.qb.id || sim!.qbCrossedLos);
    for (const t of this.actionLabels) t.setVisible(carrier);
    if (carrier) {
      for (const [b, ready] of [[this.juke, ctl!.jukeCooldown <= 0], [this.dive, ctl!.diveTimer <= 0]] as const) {
        g.fillStyle(0x0a0e0c, 0.55);
        g.fillCircle(b.cx, b.cy, b.r);
        g.lineStyle(2 * u, ready ? COLORS.gold : 0x666666, 0.9);
        g.strokeCircle(b.cx, b.cy, b.r);
      }
    }
    // Hint text.
    let hint = "";
    if (live && canThrow && !s.aim) hint = "TAP = BULLET · HOLD = TOUCH/LOB · DRAG TO LEAD";
    else if (carrier) hint = "RUN! JUKE TO MAKE THEM MISS";
    else if (live && ctl && ctl.side === "offense" && sim!.ball.possession === "defense") hint = "CHASE HIM DOWN!";
    if (this.hint.text !== hint) this.hint.setText(hint);
  }

  /** Receivers outside the camera view get their marker pinned to the screen edge. */
  private drawOffscreenReceivers(g: Phaser.GameObjects.Graphics): void {
    const sim = this.match.sim!;
    const cam = this.scene.get("game").cameras.main;
    const u = this.ui.u;
    const W = this.scale.width;
    const H = this.scale.height;
    const inset = 16 * u;
    for (const r of sim.receivers) {
      const sx = (toWorldX(r.pos.x) - cam.worldView.x) * cam.zoom;
      const sy = (toWorldY(r.pos.y) - cam.worldView.y) * cam.zoom;
      if (sx > inset && sx < W - inset && sy > inset && sy < H - inset) continue;
      const cx = Math.min(W - inset, Math.max(inset, sx));
      const cy = Math.min(H - inset, Math.max(inset + 24 * u, sy));
      const ang = Math.atan2(sy - cy, sx - cx);
      g.fillStyle(MARKER_COLORS[r.marker], 0.9);
      const tip = 9 * u;
      g.fillTriangle(
        cx + Math.cos(ang) * tip, cy + Math.sin(ang) * tip,
        cx + Math.cos(ang + 2.5) * tip * 0.6, cy + Math.sin(ang + 2.5) * tip * 0.6,
        cx + Math.cos(ang - 2.5) * tip * 0.6, cy + Math.sin(ang - 2.5) * tip * 0.6,
      );
      drawMarker(g, r.marker, cx - Math.cos(ang) * 6 * u, cy - Math.sin(ang) * 6 * u, 5 * u, 0.95);
    }
  }

  private drawHoldRing(g: Phaser.GameObjects.Graphics, b: ReceiverButton): void {
    const s = this.session;
    const u = this.ui.u;
    const held = (performance.now() - s.aim!.startedAt) / 1000;
    const type = passTypeForHold(held);
    const frac = Math.min(1, held / HOLD_LOB);
    const color = type === "bullet" ? 0xffffff : type === "touch" ? COLORS.gold : 0xff9f43;
    g.lineStyle(4 * u, color, 1);
    g.beginPath();
    g.arc(b.cx, b.cy, b.r + 5 * u, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2, false);
    g.strokePath();
    // Threshold ticks.
    for (const t of [HOLD_TOUCH, HOLD_LOB]) {
      const a = -Math.PI / 2 + (t / HOLD_LOB) * Math.PI * 2;
      g.fillStyle(0x0a0e0c, 1);
      g.fillCircle(b.cx + Math.cos(a) * (b.r + 5 * u), b.cy + Math.sin(a) * (b.r + 5 * u), 2 * u);
    }
    const left = app().store.settings.leftHanded;
    this.aimLabel.setVisible(true).setText(type.toUpperCase()).setTint(color)
      .setPosition(b.cx + (left ? 1 : -1) * (b.r + 46 * u), b.cy + 6 * u);
  }

  // ------------------------------------------------------------------ touch input

  private onDown(p: Phaser.Input.Pointer, over: Phaser.GameObjects.GameObject[]): void {
    app().sfx.unlock();
    if (over.length > 0 || this.session.paused) return;
    const m = this.match;
    const sim = m.sim;
    // Tap anywhere to continue from an info card.
    if (this.isCardFlow() && performance.now() > this.overlayReadyAt) {
      m.continue();
      return;
    }
    if (m.flow.kind !== "live" || !sim) return;
    // Throw buttons.
    if (sim.canThrow && !this.session.aim) {
      for (const b of this.recvButtons) {
        if (!b.receiverId || !b.label.visible) continue;
        if (Math.hypot(p.x - b.cx, p.y - b.cy) <= b.r * 1.3) {
          this.session.aim = { receiverId: b.receiverId, marker: b.marker, startedAt: performance.now(), lead: { x: 0, y: 0 } };
          this.aimPointer = { id: p.id, x: p.x, y: p.y };
          return;
        }
      }
    }
    // Carrier actions.
    if (this.actionLabels[0]?.visible) {
      if (Math.hypot(p.x - this.juke.cx, p.y - this.juke.cy) <= this.juke.r * 1.25) {
        m.queueCommand({ kind: "juke" });
        return;
      }
      if (Math.hypot(p.x - this.dive.cx, p.y - this.dive.cy) <= this.dive.r * 1.25) {
        m.queueCommand({ kind: "dive" });
        return;
      }
    }
    // Floating joystick on the movement half of the screen.
    const left = app().store.settings.leftHanded;
    const W = this.scale.width;
    const inZone = (left ? p.x > W * 0.55 : p.x < W * 0.45) && p.y > this.ui.safe.top + 34 * this.ui.u;
    if (inZone && !this.stick.active) {
      const st = this.stick;
      st.active = true;
      st.pointerId = p.id;
      st.baseX = p.x;
      st.baseY = p.y;
      st.knobX = p.x;
      st.knobY = p.y;
      this.session.move = { x: 0, y: 0 };
    }
  }

  private onMove(p: Phaser.Input.Pointer): void {
    const st = this.stick;
    if (st.active && p.id === st.pointerId) {
      let dx = p.x - st.baseX;
      let dy = p.y - st.baseY;
      const d = Math.hypot(dx, dy);
      if (d > st.R) {
        // Drag the base along so the stick never "runs out".
        const over = d - st.R;
        st.baseX += (dx / d) * over;
        st.baseY += (dy / d) * over;
        dx = p.x - st.baseX;
        dy = p.y - st.baseY;
      }
      st.knobX = p.x;
      st.knobY = p.y;
      const mag = Math.min(1, Math.hypot(dx, dy) / st.R);
      const dead = 0.12;
      if (mag < dead) this.session.move = { x: 0, y: 0 };
      else {
        const k = ((mag - dead) / (1 - dead)) / Math.max(1e-6, Math.hypot(dx, dy));
        this.session.move = { x: dx * k, y: dy * k };
      }
    }
    const a = this.aimPointer;
    if (a && p.id === a.id && this.session.aim) {
      const css = this.ui.u;
      const dx = (p.x - a.x) / css;
      const dy = (p.y - a.y) / css;
      const scale = 6 / AIM_DRAG_CSS;
      const lead = { x: dx * scale, y: dy * scale };
      const l = Math.hypot(lead.x, lead.y);
      this.session.aim.lead = l > 6 ? { x: (lead.x / l) * 6, y: (lead.y / l) * 6 } : lead;
    }
  }

  private onUp(p: Phaser.Input.Pointer): void {
    const st = this.stick;
    if (st.active && p.id === st.pointerId) {
      st.active = false;
      st.pointerId = -1;
      this.session.move = { x: 0, y: 0 };
    }
    const a = this.aimPointer;
    if (a && p.id === a.id) {
      this.aimPointer = null;
      this.releaseThrow();
    }
  }

  private releaseThrow(): void {
    const s = this.session;
    const aim = s.aim;
    s.aim = null;
    if (!aim) return;
    const sim = this.match.sim;
    if (!sim || !sim.canThrow) return;
    const held = (performance.now() - aim.startedAt) / 1000;
    this.match.queueCommand({ kind: "throw", targetId: aim.receiverId, passType: passTypeForHold(held), aim: aim.lead });
  }

  // ------------------------------------------------------------------ keyboard (desktop testing)

  private setupKeyboard(): void {
    const kb = this.input.keyboard;
    if (!kb) return;
    this.keys = kb.addKeys("W,A,S,D,UP,DOWN,LEFT,RIGHT,J,K,P,T,SPACE,ESC,ONE,TWO,THREE,FOUR", false) as Record<string, Phaser.Input.Keyboard.Key>;
    kb.on("keydown-SPACE", () => {
      const m = this.match;
      if (this.session.paused) return;
      if (m.flow.kind === "preSnap") m.snap();
      else if (this.isCardFlow()) m.continue();
    });
    kb.on("keydown-P", () => this.setPaused(!this.session.paused));
    kb.on("keydown-ESC", () => this.setPaused(!this.session.paused));
    kb.on("keydown-J", () => this.match.queueCommand({ kind: "juke" }));
    kb.on("keydown-K", () => this.match.queueCommand({ kind: "dive" }));
    kb.on("keydown-T", () => this.match.timeout());
    const names = ["ONE", "TWO", "THREE", "FOUR"];
    names.forEach((n, i) => {
      kb.on(`keydown-${n}`, () => {
        const sim = this.match.sim;
        if (!sim || !sim.canThrow || this.session.aim) return;
        const rec = sim.receivers.find((r) => r.marker === i);
        if (!rec) return;
        this.keyAim = i;
        this.session.aim = { receiverId: rec.id, marker: i, startedAt: performance.now(), lead: { x: 0, y: 0 } };
      });
      kb.on(`keyup-${n}`, () => {
        if (this.keyAim === i) {
          this.keyAim = null;
          this.releaseThrow();
        }
      });
    });
  }

  private keyboardMove(): { x: number; y: number } {
    const k = this.keys;
    if (!k.W) return { x: 0, y: 0 };
    const x = (k.D.isDown || k.RIGHT.isDown ? 1 : 0) - (k.A.isDown || k.LEFT.isDown ? 1 : 0);
    const y = (k.S.isDown || k.DOWN.isDown ? 1 : 0) - (k.W.isDown || k.UP.isDown ? 1 : 0);
    const l = Math.hypot(x, y);
    return l > 0 ? { x: x / l, y: y / l } : { x: 0, y: 0 };
  }

  // ------------------------------------------------------------------ overlays

  private isCardFlow(): boolean {
    const k = this.match.flow.kind;
    return k === "result" || k === "kickoff" || k === "cpuDrive" || k === "quarter";
  }

  private setPaused(p: boolean): void {
    if (this.match.flow.kind === "final") return;
    this.session.paused = p;
    this.showHelp = false;
    this.session.aim = null;
    this.aimPointer = null;
    this.stick.active = false;
    this.session.move = { x: 0, y: 0 };
    app().sfx.play("click");
  }

  private buildOverlay(): void {
    const s = this.session;
    const m = this.match;
    this.overlay.removeAll(true);
    this.preSnapButtons = [];
    this.builtFlow = m.flow;
    this.builtPaused = s.paused;
    this.builtHelp = this.showHelp;
    this.overlayReadyAt = performance.now() + 350;
    if (s.paused) return this.buildPause();
    const f = m.flow;
    switch (f.kind) {
      case "playCall": return this.buildPlayCall();
      case "preSnap": return this.buildPreSnap();
      case "result": return this.buildCard(f.title, f.detail, TONE_COLOR[f.tone]);
      case "kickoff": return this.buildCard(f.title, f.detail, COLORS.gold);
      case "quarter": return this.buildCard(f.title, f.detail, COLORS.gold);
      case "cpuDrive": {
        const d = f.drive;
        const title = d.points > 0 ? `${m.cpuTeam.name.toUpperCase()} SCORE` : `${m.cpuTeam.name.toUpperCase()} DRIVE`;
        const lines = [d.summary + ".", f.detail + ".", ...d.highlights.slice(-3).map((h) => "· " + h)];
        if (d.userYardLine !== null && d.end !== "endOfHalf") lines.push(`Your ball at ${describeYardLine(d.userYardLine)}.`);
        return this.buildCard(title, lines.join("\n"), d.points > 0 ? COLORS.bad : COLORS.good, `${m.userTeam.abbr} ${d.state.score.home} · ${m.cpuTeam.abbr} ${d.state.score.away}`);
      }
      case "pat": return this.buildPat();
      case "final": return this.buildFinal();
      default: return;
    }
  }

  private dim(alpha = 0.55): void {
    const g = this.add.graphics();
    g.fillStyle(COLORS.bg, alpha);
    g.fillRect(0, 0, this.scale.width, this.scale.height);
    this.overlay.add(g);
  }

  private buildCard(title: string, detail: string, color: number, footer?: string): void {
    const ui = this.ui;
    const u = ui.u;
    this.dim(0.45);
    const W = this.scale.width;
    const H = this.scale.height;
    const w = Math.min(W * 0.7, 520 * u);
    const body = ui.text(0, 0, ui.wrap(detail, w - 32 * u, "sm"), "sm", COLORS.ink);
    const h = Math.min(H * 0.86, 70 * u + body.height + (footer ? 26 * u : 0));
    const x = (W - w) / 2;
    const y = Math.max(ui.safe.top + 26 * u, (H - h) / 2);
    const g = this.add.graphics();
    ui.panel(g, x, y, w, h);
    this.overlay.add(g);
    this.overlay.add(ui.text(W / 2, y + 12 * u, title, "lg", color, 0.5, 0));
    body.setPosition(x + 16 * u, y + 40 * u);
    this.overlay.add(body);
    if (footer) this.overlay.add(ui.text(W / 2, y + h - 38 * u, footer, "sm", COLORS.gold, 0.5, 0));
    const tap = ui.text(W / 2, y + h - 12 * u, "TAP TO CONTINUE", "xs", COLORS.dim, 0.5, 0.5);
    this.overlay.add(tap);
    this.tweens.add({ targets: tap, alpha: 0.3, yoyo: true, repeat: -1, duration: 600 });
  }

  private buildPlayCall(): void {
    const ui = this.ui;
    const u = ui.u;
    const m = this.match;
    const W = this.scale.width;
    const H = this.scale.height;
    const safe = ui.safe;
    this.dim(0.5);
    const x = safe.left;
    const y = safe.top + 26 * u;
    const w = W - safe.left - safe.right;
    const h = H - y - safe.bottom + 4 * u;
    const g = this.add.graphics();
    ui.panel(g, x, y, w, h);
    this.overlay.add(g);
    const head = m.isTry ? "2-POINT TRY: ONE SNAP FROM THE 2" : `${m.downText} AT ${m.ballOnText}`;
    this.overlay.add(ui.text(x + 12 * u, y + 10 * u, "CALL A PLAY", "md", COLORS.gold));
    this.overlay.add(ui.text(x + 12 * u + ui.scaleFor("md") * 7 * 12, y + 10 * u, head, "md", COLORS.ink));

    const sideW = 118 * u;
    const gx = x + 10 * u;
    const gy = y + 30 * u;
    const gw = w - sideW - 30 * u;
    const gh = h - 40 * u;
    const cols = 3;
    const rows = Math.ceil(PLAYBOOK.length / cols);
    const gap = 6 * u;
    const cw = (gw - gap * (cols - 1)) / cols;
    const ch = (gh - gap * (rows - 1)) / rows;
    PLAYBOOK.forEach((play, i) => {
      const cx = gx + (i % cols) * (cw + gap);
      const cy = gy + Math.floor(i / cols) * (ch + gap);
      const btn = ui.button(cx, cy, cw, ch, "", () => m.selectPlay(play.id, this.flipNext), { size: "sm" });
      this.overlay.add(btn.container);
      const dg = this.add.graphics();
      const nameH = ui.scaleFor("sm") * 9 + 6 * u;
      dg.fillStyle(0x2f7234, 1);
      dg.fillRect(cx + 4 * u, cy + nameH, cw - 8 * u, ch - nameH - 4 * u);
      drawPlayDiagram(dg, play, this.flipNext, cx + 4 * u, cy + nameH, cw - 8 * u, ch - nameH - 4 * u, u);
      this.overlay.add(dg);
      this.overlay.add(ui.text(cx + 6 * u, cy + 5 * u, play.name, "sm", COLORS.ink));
    });

    // Side column: flip, special teams, timeout.
    const sx = x + w - sideW - 10 * u;
    let sy = gy;
    const bh = 38 * u;
    const add = (b: PixelButton) => {
      this.overlay.add(b.container);
      sy += bh + 6 * u;
    };
    add(ui.button(sx, sy, sideW, bh, this.flipNext ? "FLIP: ON" : "FLIP: OFF", () => {
      this.flipNext = !this.flipNext;
      this.builtFlow = null;
    }, { size: "sm", sub: "MIRROR PLAY" }));
    if (m.fourthDown) {
      add(ui.button(sx, sy, sideW, bh, "PUNT", () => m.punt(), { size: "md" }));
      const fg = m.fieldGoalInfo;
      if (fg.chance > 0) add(ui.button(sx, sy, sideW, bh, `FG ${fg.distance}`, () => m.fieldGoal(), { size: "md", sub: `${Math.round(fg.chance * 100)}% CHANCE` }));
    } else if (!m.isTry && (m.state.quarter === 2 || m.state.quarter === 4) && m.state.clock < 30 && m.fieldGoalInfo.chance > 0.2) {
      const fg = m.fieldGoalInfo;
      add(ui.button(sx, sy, sideW, bh, `FG ${fg.distance}`, () => m.fieldGoal(), { size: "md", sub: `${Math.round(fg.chance * 100)}% CHANCE` }));
    }
    if (m.canTimeout) {
      add(ui.button(sx, sy, sideW, bh, "TIMEOUT", () => { if (m.timeout()) this.session.showBanner("TIMEOUT", COLORS.gold); }, { size: "md", sub: `${m.state.timeouts.home} LEFT` }));
    }
    const tipY = Math.max(sy + 4 * u, y + h - 70 * u);
    this.overlay.add(ui.text(sx, tipY, ui.wrap("Read the shell after you pick. Change the play before the snap if you don't like it.", sideW, "xs"), "xs", COLORS.dim));
  }

  private buildPreSnap(): void {
    const ui = this.ui;
    const u = ui.u;
    const m = this.match;
    const W = this.scale.width;
    const H = this.scale.height;
    const safe = ui.safe;
    const left = app().store.settings.leftHanded;
    const play = m.play!;
    const label = `${play.name}${m.flipped ? " (FLIP)" : ""}`;
    const sh = m.sim ? m.sim.defense.filter((d) => (d.slot === "FS" || d.slot === "SS") && d.pos.x - m.sim!.cfg.losX >= 10).length : 1;
    const read = sh >= 2 ? "TWO DEEP" : sh === 1 ? "ONE DEEP" : "NO DEEP SAFETY: BLITZ?";
    this.overlay.add(ui.text(W / 2, safe.top + 30 * u, label, "md", COLORS.ink, 0.5, 0));
    this.overlay.add(ui.text(W / 2, safe.top + 30 * u + ui.scaleFor("md") * 10, `SAFETIES: ${read}`, "sm", sh === 0 ? COLORS.bad : COLORS.gold, 0.5, 0));

    const bw = 104 * u;
    const bh = 60 * u;
    const bx = left ? safe.left + 10 * u : W - safe.right - bw - 10 * u;
    const by = H - safe.bottom - bh - 4 * u;
    const snap = ui.button(bx, by, bw, bh, "SNAP", () => m.snap(), { size: "lg", fill: 0x2b5d3c, edge: COLORS.gold, onDown: true });
    const plays = ui.button(bx, by - 44 * u, bw, 38 * u, "PLAYS", () => m.changePlay(), { size: "sm", sub: "CHANGE CALL" });
    this.overlay.add([snap.container, plays.container]);
    this.preSnapButtons = [snap, plays];
    const to = ui.button(bx, by - 88 * u, bw, 38 * u, "TIMEOUT", () => { if (m.timeout()) this.session.showBanner("TIMEOUT", COLORS.gold); }, { size: "sm", sub: `${m.state.timeouts.home} LEFT` });
    this.overlay.add(to.container);
    this.preSnapButtons.push(to);
    to.setVisible(m.canTimeout);
    if (this.session.snaps < 3) {
      // First few snaps: a reminder next to the snap button, clear of the receivers.
      const tip = ui.wrap("After the snap: left thumb moves, receiver buttons throw. Tap = bullet, hold = touch/lob, drag = lead.", 150 * u, "xs");
      this.overlay.add(ui.text(left ? bx + bw + 10 * u : bx - 10 * u, by + bh, tip, "xs", COLORS.ink, left ? 0 : 1, 1));
    }
  }

  private updatePreSnapButtons(): void {
    const to = this.preSnapButtons[2];
    if (to && this.match.flow.kind === "preSnap") {
      to.setVisible(this.match.canTimeout);
      to.setSub(`${this.match.state.timeouts.home} LEFT`);
    }
  }

  private buildPat(): void {
    const ui = this.ui;
    const u = ui.u;
    const m = this.match;
    const W = this.scale.width;
    const H = this.scale.height;
    this.dim(0.5);
    const w = Math.min(W * 0.66, 460 * u);
    const h = 150 * u;
    const x = (W - w) / 2;
    const y = (H - h) / 2;
    const g = this.add.graphics();
    ui.panel(g, x, y, w, h);
    this.overlay.add(g);
    this.overlay.add(ui.text(W / 2, y + 14 * u, "TOUCHDOWN! NOW THE TRY", "md", COLORS.gold, 0.5, 0));
    const bw = (w - 48 * u) / 2;
    const kick = ui.button(x + 16 * u, y + 52 * u, bw, 70 * u, "KICK PAT", () => m.choosePat("kick"), { size: "md", sub: `${Math.round(m.extraPointChance * 100)}% · 1 PT` });
    const two = ui.button(x + 32 * u + bw, y + 52 * u, bw, 70 * u, "GO FOR 2", () => m.choosePat("two"), { size: "md", sub: "RUN A PLAY · 2 PTS" });
    this.overlay.add([kick.container, two.container]);
  }

  private buildFinal(): void {
    const ui = this.ui;
    const u = ui.u;
    const m = this.match;
    const f = m.flow as Extract<Flow, { kind: "final" }>;
    if (!this.session.recorded) {
      this.session.recorded = true;
      app().store.recordGame(m.state.score[m.user], m.state.score[m.cpu]);
    }
    const W = this.scale.width;
    const H = this.scale.height;
    this.dim(0.6);
    const w = Math.min(W * 0.8, 600 * u);
    const h = Math.min(H - ui.safe.top - ui.safe.bottom, 280 * u);
    const x = (W - w) / 2;
    const y = (H - h) / 2;
    const g = this.add.graphics();
    ui.panel(g, x, y, w, h);
    this.overlay.add(g);
    const won = m.state.score.home > m.state.score.away;
    this.overlay.add(ui.text(W / 2, y + 12 * u, f.title, "lg", won ? COLORS.gold : COLORS.ink, 0.5, 0));
    this.overlay.add(ui.text(W / 2, y + 40 * u, `${m.userTeam.abbr} ${m.state.score.home}  -  ${m.cpuTeam.abbr} ${m.state.score.away}`, "lg", COLORS.ink, 0.5, 0));
    const st = m.stats;
    const top = Object.values(st.receiving).sort((a, b) => b.yds - a.yds)[0];
    const lines = [
      `PASSING ${st.passComp}/${st.passAtt}, ${st.passYds} YDS, ${st.passTd} TD, ${st.ints} INT`,
      `SACKED ${st.sacks} · SCRAMBLE YDS ${st.rushYds} · LONG ${st.longest}`,
      `FIRST DOWNS ${st.firstDowns} · 3RD DOWN ${st.thirdConv}/${st.thirdAtt}`,
      top ? `TOP TARGET #${top.number} ${top.name}: ${top.rec} REC, ${top.yds} YDS` : "",
      `RECORD ${app().store.records.wins}-${app().store.records.losses}-${app().store.records.ties}`,
    ].filter(Boolean);
    this.overlay.add(ui.text(x + 18 * u, y + 76 * u, lines.join("\n"), "sm", COLORS.ink));
    const bw = (w - 48 * u) / 2;
    const again = ui.button(x + 16 * u, y + h - 52 * u, bw, 40 * u, "PLAY AGAIN", () => this.restart(), { size: "md", fill: 0x2b5d3c, edge: COLORS.gold });
    const menu = ui.button(x + 32 * u + bw, y + h - 52 * u, bw, 40 * u, "MAIN MENU", () => this.quit(), { size: "md" });
    this.overlay.add([again.container, menu.container]);
  }

  private buildPause(): void {
    const ui = this.ui;
    const u = ui.u;
    const W = this.scale.width;
    const H = this.scale.height;
    this.dim(0.7);
    if (this.showHelp) {
      const safe = ui.safe;
      const c = buildControlsHelp(ui, safe.left, safe.top, W - safe.left - safe.right, H - safe.top - safe.bottom);
      this.overlay.add(c);
      this.overlay.add(ui.button(W - safe.right - 126 * u, H - safe.bottom - 42 * u, 116 * u, 32 * u, "BACK", () => { this.showHelp = false; }, { size: "md" }).container);
      return;
    }
    const w = Math.min(W * 0.6, 360 * u);
    const bh = 36 * u;
    const items: [string, () => void, string?][] = [
      ["RESUME", () => this.setPaused(false)],
      [`SOUND: ${app().store.settings.sound ? "ON" : "OFF"}`, () => { app().store.update({ sound: !app().store.settings.sound }); this.builtFlow = null; }],
      [`VOLUME: ${Math.round(app().store.settings.volume * 10)}/10`, () => { const v = app().store.settings.volume; app().store.update({ volume: v >= 0.95 ? 0.1 : Math.round((v + 0.1) * 10) / 10 }); this.builtFlow = null; }],
      ["HOW TO PLAY", () => { this.showHelp = true; }],
      ["RESTART GAME", () => this.restart()],
      ["QUIT TO MENU", () => this.quit()],
    ];
    const h = 58 * u + items.length * (bh + 6 * u);
    const x = (W - w) / 2;
    const y = Math.max(ui.safe.top, (H - h) / 2);
    const g = this.add.graphics();
    ui.panel(g, x, y, w, h);
    this.overlay.add(g);
    this.overlay.add(ui.text(W / 2, y + 12 * u, "PAUSED", "lg", COLORS.gold, 0.5, 0));
    const m = this.match;
    if (m.sim && m.lastOutcome && m.flow.kind !== "live") {
      this.overlay.add(ui.text(W / 2, y + 38 * u, `LAST DEFENSE: ${DEFENSE_CALLS[m.sim.call.id].name}`, "xs", COLORS.dim, 0.5, 0));
    }
    items.forEach(([label, fn], i) => {
      this.overlay.add(ui.button(x + 14 * u, y + 52 * u + i * (bh + 6 * u), w - 28 * u, bh, label, fn, { size: "md" }).container);
    });
  }

  private restart(): void {
    this.session.paused = false;
    const game = this.scene.get("game");
    this.scene.stop();
    game.scene.restart();
  }

  private quit(): void {
    this.scene.stop("game");
    this.scene.start("title");
  }
}
