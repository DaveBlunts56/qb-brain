import {
  ancestors,
  clockStrings,
  easingToCss,
  eventContextFor,
  graphicFromEvent,
  keyframesToCss,
  resolveBindings,
  resolveColor,
  resolveTrackTargets,
  TakeoverController,
  ToggleLane,
  usesClock,
  ValueLane,
  type AnimationClip,
  type BindingContext,
  type BroadcastEvent,
  type Cancelable,
  type EventContext,
  type EventTimeline,
  type GameState,
  type GraphicElement,
  type GraphicKind,
  type Scene,
  type TeamSide,
  type TimelineTrigger,
} from '@bf/shared';
import { escapeAttr, fontStack, paintToCss, paintToSvg, shadowToCss, strokeToBorder, styleKey, textAlignToFlex, vAlignToFlex } from './style';

export interface RendererOptions {
  mode: 'overlay' | 'editor' | 'preview';
  assetUrl: (id: string) => string;
  /** Server-monotonic "now" used for clock display. */
  now: () => number;
  /** Editor: show elements that are normally hidden until animated (takeover graphics). */
  showRestHidden?: boolean;
  /** Scale the stage to fit the container. */
  fit?: 'contain' | 'none';
  onMissingAsset?: (assetId: string) => void;
  onQualityChange?: (q: 'high' | 'low') => void;
}

interface NodeRec {
  el: GraphicElement;
  outer: HTMLDivElement;
  tl: HTMLDivElement;
  tg: HTMLDivElement;
  body: HTMLDivElement;
  textHost: HTMLDivElement | null;
  imgHost: HTMLDivElement | null;
  valueLane: ValueLane<string> | null;
  imageLane: ValueLane<string | null> | null;
  visLane: ToggleLane | null;
  dimLane: ToggleLane | null;
  visShown: boolean;
  dimmed: boolean;
  dimOpacity: number;
  reveal: number;
  styleKey: string;
  clockBound: boolean;
  highlight: Animation | null;
  fillOverride: string | undefined;
  colorOverride: string | undefined;
}

interface PlayingTimeline extends Cancelable {
  trigger: TimelineTrigger;
}

const RESTORE_FADE_MS = 220;

/**
 * Renders a Scene as plain DOM and drives all broadcast animations with the
 * Web Animations API (compositor-friendly transforms/opacity). The same class
 * renders the OBS overlay, the Studio canvas and every preview, so what is
 * edited is exactly what airs.
 *
 * Layering per element (outer → tl → tg → body):
 *   outer: position, rotation, base opacity, display, dimming, restore fades
 *   tl:    event timelines (touchdown, entrance, accents)
 *   tg:    enter/exit clips for visibility-bound elements (flag, possession)
 *   body:  the visual itself; text/images animate inside it
 * Separate layers let concurrent animations compose instead of fighting.
 */
export class SceneRenderer {
  readonly root: HTMLDivElement;
  private stage: HTMLDivElement;
  private nodes = new Map<string, NodeRec>();
  private scene: Scene | null = null;
  private structureKey = '';
  private state: GameState | null = null;
  private eventCtx: EventContext | null = null;
  private clocks = { game: '', play: '' };
  private raf = 0;
  private destroyed = false;
  private rootLane: ToggleLane;
  private takeover: TakeoverController;
  private accents = new Map<TimelineTrigger, PlayingTimeline>();
  private stageShown = true;
  private quality: 'high' | 'low' = 'high';
  private frameSamples: number[] = [];
  private lastFrame = 0;
  private loadedFonts = new Set<string>();
  private resizeObs: ResizeObserver | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly opts: RendererOptions,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'bf-root';
    this.stage = document.createElement('div');
    this.stage.className = 'bf-stage';
    this.root.appendChild(this.stage);
    container.appendChild(this.root);
    this.rootLane = new ToggleLane(true, (show, done) => this.runRootVisibility(show, done), (show) => this.setStageShown(show));
    this.takeover = new TakeoverController((req, done) => {
      const d = req.data as { kind: GraphicKind; team: TeamSide | null; text?: string; timeline: EventTimeline };
      this.setEventContext(eventContextFor(d.kind, d.team, d.text));
      return this.playTimeline(d.timeline, d.team, done);
    });
    if (opts.fit === 'contain') {
      this.resizeObs = new ResizeObserver(() => this.layout());
      this.resizeObs.observe(container);
    }
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  setScene(scene: Scene) {
    const key = JSON.stringify(scene.elements.map((e) => [e.id, e.parentId, e.type, e.restHidden, e.bindings.length]));
    const sizeChanged = !this.scene || this.scene.width !== scene.width || this.scene.height !== scene.height;
    this.scene = scene;
    this.loadFonts(scene);
    if (key !== this.structureKey || sizeChanged) {
      this.structureKey = key;
      this.rebuild();
    } else {
      for (const el of scene.elements) {
        const rec = this.nodes.get(el.id);
        if (!rec) continue;
        rec.el = el;
        this.applyStatic(rec);
      }
      if (this.state) this.applyAllBindings(false);
    }
    this.layout();
  }

  getScene(): Scene | null {
    return this.scene;
  }

  /** Apply match state. animate=false for snapshots (reconnect/refresh): no motion, just the truth. */
  setState(state: GameState, animate: boolean) {
    this.state = state;
    this.clocks = clockStrings(state, this.opts.now());
    this.applyAllBindings(animate);
    if (this.opts.mode !== 'editor') {
      if (!state.overlayVisible && !animate) this.takeover.clear();
      this.rootLane.set(state.overlayVisible, animate);
    }
  }

  /** Handle live broadcast events (after setState with the matching snapshot). */
  handleEvents(events: BroadcastEvent[]) {
    for (const e of events) {
      if (e.type === 'GRAPHICS_CLEARED') {
        this.clearGraphics();
        continue;
      }
      if (e.type === 'GAME_RESET') {
        this.takeover.clear();
        continue;
      }
      const g = graphicFromEvent(e);
      if (g) {
        this.triggerGraphic(g.kind, g.team, g.text);
        continue;
      }
      if (e.type === 'SCORE_CHANGED' && (e.payload as { delta: number }).delta > 0) this.playAccent('scoreChange', (e.payload as { team: TeamSide }).team);
      if (e.type === 'PERIOD_CHANGED') this.playAccent('periodChange', null);
      if (e.type === 'POSSESSION_CHANGED') {
        const to = (e.payload as { to: TeamSide | null }).to;
        if (to) this.playAccent('possessionChange', to);
      }
    }
  }

  /** Start a takeover graphic (touchdown, banners). Used by live events and editor previews. */
  triggerGraphic(kind: GraphicKind, team: TeamSide | null, text?: string): string {
    if (!this.scene) return 'no-scene';
    if (this.opts.mode !== 'editor' && this.state && !this.state.overlayVisible) return 'overlay-hidden';
    const timeline = this.scene.timelines.find((t) => t.trigger === kind && t.enabled);
    if (!timeline) return 'no-timeline';
    return this.takeover.request({ key: `${kind}:${team ?? '-'}`, priority: timeline.priority, at: performance.now(), data: { kind, team, text, timeline } });
  }

  /** Play any timeline by id (Animation Editor preview). */
  previewTimeline(timelineId: string, team: TeamSide | null, onDone?: () => void): Cancelable | null {
    const tl = this.scene?.timelines.find((t) => t.id === timelineId);
    if (!tl) return null;
    this.clearGraphics(false);
    if (tl.mode === 'takeover') {
      this.setEventContext(eventContextFor(tl.trigger as GraphicKind, team, tl.trigger === 'custom' ? 'CUSTOM BANNER' : undefined));
    }
    this.setStageShown(true);
    return this.playTimeline(tl, team, () => onDone?.());
  }

  /** Play a single clip on one element (timeline editor scrubbing / per-element preview). */
  previewClip(elementId: string, clip: AnimationClip): Animation | null {
    const rec = this.nodes.get(elementId);
    if (!rec) return null;
    return rec.tl.animate(this.cssKeyframes(clip), { duration: clip.durationMs, easing: easingToCss(clip.easing), fill: 'none' });
  }

  /** Emergency clear: cut every graphic immediately. */
  clearGraphics(hideStage = true) {
    this.takeover.clear();
    for (const a of this.accents.values()) a.cancel();
    this.accents.clear();
    if (hideStage && this.opts.mode !== 'editor') {
      this.rootLane.set(false, false);
    }
  }

  setShowRestHidden(show: boolean) {
    this.opts.showRestHidden = show;
    for (const rec of this.nodes.values()) this.updateDisplay(rec);
  }

  /** Bounding box of the stage in client pixels (for editor overlays). */
  stageRect(): DOMRect {
    return this.root.getBoundingClientRect();
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObs?.disconnect();
    this.takeover.clear();
    for (const a of this.accents.values()) a.cancel();
    for (const rec of this.nodes.values()) this.disposeRec(rec);
    this.root.remove();
  }

  // ---------------------------------------------------------------------------
  // Layout & DOM construction
  // ---------------------------------------------------------------------------

  private layout() {
    if (!this.scene) return;
    const { width, height } = this.scene;
    this.root.style.width = `${width}px`;
    this.root.style.height = `${height}px`;
    if (this.opts.fit === 'contain') {
      const cw = this.container.clientWidth || width;
      const ch = this.container.clientHeight || height;
      const k = Math.min(cw / width, ch / height);
      const ox = (cw - width * k) / 2;
      const oy = (ch - height * k) / 2;
      this.root.style.transform = `translate(${ox}px, ${oy}px) scale(${k})`;
    } else {
      this.root.style.transform = '';
    }
  }

  private rebuild() {
    this.takeover.clear();
    for (const a of this.accents.values()) a.cancel();
    this.accents.clear();
    for (const rec of this.nodes.values()) this.disposeRec(rec);
    this.nodes.clear();
    this.stage.replaceChildren();
    if (!this.scene) return;
    for (const el of this.scene.elements) {
      const rec = this.createRec(el);
      this.nodes.set(el.id, rec);
      const parent = el.parentId ? this.nodes.get(el.parentId) : null;
      (parent ? parent.body : this.stage).appendChild(rec.outer);
      this.applyStatic(rec);
    }
    if (this.state) this.applyAllBindings(false);
  }

  private createRec(el: GraphicElement): NodeRec {
    const outer = document.createElement('div');
    outer.className = 'bf-el';
    outer.dataset.id = el.id;
    const tl = document.createElement('div');
    tl.className = 'bf-layer';
    const tg = document.createElement('div');
    tg.className = 'bf-layer';
    const body = document.createElement('div');
    body.className = 'bf-body';
    outer.appendChild(tl);
    tl.appendChild(tg);
    tg.appendChild(body);
    const rec: NodeRec = {
      el,
      outer,
      tl,
      tg,
      body,
      textHost: null,
      imgHost: null,
      valueLane: null,
      imageLane: null,
      visLane: null,
      dimLane: null,
      visShown: true,
      dimmed: false,
      dimOpacity: 0.25,
      reveal: 0,
      styleKey: '',
      clockBound: usesClock(el),
      highlight: null,
      fillOverride: undefined,
      colorOverride: undefined,
    };
    if (el.type === 'text') {
      const host = document.createElement('div');
      host.className = 'bf-text';
      body.appendChild(host);
      rec.textHost = host;
      const initial = el.text?.content ?? '';
      this.setTextInstant(rec, initial);
      rec.valueLane = new ValueLane<string>(initial, (from, to, done) => this.runTextChange(rec, from, to, done), (v) => this.setTextInstant(rec, v));
    }
    if (el.type === 'image') {
      const host = document.createElement('div');
      host.className = 'bf-img';
      body.appendChild(host);
      rec.imgHost = host;
      const initial = el.image?.assetId ?? null;
      this.setImageInstant(rec, initial);
      rec.imageLane = new ValueLane<string | null>(initial, (from, to, done) => this.runImageChange(rec, from, to, done), (v) => this.setImageInstant(rec, v));
    }
    if (el.bindings.some((b) => b.target === 'visible' && b.mode !== 'dim')) {
      rec.visLane = new ToggleLane(true, (show, done) => this.runToggle(rec, show, done, 'vis'), (show) => {
        rec.visShown = show;
        this.updateDisplay(rec);
      });
    }
    if (el.bindings.some((b) => b.target === 'visible' && b.mode === 'dim')) {
      rec.dimLane = new ToggleLane(true, (show, done) => this.runToggle(rec, show, done, 'dim'), (show) => {
        rec.dimmed = !show;
        this.updateOpacity(rec);
      });
    }
    return rec;
  }

  private disposeRec(rec: NodeRec) {
    rec.valueLane?.stop(false);
    rec.imageLane?.stop(false);
    rec.visLane?.stop();
    rec.dimLane?.stop();
    rec.highlight?.cancel();
  }

  private ctx(): BindingContext | null {
    if (!this.state) return null;
    return { state: this.state, clocks: this.clocks, event: this.eventCtx };
  }

  private parentOffset(el: GraphicElement): { x: number; y: number } {
    if (!el.parentId) return { x: 0, y: 0 };
    const p = this.nodes.get(el.parentId)?.el;
    return p ? { x: p.x, y: p.y } : { x: 0, y: 0 };
  }

  /** Static styling (geometry, paint, typography). Cheap no-op when nothing changed. */
  private applyStatic(rec: NodeRec, force = false) {
    const el = rec.el;
    const ctx = this.ctx();
    const tokenKey = JSON.stringify([ctx?.state.home.primaryColor, ctx?.state.away.primaryColor, ctx?.state.home.secondaryColor, ctx?.state.away.secondaryColor, ctx?.state.home.textColor, ctx?.state.away.textColor, ctx?.state.possession, this.eventCtx?.team, rec.fillOverride, rec.colorOverride, this.parentOffset(el)]);
    const key = styleKey(el, tokenKey);
    if (!force && key === rec.styleKey) return;
    rec.styleKey = key;
    const off = this.parentOffset(el);
    const o = rec.outer.style;
    o.left = `${el.x - off.x}px`;
    o.top = `${el.y - off.y}px`;
    o.width = `${el.width}px`;
    o.height = `${el.height}px`;
    o.transform = el.rotation ? `rotate(${el.rotation}deg)` : '';
    o.mixBlendMode = el.blendMode && el.blendMode !== 'normal' ? el.blendMode : '';
    this.updateOpacity(rec);
    this.updateDisplay(rec);

    const b = rec.body.style;
    b.transform = el.skewX ? `skewX(${el.skewX}deg)` : '';
    if (el.type === 'path' || el.type === 'polygon') {
      b.background = 'none';
      b.border = 'none';
      b.borderRadius = '0';
      b.boxShadow = 'none';
      b.filter = el.shadow && this.quality === 'high' ? `drop-shadow(${shadowToCss(el.shadow, ctx)})` : '';
      rec.body.innerHTML = this.svgMarkup(el, ctx, rec.fillOverride);
    } else if (el.type !== 'group') {
      const paint = paintToCss(el.fill, ctx, rec.fillOverride);
      b.backgroundColor = paint.backgroundColor;
      b.backgroundImage = paint.backgroundImage;
      b.border = strokeToBorder(el.stroke, ctx);
      b.borderRadius = el.type === 'ellipse' ? '50%' : `${el.radius}px`;
      b.boxShadow = this.quality === 'high' ? shadowToCss(el.shadow, ctx) : 'none';
      b.filter = '';
    }
    if (el.text && rec.textHost) {
      const t = el.text;
      const h = rec.textHost.style;
      h.fontFamily = fontStack(t.fontFamily);
      h.fontSize = `${t.fontSize}px`;
      h.fontWeight = String(t.fontWeight);
      h.fontStyle = t.italic ? 'italic' : 'normal';
      h.color = rec.colorOverride ?? resolveColor(t.color, ctx);
      h.letterSpacing = `${t.letterSpacing}px`;
      h.lineHeight = String(t.lineHeight);
      h.textTransform = t.uppercase ? 'uppercase' : 'none';
      h.fontVariantNumeric = t.tabularNums ? 'tabular-nums' : 'normal';
      h.setProperty('-webkit-text-stroke', t.stroke && t.stroke.width > 0 ? `${t.stroke.width}px ${resolveColor(t.stroke.color, ctx)}` : '');
      h.textShadow = t.shadow && this.quality === 'high' ? shadowToCss(t.shadow, ctx) : 'none';
      h.setProperty('--bf-justify', textAlignToFlex(t.align));
      h.setProperty('--bf-align', vAlignToFlex(t.verticalAlign));
      h.setProperty('--bf-origin', t.align === 'left' ? 'left center' : t.align === 'right' ? 'right center' : 'center center');
      h.whiteSpace = t.fit === 'none' ? 'pre-wrap' : 'nowrap';
      h.textAlign = t.align;
      for (const span of rec.textHost.querySelectorAll<HTMLElement>('.bf-tv')) this.fitText(rec, span);
    }
    if (el.image && rec.imgHost) {
      for (const img of rec.imgHost.querySelectorAll('img')) img.style.objectFit = el.image.fit;
    }
  }

  private svgMarkup(el: GraphicElement, ctx: BindingContext | null, override?: string): string {
    const gid = `g_${el.id}`;
    const paint = paintToSvg(el.fill, ctx, gid, override);
    const stroke = el.stroke && el.stroke.width > 0 ? ` stroke="${escapeAttr(resolveColor(el.stroke.color, ctx))}" stroke-width="${el.stroke.width}" vector-effect="non-scaling-stroke"` : '';
    if (el.type === 'polygon' && el.polygon) {
      const pts = el.polygon.points.map(([x, y]) => `${x},${y}`).join(' ');
      return `<svg width="100%" height="100%" viewBox="0 0 ${el.width} ${el.height}" preserveAspectRatio="none" style="overflow:visible"><defs>${paint.defs}</defs><polygon points="${pts}" fill="${escapeAttr(paint.fill)}"${stroke}/></svg>`;
    }
    if (el.type === 'path' && el.path) {
      const [vx, vy, vw, vh] = el.path.viewBox;
      return `<svg width="100%" height="100%" viewBox="${vx} ${vy} ${vw} ${vh}" preserveAspectRatio="none" style="overflow:visible"><defs>${paint.defs}</defs><path d="${escapeAttr(el.path.d)}" fill-rule="${el.path.fillRule}" fill="${escapeAttr(paint.fill)}"${stroke}/></svg>`;
    }
    return '';
  }

  private updateOpacity(rec: NodeRec) {
    rec.outer.style.opacity = String(rec.el.opacity * (rec.dimmed ? rec.dimOpacity : 1));
  }

  private updateDisplay(rec: NodeRec) {
    const el = rec.el;
    let visible = el.visible && rec.visShown;
    if (el.restHidden && rec.reveal === 0) {
      visible = visible && this.opts.mode === 'editor' && Boolean(this.opts.showRestHidden);
    }
    rec.outer.style.display = visible ? '' : 'none';
  }

  private setStageShown(show: boolean) {
    this.stageShown = show;
    this.stage.style.visibility = show ? 'visible' : 'hidden';
  }

  // ---------------------------------------------------------------------------
  // Bindings
  // ---------------------------------------------------------------------------

  private setEventContext(ctx: EventContext | null) {
    this.eventCtx = ctx;
    if (this.state) this.applyAllBindings(false, (rec) => rec.el.bindings.some((b) => b.field.startsWith('event.')) || JSON.stringify(rec.el).includes('$event.'));
  }

  private applyAllBindings(animate: boolean, filter?: (rec: NodeRec) => boolean) {
    const ctx = this.ctx();
    if (!ctx) return;
    // Hidden stage: no point animating what nobody sees.
    const anim = animate && this.stageShown && this.opts.mode !== 'editor';
    for (const rec of this.nodes.values()) {
      if (filter && !filter(rec)) continue;
      this.applyBindings(rec, ctx, anim);
    }
  }

  private applyBindings(rec: NodeRec, ctx: BindingContext, animate: boolean) {
    const el = rec.el;
    const r = resolveBindings(el, ctx);
    if (r.fill !== rec.fillOverride || r.color !== rec.colorOverride) {
      const fade = animate && el.anim.update?.style === 'fade';
      rec.body.style.transition = fade ? `background-color ${el.anim.update!.durationMs}ms ease` : '';
      rec.fillOverride = r.fill;
      rec.colorOverride = r.color;
    }
    this.applyStatic(rec);
    if (rec.valueLane) {
      const text = r.text ?? el.text?.content ?? '';
      const canAnimate = animate && !rec.clockBound && Boolean(el.anim.update && el.anim.update.style !== 'none');
      rec.valueLane.update(text, canAnimate);
    }
    if (rec.imageLane) {
      const id = r.imageAssetId !== undefined ? r.imageAssetId : (el.image?.assetId ?? null);
      rec.imageLane.update(id, animate && Boolean(el.anim.update && el.anim.update.style !== 'none'));
    }
    if (rec.visLane) rec.visLane.set(r.visible, animate);
    if (rec.dimLane) {
      const db = el.bindings.find((b) => b.target === 'visible' && b.mode === 'dim');
      rec.dimOpacity = db?.dimOpacity ?? 0.25;
      rec.dimLane.set(r.dim === null, animate);
    }
  }

  // ---------------------------------------------------------------------------
  // Text & image value changes
  // ---------------------------------------------------------------------------

  private makeTextSpan(text: string): HTMLDivElement {
    const span = document.createElement('div');
    span.className = 'bf-tv';
    const inner = document.createElement('span');
    inner.className = 'bf-tt';
    inner.textContent = text;
    span.appendChild(inner);
    return span;
  }

  private fitText(rec: NodeRec, span: HTMLElement) {
    const t = rec.el.text;
    const inner = span.firstElementChild as HTMLElement | null;
    if (!t || !inner) return;
    inner.style.transform = '';
    inner.style.fontSize = '';
    if (t.fit === 'none') return;
    const avail = rec.el.width;
    const w = inner.offsetWidth;
    if (!w || w <= avail) return;
    const k = avail / w;
    if (t.fit === 'squeeze') inner.style.transform = `scaleX(${k})`;
    else inner.style.fontSize = `${Math.max(4, t.fontSize * k)}px`;
  }

  private setTextInstant(rec: NodeRec, text: string) {
    if (!rec.textHost) return;
    const span = this.makeTextSpan(text);
    rec.textHost.replaceChildren(span);
    rec.textHost.style.clipPath = '';
    this.fitText(rec, span);
  }

  private runTextChange(rec: NodeRec, _from: string, to: string, done: () => void): Cancelable {
    const host = rec.textHost!;
    const u = rec.el.anim.update;
    const spans = host.querySelectorAll<HTMLElement>('.bf-tv');
    const oldSpan = spans[spans.length - 1] ?? null;
    // Drop any leftovers from interrupted transitions.
    for (let i = 0; i < spans.length - 1; i++) spans[i]!.remove();
    const newSpan = this.makeTextSpan(to);
    host.appendChild(newSpan);
    this.fitText(rec, newSpan);
    if (!u || u.style === 'none' || !oldSpan) {
      oldSpan?.remove();
      done();
      return { cancel() {} };
    }
    const h = rec.el.height;
    const w = rec.el.width;
    const dur = u.durationMs;
    const easing = easingToCss(u.easing);
    let outK: Keyframe[];
    let inK: Keyframe[];
    let inDelay = 0;
    let outDur = dur;
    let inDur = dur;
    const sign = u.direction === 'down' || u.direction === 'right' ? 1 : -1;
    switch (u.style) {
      case 'roll': {
        const d = h * sign;
        outK = [{ transform: 'translateY(0px)', opacity: 1 }, { transform: `translateY(${d}px)`, opacity: 0.2 }];
        inK = [{ transform: `translateY(${-d}px)`, opacity: 0.2 }, { transform: 'translateY(0px)', opacity: 1 }];
        host.style.clipPath = 'inset(0 -50% 0 -50%)';
        break;
      }
      case 'slide': {
        const horiz = u.direction === 'left' || u.direction === 'right';
        const d = (horiz ? w * 0.35 : h * 0.55) * sign;
        const axis = horiz ? 'X' : 'Y';
        outK = [{ transform: `translate${axis}(0px)`, opacity: 1 }, { transform: `translate${axis}(${d}px)`, opacity: 0 }];
        inK = [{ transform: `translate${axis}(${-d}px)`, opacity: 0 }, { transform: `translate${axis}(0px)`, opacity: 1 }];
        break;
      }
      case 'flip':
        outDur = dur / 2;
        inDur = dur / 2;
        inDelay = dur / 2;
        outK = [{ transform: 'perspective(400px) rotateX(0deg)', opacity: 1 }, { transform: 'perspective(400px) rotateX(90deg)', opacity: 0.4 }];
        inK = [{ transform: 'perspective(400px) rotateX(-90deg)', opacity: 0.4 }, { transform: 'perspective(400px) rotateX(0deg)', opacity: 1 }];
        break;
      case 'scale':
        outK = [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(0.5)', opacity: 0 }];
        inK = [{ transform: 'scale(1.5)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }];
        break;
      default:
        outK = [{ opacity: 1 }, { opacity: 0 }];
        inK = [{ opacity: 0 }, { opacity: 1 }];
    }
    const a1 = oldSpan.animate(outK, { duration: outDur, easing, fill: 'forwards' });
    const a2 = newSpan.animate(inK, { duration: inDur, delay: inDelay, easing, fill: 'backwards' });
    let finished = false;
    const cleanup = () => {
      a1.cancel();
      oldSpan.remove();
      host.style.clipPath = '';
    };
    a2.finished
      .then(() => {
        if (finished) return;
        finished = true;
        cleanup();
        done();
        this.runHighlight(rec);
      })
      .catch(() => {});
    return {
      cancel: () => {
        if (finished) return;
        finished = true;
        a2.cancel();
        cleanup();
      },
    };
  }

  private runHighlight(rec: NodeRec) {
    const u = rec.el.anim.update;
    if (!u || u.highlight === 'none' || !rec.textHost) return;
    rec.highlight?.cancel();
    const ctx = this.ctx();
    let k: Keyframe[];
    if (u.highlight === 'pulse') k = [{ transform: 'scale(1)' }, { transform: 'scale(1.18)', offset: 0.35 }, { transform: 'scale(1)' }];
    else if (u.highlight === 'flash') k = [{ filter: 'brightness(1)' }, { filter: 'brightness(2)', offset: 0.25 }, { filter: 'brightness(1)' }];
    else {
      if (this.quality === 'low') return;
      const c = resolveColor(u.highlightColor, ctx);
      k = [{ filter: `drop-shadow(0 0 0px ${c})` }, { filter: `drop-shadow(0 0 14px ${c})`, offset: 0.35 }, { filter: `drop-shadow(0 0 0px ${c})` }];
    }
    rec.highlight = rec.textHost.animate(k, { duration: u.highlightMs, easing: 'ease-out' });
  }

  private makeImg(rec: NodeRec, assetId: string): HTMLImageElement {
    const img = document.createElement('img');
    img.draggable = false;
    img.decoding = 'async';
    img.alt = '';
    img.style.objectFit = rec.el.image?.fit ?? 'contain';
    img.onerror = () => {
      img.style.visibility = 'hidden';
      this.opts.onMissingAsset?.(assetId);
    };
    img.src = this.opts.assetUrl(assetId);
    return img;
  }

  private setImageInstant(rec: NodeRec, assetId: string | null) {
    if (!rec.imgHost) return;
    rec.imgHost.replaceChildren(...(assetId ? [this.makeImg(rec, assetId)] : []));
  }

  private runImageChange(rec: NodeRec, _from: string | null, to: string | null, done: () => void): Cancelable {
    const host = rec.imgHost!;
    const olds = [...host.querySelectorAll('img')];
    const img = to ? this.makeImg(rec, to) : null;
    if (img) host.appendChild(img);
    const dur = rec.el.anim.update?.durationMs ?? 300;
    const anims = [...olds.map((o) => o.animate([{ opacity: 1 }, { opacity: 0 }], { duration: dur, fill: 'forwards' })), ...(img ? [img.animate([{ opacity: 0 }, { opacity: 1 }], { duration: dur, fill: 'backwards' })] : [])];
    let finished = false;
    const end = () => {
      for (const o of olds) o.remove();
      for (const a of anims) a.cancel();
    };
    Promise.all(anims.map((a) => a.finished))
      .then(() => {
        if (finished) return;
        finished = true;
        end();
        done();
      })
      .catch(() => {});
    return {
      cancel: () => {
        if (finished) return;
        finished = true;
        end();
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Visibility toggles (flag panel, possession, timeout pips, whole scorebug)
  // ---------------------------------------------------------------------------

  private cssKeyframes(clip: AnimationClip): Keyframe[] {
    let kfs = clip.keyframes;
    if (this.quality === 'low') kfs = kfs.map(({ glow: _g, brightness: _b, ...rest }) => rest);
    const css = keyframesToCss(kfs, { glowColor: resolveColor(clip.glowColor ?? '#ffffff', this.ctx()) });
    if (clip.origin) for (const k of css) k.transformOrigin = clip.origin;
    return css as Keyframe[];
  }

  private runToggle(rec: NodeRec, show: boolean, done: () => void, kind: 'vis' | 'dim'): Cancelable {
    const clip = show ? rec.el.anim.enter : rec.el.anim.exit;
    if (show) {
      if (kind === 'vis') rec.visShown = true;
      else rec.dimmed = false;
      this.updateDisplay(rec);
      this.updateOpacity(rec);
    }
    if (!clip || !clip.keyframes.length) {
      done();
      return { cancel() {} };
    }
    const anim = rec.tg.animate(this.cssKeyframes(clip), { duration: clip.durationMs, easing: easingToCss(clip.easing), fill: 'both' });
    let state: 'running' | 'done' = 'running';
    let onDone = done;
    anim.onfinish = () => {
      if (state === 'done') return;
      state = 'done';
      onDone();
      anim.cancel();
    };
    return {
      cancel: () => {
        state = 'done';
        anim.cancel();
      },
      reverse: (cb) => {
        if (state !== 'running') return false;
        onDone = cb;
        anim.reverse();
        return true;
      },
    };
  }

  private runRootVisibility(show: boolean, done: () => void): Cancelable {
    if (show) this.setStageShown(true);
    const tl = this.scene?.timelines.find((t) => t.trigger === (show ? 'entrance' : 'exit') && t.enabled);
    if (!tl || !tl.tracks.length) {
      const anim = this.stage.animate(show ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0 }], { duration: 350, easing: 'ease-out', fill: 'both' });
      let finished = false;
      let cb = done;
      anim.onfinish = () => {
        if (finished) return;
        finished = true;
        cb();
        anim.cancel();
      };
      return {
        cancel: () => {
          finished = true;
          anim.cancel();
        },
        reverse: (onDone) => {
          if (finished) return false;
          cb = onDone;
          anim.reverse();
          return true;
        },
      };
    }
    return this.playTimeline(tl, null, done, { restoreOnCancel: false });
  }

  // ---------------------------------------------------------------------------
  // Timelines
  // ---------------------------------------------------------------------------

  private playAccent(trigger: TimelineTrigger, team: TeamSide | null) {
    if (!this.stageShown || !this.scene) return;
    const tl = this.scene.timelines.find((t) => t.trigger === trigger && t.enabled);
    if (!tl) return;
    this.accents.get(trigger)?.cancel();
    let entry: PlayingTimeline | null = null;
    let finishedNow = false;
    const playing = this.playTimeline(tl, team, () => {
      finishedNow = true;
      if (entry && this.accents.get(trigger) === entry) this.accents.delete(trigger);
    });
    if (finishedNow) return;
    entry = { ...playing, trigger };
    this.accents.set(trigger, entry);
  }

  /**
   * Play an event timeline. The first track on each element fills backwards
   * (so it starts hidden during its delay); later tracks only fill forwards,
   * so sequential in/out tracks on one element hand over cleanly.
   */
  private playTimeline(tl: EventTimeline, team: TeamSide | null, onDone: () => void, opts: { restoreOnCancel?: boolean } = {}): Cancelable {
    const scene = this.scene;
    if (!scene) {
      onDone();
      return { cancel() {} };
    }
    const byRec = new Map<NodeRec, typeof tl.tracks>();
    for (const tr of tl.tracks) {
      for (const id of resolveTrackTargets(scene, tr.elementId, team)) {
        const rec = this.nodes.get(id);
        if (!rec) continue;
        const list = byRec.get(rec) ?? [];
        list.push(tr);
        byRec.set(rec, list);
      }
    }
    // Reveal rest-hidden targets and their rest-hidden ancestors for the duration.
    const revealed: NodeRec[] = [];
    for (const rec of byRec.keys()) {
      for (const r of [rec, ...ancestors(scene, rec.el.id).map((a) => this.nodes.get(a.id)!).filter(Boolean)]) {
        if (r.el.restHidden && !revealed.includes(r)) revealed.push(r);
      }
    }
    for (const r of revealed) {
      r.reveal++;
      this.updateDisplay(r);
    }
    const anims: Animation[] = [];
    for (const [rec, tracks] of byRec) {
      tracks.sort((a, b) => a.startMs - b.startMs);
      tracks.forEach((tr, i) => {
        const a = rec.tl.animate(this.cssKeyframes(tr.clip), {
          duration: Math.max(1, tr.clip.durationMs),
          delay: tr.startMs,
          easing: easingToCss(tr.clip.easing),
          fill: i === 0 ? 'both' : 'forwards',
        });
        anims.push(a);
      });
    }
    let state: 'running' | 'done' = 'running';
    let doneCb = onDone;
    const release = () => {
      for (const a of anims) a.cancel();
      for (const r of revealed) {
        r.reveal = Math.max(0, r.reveal - 1);
        this.updateDisplay(r);
      }
    };
    if (!anims.length) {
      release();
      onDone();
      return { cancel() {} };
    }
    Promise.all(anims.map((a) => a.finished))
      .then(() => {
        if (state !== 'running') return;
        state = 'done';
        // Settle state first (e.g. hide the stage after an exit), then drop the fills.
        doneCb();
        release();
      })
      .catch(() => {});
    return {
      cancel: () => {
        if (state !== 'running') return;
        state = 'done';
        release();
        // Elements that are normally on screen fade back in instead of popping.
        if (opts.restoreOnCancel !== false) {
          for (const rec of byRec.keys()) {
            if (!rec.el.restHidden && rec.outer.style.display !== 'none') rec.outer.animate([{ opacity: 0 }, { opacity: Number(rec.outer.style.opacity || 1) }], { duration: RESTORE_FADE_MS, easing: 'ease-out' });
          }
        }
      },
      reverse: (cb) => {
        if (state !== 'running') return false;
        doneCb = cb;
        for (const a of anims) a.reverse();
        return true;
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Clocks, fonts, frame loop
  // ---------------------------------------------------------------------------

  private loop(t: number) {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.loop);
    if (this.state) {
      const c = clockStrings(this.state, this.opts.now());
      if (c.game !== this.clocks.game || c.play !== this.clocks.play) {
        this.clocks = c;
        const ctx = this.ctx()!;
        for (const rec of this.nodes.values()) if (rec.clockBound) this.applyBindings(rec, ctx, false);
      }
    }
    this.monitorFrames(t);
  }

  /** Drop expensive filters if the machine cannot hold frame rate during animations. */
  private monitorFrames(t: number) {
    if (this.opts.mode !== 'overlay' || this.quality === 'low') {
      this.lastFrame = t;
      return;
    }
    const dt = t - this.lastFrame;
    this.lastFrame = t;
    const animating = document.getAnimations().length > 0;
    if (!animating || dt > 500) return;
    this.frameSamples.push(dt);
    if (this.frameSamples.length > 90) this.frameSamples.shift();
    if (this.frameSamples.length === 90) {
      const avg = this.frameSamples.reduce((a, b) => a + b, 0) / 90;
      if (avg > 28) {
        this.quality = 'low';
        this.root.dataset.quality = 'low';
        for (const rec of this.nodes.values()) this.applyStatic(rec, true);
        this.opts.onQualityChange?.('low');
      }
    }
  }

  private loadFonts(scene: Scene) {
    for (const f of scene.fonts) {
      const key = `${f.family}|${f.assetId}`;
      if (this.loadedFonts.has(key)) continue;
      this.loadedFonts.add(key);
      try {
        const face = new FontFace(f.family, `url(${this.opts.assetUrl(f.assetId)})`);
        document.fonts.add(face);
        face.load().then(
          () => this.refit(),
          () => this.opts.onMissingAsset?.(f.assetId),
        );
      } catch {
        this.opts.onMissingAsset?.(f.assetId);
      }
    }
    document.fonts?.ready.then(() => this.refit());
  }

  /** Re-measure text after web fonts load (widths change). */
  refit() {
    for (const rec of this.nodes.values()) {
      if (!rec.textHost) continue;
      for (const span of rec.textHost.querySelectorAll<HTMLElement>('.bf-tv')) this.fitText(rec, span);
    }
  }
}
