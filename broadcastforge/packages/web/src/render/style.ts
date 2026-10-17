import { resolveColor, type BindingContext, type GraphicElement, type Paint, type Shadow, type Stroke } from '@bf/shared';

export function paintToCss(paint: Paint, ctx: BindingContext | null, override?: string): { backgroundColor: string; backgroundImage: string } {
  if (override) return { backgroundColor: override, backgroundImage: 'none' };
  if (paint.type === 'solid') return { backgroundColor: resolveColor(paint.color, ctx), backgroundImage: 'none' };
  if (paint.type === 'linear') {
    const stops = [...paint.stops].sort((a, b) => a.offset - b.offset).map((s) => `${resolveColor(s.color, ctx)} ${Math.round(s.offset * 1000) / 10}%`);
    if (stops.length === 1) stops.push(stops[0]!.replace(/\s[\d.]+%$/, ' 100%'));
    return { backgroundColor: 'transparent', backgroundImage: `linear-gradient(${paint.angle}deg, ${stops.join(', ')})` };
  }
  return { backgroundColor: 'transparent', backgroundImage: 'none' };
}

export function shadowToCss(s: Shadow | null, ctx: BindingContext | null): string {
  return s ? `${s.x}px ${s.y}px ${s.blur}px ${resolveColor(s.color, ctx)}` : 'none';
}

export function strokeToBorder(s: Stroke | null, ctx: BindingContext | null): string {
  return s && s.width > 0 ? `${s.width}px solid ${resolveColor(s.color, ctx)}` : 'none';
}

/** Paint for SVG shapes (paths/polygons): returns a fill attribute and optional gradient defs. */
export function paintToSvg(paint: Paint, ctx: BindingContext | null, gradId: string, override?: string): { fill: string; defs: string } {
  if (override) return { fill: override, defs: '' };
  if (paint.type === 'solid') return { fill: resolveColor(paint.color, ctx), defs: '' };
  if (paint.type === 'linear') {
    // CSS angle semantics: 0deg = towards top, 90deg = towards right.
    const a = ((paint.angle - 90) * Math.PI) / 180;
    const x1 = 50 - Math.cos(a) * 50;
    const y1 = 50 - Math.sin(a) * 50;
    const x2 = 50 + Math.cos(a) * 50;
    const y2 = 50 + Math.sin(a) * 50;
    const stops = paint.stops
      .map((s) => `<stop offset="${s.offset}" stop-color="${escapeAttr(resolveColor(s.color, ctx))}"/>`)
      .join('');
    return {
      fill: `url(#${gradId})`,
      defs: `<linearGradient id="${gradId}" x1="${x1}%" y1="${y1}%" x2="${x2}%" y2="${y2}%">${stops}</linearGradient>`,
    };
  }
  return { fill: 'none', defs: '' };
}

export function escapeAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function fontStack(family: string): string {
  return `"${family.replace(/"/g, '')}", "Barlow Condensed", "Arial Narrow", Arial, sans-serif`;
}

export function textAlignToFlex(align: string): string {
  return align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center';
}

export function vAlignToFlex(v: string): string {
  return v === 'top' ? 'flex-start' : v === 'bottom' ? 'flex-end' : 'center';
}

/** A stable key of everything that affects an element's static look (to skip redundant restyles). */
export function styleKey(el: GraphicElement, extra: string): string {
  return JSON.stringify([el.x, el.y, el.width, el.height, el.rotation, el.opacity, el.fill, el.stroke, el.radius, el.skewX, el.shadow, el.blendMode, el.text && { ...el.text, content: '' }, el.image?.fit, el.path, el.polygon, extra]);
}
