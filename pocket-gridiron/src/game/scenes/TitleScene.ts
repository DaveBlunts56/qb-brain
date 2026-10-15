import Phaser from "phaser";
import { TEAMS } from "../../core/data/teams";
import type { Difficulty } from "../../core/match";
import { isInstalled } from "../../platform/pwa";
import { app } from "../app";
import { makeFieldTexture } from "../art/fieldTexture";
import { COLORS, WORLD_H, WORLD_W } from "../config";
import { buildControlsHelp } from "../ui/controlsHelp";
import { UI } from "../ui/kit";

type Panel = "menu" | "matchup" | "settings" | "controls";

const DIFF_NAMES: Record<Difficulty, string> = { rookie: "ROOKIE", pro: "PRO", allpro: "ALL-PRO" };

/** Title screen: Play, Controls, Settings. Rebuilds itself on resize. */
export class TitleScene extends Phaser.Scene {
  private ui!: UI;
  private layer!: Phaser.GameObjects.Container;
  private panel: Panel = "menu";
  private bg!: Phaser.GameObjects.Image;
  private uiCam!: Phaser.Cameras.Scene2D.Camera;
  private t = 0;

  constructor() {
    super("title");
  }

  create(data?: { panel?: Panel }): void {
    this.ui = new UI(this);
    this.panel = data?.panel ?? "menu";
    const s = app().store.settings;
    const key = makeFieldTexture(this, TEAMS.find((t) => t.id === s.userTeam) ?? TEAMS[0], TEAMS.find((t) => t.id === s.cpuTeam) ?? TEAMS[1]);
    this.bg = this.add.image(0, 0, key).setOrigin(0, 0);
    this.cameras.main.setBackgroundColor(COLORS.bg);
    this.layer = this.add.container(0, 0);
    // Two cameras: a zoomed one slowly panning the stadium, and a fixed one for the menu.
    this.uiCam = this.cameras.add(0, 0, this.scale.width, this.scale.height);
    this.uiCam.ignore(this.bg);
    this.cameras.main.ignore(this.layer);
    this.build();
    const relayout = () => {
      this.cameras.main.setSize(this.scale.width, this.scale.height);
      this.uiCam.setSize(this.scale.width, this.scale.height);
      this.build();
    };
    this.game.events.on("pg-layout", relayout);
    this.events.once("shutdown", () => this.game.events.off("pg-layout", relayout));
    this.input.keyboard?.on("keydown-SPACE", () => this.panel === "menu" && this.show("matchup"));
  }

  override update(_t: number, dms: number): void {
    // Slow pan across the stadium behind the menu.
    this.t += dms / 1000;
    const cam = this.cameras.main;
    const z = Math.max(1, Math.round(this.scale.height / 300));
    cam.setZoom(z);
    const viewW = this.scale.width / z;
    const x = (Math.sin(this.t * 0.05) * 0.5 + 0.5) * Math.max(0, WORLD_W - viewW);
    cam.centerOn(x + viewW / 2, WORLD_H / 2);
  }

  private show(p: Panel): void {
    this.panel = p;
    this.build();
  }

  private build(): void {
    this.layer.removeAll(true);
    const ui = this.ui;
    const u = ui.u;
    const W = this.scale.width;
    const H = this.scale.height;
    const safe = ui.safe;
    const dim = this.add.graphics();
    dim.fillStyle(COLORS.bg, 0.72);
    dim.fillRect(0, 0, W, H);
    this.layer.add(dim);
    const add = (o: Phaser.GameObjects.GameObject | Phaser.GameObjects.GameObject[]) => this.layer.add(o);

    if (this.panel === "menu") this.buildMenu(add, W, H, safe, u);
    else if (this.panel === "matchup") this.buildMatchup(add, W, H, safe, u);
    else if (this.panel === "settings") this.buildSettings(add, W, H, safe, u);
    else this.buildControls(add, W, H, safe, u);
  }

  private buildMenu(add: (o: Phaser.GameObjects.GameObject | Phaser.GameObjects.GameObject[]) => void, W: number, H: number, safe: UI["safe"], u: number): void {
    const ui = this.ui;
    const left = safe.left + 24 * u;
    const topY = Math.max(safe.top + 10 * u, H * 0.12);
    add(ui.text(left, topY, "POCKET", "lg", COLORS.ink));
    const title = ui.text(left, topY + ui.scaleFor("lg") * 10, "GRIDIRON", "xl", COLORS.gold);
    title.setTint(0xffe08a, 0xffe08a, 0xf2a03d, 0xf2a03d);
    add(title);
    const tagY = title.y + title.height + 6 * u;
    add(ui.text(left, tagY, "RETRO FOOTBALL - READ IT - RIP IT", "sm", COLORS.dim));

    const r = app().store.records;
    add(ui.text(left, H - safe.bottom - 14 * u, `RECORD ${r.wins}-${r.losses}-${r.ties}   V${app().version}`, "xs", COLORS.dim, 0, 1));
    if (!isInstalled()) {
      add(ui.text(left, H - safe.bottom - 28 * u, "TIP: SAFARI SHARE > ADD TO HOME SCREEN FOR FULL SCREEN", "xs", COLORS.dim, 0, 1));
    }

    const bw = Math.min(220 * u, W * 0.36);
    const bh = 46 * u;
    const bx = W - safe.right - 24 * u - bw;
    let by = Math.max(safe.top + 20 * u, H / 2 - bh * 1.8);
    const play = ui.button(bx, by, bw, bh, "PLAY", () => this.show("matchup"), { size: "lg", fill: 0x2b5d3c, edge: COLORS.gold });
    by += bh + 12 * u;
    const controls = ui.button(bx, by, bw, bh, "CONTROLS", () => this.show("controls"), { size: "md" });
    by += bh + 12 * u;
    const settings = ui.button(bx, by, bw, bh, "SETTINGS", () => this.show("settings"), { size: "md" });
    add([play.container, controls.container, settings.container]);
  }

  private buildMatchup(add: (o: Phaser.GameObjects.GameObject | Phaser.GameObjects.GameObject[]) => void, W: number, H: number, safe: UI["safe"], u: number): void {
    const ui = this.ui;
    const store = app().store;
    const s = store.settings;
    const g = this.add.graphics();
    add(g);
    const x = safe.left + 12 * u;
    const y = safe.top + 4 * u;
    const w = W - safe.left - safe.right - 24 * u;
    const h = H - safe.top - safe.bottom - 8 * u;
    ui.panel(g, x, y, w, h);
    add(ui.text(x + w / 2, y + 12 * u, "GAME SETUP", "lg", COLORS.gold, 0.5, 0));

    const colW = (w - 36 * u) / 2;
    const teamCard = (cx: number, label: string, teamId: string, other: string, setKey: "userTeam" | "cpuTeam") => {
      const team = TEAMS.find((t) => t.id === teamId) ?? TEAMS[0];
      const cy = y + 42 * u;
      const ch = Math.min(118 * u, h * 0.42);
      ui.panel(g, cx, cy, colW, ch, team.colors.primary, team.colors.secondary, 1);
      add(ui.text(cx + colW / 2, cy + 8 * u, label, "xs", COLORS.ink, 0.5, 0));
      add(ui.text(cx + colW / 2, cy + 22 * u, team.city, "sm", team.colors.secondary, 0.5, 0));
      add(ui.text(cx + colW / 2, cy + 36 * u, team.name, "lg", COLORS.ink, 0.5, 0));
      add(ui.text(cx + colW / 2, cy + ch - 24 * u, `OFF ${team.offenseRating}  DEF ${team.defenseRating}`, "sm", COLORS.ink, 0.5, 0));
      const cycle = (dir: number) => {
        const ids = TEAMS.map((t) => t.id).filter((id) => id !== other);
        const i = ids.indexOf(teamId);
        store.update({ [setKey]: ids[(i + dir + ids.length) % ids.length] } as Partial<typeof s>);
        this.build();
      };
      const bs = 34 * u;
      add(ui.button(cx + 6 * u, cy + ch / 2 - bs / 2 + 6 * u, bs, bs, "<", () => cycle(-1)).container);
      add(ui.button(cx + colW - 6 * u - bs, cy + ch / 2 - bs / 2 + 6 * u, bs, bs, ">", () => cycle(1)).container);
      return cy + ch;
    };
    const bottomOfCards = teamCard(x + 12 * u, "YOU (OFFENSE)", s.userTeam, s.cpuTeam, "userTeam");
    teamCard(x + 24 * u + colW, "CPU", s.cpuTeam, s.userTeam, "cpuTeam");

    // Options row.
    const oy = bottomOfCards + 10 * u;
    const ow = (w - 48 * u) / 3;
    const oh = 40 * u;
    const diffs: Difficulty[] = ["rookie", "pro", "allpro"];
    const diff = ui.button(x + 12 * u, oy, ow, oh, DIFF_NAMES[s.difficulty], () => {
      store.update({ difficulty: diffs[(diffs.indexOf(s.difficulty) + 1) % 3] });
      this.build();
    }, { size: "md", sub: "DIFFICULTY" });
    const qs = [2, 3, 5] as const;
    const quarter = ui.button(x + 24 * u + ow, oy, ow, oh, `${s.quarterMinutes} MIN`, () => {
      store.update({ quarterMinutes: qs[(qs.indexOf(s.quarterMinutes) + 1) % 3] });
      this.build();
    }, { size: "md", sub: "QUARTERS" });
    const back = ui.button(x + 36 * u + ow * 2, oy, ow, oh, "BACK", () => this.show("menu"), { size: "md" });
    add([diff.container, quarter.container, back.container]);

    const ky = oy + oh + 10 * u;
    const kh = Math.min(48 * u, y + h - ky - 10 * u);
    const kick = ui.button(x + 12 * u, ky, w - 24 * u, kh, "KICKOFF", () => this.startGame(), { size: "lg", fill: 0x2b5d3c, edge: COLORS.gold });
    add(kick.container);
  }

  private buildSettings(add: (o: Phaser.GameObjects.GameObject | Phaser.GameObjects.GameObject[]) => void, W: number, H: number, safe: UI["safe"], u: number): void {
    const ui = this.ui;
    const store = app().store;
    const s = store.settings;
    const g = this.add.graphics();
    add(g);
    const w = Math.min(W - safe.left - safe.right - 24 * u, 560 * u);
    const x = (W - w) / 2;
    const y = safe.top + 4 * u;
    const h = H - safe.top - safe.bottom - 8 * u;
    ui.panel(g, x, y, w, h);
    add(ui.text(x + w / 2, y + 12 * u, "SETTINGS", "lg", COLORS.gold, 0.5, 0));
    const rows: [string, string, () => void][] = [
      ["SOUND", s.sound ? "ON" : "OFF", () => store.update({ sound: !s.sound })],
      ["VOLUME", `${Math.round(s.volume * 10)}/10`, () => store.update({ volume: s.volume >= 0.95 ? 0.1 : Math.round((s.volume + 0.1) * 10) / 10 })],
      ["CAMERA", s.camera.toUpperCase(), () => store.update({ camera: s.camera === "near" ? "normal" : s.camera === "normal" ? "far" : "near" })],
      ["CONTROLS", s.leftHanded ? "LEFT-HANDED" : "RIGHT-HANDED", () => store.update({ leftHanded: !s.leftHanded })],
      ["ROUTES AFTER SNAP", s.routesDuringPlay ? "SHOW" : "HIDE", () => store.update({ routesDuringPlay: !s.routesDuringPlay })],
    ];
    const rowH = Math.min(40 * u, (h - 90 * u) / rows.length);
    rows.forEach(([label, value, fn], i) => {
      const ry = y + 40 * u + i * (rowH + 4 * u);
      add(ui.text(x + 16 * u, ry + rowH / 2, label, "md", COLORS.ink, 0, 0.5));
      add(ui.button(x + w - 16 * u - 170 * u, ry, 170 * u, rowH, value, () => {
        fn();
        app().sfx.unlock();
        app().sfx.play("click");
        this.build();
      }, { size: "sm" }).container);
    });
    add(ui.text(x + 16 * u, y + h - 22 * u, `SAVED ON THIS DEVICE (${app().store.storageKind.toUpperCase()})`, "xs", COLORS.dim, 0, 0.5));
    add(ui.button(x + w - 16 * u - 120 * u, y + h - 40 * u, 120 * u, 32 * u, "BACK", () => this.show("menu"), { size: "md" }).container);
  }

  private buildControls(add: (o: Phaser.GameObjects.GameObject | Phaser.GameObjects.GameObject[]) => void, W: number, H: number, safe: UI["safe"], u: number): void {
    const ui = this.ui;
    const x = safe.left + 6 * u;
    const y = safe.top;
    const w = W - safe.left - safe.right - 12 * u;
    const h = H - safe.top - safe.bottom;
    add(buildControlsHelp(ui, x, y, w, h));
    add(ui.button(x + w - 126 * u, y + h - 42 * u, 116 * u, 32 * u, "BACK", () => this.show("menu"), { size: "md" }).container);
  }

  private startGame(): void {
    const sfx = app().sfx;
    sfx.unlock();
    sfx.play("whistle");
    this.scene.start("game");
  }
}
