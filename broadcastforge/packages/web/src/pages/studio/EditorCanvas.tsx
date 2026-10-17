import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ancestors,
  boundsOf,
  createElement,
  defaultTextProps,
  descendantIds,
  hitTestScene,
  isEffectivelyLocked,
  isEffectivelyVisible,
  rectsIntersect,
  resizeElement,
  rotatedBounds,
  safeZoneRects,
  snapRect,
  snapTargets,
  translateElements,
  type GraphicElement,
  type Point,
  type Rect,
  type Scene,
  type SnapGuide,
} from '@bf/shared';
import { assetUrl } from '../../lib/api';
import { SceneRenderer } from '../../render/SceneRenderer';
import { useEditor } from './editorStore';
import { sampleRegionFill } from './regionDetect';

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rot';

interface Drag {
  mode: 'pan' | 'move' | 'resize' | 'rotate' | 'marquee' | 'draw';
  startClient: Point;
  start: Point;
  initial: Scene;
  ids: string[];
  bbox: Rect | null;
  handle?: Handle;
  pan0?: { x: number; y: number };
  targets?: { xs: number[]; ys: number[] };
  shift?: boolean;
  moved: boolean;
}

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

function handlePos(b: Rect, h: Handle): Point {
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const x = h.includes('w') ? b.x : h.includes('e') ? b.x + b.width : cx;
  const y = h.startsWith('n') ? b.y : h.startsWith('s') ? b.y + b.height : cy;
  return { x, y };
}

const CURSORS: Record<Handle, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', rot: 'grab' };

/** Selection without children whose ancestor is also selected (so groups move once). */
export function topLevelSelection(scene: Scene, ids: string[]): string[] {
  const set = new Set(ids);
  return ids.filter((id) => !ancestors(scene, id).some((a) => set.has(a.id)));
}

/** The Studio canvas renderer, so the timeline dock can preview animations on it. */
export const canvasRendererRef: { current: SceneRenderer | null } = { current: null };

export function EditorCanvas({ onRenderer }: { onRenderer?: (r: SceneRenderer | null) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<SceneRenderer | null>(null);
  const drag = useRef<Drag | null>(null);
  const spaceDown = useRef(false);
  const [guides, setGuides] = useState<SnapGuide[]>([]);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [cursor, setCursor] = useState('default');
  const [poly, setPoly] = useState<Point[]>([]);
  const [polyCursor, setPolyCursor] = useState<Point | null>(null);
  const { scene, selection, tool, zoom, pan, showRestHidden, previewState, candidates } = useEditor();
  const fitted = useRef(false);

  // Renderer lifecycle
  useEffect(() => {
    const r = new SceneRenderer(stageRef.current!, { mode: 'editor', assetUrl, now: () => performance.now(), showRestHidden: useEditor.getState().showRestHidden });
    rendererRef.current = r;
    canvasRendererRef.current = r;
    onRenderer?.(r);
    return () => {
      onRenderer?.(null);
      if (canvasRendererRef.current === r) canvasRendererRef.current = null;
      r.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (scene) rendererRef.current?.setScene(scene);
  }, [scene]);
  useEffect(() => {
    rendererRef.current?.setState(previewState, false);
  }, [previewState, scene]);
  useEffect(() => {
    rendererRef.current?.setShowRestHidden(showRestHidden);
  }, [showRestHidden]);

  const fit = useCallback(() => {
    const c = containerRef.current;
    const s = useEditor.getState().scene;
    if (!c || !s) return;
    const pad = 40;
    const z = Math.min((c.clientWidth - pad * 2) / s.width, (c.clientHeight - pad * 2) / s.height);
    useEditor.getState().setView(z, { x: (c.clientWidth - s.width * z) / 2, y: (c.clientHeight - s.height * z) / 2 });
  }, []);

  useLayoutEffect(() => {
    if (scene && !fitted.current) {
      fitted.current = true;
      fit();
    }
  }, [scene, fit]);

  useEffect(() => {
    const onFit = () => fit();
    window.addEventListener('bf:fit', onFit);
    return () => window.removeEventListener('bf:fit', onFit);
  }, [fit]);

  const toScene = useCallback((clientX: number, clientY: number): Point => {
    const rect = containerRef.current!.getBoundingClientRect();
    const { zoom: z, pan: p } = useEditor.getState();
    return { x: (clientX - rect.left - p.x) / z, y: (clientY - rect.top - p.y) / z };
  }, []);

  /** Only what is visible on the canvas can be clicked (not hidden takeover graphics or a FLAG panel that is off). */
  const isDrawn = (id: string) => rendererRef.current?.isRendered(id) ?? true;

  const selBounds = useCallback((s: Scene, ids: string[]): Rect | null => {
    const els = s.elements.filter((e) => ids.includes(e.id));
    return boundsOf(els.map((e) => rotatedBounds(e)));
  }, []);

  const hitHandle = (p: Point): Handle | null => {
    if (!scene || !selection.length) return null;
    const ids = topLevelSelection(scene, selection).filter((id) => !isEffectivelyLocked(scene, scene.elements.find((e) => e.id === id)!));
    const b = selBounds(scene, ids);
    if (!b) return null;
    const r = 7 / zoom;
    if (ids.length === 1) {
      const rp = { x: b.x + b.width / 2, y: b.y - 24 / zoom };
      if (Math.hypot(p.x - rp.x, p.y - rp.y) <= r) return 'rot';
    }
    for (const h of HANDLES) {
      const hp = handlePos(b, h);
      if (Math.abs(p.x - hp.x) <= r && Math.abs(p.y - hp.y) <= r) return h;
    }
    return null;
  };

  /** Element to act on for a click: a selected ancestor wins (moving a group), Alt picks the top group. */
  const pickTarget = (p: Point, alt: boolean): GraphicElement | null => {
    if (!scene) return null;
    const hit = hitTestScene(scene, p, { skip: (el) => !isDrawn(el.id) });
    if (!hit) return null;
    const chain = [hit, ...ancestors(scene, hit.id)];
    if (alt) return chain[chain.length - 1]!;
    const selected = chain.find((e) => selection.includes(e.id));
    return selected ?? hit;
  };

  // ---------------------------------------------------------------------------

  const onPointerDown = (e: React.PointerEvent) => {
    if (!scene) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = toScene(e.clientX, e.clientY);
    const base = { startClient: { x: e.clientX, y: e.clientY }, start: p, initial: scene, moved: false, ids: [] as string[], bbox: null };
    const st = useEditor.getState();

    if (e.button === 1 || tool === 'hand' || spaceDown.current) {
      drag.current = { ...base, mode: 'pan', pan0: st.pan };
      setCursor('grabbing');
      return;
    }
    if (e.button !== 0) return;

    if (tool === 'polygon') {
      setPoly((pts) => [...pts, snapPoint(p)]);
      return;
    }
    if (tool !== 'select') {
      drag.current = { ...base, mode: 'draw' };
      setMarquee({ x: p.x, y: p.y, width: 0, height: 0 });
      return;
    }

    const h = hitHandle(p);
    if (h) {
      const ids = topLevelSelection(scene, selection).filter((id) => !isEffectivelyLocked(scene, scene.elements.find((x) => x.id === id)!));
      st.checkpoint();
      drag.current = { ...base, mode: h === 'rot' ? 'rotate' : 'resize', handle: h, ids, bbox: selBounds(scene, ids), targets: snapTargets(scene, new Set(ids.flatMap((id) => [id, ...descendantIds(scene, id)])), scene.settings.safeZones) };
      return;
    }

    const target = pickTarget(p, e.altKey);
    if (!target) {
      if (!e.shiftKey) st.select([]);
      drag.current = { ...base, mode: 'marquee', shift: e.shiftKey };
      setMarquee({ x: p.x, y: p.y, width: 0, height: 0 });
      return;
    }
    let sel = selection;
    if (e.shiftKey) {
      sel = selection.includes(target.id) ? selection.filter((id) => id !== target.id) : [...selection, target.id];
      st.select(sel);
    } else if (!selection.includes(target.id)) {
      sel = [target.id];
      st.select(sel);
    }
    const ids = topLevelSelection(scene, sel).filter((id) => !isEffectivelyLocked(scene, scene.elements.find((x) => x.id === id)!));
    if (!ids.length) return;
    drag.current = {
      ...base,
      mode: 'move',
      ids,
      bbox: selBounds(scene, ids),
      targets: snapTargets(scene, new Set(ids.flatMap((id) => [id, ...descendantIds(scene, id)])), scene.settings.safeZones),
    };
  };

  const snapPoint = (p: Point): Point => {
    if (!scene?.settings.snap) return p;
    const g = scene.settings.grid || 1;
    return { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!scene) return;
    const p = toScene(e.clientX, e.clientY);
    const d = drag.current;
    if (!d) {
      if (tool === 'polygon') setPolyCursor(p);
      if (tool !== 'select') return setCursor(tool === 'hand' ? 'grab' : 'crosshair');
      const h = hitHandle(p);
      if (h) {
        setCursor(CURSORS[h]);
        setHoverId(null);
        return;
      }
      const t = pickTarget(p, e.altKey);
      setHoverId(t?.id ?? null);
      setCursor(t && !isEffectivelyLocked(scene, t) ? 'move' : 'default');
      return;
    }
    const dxC = e.clientX - d.startClient.x;
    const dyC = e.clientY - d.startClient.y;
    if (!d.moved && Math.hypot(dxC, dyC) < 3) return;
    if (!d.moved && d.mode === 'move') useEditor.getState().checkpoint();
    d.moved = true;
    const st = useEditor.getState();
    const snapOn = d.initial.settings.snap && !e.altKey;
    const threshold = 6 / zoom;

    switch (d.mode) {
      case 'pan':
        st.setView(st.zoom, { x: d.pan0!.x + dxC, y: d.pan0!.y + dyC });
        break;
      case 'move': {
        let dx = p.x - d.start.x;
        let dy = p.y - d.start.y;
        if (e.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        let g: SnapGuide[] = [];
        if (snapOn && d.bbox && d.targets) {
          const r = snapRect({ ...d.bbox, x: d.bbox.x + dx, y: d.bbox.y + dy }, d.targets, threshold);
          dx += r.dx;
          dy += r.dy;
          g = r.guides;
        }
        setGuides(g);
        dx = Math.round(dx);
        dy = Math.round(dy);
        st.update(
          (s) => {
            s.elements = structuredClone(d.initial.elements);
            translateElements(s, d.ids, dx, dy);
          },
          { history: false },
        );
        break;
      }
      case 'resize': {
        const b = d.bbox!;
        const h = d.handle!;
        let x0 = b.x;
        let y0 = b.y;
        let x1 = b.x + b.width;
        let y1 = b.y + b.height;
        const g: SnapGuide[] = [];
        const snapVal = (v: number, ts: number[], axis: 'x' | 'y') => {
          if (!snapOn) return v;
          let best = v;
          let bd = threshold;
          for (const t of ts)
            if (Math.abs(t - v) < bd) {
              bd = Math.abs(t - v);
              best = t;
            }
          if (best !== v) g.push({ axis, pos: best });
          return best;
        };
        if (h.includes('w')) x0 = snapVal(p.x, d.targets!.xs, 'x');
        if (h.includes('e')) x1 = snapVal(p.x, d.targets!.xs, 'x');
        if (h.startsWith('n')) y0 = snapVal(p.y, d.targets!.ys, 'y');
        if (h.startsWith('s')) y1 = snapVal(p.y, d.targets!.ys, 'y');
        let w = Math.max(2, x1 - x0);
        let hh = Math.max(2, y1 - y0);
        if (e.shiftKey && b.width && b.height) {
          const k = Math.max(w / b.width, hh / b.height);
          w = b.width * k;
          hh = b.height * k;
          if (h.includes('w')) x0 = b.x + b.width - w;
          if (h.startsWith('n')) y0 = b.y + b.height - hh;
        }
        if (x1 - x0 < 2 && h.includes('w')) x0 = x1 - 2;
        if (y1 - y0 < 2 && h.startsWith('n')) y0 = y1 - 2;
        const nb = { x: Math.round(x0), y: Math.round(y0), width: Math.round(w), height: Math.round(hh) };
        setGuides(g);
        st.update(
          (s) => {
            s.elements = structuredClone(d.initial.elements);
            const sx = b.width ? nb.width / b.width : 1;
            const sy = b.height ? nb.height / b.height : 1;
            for (const id of d.ids) {
              const el = s.elements.find((x) => x.id === id)!;
              resizeElement(s, id, { x: nb.x + (el.x - b.x) * sx, y: nb.y + (el.y - b.y) * sy, width: el.width * sx, height: el.height * sy });
            }
          },
          { history: false },
        );
        break;
      }
      case 'rotate': {
        const b = d.bbox!;
        const c = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
        let a = (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI + 90;
        if (e.shiftKey) a = Math.round(a / 15) * 15;
        a = Math.round(((a % 360) + 540) % 360) - 180;
        st.update(
          (s) => {
            const el = s.elements.find((x) => x.id === d.ids[0]);
            if (el) el.rotation = a;
          },
          { history: false },
        );
        break;
      }
      case 'marquee':
      case 'draw': {
        const s0 = d.mode === 'draw' ? snapPoint(d.start) : d.start;
        const s1 = d.mode === 'draw' ? snapPoint(p) : p;
        setMarquee({ x: Math.min(s0.x, s1.x), y: Math.min(s0.y, s1.y), width: Math.abs(s1.x - s0.x), height: Math.abs(s1.y - s0.y) });
        break;
      }
    }
  };

  const onPointerUp = async () => {
    const d = drag.current;
    drag.current = null;
    setGuides([]);
    if (!d || !scene) return;
    const st = useEditor.getState();
    if (d.mode === 'pan') setCursor(tool === 'hand' ? 'grab' : 'default');
    if (d.mode === 'marquee' && marquee) {
      if (marquee.width > 2 || marquee.height > 2) {
        const hits = scene.elements
          .filter((el) => el.type !== 'group' && isEffectivelyVisible(scene, el) && isDrawn(el.id) && !isEffectivelyLocked(scene, el) && rectsIntersect(rotatedBounds(el), marquee))
          .map((el) => el.id);
        st.select(d.shift ? [...new Set([...selection, ...hits])] : hits);
      }
      setMarquee(null);
    }
    if (d.mode === 'draw') {
      const r = marquee && marquee.width > 4 && marquee.height > 4 ? marquee : { ...snapPoint(d.start), width: tool === 'text' ? 240 : 160, height: tool === 'text' ? 60 : 80 };
      setMarquee(null);
      await createFromTool(r);
    }
  };

  const createFromTool = async (r: Rect) => {
    const st = useEditor.getState();
    const box = { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
    let el: GraphicElement;
    switch (st.tool) {
      case 'rect':
        el = createElement('rect', { ...box, name: 'Rectangle', meta: { source: 'user' } });
        break;
      case 'ellipse':
        el = createElement('ellipse', { ...box, name: 'Ellipse', meta: { source: 'user' } });
        break;
      case 'text':
        el = createElement('text', { ...box, name: 'Text', text: defaultTextProps({ content: 'TEXT', fontSize: Math.max(12, Math.round(box.height * 0.7)) }), meta: { source: 'user' } });
        break;
      case 'region':
        el = createElement('rect', { ...box, name: 'Region', fill: { type: 'none' }, meta: { source: 'user', note: 'Region: assign a live role in Make It Live' } });
        break;
      case 'mask': {
        const fill = await sampleRegionFill(useEditor.getState().scene!, box);
        el = createElement('rect', {
          ...box,
          name: 'Mask',
          fill: fill.top === fill.bottom ? { type: 'solid', color: fill.top } : { type: 'linear', angle: 180, stops: [{ offset: 0, color: fill.top }, { offset: 1, color: fill.bottom }] },
          meta: { source: 'user', isMask: true, note: 'Covers baked-in artwork (colour sampled from the surrounding pixels).' },
        });
        break;
      }
      default:
        return;
    }
    insertAboveBase(el);
    st.setTool('select');
  };

  const finishPolygon = useCallback(() => {
    if (poly.length < 3) {
      setPoly([]);
      return;
    }
    const b = boundsOf(poly.map((p) => ({ x: p.x, y: p.y, width: 0, height: 0 })))!;
    const el = createElement('polygon', {
      name: 'Polygon',
      x: b.x,
      y: b.y,
      width: Math.max(1, b.width),
      height: Math.max(1, b.height),
      polygon: { points: poly.map((p) => [p.x - b.x, p.y - b.y]) },
      fill: { type: 'solid', color: '#2a2f3a' },
      meta: { source: 'user' },
    });
    insertAboveBase(el);
    setPoly([]);
    useEditor.getState().setTool('select');
  }, [poly]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target as HTMLElement).closest('input,textarea,select')) {
        spaceDown.current = e.type === 'keydown';
        if (e.type === 'keydown') e.preventDefault();
      }
      if (e.type === 'keydown' && tool === 'polygon') {
        if (e.key === 'Enter') finishPolygon();
        if (e.key === 'Escape') setPoly([]);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, [tool, finishPolygon]);

  useEffect(() => {
    if (tool !== 'polygon') setPoly([]);
  }, [tool]);

  // Wheel: scroll pans, Ctrl/⌘ + wheel (or pinch) zooms around the cursor.
  useEffect(() => {
    const c = containerRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const st = useEditor.getState();
      if (e.ctrlKey || e.metaKey) {
        const rect = c.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const z = Math.min(8, Math.max(0.05, st.zoom * Math.exp(-e.deltaY * 0.0025)));
        const k = z / st.zoom;
        st.setView(z, { x: mx - (mx - st.pan.x) * k, y: my - (my - st.pan.y) * k });
      } else {
        st.setView(st.zoom, { x: st.pan.x - e.deltaX, y: st.pan.y - e.deltaY });
      }
    };
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => c.removeEventListener('wheel', onWheel);
  }, []);

  if (!scene) return <div ref={containerRef} className="flex-1" />;

  const sw = 1 / zoom;
  const topIds = topLevelSelection(scene, selection);
  const selEls = scene.elements.filter((e) => selection.includes(e.id));
  const sb = selBounds(scene, topIds);
  const hover = hoverId && !selection.includes(hoverId) ? scene.elements.find((e) => e.id === hoverId) : null;
  const corners = (el: GraphicElement) => {
    const cx = el.x + el.width / 2;
    const cy = el.y + el.height / 2;
    const a = (el.rotation * Math.PI) / 180;
    return [
      [-el.width / 2, -el.height / 2],
      [el.width / 2, -el.height / 2],
      [el.width / 2, el.height / 2],
      [-el.width / 2, el.height / 2],
    ]
      .map(([x, y]) => `${cx + x! * Math.cos(a) - y! * Math.sin(a)},${cy + x! * Math.sin(a) + y! * Math.cos(a)}`)
      .join(' ');
  };
  const invisibleOutlines = scene.elements.filter(
    (e) => e.visible && (e.type === 'rect' || e.type === 'ellipse') && e.fill.type === 'none' && !e.stroke && !selection.includes(e.id) && (!e.restHidden || showRestHidden),
  );
  const multiLocked = selEls.every((e) => isEffectivelyLocked(scene, e));

  return (
    <div
      ref={containerRef}
      className="relative min-h-0 min-w-0 flex-1 touch-none overflow-hidden bg-ink-950"
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => setHoverId(null)}
      onDoubleClick={() => tool === 'polygon' && finishPolygon()}
      data-testid="editor-canvas"
    >
      <div className="absolute left-0 top-0" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0' }}>
        <div className="relative shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_20px_60px_rgba(0,0,0,0.6)]" style={{ width: scene.width, height: scene.height, background: scene.settings.editorBackground }}>
          <div ref={stageRef} className="absolute inset-0" />
        </div>
        <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={scene.width} height={scene.height}>
          {scene.settings.safeZones &&
            safeZoneRects(scene.width, scene.height).map((z, i) => (
              <rect key={z.name} x={z.rect.x} y={z.rect.y} width={z.rect.width} height={z.rect.height} fill="none" stroke={i === 0 ? 'rgba(255,255,255,0.18)' : 'rgba(245,179,1,0.3)'} strokeWidth={sw} strokeDasharray={`${8 * sw} ${6 * sw}`} />
            ))}
          {invisibleOutlines.map((e) => (
            <polygon key={e.id} points={corners(e)} fill="rgba(59,158,255,0.06)" stroke="rgba(59,158,255,0.5)" strokeWidth={sw} strokeDasharray={`${4 * sw} ${3 * sw}`} />
          ))}
          {candidates.map((c) => (
            <g key={c.id}>
              <rect x={c.x} y={c.y} width={c.width} height={c.height} fill="rgba(245,179,1,0.08)" stroke="#f5b301" strokeWidth={1.5 * sw} strokeDasharray={`${5 * sw} ${3 * sw}`} />
              <text x={c.x + 3 * sw} y={c.y - 4 * sw} fontSize={11 * sw} fill="#f5b301" fontFamily="Inter">
                {c.kind === 'largeText' ? 'large text' : c.kind}
                {c.complexBackground ? ' ⚠' : ''}
              </text>
            </g>
          ))}
          {hover && tool === 'select' && <polygon points={corners(hover)} fill="none" stroke="#3b9eff" strokeWidth={1.5 * sw} />}
          {selEls.map((e) => (
            <polygon key={e.id} points={corners(e)} fill="none" stroke={isEffectivelyLocked(scene, e) ? '#97a2b0' : '#3b9eff'} strokeWidth={1.5 * sw} />
          ))}
          {sb && !multiLocked && (
            <g>
              {topIds.length > 1 && <rect x={sb.x} y={sb.y} width={sb.width} height={sb.height} fill="none" stroke="#3b9eff" strokeWidth={sw} strokeDasharray={`${4 * sw} ${3 * sw}`} />}
              {HANDLES.map((h) => {
                const hp = handlePos(sb, h);
                return <rect key={h} x={hp.x - 4 * sw} y={hp.y - 4 * sw} width={8 * sw} height={8 * sw} fill="#fff" stroke="#3b9eff" strokeWidth={1.5 * sw} />;
              })}
              {topIds.length === 1 && (
                <>
                  <line x1={sb.x + sb.width / 2} y1={sb.y} x2={sb.x + sb.width / 2} y2={sb.y - 24 * sw} stroke="#3b9eff" strokeWidth={sw} />
                  <circle cx={sb.x + sb.width / 2} cy={sb.y - 24 * sw} r={5 * sw} fill="#fff" stroke="#3b9eff" strokeWidth={1.5 * sw} />
                </>
              )}
              <text x={sb.x} y={sb.y + sb.height + 16 * sw} fontSize={11 * sw} fill="#3b9eff" fontFamily="Inter">
                {Math.round(sb.x)}, {Math.round(sb.y)} · {Math.round(sb.width)} × {Math.round(sb.height)}
              </text>
            </g>
          )}
          {guides.map((g, i) =>
            g.axis === 'x' ? <line key={i} x1={g.pos} y1={-10000} x2={g.pos} y2={10000} stroke="#ff3d9a" strokeWidth={sw} /> : <line key={i} x1={-10000} y1={g.pos} x2={10000} y2={g.pos} stroke="#ff3d9a" strokeWidth={sw} />,
          )}
          {marquee && <rect x={marquee.x} y={marquee.y} width={marquee.width} height={marquee.height} fill="rgba(59,158,255,0.1)" stroke="#3b9eff" strokeWidth={sw} />}
          {poly.length > 0 && (
            <g>
              <polyline points={[...poly, ...(polyCursor ? [polyCursor] : [])].map((p) => `${p.x},${p.y}`).join(' ')} fill="rgba(59,158,255,0.12)" stroke="#3b9eff" strokeWidth={1.5 * sw} />
              {poly.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={4 * sw} fill={i === 0 ? '#f5b301' : '#fff'} stroke="#3b9eff" strokeWidth={sw} />
              ))}
            </g>
          )}
        </svg>
      </div>
      {tool === 'polygon' && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded bg-ink-800/90 px-3 py-1.5 text-xs text-ink-200">Click to add points · double-click or Enter to finish · Esc to cancel</div>
      )}
    </div>
  );
}

/** Add a new element on top of the scene (above any base artwork) and select it. */
export function insertAboveBase(el: GraphicElement) {
  const st = useEditor.getState();
  st.update((s) => {
    s.elements.push(el);
  });
  st.select([el.id]);
}
