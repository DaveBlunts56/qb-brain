import { createId, rectsIntersect, type GraphicElement, type Rect, type Scene } from '@bf/shared';
import { assetUrl } from '../../lib/api';
import type { Candidate } from './editorStore';

/**
 * Assisted region detection for flattened artwork (PNG/JPEG/WebP).
 *
 * Practical, explainable image processing — not "AI":
 *  1. Crop to the non-transparent part of the image.
 *  2. Sobel edge magnitude → threshold → horizontal run-length smoothing
 *     merges glyphs into word blobs → connected components = text-like areas.
 *  3. Colour quantisation + connected components of large uniform areas = panels.
 *  4. A ring around each text box is sampled: its median colours give a
 *     cover/mask fill, and its variance tells whether the background is too
 *     complex to cover cleanly.
 * Results are suggestions; the user confirms or redraws every region.
 */

const imageCache = new Map<string, Promise<HTMLImageElement>>();

export function loadImage(url: string): Promise<HTMLImageElement> {
  let p = imageCache.get(url);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Could not load image'));
      img.src = url;
    });
    imageCache.set(url, p);
  }
  return p;
}

interface Raster {
  w: number;
  h: number;
  data: Uint8ClampedArray;
  /** scene units per raster pixel */
  scale: number;
  ox: number;
  oy: number;
}

async function rasterize(el: GraphicElement, maxW = 1200, crop?: Rect): Promise<Raster | null> {
  if (!el.image?.assetId) return null;
  const img = await loadImage(assetUrl(el.image.assetId));
  // Region of the element (scene coordinates) to rasterize.
  const r = crop ?? { x: el.x, y: el.y, width: el.width, height: el.height };
  // Raster pixels per scene unit: never above the source resolution, never wider than maxW.
  const k = Math.min(maxW / Math.max(1, r.width), (img.naturalWidth || el.width) / el.width) || 1;
  const w = Math.max(1, Math.round(r.width * k));
  const h = Math.max(1, Math.round(r.height * k));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const sx = img.naturalWidth / el.width;
  const sy = img.naturalHeight / el.height;
  ctx.drawImage(img, (r.x - el.x) * sx, (r.y - el.y) * sy, r.width * sx, r.height * sy, 0, 0, w, h);
  return { w, h, data: ctx.getImageData(0, 0, w, h).data, scale: 1 / k, ox: r.x, oy: r.y };
}

/** Bounding box of opaque pixels (scene coordinates), or the whole element for opaque images. */
async function opaqueBounds(el: GraphicElement): Promise<Rect> {
  const r = await rasterize(el, 480);
  if (!r) return el;
  let x0 = r.w,
    y0 = r.h,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < r.h; y++)
    for (let x = 0; x < r.w; x++) {
      if (r.data[(y * r.w + x) * 4 + 3]! > 24) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  if (x1 < 0) return el;
  const pad = 2;
  return {
    x: r.ox + Math.max(0, x0 - pad) * r.scale,
    y: r.oy + Math.max(0, y0 - pad) * r.scale,
    width: (Math.min(r.w, x1 + pad) - Math.max(0, x0 - pad)) * r.scale,
    height: (Math.min(r.h, y1 + pad) - Math.max(0, y0 - pad)) * r.scale,
  };
}

function components(mask: Uint8Array, w: number, h: number): { x0: number; y0: number; x1: number; y1: number; area: number }[] {
  const seen = new Uint8Array(w * h);
  const out: { x0: number; y0: number; x1: number; y1: number; area: number }[] = [];
  const stack: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || seen[i]) continue;
    let x0 = w,
      y0 = h,
      x1 = 0,
      y1 = 0,
      area = 0;
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop()!;
      const x = j % w;
      const y = (j / w) | 0;
      area++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      const nb = [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, y > 0 ? j - w : -1, y < h - 1 ? j + w : -1];
      for (const n of nb)
        if (n >= 0 && mask[n] && !seen[n]) {
          seen[n] = 1;
          stack.push(n);
        }
    }
    out.push({ x0, y0, x1, y1, area });
  }
  return out;
}

function hex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
}

function median(vals: number[]): number {
  if (!vals.length) return 0;
  const s = [...vals].sort((a, b) => a - b);
  return s[s.length >> 1]!;
}

/** Median colours of thin bands above/below a box and the luminance spread of its surrounding ring. */
function ringStats(r: Raster, x0: number, y0: number, x1: number, y1: number, band = 3) {
  const top: number[][] = [[], [], []];
  const bot: number[][] = [[], [], []];
  const lum: number[] = [];
  const push = (x: number, y: number, into: number[][]) => {
    if (x < 0 || y < 0 || x >= r.w || y >= r.h) return;
    const i = (y * r.w + x) * 4;
    if (r.data[i + 3]! < 128) return;
    into[0]!.push(r.data[i]!);
    into[1]!.push(r.data[i + 1]!);
    into[2]!.push(r.data[i + 2]!);
    lum.push(0.299 * r.data[i]! + 0.587 * r.data[i + 1]! + 0.114 * r.data[i + 2]!);
  };
  for (let d = 1; d <= band; d++) {
    for (let x = x0 - band; x <= x1 + band; x++) {
      push(x, y0 - d, top);
      push(x, y1 + d, bot);
    }
    for (let y = y0; y <= y1; y++) {
      const t = y < (y0 + y1) / 2 ? top : bot;
      push(x0 - d, y, t);
      push(x1 + d, y, t);
    }
  }
  const mean = lum.reduce((a, b) => a + b, 0) / Math.max(1, lum.length);
  const sd = Math.sqrt(lum.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, lum.length));
  const col = (c: number[][]) => (c[0]!.length ? hex(median(c[0]!), median(c[1]!), median(c[2]!)) : null);
  const t = col(top);
  const b = col(bot);
  return { top: t ?? b ?? '#20242b', bottom: b ?? t ?? '#20242b', sd };
}

export async function detectRegions(base: GraphicElement): Promise<{ candidates: Candidate[]; notes: string[] }> {
  const notes: string[] = [];
  const crop = await opaqueBounds(base);
  const r = await rasterize(base, 1200, crop);
  if (!r) return { candidates: [], notes: ['Base artwork could not be read.'] };
  const { w, h, data } = r;

  // Luminance and alpha
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = data[i * 4 + 3]! / 255;
    lum[i] = (0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!) * a;
  }
  // Sobel magnitude
  const mag = new Float32Array(w * h);
  let sum = 0;
  let sum2 = 0;
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = -lum[i - w - 1]! - 2 * lum[i - 1]! - lum[i + w - 1]! + lum[i - w + 1]! + 2 * lum[i + 1]! + lum[i + w + 1]!;
      const gy = -lum[i - w - 1]! - 2 * lum[i - w]! - lum[i - w + 1]! + lum[i + w - 1]! + 2 * lum[i + w]! + lum[i + w + 1]!;
      const m = Math.hypot(gx, gy);
      mag[i] = m;
      sum += m;
      sum2 += m * m;
    }
  const n = (w - 2) * (h - 2);
  const mean = sum / n;
  const sd = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
  const thr = Math.max(60, mean + 1.2 * sd);
  const edges = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) edges[i] = mag[i]! > thr ? 1 : 0;

  // Horizontal run-length smoothing merges letters into words; slight vertical too.
  const gapX = Math.max(3, Math.round(w * 0.008));
  const smooth = new Uint8Array(edges);
  for (let y = 0; y < h; y++) {
    let last = -1;
    for (let x = 0; x < w; x++) {
      if (edges[y * w + x]) {
        if (last >= 0 && x - last <= gapX) for (let k = last + 1; k < x; k++) smooth[y * w + k] = 1;
        last = x;
      }
    }
  }
  for (let x = 0; x < w; x++) {
    let last = -1;
    for (let y = 0; y < h; y++) {
      if (smooth[y * w + x]) {
        if (last >= 0 && y - last <= 2) for (let k = last + 1; k < y; k++) smooth[k * w + x] = 1;
        last = y;
      }
    }
  }

  let boxes = components(smooth, w, h)
    .filter((c) => {
      const bw = c.x1 - c.x0 + 1;
      const bh = c.y1 - c.y0 + 1;
      return bh >= 7 && bw >= 6 && bh <= h * 0.95 && c.area / (bw * bh) > 0.15;
    })
    .map((c) => ({ ...c }));
  // Merge boxes that overlap or touch.
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;
        if (a.x0 <= b.x1 + 2 && b.x0 <= a.x1 + 2 && a.y0 <= b.y1 + 1 && b.y0 <= a.y1 + 1) {
          boxes[i] = { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1), area: a.area + b.area };
          boxes.splice(j, 1);
          merged = true;
          break outer;
        }
      }
  }
  boxes = boxes.filter((b) => b.x1 - b.x0 < w * 0.9 || b.y1 - b.y0 < h * 0.5);
  const heights = boxes.map((b) => b.y1 - b.y0 + 1);
  const medH = median(heights) || 1;

  const toScene = (x0: number, y0: number, x1: number, y1: number) => ({
    x: Math.round(r.ox + x0 * r.scale),
    y: Math.round(r.oy + y0 * r.scale),
    width: Math.round((x1 - x0 + 1) * r.scale),
    height: Math.round((y1 - y0 + 1) * r.scale),
  });

  const out: Candidate[] = [];
  for (const b of boxes) {
    const bw = b.x1 - b.x0 + 1;
    const bh = b.y1 - b.y0 + 1;
    const ring = ringStats(r, b.x0, b.y0, b.x1, b.y1);
    // Colour variety inside the box helps tell logos from text.
    let satSum = 0;
    let cnt = 0;
    for (let y = b.y0; y <= b.y1; y += 2)
      for (let x = b.x0; x <= b.x1; x += 2) {
        const i = (y * w + x) * 4;
        const mx = Math.max(data[i]!, data[i + 1]!, data[i + 2]!);
        const mn = Math.min(data[i]!, data[i + 1]!, data[i + 2]!);
        satSum += mx - mn;
        cnt++;
      }
    const colorful = satSum / Math.max(1, cnt) > 55;
    const aspect = bw / bh;
    let kind: Candidate['kind'] = 'text';
    if (aspect > 0.7 && aspect < 1.4 && bh >= medH * 1.2 && colorful) kind = 'logo';
    else if (bh >= medH * 1.35 && bh >= 14) kind = 'largeText';
    out.push({
      id: createId('cand'),
      ...toScene(b.x0, b.y0, b.x1, b.y1),
      kind,
      confidence: Math.min(1, 0.4 + b.area / (bw * bh)),
      complexBackground: ring.sd > 22,
      fill: { top: ring.top, bottom: ring.bottom },
    });
  }

  // Uniform panels: quantised-colour connected components.
  const q = new Uint16Array(w * h);
  let opaque = 0;
  for (let i = 0; i < w * h; i++) {
    if (data[i * 4 + 3]! < 200) {
      q[i] = 0xffff;
      continue;
    }
    opaque++;
    q[i] = ((data[i * 4]! >> 4) << 8) | ((data[i * 4 + 1]! >> 4) << 4) | (data[i * 4 + 2]! >> 4);
  }
  const seen = new Uint8Array(w * h);
  const panels: { x0: number; y0: number; x1: number; y1: number; area: number; color: number }[] = [];
  for (let i = 0; i < w * h; i++) {
    if (seen[i] || q[i] === 0xffff) continue;
    const color = q[i]!;
    const stack = [i];
    seen[i] = 1;
    let x0 = w,
      y0 = h,
      x1 = 0,
      y1 = 0,
      area = 0;
    while (stack.length) {
      const j = stack.pop()!;
      const x = j % w;
      const y = (j / w) | 0;
      area++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (const nb of [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, y > 0 ? j - w : -1, y < h - 1 ? j + w : -1])
        if (nb >= 0 && !seen[nb] && q[nb] === color) {
          seen[nb] = 1;
          stack.push(nb);
        }
    }
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    if (area >= opaque * 0.01 && bw >= 16 && bh >= 10 && area / (bw * bh) > 0.55) panels.push({ x0, y0, x1, y1, area, color });
  }
  panels.sort((a, b) => b.area - a.area);
  for (const p of panels.slice(0, 8)) {
    const rect = toScene(p.x0, p.y0, p.x1, p.y1);
    // Skip panels that are basically the whole artwork.
    if (rect.width * rect.height > crop.width * crop.height * 0.85) continue;
    const cr = ((p.color >> 8) & 15) * 17;
    const cg = ((p.color >> 4) & 15) * 17;
    const cb = (p.color & 15) * 17;
    out.push({ id: createId('cand'), ...rect, kind: 'panel', confidence: Math.min(1, p.area / (rect.width * rect.height)), complexBackground: false, fill: { top: hex(cr, cg, cb), bottom: hex(cr, cg, cb) } });
  }

  // Drop noise: tiny boxes, and boxes mostly inside a bigger one of a similar kind.
  const area = (c: Candidate) => c.width * c.height;
  const overlap = (a: Candidate, b: Candidate) => {
    const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
    return w > 0 && h > 0 ? w * h : 0;
  };
  const textLike = (c: Candidate) => c.kind !== 'panel';
  let filtered = out.filter((c) => (c.kind === 'panel' ? c.width >= 40 && c.height >= 18 : c.height >= 10 && c.width >= 8));
  filtered = filtered.filter((a) => !filtered.some((b) => b !== a && area(b) > area(a) && textLike(a) === textLike(b) && overlap(a, b) >= area(a) * 0.8));
  const rank = { largeText: 0, logo: 1, text: 2, panel: 3 } as const;
  out.length = 0;
  out.push(...filtered.sort((a, b) => rank[a.kind] - rank[b.kind] || a.x - b.x));

  if (!out.length) notes.push('No distinct regions were found. Draw regions manually with the Region tool (R).');
  const complex = out.filter((c) => c.complexBackground).length;
  if (complex) notes.push(`${complex} text area(s) sit on gradients/photos: a solid cover would show. Prefer a replacement panel, cropping, or rebuilding that part.`);
  notes.push('Detection is approximate. Adjust or redraw any region before assigning it.');
  return { candidates: out, notes };
}

/** Colours to cover baked-in content in a box, sampled from the artwork around it. */
export async function sampleRegionFill(scene: Scene, box: Rect): Promise<{ top: string; bottom: string; complex: boolean }> {
  const base = [...scene.elements].reverse().find((e) => e.type === 'image' && e.image?.assetId && rectsIntersect(e, box));
  if (!base) return { top: '#20242b', bottom: '#20242b', complex: false };
  const pad = Math.max(6, Math.round(Math.min(box.width, box.height) * 0.15));
  const area = { x: box.x - pad, y: box.y - pad, width: box.width + pad * 2, height: box.height + pad * 2 };
  try {
    const r = await rasterize(base, 600, area);
    if (!r) return { top: '#20242b', bottom: '#20242b', complex: false };
    const k = 1 / r.scale;
    const ring = ringStats(r, Math.round(pad * k), Math.round(pad * k), Math.round((pad + box.width) * k) - 1, Math.round((pad + box.height) * k) - 1, Math.max(2, Math.round(pad * k * 0.6)));
    return { top: ring.top, bottom: ring.bottom, complex: ring.sd > 22 };
  } catch {
    return { top: '#20242b', bottom: '#20242b', complex: false };
  }
}
