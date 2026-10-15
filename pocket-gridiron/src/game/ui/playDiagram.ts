import Phaser from "phaser";
import { FORMATIONS, type Play } from "../../core/data/playbook";
import { ROUTES } from "../../core/data/routes";
import type { SkillSlot } from "../../core/data/types";
import { MARKER_COLORS } from "../art/sprites";

/**
 * Draws a play as a coach's diagram: line of scrimmage, linemen, QB, receivers (in their marker
 * colors and shapes) and routes, mirrored if flipped. Offense moves to the right, like the field.
 */
export function drawPlayDiagram(g: Phaser.GameObjects.Graphics, play: Play, flipped: boolean, x: number, y: number, w: number, h: number, u: number): void {
  const form = FORMATIONS[play.formation];
  const m = flipped ? -1 : 1;
  const pad = 4 * u;
  const minD = -6;
  const maxD = 24;
  const halfW = 21;
  const px = (d: number) => x + pad + ((d - minD) / (maxD - minD)) * (w - 2 * pad);
  const py = (lat: number) => y + pad + ((lat + halfW) / (2 * halfW)) * (h - 2 * pad);
  const lw = Math.max(1, Math.round(u));

  // LOS
  g.lineStyle(lw, 0x4aa3ff, 0.6);
  g.lineBetween(px(0), y + pad, px(0), y + h - pad);

  // Linemen and QB
  const dot = Math.max(2, Math.round(1.6 * u));
  g.fillStyle(0xbfc8c2, 1);
  g.fillRect(px(-0.6) - dot, py(-1.6) - dot, dot * 2, dot * 2);
  g.fillRect(px(-0.6) - dot, py(1.6) - dot, dot * 2, dot * 2);
  g.fillStyle(0xffffff, 1);
  g.fillCircle(px(form.qb.dx), py(form.qb.dy * m), dot * 1.2);

  const slots = (Object.keys(form.skill) as SkillSlot[]).map((slot) => ({ slot, a: form.skill[slot]! }));
  const order = [...slots].sort((p, q) => p.a.dy * m - q.a.dy * m);
  for (const { slot, a } of slots) {
    const marker = order.findIndex((o) => o.slot === slot);
    const color = MARKER_COLORS[marker];
    const ay = a.dy * m;
    const routeId = play.routes[slot] ?? "checkdown";
    const route = ROUTES[routeId];
    const outside = ay < -0.1 ? -1 : 1;
    const pts = [{ x: px(a.dx), y: py(ay) }, ...route.points.map((p) => ({ x: px(Math.min(maxD, p.d)), y: py(Math.max(-halfW, Math.min(halfW, ay + p.w * outside))) }))];
    g.lineStyle(lw * 1.5, color, 0.95);
    g.beginPath();
    g.moveTo(pts[0].x, pts[0].y);
    for (const p of pts.slice(1)) g.lineTo(p.x, p.y);
    g.strokePath();
    const end = pts[pts.length - 1];
    const prev = pts[pts.length - 2];
    const ang = Math.atan2(end.y - prev.y, end.x - prev.x);
    if (route.end === "continue") {
      const s = 3 * u;
      g.fillStyle(color, 1);
      g.fillTriangle(
        end.x + Math.cos(ang) * s, end.y + Math.sin(ang) * s,
        end.x + Math.cos(ang + 2.4) * s, end.y + Math.sin(ang + 2.4) * s,
        end.x + Math.cos(ang - 2.4) * s, end.y + Math.sin(ang - 2.4) * s,
      );
    } else {
      // Settle routes end in a "T".
      const s = 2.5 * u;
      g.lineBetween(end.x + Math.cos(ang + Math.PI / 2) * s, end.y + Math.sin(ang + Math.PI / 2) * s, end.x - Math.cos(ang + Math.PI / 2) * s, end.y - Math.sin(ang + Math.PI / 2) * s);
    }
    drawMarker(g, marker, pts[0].x, pts[0].y, 2.6 * u);
  }
}

/** Receiver marker shapes: ▲ ● ■ ◆ in the marker colors. */
export function drawMarker(g: Phaser.GameObjects.Graphics, marker: number, cx: number, cy: number, r: number, alpha = 1): void {
  const color = MARKER_COLORS[marker] ?? 0xffffff;
  g.fillStyle(0x0a0e0c, alpha);
  shape(g, marker, cx, cy, r + Math.max(1, r * 0.35));
  g.fillStyle(color, alpha);
  shape(g, marker, cx, cy, r);
}

function shape(g: Phaser.GameObjects.Graphics, marker: number, cx: number, cy: number, r: number): void {
  switch (marker) {
    case 0:
      g.fillTriangle(cx, cy - r * 1.1, cx - r, cy + r * 0.8, cx + r, cy + r * 0.8);
      break;
    case 1:
      g.fillCircle(cx, cy, r);
      break;
    case 2:
      g.fillRect(cx - r * 0.85, cy - r * 0.85, r * 1.7, r * 1.7);
      break;
    default:
      g.fillPoints([{ x: cx, y: cy - r * 1.15 }, { x: cx + r * 1.05, y: cy }, { x: cx, y: cy + r * 1.15 }, { x: cx - r * 1.05, y: cy }] as Phaser.Types.Math.Vector2Like[], true);
  }
}
