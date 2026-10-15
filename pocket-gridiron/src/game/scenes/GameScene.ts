import Phaser from "phaser";
import { FIELD_WIDTH } from "../../core/field";
import { clamp, len2 } from "../../core/math/vec";
import type { MatchEvent } from "../../core/match";
import { leadTarget } from "../../core/sim/passing";
import type { PlaySim } from "../../core/sim/playSim";
import type { SimEvent, SimPlayer } from "../../core/sim/types";
import { app } from "../app";
import { makeFieldTexture } from "../art/fieldTexture";
import { FRAME_INDEX, MARKER_COLORS, teamSheetKey } from "../art/sprites";
import { CAMERA_SPAN, COLORS, PPY, toWorldX, toWorldY, WORLD_H, WORLD_W } from "../config";
import { passTypeForHold, Session } from "../session";

interface PlayerView {
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Image;
  marker: Phaser.GameObjects.Image | null;
  anim: number;
  skin: number;
}

/**
 * The field: renders the match's current play (players, ball, lines, routes, aim) and steps the
 * simulation. All football logic lives in core/; this scene only draws it and forwards input.
 */
export class GameScene extends Phaser.Scene {
  session!: Session;
  private views = new Map<string, PlayerView>();
  private viewSim: PlaySim | null = null;
  private lines!: Phaser.GameObjects.Graphics;
  private routes!: Phaser.GameObjects.Graphics;
  private aimG!: Phaser.GameObjects.Graphics;
  private ring!: Phaser.GameObjects.Image;
  private ball!: Phaser.GameObjects.Image;
  private ballShadow!: Phaser.GameObjects.Image;
  private camX = 0;
  private camY = 0;

  constructor() {
    super("game");
  }

  create(): void {
    const settings = app().store.settings;
    this.session = new Session(settings);
    const m = this.session.match;
    this.views.clear();
    this.viewSim = null;
    const key = makeFieldTexture(this, m.userTeam, m.cpuTeam);
    this.add.image(0, 0, key).setOrigin(0, 0).setDepth(0);
    this.lines = this.add.graphics().setDepth(1);
    this.routes = this.add.graphics().setDepth(2);
    this.aimG = this.add.graphics().setDepth(5000);
    this.ring = this.add.image(0, 0, "ring").setDepth(3).setTint(COLORS.gold).setVisible(false);
    this.ballShadow = this.add.image(0, 0, "shadow").setDepth(4).setVisible(false);
    this.ball = this.add.image(0, 0, "ball").setDepth(6000).setVisible(false);
    this.makeMarkerTextures();
    const cam = this.cameras.main;
    cam.setBounds(0, 0, WORLD_W, WORLD_H);
    cam.setBackgroundColor(COLORS.bg);
    this.applyZoom();
    this.camX = toWorldX(m.losX);
    this.camY = toWorldY(FIELD_WIDTH / 2);
    cam.centerOn(this.camX, this.camY);

    const onLayout = () => this.applyZoom();
    const onHidden = () => {
      this.session.paused = true;
    };
    const offSettings = app().store.onChange(() => this.applyZoom());
    this.game.events.on("pg-layout", onLayout);
    this.game.events.on("pg-hidden", onHidden);
    this.events.once("shutdown", () => {
      this.game.events.off("pg-layout", onLayout);
      this.game.events.off("pg-hidden", onHidden);
      offSettings();
      app().sfx.stopCrowd();
    });
    app().sfx.startCrowd();
    this.scene.launch("hud", { session: this.session });
    // Expose for automated tests.
    (window as unknown as { __PG_SESSION__: Session }).__PG_SESSION__ = this.session;
  }

  private applyZoom(): void {
    const span = CAMERA_SPAN[app().store.settings.camera];
    // Fractional zoom: at full device resolution the uneven pixel widths are invisible, and the
    // whole formation fits on every screen.
    const z = Math.max(1, this.scale.height / span);
    const cam = this.cameras.main;
    cam.setSize(this.scale.width, this.scale.height);
    cam.setZoom(z);
  }

  /** Receiver icons drawn as small textures (▲ ● ■ ◆). */
  private makeMarkerTextures(): void {
    for (let i = 0; i < 4; i++) {
      const key = `marker-${i}`;
      if (this.textures.exists(key)) continue;
      const g = this.make.graphics({}, false);
      const draw = (color: number, r: number) => {
        g.fillStyle(color, 1);
        const c = 5;
        if (i === 0) g.fillTriangle(c, c - r, c - r, c + r * 0.8, c + r, c + r * 0.8);
        else if (i === 1) g.fillCircle(c, c, r);
        else if (i === 2) g.fillRect(c - r * 0.8, c - r * 0.8, r * 1.6, r * 1.6);
        else g.fillPoints([{ x: c, y: c - r }, { x: c + r, y: c }, { x: c, y: c + r }, { x: c - r, y: c }], true);
      };
      draw(0x0a0e0c, 5);
      draw(MARKER_COLORS[i], 3.6);
      g.generateTexture(key, 11, 11);
      g.destroy();
    }
  }

  override update(_time: number, deltaMs: number): void {
    const s = this.session;
    const m = s.match;
    const dt = Math.min(0.1, deltaMs / 1000);
    const frozen = s.paused || app().portrait || app().backgrounded;
    if (!frozen) m.update(dt, s.move);

    if (m.sim !== this.viewSim) this.rebuildViews(m.sim);
    if (m.sim) this.handleSimEvents(m.sim.drainEvents());
    this.handleMatchEvents(m.drainEvents());
    this.syncPlayers(dt, frozen);
    this.drawLines();
    this.drawRoutes();
    this.drawAim();
    this.updateCamera(dt);
  }

  // ------------------------------------------------------------------ players

  private rebuildViews(sim: PlaySim | null): void {
    for (const v of this.views.values()) {
      v.sprite.destroy();
      v.shadow.destroy();
      v.marker?.destroy();
    }
    this.views.clear();
    this.viewSim = sim;
    if (!sim) return;
    const m = this.session.match;
    for (const p of sim.players) {
      const team = p.side === "offense" ? m.userTeam : m.cpuTeam;
      const skin = hash(p.profile.id) % 3;
      const sprite = this.add.sprite(0, 0, teamSheetKey(team.id, skin), 0).setOrigin(0.5, 0.92);
      const shadow = this.add.image(0, 0, "shadow").setDepth(3);
      const marker = p.eligible && p.marker >= 0 ? this.add.image(0, 0, `marker-${p.marker}`).setDepth(5500) : null;
      this.views.set(p.id, { sprite, shadow, marker, anim: 0, skin });
    }
  }

  private syncPlayers(dt: number, frozen: boolean): void {
    const sim = this.viewSim;
    const ring = this.ring;
    if (!sim) {
      ring.setVisible(false);
      this.ball.setVisible(false);
      this.ballShadow.setVisible(false);
      return;
    }
    const showMarkers = sim.phase === "preSnap" || (sim.phase === "live" && sim.ball.carrierId === sim.qb.id && !sim.passThrown) || sim.phase === "passInAir";
    for (const p of sim.players) {
      const v = this.views.get(p.id);
      if (!v) continue;
      const wx = toWorldX(p.pos.x);
      const wy = toWorldY(p.pos.y);
      v.sprite.setPosition(Math.round(wx), Math.round(wy));
      v.sprite.setDepth(100 + wy);
      v.shadow.setPosition(Math.round(wx), Math.round(wy) - 1);
      const speed = len2(p.vel);
      if (!frozen) v.anim += dt * (2 + speed * 1.4);
      v.sprite.setFrame(this.frameFor(sim, p, v, speed));
      if (v.marker) {
        v.marker.setVisible(showMarkers && !p.down);
        v.marker.setPosition(Math.round(wx), Math.round(wy) - 21);
      }
    }
    const ctl = sim.controlled;
    if (ctl && sim.phase !== "deadBall" && sim.phase !== "result") {
      ring.setVisible(true).setPosition(Math.round(toWorldX(ctl.pos.x)), Math.round(toWorldY(ctl.pos.y)));
    } else {
      ring.setVisible(false);
    }
    this.syncBall(sim);
  }

  private frameFor(sim: PlaySim, p: SimPlayer, v: PlayerView, speed: number): number {
    if (p.down) return FRAME_INDEX.down;
    if (p.id === sim.qb.id && (p.mode === "throwing" || (sim.ball.throwInfo && sim.time - sim.ball.throwInfo.releaseTime < 0.25))) {
      v.sprite.setFlipX(false);
      return FRAME_INDEX.throw;
    }
    const f = speed > 0.8 ? p.vel : p.facing;
    const fx = f.x;
    const fy = f.y;
    const step = speed > 0.8 ? Math.floor(v.anim) % 4 : 0;
    if (Math.abs(fx) >= Math.abs(fy) * 0.8) {
      v.sprite.setFlipX(fx < 0);
      return FRAME_INDEX.side + step;
    }
    v.sprite.setFlipX(false);
    return (fy > 0 ? FRAME_INDEX.front : FRAME_INDEX.back) + step;
  }

  private syncBall(sim: PlaySim): void {
    const b = sim.ball;
    const wx = Math.round(toWorldX(b.pos.x));
    const wy = Math.round(toWorldY(b.pos.y));
    if (sim.phase === "preSnap") {
      this.ball.setVisible(true).setPosition(toWorldX(sim.cfg.losX), toWorldY(sim.cfg.ballY) - 2).setScale(1).setDepth(50 + toWorldY(sim.cfg.ballY));
      this.ballShadow.setVisible(false);
      return;
    }
    if (b.state === "air" || (b.state === "dead" && b.pos.z > 0.05)) {
      const lift = Math.round(b.pos.z * PPY * 0.9);
      this.ball.setVisible(true).setPosition(wx, wy - lift).setScale(1 + b.pos.z * 0.05).setDepth(6000);
      this.ballShadow.setVisible(true).setPosition(wx, wy).setScale(Math.max(0.4, 1 - b.pos.z * 0.05));
      return;
    }
    this.ballShadow.setVisible(false);
    const c = sim.carrier;
    if (c) {
      this.ball.setVisible(true).setScale(1).setPosition(Math.round(toWorldX(c.pos.x) + c.facing.x * 3), Math.round(toWorldY(c.pos.y)) - 8).setDepth(101 + toWorldY(c.pos.y));
    } else if (b.state === "dead") {
      this.ball.setVisible(true).setScale(1).setPosition(wx, wy).setDepth(99 + wy);
    } else {
      this.ball.setVisible(false);
    }
  }

  // ------------------------------------------------------------------ lines, routes, aim

  private drawLines(): void {
    const g = this.lines;
    g.clear();
    const m = this.session.match;
    const flow = m.flow.kind;
    if (flow === "final" || flow === "cpuDrive") return;
    const top = toWorldY(0);
    const bot = toWorldY(FIELD_WIDTH);
    const los = toWorldX(m.sim ? m.sim.cfg.losX : m.losX);
    g.fillStyle(COLORS.los, 0.75);
    g.fillRect(Math.round(los) - 1, top, 2, bot - top);
    const fd = m.firstDownX;
    if (fd !== null) {
      g.fillStyle(COLORS.firstDown, 0.85);
      g.fillRect(Math.round(toWorldX(fd)) - 1, top, 2, bot - top);
    }
  }

  private drawRoutes(): void {
    const g = this.routes;
    g.clear();
    const sim = this.viewSim;
    if (!sim) return;
    const pre = sim.phase === "preSnap";
    const during = app().store.settings.routesDuringPlay && (sim.phase === "live" || sim.phase === "passInAir") && !sim.passThrown;
    if (!pre && !during) return;
    for (const r of sim.receivers) {
      if (!r.route) continue;
      const color = MARKER_COLORS[r.marker];
      const alpha = pre ? 0.9 : 0.35;
      const start = r.pos;
      g.lineStyle(2, 0x0a0e0c, alpha * 0.6);
      this.polyline(g, [start, ...r.route.points], 1);
      g.lineStyle(1, color, alpha);
      this.polyline(g, [start, ...r.route.points], 0);
      const end = r.route.points[r.route.points.length - 1];
      const prev = r.route.points.length > 1 ? r.route.points[r.route.points.length - 2] : start;
      const ex = toWorldX(end.x);
      const ey = toWorldY(end.y);
      const ang = Math.atan2(toWorldY(end.y) - toWorldY(prev.y), toWorldX(end.x) - toWorldX(prev.x));
      g.fillStyle(color, alpha);
      if (r.route.def.end === "continue") {
        g.fillTriangle(ex + Math.cos(ang) * 4, ey + Math.sin(ang) * 4, ex + Math.cos(ang + 2.5) * 4, ey + Math.sin(ang + 2.5) * 4, ex + Math.cos(ang - 2.5) * 4, ey + Math.sin(ang - 2.5) * 4);
      } else {
        g.fillRect(ex - 2, ey - 2, 4, 4);
      }
    }
  }

  private polyline(g: Phaser.GameObjects.Graphics, pts: { x: number; y: number }[], offset: number): void {
    g.beginPath();
    g.moveTo(toWorldX(pts[0].x) + offset, toWorldY(pts[0].y) + offset);
    for (const p of pts.slice(1)) g.lineTo(toWorldX(p.x) + offset, toWorldY(p.y) + offset);
    g.strokePath();
  }

  /** While a receiver button is held: show where the ball is going. */
  private drawAim(): void {
    const g = this.aimG;
    g.clear();
    const s = this.session;
    const sim = this.viewSim;
    if (!s.aim || !sim || !sim.canThrow) return;
    const r = sim.get(s.aim.receiverId);
    if (!r) return;
    const held = (performance.now() - s.aim.startedAt) / 1000;
    const type = passTypeForHold(held);
    const lead = leadTarget(sim.qb.pos, sim.qb.r, r, type);
    const tx = toWorldX(clamp(lead.point.x + s.aim.lead.x, 0, 120));
    const ty = toWorldY(clamp(lead.point.y + s.aim.lead.y, -1, FIELD_WIDTH + 1));
    const color = MARKER_COLORS[s.aim.marker];
    // Dotted path from QB.
    const qx = toWorldX(sim.qb.pos.x);
    const qy = toWorldY(sim.qb.pos.y);
    const n = Math.max(4, Math.round(Math.hypot(tx - qx, ty - qy) / 6));
    const arc = type === "lob" ? 26 : type === "touch" ? 14 : 4;
    g.fillStyle(color, 0.8);
    for (let i = 1; i < n; i++) {
      const f = i / n;
      g.fillRect(Math.round(qx + (tx - qx) * f) - 1, Math.round(qy + (ty - qy) * f - Math.sin(f * Math.PI) * arc) - 1, 2, 2);
    }
    g.lineStyle(1, color, 1);
    g.strokeCircle(tx, ty, 5);
    g.lineBetween(tx - 8, ty, tx - 3, ty);
    g.lineBetween(tx + 3, ty, tx + 8, ty);
    g.lineBetween(tx, ty - 8, tx, ty - 3);
    g.lineBetween(tx, ty + 3, tx, ty + 8);
  }

  // ------------------------------------------------------------------ camera

  private updateCamera(dt: number): void {
    const m = this.session.match;
    const sim = this.viewSim;
    const cam = this.cameras.main;
    const viewW = cam.width / cam.zoom;
    let tx = toWorldX(m.losX + 12);
    let ty = toWorldY(m.state.ballY);
    if (sim) {
      const lookAhead = viewW * 0.18;
      if (sim.phase === "preSnap") {
        // Frame the whole formation.
        const ys = sim.offense.map((p) => p.pos.y);
        tx = toWorldX(sim.cfg.losX) + viewW * 0.18;
        ty = toWorldY((Math.min(...ys) + Math.max(...ys)) / 2);
      } else if (sim.ball.state === "air" || (sim.ball.state === "dead" && !sim.carrier)) {
        const t = sim.ball.throwInfo;
        const bx = toWorldX(sim.ball.pos.x);
        const by = toWorldY(sim.ball.pos.y);
        tx = t ? (bx * 0.6 + toWorldX(t.catchPoint.x) * 0.4) : bx;
        ty = t ? (by * 0.6 + toWorldY(t.catchPoint.y) * 0.4) : by;
      } else {
        const c = sim.carrier ?? sim.qb;
        const dir = c.side === "offense" ? 1 : -1;
        const qbPocket = c.id === sim.qb.id && !sim.qbCrossedLos;
        tx = toWorldX(c.pos.x) + (qbPocket ? lookAhead * 1.2 : lookAhead * dir) + c.vel.x * PPY * 0.25;
        ty = qbPocket ? toWorldY(c.pos.y * 0.5 + sim.cfg.ballY * 0.5) : toWorldY(c.pos.y) + c.vel.y * PPY * 0.2;
      }
    }
    const k = 1 - Math.exp(-dt * 5);
    this.camX += (tx - this.camX) * k;
    this.camY += (ty - this.camY) * k;
    cam.centerOn(Math.round(this.camX), Math.round(this.camY));
  }

  // ------------------------------------------------------------------ events → sound & effects

  private handleSimEvents(events: SimEvent[]): void {
    const sfx = app().sfx;
    const s = this.session;
    for (const e of events) {
      switch (e.kind) {
        case "snap": sfx.play("hut"); s.snaps++; break;
        case "throw": sfx.play("throw"); break;
        case "catch": sfx.play("catch"); if (!e.contested) sfx.play("crowdCheer"); break;
        case "drop": sfx.play("incomplete"); s.showBanner("DROPPED!", COLORS.bad); break;
        case "deflect": sfx.play("hit"); break;
        case "interception": sfx.play("interception"); s.showBanner("INTERCEPTED!", COLORS.bad); this.cameras.main.shake(180, 0.004); break;
        case "incomplete": sfx.play("incomplete"); s.showBanner("INCOMPLETE", COLORS.ink); break;
        case "tackle": {
          sfx.play("hit");
          const sim = this.viewSim;
          const c = sim?.get(e.carrierId);
          if (c) this.dust(c.pos.x, c.pos.y);
          if (e.sack) { s.showBanner("SACKED!", COLORS.bad); this.cameras.main.shake(160, 0.005); }
          break;
        }
        case "missedTackle": sfx.play("juke"); break;
        case "juke": sfx.play("juke"); break;
        case "touchdown": sfx.play("touchdown"); s.showBanner(e.side === "offense" ? "TOUCHDOWN!" : "PICK SIX!", e.side === "offense" ? COLORS.gold : COLORS.bad); break;
        case "safety": s.showBanner("SAFETY!", COLORS.bad); break;
        case "outOfBounds": break;
        case "whistle": {
          sfx.play("whistle");
          // Call the first down at the whistle (the result card follows).
          const sim = this.viewSim;
          const o = sim?.outcome;
          const m = this.session.match;
          if (sim && o && !m.isTry && (o.kind === "tackle" || o.kind === "outOfBounds") && o.spotX >= sim.cfg.firstDownX) {
            sfx.play("firstDown");
            s.showBanner("FIRST DOWN!", COLORS.firstDown);
          }
          break;
        }
        default: break;
      }
    }
  }

  private handleMatchEvents(events: MatchEvent[]): void {
    const sfx = app().sfx;
    for (const e of events) {
      if (e.kind === "turnoverOnDowns") sfx.play("groan");
      else if (e.kind === "fieldGoal" || e.kind === "extraPoint") { sfx.play("kick"); if (e.good) sfx.play("crowdCheer"); }
      else if (e.kind === "cpuScore") sfx.play("groan");
      else if (e.kind === "final" || e.kind === "halftime" || e.kind === "endQuarter") sfx.play("whistle");
    }
  }

  private dust(x: number, y: number): void {
    const wx = toWorldX(x);
    const wy = toWorldY(y);
    for (let i = 0; i < 6; i++) {
      const d = this.add.image(wx, wy, "dust").setDepth(5000);
      const a = (i / 6) * Math.PI * 2;
      this.tweens.add({ targets: d, x: wx + Math.cos(a) * 9, y: wy + Math.sin(a) * 5 - 3, alpha: 0, duration: 420, onComplete: () => d.destroy() });
    }
  }
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
