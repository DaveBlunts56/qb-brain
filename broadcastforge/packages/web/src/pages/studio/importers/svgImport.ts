import { BUNDLED_FONTS, createElement, defaultTextProps, type GraphicElement, type Paint, type Stroke } from '@bf/shared';

export interface ImportContext {
  canvasWidth: number;
  canvasHeight: number;
  /** Upload a binary (image or font) and return its asset id. */
  upload: (blob: Blob, name: string) => Promise<string>;
}

export interface ImportResult {
  elements: GraphicElement[];
  fonts: { family: string; assetId: string }[];
  warnings: string[];
  /** Natural size of the imported artwork (before placement). */
  width: number;
  height: number;
}

const UNSUPPORTED_TAGS = new Set(['filter', 'mask', 'pattern', 'foreignObject', 'clipPath', 'marker', 'symbol', 'switch', 'animate', 'animateTransform', 'animateMotion', 'set']);

/** Remove anything executable or external before the SVG touches the live DOM. */
export function sanitizeSvg(root: Element): string[] {
  const removed: string[] = [];
  const walk = (el: Element) => {
    for (const child of [...el.children]) {
      const tag = child.localName;
      if (tag === 'script' || tag === 'foreignObject' || tag === 'iframe') {
        removed.push(tag);
        child.remove();
        continue;
      }
      walk(child);
    }
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const v = attr.value.trim().toLowerCase();
      if (name.startsWith('on')) el.removeAttribute(attr.name);
      else if ((name === 'href' || name === 'xlink:href') && !v.startsWith('#') && !v.startsWith('data:image/')) {
        removed.push(`external link ${attr.value.slice(0, 40)}`);
        el.removeAttribute(attr.name);
      }
    }
  };
  walk(root);
  return removed;
}

function colorToHex(c: string): string | null {
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)/.exec(c);
  if (!m) return null;
  const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? Number(m[4].slice(0, -1)) / 100 : Number(m[4]);
  if (a === 0) return null;
  const h = [m[1], m[2], m[3]].map((v) => Math.round(Number(v)).toString(16).padStart(2, '0')).join('');
  return a < 1 ? `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${a})` : `#${h}`;
}

function gradientPaint(doc: Document, ref: string, warnings: string[]): Paint | null {
  const id = /url\(\s*["']?#([^"')]+)["']?\s*\)/.exec(ref)?.[1];
  if (!id) return null;
  const g = doc.getElementById(id);
  if (!g) return null;
  const stopsFrom = (el: Element): Element[] => {
    const own = [...el.querySelectorAll('stop')];
    if (own.length) return own;
    const href = el.getAttribute('href') ?? el.getAttribute('xlink:href');
    const parent = href?.startsWith('#') ? doc.getElementById(href.slice(1)) : null;
    return parent ? stopsFrom(parent) : [];
  };
  const stops = stopsFrom(g).map((s) => {
    const cs = getComputedStyle(s);
    const color = cs.getPropertyValue('stop-color') || s.getAttribute('stop-color') || '#000';
    const op = Number(cs.getPropertyValue('stop-opacity') || s.getAttribute('stop-opacity') || 1);
    const off = s.getAttribute('offset') ?? '0';
    const offset = off.endsWith('%') ? Number(off.slice(0, -1)) / 100 : Number(off);
    const hex = colorToHex(color) ?? color;
    const withAlpha = op < 1 && hex.startsWith('#') ? `rgba(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)}, ${op})` : hex;
    return { offset: Math.min(1, Math.max(0, offset || 0)), color: withAlpha };
  });
  if (!stops.length) return null;
  if (g.localName === 'radialGradient') {
    warnings.push(`Radial gradient "${id}" was converted to a linear gradient.`);
    return { type: 'linear', angle: 180, stops };
  }
  const num = (a: string, d: number) => {
    const v = g.getAttribute(a);
    if (v === null) return d;
    return v.endsWith('%') ? Number(v.slice(0, -1)) / 100 : Number(v);
  };
  const dx = num('x2', 1) - num('x1', 0);
  const dy = num('y2', 0) - num('y1', 0);
  // SVG vector → CSS angle (0deg = up, 90deg = right)
  const angle = Math.round(((Math.atan2(dy, dx) * 180) / Math.PI + 90 + 360) % 360);
  return { type: 'linear', angle, stops };
}

function paintOf(el: Element, doc: Document, warnings: string[]): Paint {
  const fill = getComputedStyle(el).fill || el.getAttribute('fill') || '';
  if (!fill || fill === 'none') return { type: 'none' };
  if (fill.startsWith('url')) return gradientPaint(doc, fill, warnings) ?? { type: 'solid', color: '#808080' };
  const hex = colorToHex(fill);
  return hex ? { type: 'solid', color: hex } : { type: 'none' };
}

function strokeOf(el: Element, scale: number): Stroke | null {
  const cs = getComputedStyle(el);
  const s = cs.stroke;
  if (!s || s === 'none' || s.startsWith('url')) return null;
  const width = parseFloat(cs.strokeWidth) || 1;
  const color = colorToHex(s);
  return color ? { color, width: width * scale } : null;
}

/** Decompose an SVG matrix into translation/rotation/scale; flags skew. */
function decompose(m: DOMMatrix) {
  const sx = Math.hypot(m.a, m.b);
  const det = m.a * m.d - m.b * m.c;
  const sy = sx ? det / sx : 0;
  const rotation = (Math.atan2(m.b, m.a) * 180) / Math.PI;
  const skew = sx ? (m.a * m.c + m.b * m.d) / (sx * sx) : 0;
  return { sx, sy, rotation, skewed: Math.abs(skew) > 0.01 };
}

export async function importSvg(text: string, ctx: ImportContext): Promise<ImportResult> {
  const warnings: string[] = [];
  const parsed = new DOMParser().parseFromString(text, 'image/svg+xml');
  if (parsed.querySelector('parsererror')) throw new Error('This SVG file could not be parsed (malformed XML).');
  const srcRoot = parsed.documentElement;
  if (srcRoot.localName !== 'svg') throw new Error('Not an SVG document.');
  const removed = sanitizeSvg(srcRoot);
  if (removed.length) warnings.push(`Removed unsafe or external content: ${[...new Set(removed)].slice(0, 5).join(', ')}.`);

  // Mount offscreen so the browser computes transforms, styles and bounding boxes for us.
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none';
  const svg = document.importNode(srcRoot, true) as unknown as SVGSVGElement;
  host.appendChild(svg);
  document.body.appendChild(host);
  try {
    const vb = svg.viewBox?.baseVal;
    const width = vb && vb.width ? vb.width : parseFloat(svg.getAttribute('width') ?? '') || ctx.canvasWidth;
    const height = vb && vb.height ? vb.height : parseFloat(svg.getAttribute('height') ?? '') || ctx.canvasHeight;
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    const rootCTM = svg.getScreenCTM()!.inverse();
    const elements: GraphicElement[] = [];
    const fonts: ImportResult['fonts'] = [];

    // Embedded @font-face fonts (data: URLs) are uploaded as font assets.
    for (const style of [...svg.querySelectorAll('style')]) {
      const css = style.textContent ?? '';
      const faceRe = /@font-face\s*{([^}]*)}/g;
      let m: RegExpExecArray | null;
      while ((m = faceRe.exec(css))) {
        const family = /font-family\s*:\s*["']?([^;"']+)["']?/.exec(m[1]!)?.[1]?.trim();
        const data = /url\(\s*["']?(data:[^"')]+)["']?\s*\)/.exec(m[1]!)?.[1];
        if (!family) continue;
        if (!data) {
          warnings.push(`Font "${family}" references an external file; add the font file in Assets or it falls back to Barlow Condensed.`);
          continue;
        }
        try {
          const blob = await (await fetch(data)).blob();
          fonts.push({ family, assetId: await ctx.upload(blob, `${family}.font`) });
        } catch {
          warnings.push(`Embedded font "${family}" could not be imported.`);
        }
      }
    }
    const knownFonts = new Set<string>([...BUNDLED_FONTS.map((f) => f.toLowerCase()), ...fonts.map((f) => f.family.toLowerCase())]);
    const missingFonts = new Set<string>();
    const unsupported = new Set<string>();

    const walk = async (node: Element, parentId: string | null) => {
      for (const child of [...node.children]) {
        const tag = child.localName;
        if (UNSUPPORTED_TAGS.has(tag)) {
          if (tag !== 'clipPath' && tag !== 'symbol') unsupported.add(tag);
          continue;
        }
        if (tag === 'defs' || tag === 'style' || tag === 'title' || tag === 'desc' || tag === 'metadata' || tag === 'linearGradient' || tag === 'radialGradient') continue;
        const g = child as SVGGraphicsElement;
        const cs = getComputedStyle(g);
        if (cs.display === 'none') continue;
        for (const attr of ['filter', 'mask', 'clip-path']) {
          const v = g.getAttribute(attr) ?? (cs.getPropertyValue(attr) !== 'none' ? cs.getPropertyValue(attr) : '');
          if (v) unsupported.add(attr);
        }
        if (typeof g.getBBox !== 'function') continue;
        let bbox: DOMRect;
        try {
          bbox = g.getBBox();
        } catch {
          continue;
        }
        const ctm = rootCTM.multiply(g.getScreenCTM()!);
        const d = decompose(ctm);
        if (d.skewed) warnings.push(`"${g.id || tag}" is skewed; it was imported approximately.`);
        // Box in canvas coordinates (unrotated size, centred on the transformed centre).
        const centre = new DOMPoint(bbox.x + bbox.width / 2, bbox.y + bbox.height / 2).matrixTransform(ctm);
        const w = bbox.width * Math.abs(d.sx);
        const h = bbox.height * Math.abs(d.sy);
        const geom = { x: centre.x - w / 2, y: centre.y - h / 2, width: w, height: h, rotation: Math.round(d.rotation * 100) / 100 };
        const opacity = Number(cs.opacity || 1) * Number(cs.fillOpacity || 1);
        const name = g.id || g.getAttribute('inkscape:label') || g.getAttribute('data-name') || tag;
        const meta = { source: 'svg' as const };

        if (tag === 'g' || tag === 'a' || tag === 'svg') {
          const group = createElement('group', { ...geom, rotation: 0, name, parentId, opacity: Number(cs.opacity || 1), meta });
          elements.push(group);
          await walk(child, group.id);
          continue;
        }
        if (tag === 'use') {
          unsupported.add('use (symbol references)');
          continue;
        }
        if (tag === 'rect') {
          const rx = parseFloat(g.getAttribute('rx') ?? g.getAttribute('ry') ?? '0') || 0;
          elements.push(createElement('rect', { ...geom, name, parentId, fill: paintOf(g, svg.ownerDocument, warnings), stroke: strokeOf(g, d.sx), radius: rx * d.sx, opacity, meta }));
        } else if (tag === 'circle' || tag === 'ellipse') {
          elements.push(createElement('ellipse', { ...geom, name, parentId, fill: paintOf(g, svg.ownerDocument, warnings), stroke: strokeOf(g, d.sx), opacity, meta }));
        } else if (tag === 'path' || tag === 'polygon' || tag === 'polyline' || tag === 'line') {
          let pathD = g.getAttribute('d') ?? '';
          if (tag === 'polygon' || tag === 'polyline') {
            const pts = (g.getAttribute('points') ?? '').trim().split(/[\s,]+/).map(Number);
            const pairs: string[] = [];
            for (let i = 0; i + 1 < pts.length; i += 2) pairs.push(`${pts[i]} ${pts[i + 1]}`);
            pathD = `M ${pairs.join(' L ')}${tag === 'polygon' ? ' Z' : ''}`;
          } else if (tag === 'line') {
            pathD = `M ${g.getAttribute('x1') ?? 0} ${g.getAttribute('y1') ?? 0} L ${g.getAttribute('x2') ?? 0} ${g.getAttribute('y2') ?? 0}`;
          }
          if (!pathD) continue;
          elements.push(
            createElement('path', {
              ...geom,
              width: Math.max(1, w),
              height: Math.max(1, h),
              name,
              parentId,
              fill: paintOf(g, svg.ownerDocument, warnings),
              stroke: strokeOf(g, d.sx),
              opacity,
              path: { d: pathD, viewBox: [bbox.x, bbox.y, Math.max(0.01, bbox.width), Math.max(0.01, bbox.height)], fillRule: cs.fillRule === 'evenodd' ? 'evenodd' : 'nonzero' },
              meta,
            }),
          );
        } else if (tag === 'text') {
          const content = (g.textContent ?? '').replace(/\s+/g, ' ').trim();
          if (!content) continue;
          const family = (cs.fontFamily || 'Barlow Condensed').split(',')[0]!.replace(/["']/g, '').trim();
          if (!knownFonts.has(family.toLowerCase())) missingFonts.add(family);
          const anchor = cs.textAnchor || g.getAttribute('text-anchor') || 'start';
          const fill = paintOf(g, svg.ownerDocument, warnings);
          elements.push(
            createElement('text', {
              ...geom,
              name: name === 'text' ? `Text "${content.slice(0, 20)}"` : name,
              parentId,
              opacity: Number(cs.opacity || 1),
              text: defaultTextProps({
                content,
                fontFamily: knownFonts.has(family.toLowerCase()) ? family : 'Barlow Condensed',
                fontSize: (parseFloat(cs.fontSize) || 16) * Math.abs(d.sy),
                fontWeight: Number(cs.fontWeight) || 400,
                italic: cs.fontStyle === 'italic',
                color: fill.type === 'solid' ? fill.color : '#ffffff',
                align: anchor === 'middle' ? 'center' : anchor === 'end' ? 'right' : 'left',
                letterSpacing: (parseFloat(cs.letterSpacing) || 0) * d.sx,
                uppercase: false,
                fit: 'none',
                tabularNums: false,
              }),
              meta: { ...meta, note: 'Imported SVG text (editable).' },
            }),
          );
        } else if (tag === 'image') {
          const href = g.getAttribute('href') ?? g.getAttribute('xlink:href') ?? '';
          if (!href.startsWith('data:image/')) {
            warnings.push('An image linked to an external file was skipped; embed it or add it separately.');
            continue;
          }
          try {
            const blob = await (await fetch(href)).blob();
            const assetId = await ctx.upload(blob, `${name}.${blob.type.split('/')[1] ?? 'png'}`);
            elements.push(createElement('image', { ...geom, name, parentId, opacity, image: { assetId, fit: 'fill' }, meta }));
          } catch (e) {
            warnings.push(`Embedded image "${name}" could not be imported: ${(e as Error).message}`);
          }
        } else {
          unsupported.add(tag);
        }
      }
    };
    await walk(svg, null);
    if (unsupported.size) warnings.push(`Not editable / left out: ${[...unsupported].join(', ')}. Use "Import as a single image" if the design depends on them.`);
    if (missingFonts.size) warnings.push(`Font(s) not available locally: ${[...missingFonts].join(', ')} → shown in Barlow Condensed. Upload the font files in Assets to use them.`);
    if (!elements.length) warnings.push('No supported shapes were found in this SVG.');
    return { elements, fonts, warnings, width, height };
  } finally {
    host.remove();
  }
}

