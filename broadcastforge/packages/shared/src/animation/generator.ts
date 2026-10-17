import { createId } from '../util/id.js';
import { createElement, defaultTextProps, DEFAULT_FONT } from '../scene/factory.js';
import { ROLE_MAP, roleTeam, type FieldRole } from '../scene/roles.js';
import { boundsOf } from '../scene/tree.js';
import { rotatedBounds, type Rect } from '../scene/geometry.js';
import type { GraphicElement, Scene } from '../scene/types.js';
import { buildClip, type Direction } from './presets.js';
import { bugRoots } from './targets.js';
import type { AnimationClip, EventTimeline, ParamValue, TimelineTrack, TimelineTrigger, UpdateAnimation } from './types.js';

/**
 * The Animation Generator proposes broadcast-style motion from the
 * *semantic roles* assigned in Make It Live. It does not (and cannot)
 * recover animation from static artwork: everything here follows explicit,
 * documented rules that users can then edit in the timeline editor.
 */

export interface GeneratorOptions {
  intensity: 'subtle' | 'standard' | 'bold';
  /** replace: the scorebug exits and the TD graphic takes its place. above: TD banner sits above the bug. */
  touchdownStyle: 'replace' | 'above';
  /** Create TD takeover / event banner / flag panel / light sweep when missing. */
  createMissing: boolean;
  /** Replace animations that already exist (otherwise only fill gaps). */
  overwrite: boolean;
}

export const DEFAULT_GENERATOR_OPTIONS: GeneratorOptions = {
  intensity: 'standard',
  touchdownStyle: 'replace',
  createMissing: true,
  overwrite: true,
};

export interface GeneratorReport {
  created: string[];
  animated: string[];
  timelines: string[];
  kept: string[];
  warnings: string[];
}

export const TAKEOVER_PRIORITY: Partial<Record<TimelineTrigger, number>> = {
  touchdown: 100,
  safety: 90,
  fieldGoal: 80,
  twoPoint: 70,
  extraPoint: 60,
  turnover: 50,
  penalty: 40,
  timeout: 30,
  firstDown: 20,
  custom: 10,
};

interface Ctx {
  scene: Scene;
  opts: GeneratorOptions;
  report: GeneratorReport;
  t: number; // duration factor
  d: number; // distance factor
}

const clip = (c: Ctx, preset: string, params: Record<string, ParamValue> = {}, durationMs?: number, easing?: string): AnimationClip => {
  const scaled: Record<string, ParamValue> = { ...params };
  if (typeof scaled.distance === 'number') scaled.distance = Math.round(scaled.distance * c.d);
  const base = buildClip(preset, scaled);
  return { ...base, durationMs: Math.round((durationMs ?? base.durationMs) * c.t), easing: easing ?? base.easing };
};

const track = (elementId: string, startMs: number, c: AnimationClip): TimelineTrack => ({ id: createId('tr'), elementId, startMs: Math.round(startMs), clip: c });

const byRole = (scene: Scene, role: FieldRole) => scene.elements.filter((e) => e.role === role);
const center = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

export function generateAnimations(input: Scene, options: Partial<GeneratorOptions> = {}): { scene: Scene; report: GeneratorReport } {
  const scene = structuredClone(input);
  const opts = { ...DEFAULT_GENERATOR_OPTIONS, ...options };
  const report: GeneratorReport = { created: [], animated: [], timelines: [], kept: [], warnings: [] };
  const factors = { subtle: { t: 0.8, d: 0.6 }, standard: { t: 1, d: 1 }, bold: { t: 1.15, d: 1.6 } }[opts.intensity];
  const c: Ctx = { scene, opts, report, ...factors };

  const mapped = scene.elements.filter((e) => e.role);
  if (!mapped.length) report.warnings.push('No elements have live roles yet. Run Make It Live first for role-aware animations.');

  const bug = bugBounds(scene);
  if (!bug) report.warnings.push('The scene has no visible scorebug elements; graphics were placed at a default position.');
  const bugRect: Rect = bug ?? { x: scene.width * 0.2, y: scene.height * 0.85, width: scene.width * 0.6, height: scene.height * 0.075 };

  if (opts.createMissing) {
    ensureFlagPanel(c, bugRect);
    ensureEventBanner(c, bugRect);
    ensureTdTakeover(c, bugRect);
    const period = byRole(scene, 'period')[0];
    if (period) ensureSweep(c, period);
  }

  elementAnimations(c);
  timelines(c, bugRect);
  return { scene, report };
}

/**
 * Where the resting scorebug is. Live (role-mapped) elements define it best;
 * a flattened base image usually spans the whole canvas, so it is only used
 * when nothing else is available.
 */
export function bugBounds(scene: Scene): Rect | null {
  const usable = (e: GraphicElement) => e.visible && !e.restHidden && !e.meta?.component && !e.role?.startsWith('event');
  const live = scene.elements.filter((e) => e.role && usable(e) && e.type !== 'group');
  const liveBounds = live.length >= 2 ? boundsOf(live.map((e) => rotatedBounds(e))) : null;
  if (liveBounds) return liveBounds;
  const roots = scene.elements.filter((e) => e.parentId === null && usable(e));
  const nonBase = roots.filter((e) => !e.meta?.isBaseArt);
  const b = boundsOf((nonBase.length ? nonBase : roots).map((e) => rotatedBounds(e)));
  // A full-canvas base image says nothing about where the bug is.
  if (b && b.width >= scene.width * 0.95 && b.height >= scene.height * 0.9) return liveBounds ?? null;
  return b;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// ---------------------------------------------------------------------------
// Per-element update / enter / exit animations
// ---------------------------------------------------------------------------

function updateAnim(c: Ctx, style: UpdateAnimation['style'], extra: Partial<UpdateAnimation> = {}): UpdateAnimation {
  return {
    style,
    direction: 'up',
    durationMs: Math.round((extra.durationMs ?? 450) * c.t),
    easing: 'easeOutCubic',
    highlight: 'none',
    highlightColor: '#ffffff',
    highlightMs: 600,
    ...extra,
    ...(extra.durationMs ? { durationMs: Math.round(extra.durationMs * c.t) } : {}),
  };
}

function teamCenterX(scene: Scene, side: 'home' | 'away'): number | null {
  const els = scene.elements.filter((e) => roleTeam(e.role) === side && e.role !== `${side}Possession`);
  const b = boundsOf(els.map((e) => rotatedBounds(e)));
  return b ? center(b).x : null;
}

function elementAnimations(c: Ctx) {
  const { scene, opts, report } = c;
  for (const el of scene.elements) {
    if (!el.role) continue;
    const before = JSON.stringify(el.anim);
    const role = el.role;
    const setUpdate = (u: UpdateAnimation | null) => {
      if (opts.overwrite || !el.anim.update) el.anim.update = u;
    };
    const setEnterExit = (enter: AnimationClip | null, exit: AnimationClip | null) => {
      if (opts.overwrite || !el.anim.enter) el.anim.enter = enter;
      if (opts.overwrite || !el.anim.exit) el.anim.exit = exit;
    };
    switch (role) {
      case 'homeScore':
      case 'awayScore':
        // Previous digits roll out, new digits roll in, then a brief pulse.
        setUpdate(updateAnim(c, 'roll', { direction: 'up', durationMs: 550, easing: 'easeOutCubic', highlight: 'pulse', highlightMs: 500 }));
        break;
      case 'period':
        setUpdate(updateAnim(c, 'flip', { durationMs: 500, easing: 'easeOutCubic' }));
        break;
      case 'down':
      case 'distance':
      case 'downDistance':
      case 'ballOn':
        setUpdate(updateAnim(c, 'slide', { direction: 'up', durationMs: 380 }));
        setEnterExit(clip(c, 'fadeIn', {}, 250), clip(c, 'fadeOut', {}, 200));
        break;
      case 'homeAbbr':
      case 'awayAbbr':
      case 'homeName':
      case 'awayName':
      case 'homeRecord':
      case 'awayRecord':
      case 'label':
      case 'homeLogo':
      case 'awayLogo':
        setUpdate(updateAnim(c, 'fade', { durationMs: 400, easing: 'easeInOut' }));
        break;
      case 'homePanel':
      case 'awayPanel':
        setUpdate(updateAnim(c, 'fade', { durationMs: 500, easing: 'easeInOut' }));
        break;
      case 'gameClock':
      case 'playClock':
        setUpdate(null);
        setEnterExit(clip(c, 'fadeIn', {}, 250), clip(c, 'fadeOut', {}, 200));
        break;
      case 'homePossession':
      case 'awayPossession': {
        const side = role === 'homePossession' ? 'home' : 'away';
        const other = side === 'home' ? 'away' : 'home';
        const me = center(rotatedBounds(el)).x;
        const otherX = byRole(scene, `${other}Possession`)[0] ? center(rotatedBounds(byRole(scene, `${other}Possession`)[0]!)).x : teamCenterX(scene, other);
        const towardsOther: Direction = otherX !== null && otherX < me ? 'left' : 'right';
        // The indicator travels across: it leaves towards the other team and arrives from the other team's side.
        setEnterExit(clip(c, 'slideIn', { direction: towardsOther, distance: 60 }, 380), clip(c, 'slideOut', { direction: towardsOther, distance: 60 }, 300));
        break;
      }
      case 'homeTimeout':
      case 'awayTimeout':
        // Used timeouts pulse before dimming; restored timeouts flash back in.
        setEnterExit(clip(c, 'flash', { intensity: 2 }, 400), clip(c, 'pulse', { scale: 1.6 }, 600));
        break;
      case 'flag':
        setEnterExit(clip(c, 'wipeIn', { direction: 'left' }, 350), clip(c, 'wipeOut', { direction: 'right' }, 280));
        break;
      default:
        break;
    }
    if (JSON.stringify(el.anim) !== before) report.animated.push(`${el.name} (${ROLE_MAP[role]?.label ?? role})`);
  }
}

// ---------------------------------------------------------------------------
// Event timelines
// ---------------------------------------------------------------------------

function putTimeline(c: Ctx, tl: Omit<EventTimeline, 'id' | 'enabled'>) {
  const existing = c.scene.timelines.filter((t) => t.trigger === tl.trigger);
  if (existing.length && !c.opts.overwrite) {
    c.report.kept.push(tl.name);
    return;
  }
  c.scene.timelines = c.scene.timelines.filter((t) => t.trigger !== tl.trigger);
  c.scene.timelines.push({ ...tl, id: createId('tl'), enabled: true });
  c.report.timelines.push(tl.name);
}

function partOf(scene: Scene, component: string, part: string): GraphicElement | undefined {
  return scene.elements.find((e) => e.meta?.component === component && e.meta?.part === part);
}

function timelines(c: Ctx, bug: Rect) {
  const { scene } = c;
  const roots = bugRoots(scene).sort((a, b) => a.x - b.x);
  const rise = Math.max(24, Math.round(bug.height * 0.6));

  // Scorebug entrance: coordinated slide up + fade, staggered left to right.
  putTimeline(c, {
    name: 'Scorebug entrance',
    trigger: 'entrance',
    mode: 'visibility',
    priority: 0,
    tracks: roots.map((el, i) => track(el.id, i * 60 * c.t, clip(c, 'slideIn', { direction: 'down', distance: rise }, 450, 'easeOutCubic'))),
  });
  // Scorebug exit: reverse order, quicker.
  putTimeline(c, {
    name: 'Scorebug exit',
    trigger: 'exit',
    mode: 'visibility',
    priority: 0,
    tracks: [...roots].reverse().map((el, i) => track(el.id, i * 40 * c.t, clip(c, 'slideOut', { direction: 'down', distance: rise }, 300, 'easeInCubic'))),
  });

  // Score change accent: brief team-colour flash on the scoring team's panel.
  putTimeline(c, {
    name: 'Score change highlight',
    trigger: 'scoreChange',
    mode: 'accent',
    priority: 0,
    tracks: [track('@event.panel', 0, clip(c, 'flash', { intensity: 1.7 }, 700)), track('@event.score', 120, clip(c, 'glow', { size: 16, color: '#ffffff' }, 800))],
  });

  // Quarter change: the period text flips (update animation) and a light sweep crosses it.
  const sweep = partOf(scene, 'sweep', 'shine');
  const period = byRole(scene, 'period')[0];
  if (period) {
    const tracks: TimelineTrack[] = [track(period.id, 150, clip(c, 'flash', { intensity: 1.4 }, 500))];
    if (sweep) tracks.push(track(sweep.id, 250, clip(c, 'sweep', { distance: Math.round(period.width * 0.9) }, 750)));
    putTimeline(c, { name: 'Quarter change sweep', trigger: 'periodChange', mode: 'accent', priority: 0, tracks });
  }

  // Possession change: the new team's panel brightens as the arrow arrives.
  putTimeline(c, {
    name: 'Possession change accent',
    trigger: 'possessionChange',
    mode: 'accent',
    priority: 0,
    tracks: [track('@event.panel', 200, clip(c, 'flash', { intensity: 1.35 }, 500))],
  });

  touchdownTimeline(c, roots, bug);
  bannerTimelines(c);
}

function touchdownTimeline(c: Ctx, roots: GraphicElement[], bug: Rect) {
  const { scene } = c;
  const part = (p: string) => partOf(scene, 'tdTakeover', p);
  const panel = part('panel');
  const title = part('title');
  if (!panel || !title) {
    c.report.warnings.push('No touchdown graphic found: the TOUCHDOWN timeline only highlights the scoring team.');
    putTimeline(c, {
      name: 'Touchdown',
      trigger: 'touchdown',
      mode: 'takeover',
      priority: TAKEOVER_PRIORITY.touchdown!,
      tracks: [track('@event.panel', 0, clip(c, 'flash', { intensity: 2 }, 900)), track('@event.score', 0, clip(c, 'glow', { size: 24 }, 1200))],
    });
    return;
  }
  const t = c.t;
  const hold = 4300 * t;
  const tracks: TimelineTrack[] = [];
  const replace = c.opts.touchdownStyle === 'replace';
  if (replace) {
    // The scorebug animates away, the team panel expands into its place...
    roots.forEach((el, i) => tracks.push(track(el.id, i * 25 * t, clip(c, 'slideOut', { direction: 'down', distance: Math.round(bug.height * 0.8) }, 320, 'easeInCubic'))));
  } else {
    tracks.push(track('@event.panel', 0, clip(c, 'flash', { intensity: 1.8 }, 700)));
  }
  const start = replace ? 220 * t : 0;
  tracks.push(track(panel.id, start, clip(c, 'expandIn', { axis: 'x', from: 'center' }, 480, 'easeOutExpo')));
  const stripe = part('stripe');
  if (stripe) tracks.push(track(stripe.id, start + 280 * t, clip(c, 'wipeIn', { direction: 'left' }, 420)));
  const logo = part('logo');
  if (logo) tracks.push(track(logo.id, start + 380 * t, clip(c, 'scaleIn', { from: 0.2 }, 480, 'backOut')));
  tracks.push(track(title.id, start + 420 * t, clip(c, 'slideIn', { direction: 'right', distance: 160 }, 520, 'easeOutExpo')));
  tracks.push(track(title.id, start + 1050 * t, clip(c, 'glow', { size: 22, color: '$event.secondary' }, 900)));
  const name = part('team');
  if (name) tracks.push(track(name.id, start + 700 * t, clip(c, 'slideIn', { direction: 'down', distance: 16 }, 400)));
  const shine = part('shine');
  if (shine) tracks.push(track(shine.id, start + 1000 * t, clip(c, 'sweep', { distance: Math.round(panel.width * 0.6) }, 900)));
  // ...hold, then everything leaves and the regular scorebug returns.
  tracks.push(track(title.id, hold, clip(c, 'slideOut', { direction: 'left', distance: 120 }, 300)));
  if (name) tracks.push(track(name.id, hold, clip(c, 'fadeOut', {}, 220)));
  if (logo) tracks.push(track(logo.id, hold, clip(c, 'scaleOut', { to: 0.3 }, 260)));
  if (stripe) tracks.push(track(stripe.id, hold + 60 * t, clip(c, 'wipeOut', { direction: 'right' }, 260)));
  tracks.push(track(panel.id, hold + 180 * t, clip(c, 'collapseOut', { axis: 'x', to: 'center' }, 320)));
  if (replace) {
    roots.forEach((el, i) => tracks.push(track(el.id, hold + 420 * t + i * 40 * t, clip(c, 'slideIn', { direction: 'down', distance: Math.round(bug.height * 0.8) }, 420, 'easeOutCubic'))));
  }
  putTimeline(c, { name: 'Touchdown', trigger: 'touchdown', mode: 'takeover', priority: TAKEOVER_PRIORITY.touchdown!, tracks });
}

function bannerTimelines(c: Ctx) {
  const { scene } = c;
  const part = (p: string) => partOf(scene, 'eventBanner', p);
  const panel = part('panel');
  const title = part('title');
  const defs: { trigger: TimelineTrigger; name: string; hold: number; accent?: 'score' | 'timeouts' }[] = [
    { trigger: 'fieldGoal', name: 'Field goal', hold: 2800, accent: 'score' },
    { trigger: 'safety', name: 'Safety', hold: 2800, accent: 'score' },
    { trigger: 'extraPoint', name: 'Extra point', hold: 2400, accent: 'score' },
    { trigger: 'twoPoint', name: '2-point conversion', hold: 2600, accent: 'score' },
    { trigger: 'firstDown', name: 'First down', hold: 1800 },
    { trigger: 'turnover', name: 'Turnover', hold: 2600 },
    { trigger: 'timeout', name: 'Timeout', hold: 2400, accent: 'timeouts' },
    { trigger: 'penalty', name: 'Penalty banner', hold: 2400 },
    { trigger: 'custom', name: 'Custom banner', hold: 3500 },
  ];
  for (const def of defs) {
    const t = c.t;
    const tracks: TimelineTrack[] = [];
    if (panel && title) {
      const hold = def.hold * t;
      tracks.push(track(panel.id, 0, clip(c, 'expandIn', { axis: 'x', from: 'center' }, 360, 'easeOutExpo')));
      const stripe = part('stripe');
      const logo = part('logo');
      if (stripe) tracks.push(track(stripe.id, 160 * t, clip(c, 'wipeIn', { direction: 'left' }, 320)));
      if (logo) tracks.push(track(logo.id, 200 * t, clip(c, 'scaleIn', { from: 0.3 }, 380, 'backOut')));
      tracks.push(track(title.id, 220 * t, clip(c, 'slideIn', { direction: 'down', distance: 18 }, 380)));
      tracks.push(track(title.id, hold, clip(c, 'fadeOut', {}, 200)));
      if (logo) tracks.push(track(logo.id, hold, clip(c, 'scaleOut', { to: 0.4 }, 220)));
      if (stripe) tracks.push(track(stripe.id, hold + 40 * t, clip(c, 'wipeOut', { direction: 'right' }, 220)));
      tracks.push(track(panel.id, hold + 120 * t, clip(c, 'collapseOut', { axis: 'x', to: 'center' }, 280)));
    }
    if (def.accent === 'score') {
      // Field goal: accent flash on the scoring team.
      tracks.push(track('@event.panel', 250 * t, clip(c, 'flash', { intensity: 1.9 }, 600)));
      tracks.push(track('@event.score', 300 * t, clip(c, 'glow', { size: 18 }, 900)));
    }
    if (def.accent === 'timeouts') tracks.push(track('@event.timeouts', 0, clip(c, 'pulse', { scale: 1.5 }, 500)));
    if (!tracks.length) continue;
    putTimeline(c, { name: def.name, trigger: def.trigger, mode: 'takeover', priority: TAKEOVER_PRIORITY[def.trigger] ?? 10, tracks });
  }
}

// ---------------------------------------------------------------------------
// Generated components
// ---------------------------------------------------------------------------

function hasComponent(scene: Scene, component: string) {
  return scene.elements.some((e) => e.meta?.component === component);
}

function group(name: string, r: Rect, component: NonNullable<GraphicElement['meta']>['component'], restHidden: boolean): GraphicElement {
  return createElement('group', { name, ...r, restHidden, meta: { source: 'generator', component } });
}

function ensureFlagPanel(c: Ctx, bug: Rect) {
  const { scene } = c;
  if (byRole(scene, 'flag').length || hasComponent(scene, 'flagPanel')) return;
  const situation = scene.elements.filter((e) => ['down', 'distance', 'downDistance', 'ballOn'].includes(e.role ?? ''));
  const fallbackW = Math.round(clamp(bug.height * 2.4, 120, scene.width * 0.25));
  const area = boundsOf(situation.map((e) => rotatedBounds(e))) ?? {
    x: Math.round(clamp(bug.x + bug.width + 8, 0, scene.width - fallbackW)),
    y: Math.round(clamp(bug.y, 0, scene.height - 40)),
    width: fallbackW,
    height: Math.round(clamp(bug.height, 30, 120)),
  };
  const g = group('Flag panel', area, 'flagPanel', false);
  g.role = 'flag';
  g.bindings = ROLE_MAP.flag.bindings();
  const bg = createElement('rect', { name: 'Flag background', parentId: g.id, ...area, fill: { type: 'linear', angle: 180, stops: [{ offset: 0, color: '#ffd84a' }, { offset: 1, color: '#f2b705' }] }, meta: { source: 'generator', component: 'flagPanel', part: 'panel' } });
  const txt = createElement('text', {
    name: 'FLAG text',
    parentId: g.id,
    ...area,
    text: defaultTextProps({ content: 'FLAG', color: '#111111', fontSize: Math.round(area.height * 0.62), fontWeight: 800, letterSpacing: 2, italic: true }),
    meta: { source: 'generator', component: 'flagPanel', part: 'title' },
  });
  scene.elements.push(g, bg, txt);
  c.report.created.push('Yellow FLAG panel over the down & distance area');
}

function ensureEventBanner(c: Ctx, bug: Rect) {
  const { scene } = c;
  if (hasComponent(scene, 'eventBanner')) return;
  const h = Math.round(clamp(bug.height * 0.75, 44, scene.height * 0.12));
  const w = Math.round(clamp(bug.width * 0.62, h * 6, scene.width * 0.45));
  const above = bug.y - h - 10 >= 0;
  const r: Rect = {
    x: Math.round(clamp(bug.x + (bug.width - w) / 2, 0, scene.width - w)),
    y: Math.round(clamp(above ? bug.y - h - 10 : bug.y + bug.height + 10, 0, scene.height - h)),
    width: w,
    height: h,
  };
  const meta = (part: string) => ({ source: 'generator' as const, component: 'eventBanner' as const, part });
  const g = group('Event banner', r, 'eventBanner', true);
  const panel = createElement('rect', {
    name: 'Banner panel',
    parentId: g.id,
    ...r,
    role: 'eventPanel',
    fill: { type: 'linear', angle: 90, stops: [{ offset: 0, color: '$event.secondary' }, { offset: 0.5, color: '$event.primary' }, { offset: 1, color: '$event.secondary' }] },
    radius: 4,
    shadow: { x: 0, y: 6, blur: 18, color: 'rgba(0,0,0,0.45)' },
    meta: meta('panel'),
  });
  const stripe = createElement('rect', { name: 'Banner stripe', parentId: g.id, x: r.x, y: r.y + r.height - 5, width: r.width, height: 5, fill: { type: 'solid', color: '#ffffff' }, meta: meta('stripe') });
  const logoSize = Math.round(h * 0.8);
  const logo = createElement('image', {
    name: 'Banner logo',
    parentId: g.id,
    x: r.x + 10,
    y: r.y + (h - logoSize) / 2,
    width: logoSize,
    height: logoSize,
    role: 'eventTeamLogo',
    bindings: ROLE_MAP.eventTeamLogo.bindings(),
    image: { assetId: null, fit: 'contain' },
    meta: meta('logo'),
  });
  const title = createElement('text', {
    name: 'Banner title',
    parentId: g.id,
    x: r.x + logoSize + 20,
    y: r.y,
    width: r.width - logoSize * 2 - 40,
    height: r.height,
    role: 'eventTitle',
    bindings: ROLE_MAP.eventTitle.bindings(),
    text: defaultTextProps({ content: 'FIELD GOAL', fontFamily: DEFAULT_FONT, fontSize: Math.round(h * 0.6), fontWeight: 800, color: '$event.text', italic: true, letterSpacing: 3 }),
    meta: meta('title'),
  });
  scene.elements.push(g, panel, logo, title, stripe);
  c.report.created.push(`Event banner ${above ? 'above' : 'below'} the scorebug (FIELD GOAL, SAFETY, TIMEOUT, custom text…)`);
}

function ensureTdTakeover(c: Ctx, bug: Rect) {
  const { scene, opts } = c;
  if (hasComponent(scene, 'tdTakeover')) return;
  const H = Math.round(clamp(bug.height * 1.9, 100, scene.height * 0.3));
  const fitX = (w: number) => Math.round(clamp(bug.x + (bug.width - w) / 2, 0, Math.max(0, scene.width - w)));
  let r: Rect;
  if (opts.touchdownStyle === 'replace') {
    const w = Math.round(clamp(bug.width, H * 4.5, scene.width));
    r = { x: fitX(w), y: Math.round(clamp(bug.y + bug.height - H, 0, scene.height - H)), width: w, height: H };
  } else {
    const w = Math.round(clamp(bug.width * 0.8, H * 4.5, scene.width));
    r = { x: fitX(w), y: Math.round(clamp(bug.y - H - 12, 0, scene.height - H)), width: w, height: H };
  }
  const meta = (part: string) => ({ source: 'generator' as const, component: 'tdTakeover' as const, part });
  const g = group('Touchdown takeover', r, 'tdTakeover', true);
  const panel = createElement('rect', {
    name: 'TD panel',
    parentId: g.id,
    ...r,
    role: 'eventPanel',
    fill: { type: 'linear', angle: 100, stops: [{ offset: 0, color: '$event.primary' }, { offset: 0.65, color: '$event.primary' }, { offset: 1, color: '$event.secondary' }] },
    radius: 6,
    shadow: { x: 0, y: 10, blur: 30, color: 'rgba(0,0,0,0.5)' },
    meta: meta('panel'),
  });
  const shine = createElement('rect', {
    name: 'TD shine',
    parentId: g.id,
    x: r.x + r.width / 2 - r.width * 0.12,
    y: r.y,
    width: r.width * 0.24,
    height: r.height,
    skewX: -20,
    fill: { type: 'linear', angle: 90, stops: [{ offset: 0, color: 'rgba(255,255,255,0)' }, { offset: 0.5, color: 'rgba(255,255,255,0.45)' }, { offset: 1, color: 'rgba(255,255,255,0)' }] },
    blendMode: 'screen',
    meta: meta('shine'),
  });
  const stripe = createElement('rect', { name: 'TD stripe', parentId: g.id, x: r.x, y: r.y + r.height - 8, width: r.width, height: 8, fill: { type: 'solid', color: '$event.secondary' }, meta: meta('stripe') });
  const logoSize = Math.round(H * 0.82);
  const logo = createElement('image', {
    name: 'TD logo',
    parentId: g.id,
    x: r.x + 18,
    y: r.y + (H - logoSize) / 2,
    width: logoSize,
    height: logoSize,
    role: 'eventTeamLogo',
    bindings: ROLE_MAP.eventTeamLogo.bindings(),
    image: { assetId: null, fit: 'contain' },
    meta: meta('logo'),
  });
  const textX = r.x + logoSize + 36;
  const textW = r.width - logoSize - 60;
  const title = createElement('text', {
    name: 'TOUCHDOWN text',
    parentId: g.id,
    x: textX,
    y: r.y + H * 0.08,
    width: textW,
    height: H * 0.62,
    role: 'eventTitle',
    bindings: ROLE_MAP.eventTitle.bindings(),
    text: defaultTextProps({ content: 'TOUCHDOWN', fontSize: Math.round(H * 0.56), fontWeight: 800, italic: true, letterSpacing: 4, color: '$event.text', align: 'left', shadow: { x: 0, y: 3, blur: 8, color: 'rgba(0,0,0,0.4)' } }),
    meta: meta('title'),
  });
  const team = createElement('text', {
    name: 'TD team name',
    parentId: g.id,
    x: textX,
    y: r.y + H * 0.66,
    width: textW,
    height: H * 0.24,
    role: 'eventTeamName',
    bindings: ROLE_MAP.eventTeamName.bindings(),
    text: defaultTextProps({ content: 'IRONWOOD FOXES', fontSize: Math.round(H * 0.19), fontWeight: 600, letterSpacing: 6, color: '$event.text', align: 'left' }),
    meta: meta('team'),
  });
  scene.elements.push(g, panel, shine, logo, title, team, stripe);
  c.report.created.push(`TOUCHDOWN takeover graphic (${opts.touchdownStyle === 'replace' ? 'replaces the scorebug' : 'above the scorebug'})`);
}

function ensureSweep(c: Ctx, period: GraphicElement) {
  const { scene } = c;
  if (hasComponent(scene, 'sweep')) return;
  const g = group('Quarter sweep', { x: period.x, y: period.y, width: period.width, height: period.height }, 'sweep', true);
  const shine = createElement('rect', {
    name: 'Sweep shine',
    parentId: g.id,
    x: period.x + period.width * 0.3,
    y: period.y,
    width: period.width * 0.4,
    height: period.height,
    skewX: -18,
    fill: { type: 'linear', angle: 90, stops: [{ offset: 0, color: 'rgba(255,255,255,0)' }, { offset: 0.5, color: 'rgba(255,255,255,0.7)' }, { offset: 1, color: 'rgba(255,255,255,0)' }] },
    blendMode: 'screen',
    meta: { source: 'generator', component: 'sweep', part: 'shine' },
  });
  scene.elements.push(g, shine);
  c.report.created.push('Light sweep over the quarter display');
}
