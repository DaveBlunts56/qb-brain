import { describe, expect, it } from 'vitest';
import {
  buildClip,
  createElement,
  createFootballTemplateBase,
  createFootballTemplateScene,
  createSampleGameState,
  createScene,
  duplicateElements,
  eventContextFor,
  generateAnimations,
  groupElements,
  hitTestScene,
  keyframesToCss,
  normalizeKeyframes,
  removeElements,
  reorderElement,
  resolveBindings,
  resolveColor,
  resolveTrackTargets,
  snapRect,
  TEMPLATE_HOME,
  TEMPLATE_AWAY,
  validateScene,
  type BindingContext,
} from '../src/index.js';

const ctx = (): BindingContext => ({
  state: createSampleGameState(TEMPLATE_HOME, TEMPLATE_AWAY),
  clocks: { game: '7:42', play: '25' },
  event: null,
});

describe('bindings', () => {
  it('resolves text, image, fill and visibility bindings', () => {
    const c = ctx();
    const score = createElement('text', { bindings: [{ field: 'home.score', target: 'text', format: '{value} PTS' }] });
    expect(resolveBindings(score, c).text).toBe('21 PTS');
    const logo = createElement('image', { bindings: [{ field: 'away.logo', target: 'image' }] });
    expect(resolveBindings(logo, c).imageAssetId).toBe(TEMPLATE_AWAY.logoAssetId);
    const pip = createElement('rect', { bindings: [{ field: 'home.timeouts', target: 'visible', index: 3, mode: 'dim', dimOpacity: 0.2 }] });
    expect(resolveBindings(pip, c)).toMatchObject({ visible: true, dim: 0.2 }); // home has 2 timeouts
    const poss = createElement('rect', { bindings: [{ field: 'away.hasPossession', target: 'visible', mode: 'hide' }] });
    expect(resolveBindings(poss, c).visible).toBe(false);
    const dd = createElement('text', { bindings: [{ field: 'downDistance', target: 'text' }] });
    expect(resolveBindings(dd, c).text).toBe('3RD & 6');
    const ball = createElement('text', { bindings: [{ field: 'ballOn', target: 'text' }] });
    expect(resolveBindings(ball, c).text).toBe('BAY 34');
  });

  it('flag hides the down & distance', () => {
    const c = ctx();
    c.state.flag = true;
    const dd = createElement('text', { bindings: [{ field: 'showSituation', target: 'visible' }] });
    expect(resolveBindings(dd, c).visible).toBe(false);
  });

  it('resolves colour tokens including the event team', () => {
    const c = ctx();
    expect(resolveColor('$home.primary', c)).toBe(TEMPLATE_HOME.primaryColor);
    expect(resolveColor('$possession.secondary', c)).toBe(TEMPLATE_HOME.secondaryColor);
    expect(resolveColor('#123456', c)).toBe('#123456');
    c.event = eventContextFor('touchdown', 'away');
    expect(resolveColor('$event.primary', c)).toBe(TEMPLATE_AWAY.primaryColor);
    expect(c.event.title).toBe('TOUCHDOWN');
    const title = createElement('text', { bindings: [{ field: 'event.team.fullName', target: 'text' }] });
    expect(resolveBindings(title, c).text).toBe('Bayview Mariners');
  });
});

describe('scene tree & geometry', () => {
  it('groups, duplicates, reorders and removes', () => {
    const scene = createScene();
    const a = createElement('rect', { x: 0, y: 0, width: 10, height: 10 });
    const b = createElement('rect', { x: 20, y: 20, width: 10, height: 10 });
    const c = createElement('rect', { x: 50, y: 0, width: 10, height: 10 });
    scene.elements.push(a, b, c);
    const g = groupElements(scene, [a.id, b.id], 'AB')!;
    const group = scene.elements.find((e) => e.id === g)!;
    expect(group).toMatchObject({ x: 0, y: 0, width: 30, height: 30 });
    expect(scene.elements.map((e) => e.id)).toEqual([g, a.id, b.id, c.id]);
    const [copy] = duplicateElements(scene, [g]);
    expect(scene.elements.filter((e) => e.parentId === copy)).toHaveLength(2);
    reorderElement(scene, c.id, 'back');
    expect(scene.elements[0]!.id).toBe(c.id);
    removeElements(scene, [g]);
    expect(scene.elements.some((e) => e.id === a.id)).toBe(false);
  });

  it('hit-tests the topmost visible, unlocked element accounting for rotation and ellipses', () => {
    const scene = createScene();
    const bottom = createElement('rect', { x: 0, y: 0, width: 100, height: 100 });
    const top = createElement('ellipse', { x: 0, y: 0, width: 100, height: 100 });
    scene.elements.push(bottom, top);
    expect(hitTestScene(scene, { x: 50, y: 50 })?.id).toBe(top.id);
    expect(hitTestScene(scene, { x: 3, y: 3 })?.id).toBe(bottom.id); // outside the ellipse corner
    top.locked = true;
    expect(hitTestScene(scene, { x: 50, y: 50 })?.id).toBe(bottom.id);
    const rotated = createElement('rect', { x: 200, y: 200, width: 100, height: 10, rotation: 90 });
    scene.elements.push(rotated);
    expect(hitTestScene(scene, { x: 250, y: 250 })?.id).toBe(rotated.id);
    expect(hitTestScene(scene, { x: 205, y: 205 })).toBeNull();
  });

  it('snaps to nearby edges within threshold', () => {
    const r = snapRect({ x: 103, y: 50, width: 40, height: 40 }, { xs: [100], ys: [0] }, 6);
    expect(r.dx).toBe(-3);
    expect(r.dy).toBe(0);
    expect(r.guides).toEqual([{ axis: 'x', pos: 100 }]);
  });
});

describe('animation presets & css', () => {
  it('fills missing keyframe properties by interpolation', () => {
    const n = normalizeKeyframes([{ offset: 0, opacity: 0, y: 40 }, { offset: 0.5, opacity: 1 }, { offset: 1, y: 0 }]);
    expect(n[1]!.y).toBe(20);
    expect(n[2]!.opacity).toBe(1);
  });

  it('produces consistent WAAPI keyframes', () => {
    const clip = buildClip('slideIn', { direction: 'left', distance: 100 });
    const css = keyframesToCss(clip.keyframes);
    expect(css[0]).toMatchObject({ offset: 0, opacity: 0, transform: 'translate(-100px, 0px) scale(1, 1) rotate(0deg)' });
    expect(css.at(-1)).toMatchObject({ offset: 1, opacity: 1, transform: 'translate(0px, 0px) scale(1, 1) rotate(0deg)' });
    const wipe = keyframesToCss(buildClip('wipeIn', { direction: 'left' }).keyframes);
    expect(wipe[0]!.clipPath).toBe('inset(0% 100% 0% 0%)');
    const glow = keyframesToCss(buildClip('glow').keyframes, { glowColor: '#ff0000' });
    expect(String(glow[1]!.filter)).toContain('#ff0000');
  });
});

describe('animation generator', () => {
  it('builds role-aware animations, timelines and missing components', () => {
    const { scene, report } = generateAnimations(createFootballTemplateBase());
    const score = scene.elements.find((e) => e.role === 'homeScore')!;
    expect(score.anim.update?.style).toBe('roll');
    const flag = scene.elements.find((e) => e.role === 'flag');
    expect(flag?.anim.enter?.preset).toBe('wipeIn');
    const triggers = scene.timelines.map((t) => t.trigger);
    for (const t of ['entrance', 'exit', 'touchdown', 'fieldGoal', 'safety', 'periodChange', 'possessionChange', 'timeout']) expect(triggers).toContain(t);
    expect(report.created.length).toBeGreaterThanOrEqual(3);
    // Every track points at an existing element or a known alias.
    for (const tl of scene.timelines)
      for (const tr of tl.tracks) {
        if (tr.elementId.startsWith('@')) continue;
        expect(scene.elements.some((e) => e.id === tr.elementId)).toBe(true);
      }
  });

  it('possession arrows travel towards the other team', () => {
    const { scene } = generateAnimations(createFootballTemplateBase());
    const away = scene.elements.find((e) => e.role === 'awayPossession')!; // away is on the left
    expect(away.anim.exit?.params.direction).toBe('right');
    const home = scene.elements.find((e) => e.role === 'homePossession')!;
    expect(home.anim.enter?.params.direction).toBe('left');
  });

  it('respects overwrite=false', () => {
    const base = createFootballTemplateBase();
    const custom = generateAnimations(base).scene;
    const score = custom.elements.find((e) => e.role === 'homeScore')!;
    score.anim.update!.style = 'flip';
    const again = generateAnimations(custom, { overwrite: false });
    expect(again.scene.elements.find((e) => e.role === 'homeScore')!.anim.update!.style).toBe('flip');
    expect(again.report.kept).toContain('Touchdown');
  });

  it('resolves team-relative track aliases', () => {
    const scene = createFootballTemplateScene();
    expect(resolveTrackTargets(scene, '@event.score', 'home')).toHaveLength(1);
    expect(resolveTrackTargets(scene, '@event.timeouts', 'away')).toHaveLength(3);
    expect(resolveTrackTargets(scene, '@event.score', null)).toEqual([]);
    expect(resolveTrackTargets(scene, '@bug', null).length).toBeGreaterThan(2);
  });
});

describe('football template', () => {
  it('is a valid scene at 1080p and 720p', () => {
    for (const [w, h] of [
      [1920, 1080],
      [1280, 720],
    ] as const) {
      const s = createFootballTemplateScene(w, h);
      const v = validateScene(JSON.parse(JSON.stringify(s)));
      expect(v.ok, v.ok ? '' : v.error).toBe(true);
      expect(s.width).toBe(w);
      for (const el of s.elements) {
        expect(el.x + el.width).toBeLessThanOrEqual(w);
        expect(el.y + el.height).toBeLessThanOrEqual(h);
      }
    }
  });

  it('maps every core football role', () => {
    const s = createFootballTemplateScene();
    const roles = new Set(s.elements.map((e) => e.role));
    for (const r of ['homeScore', 'awayScore', 'homeAbbr', 'awayAbbr', 'homeLogo', 'awayLogo', 'gameClock', 'playClock', 'period', 'downDistance', 'ballOn', 'homePossession', 'awayPossession', 'homeTimeout', 'awayTimeout', 'flag'])
      expect(roles.has(r as never), r).toBe(true);
  });

  it('rejects malformed scenes', () => {
    expect(validateScene({}).ok).toBe(false);
    const s = createFootballTemplateScene();
    s.elements.push({ ...s.elements[0]! });
    expect(validateScene(s).ok).toBe(false);
  });
});
