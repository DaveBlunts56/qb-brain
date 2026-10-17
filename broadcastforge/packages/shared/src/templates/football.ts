import { generateAnimations } from '../animation/generator.js';
import { createElement, createScene, defaultTextProps, scaleScene } from '../scene/factory.js';
import { ROLE_MAP, type FieldRole } from '../scene/roles.js';
import type { GraphicElement, Paint, Scene, TextProps } from '../scene/types.js';
import type { TeamInfo } from '../game/types.js';

/**
 * "Gridiron Pro" — an original American-football scorebug template.
 * Fictional teams, original geometric logos; not modelled on any network's
 * branding. Laid out for 1920x1080 and rescaled for 720p projects.
 */

export const TEMPLATE_ASSET_IDS = {
  homeLogo: 'asset_tpl_ironwood_fox',
  awayLogo: 'asset_tpl_bayview_anchor',
} as const;

export const TEMPLATE_HOME: TeamInfo = {
  name: 'Ironwood',
  mascot: 'Foxes',
  abbreviation: 'IRW',
  record: '7-1',
  primaryColor: '#e8692c',
  secondaryColor: '#13233f',
  textColor: '#ffffff',
  logoAssetId: TEMPLATE_ASSET_IDS.homeLogo,
};

export const TEMPLATE_AWAY: TeamInfo = {
  name: 'Bayview',
  mascot: 'Mariners',
  abbreviation: 'BAY',
  record: '6-2',
  primaryColor: '#138d90',
  secondaryColor: '#0a3d4f',
  textColor: '#ffffff',
  logoAssetId: TEMPLATE_ASSET_IDS.awayLogo,
};

const FOX_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<circle cx="50" cy="50" r="47" fill="#13233f" stroke="#ffffff" stroke-width="3"/>
<polygon points="20,18 40,37 60,37 80,18 77,53 50,86 23,53" fill="#e8692c"/>
<polygon points="25,26 36,38 27,43" fill="#13233f"/>
<polygon points="75,26 64,38 73,43" fill="#13233f"/>
<polygon points="29,52 50,86 71,52 50,63" fill="#ffffff"/>
<polygon points="34,47 44,46 41,52" fill="#13233f"/>
<polygon points="66,47 56,46 59,52" fill="#13233f"/>
<polygon points="45,76 55,76 50,83" fill="#13233f"/>
</svg>`;

const ANCHOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
<circle cx="50" cy="50" r="47" fill="#0a3d4f" stroke="#ffffff" stroke-width="3"/>
<circle cx="50" cy="23" r="7" fill="none" stroke="#7fe0d8" stroke-width="5"/>
<rect x="47" y="29" width="6" height="47" fill="#7fe0d8"/>
<rect x="33" y="37" width="34" height="6" rx="3" fill="#7fe0d8"/>
<path d="M22 57 Q25 79 50 79 Q75 79 78 57" fill="none" stroke="#7fe0d8" stroke-width="6" stroke-linecap="round"/>
<polygon points="15,62 22,50 29,62" fill="#7fe0d8"/>
<polygon points="71,62 78,50 85,62" fill="#7fe0d8"/>
<path d="M16 88 Q27 82 38 88 T60 88 T84 88" stroke="#138d90" stroke-width="4" fill="none"/>
</svg>`;

export const TEMPLATE_ASSETS = [
  { id: TEMPLATE_ASSET_IDS.homeLogo, name: 'Ironwood Foxes logo.svg', mime: 'image/svg+xml', content: FOX_SVG },
  { id: TEMPLATE_ASSET_IDS.awayLogo, name: 'Bayview Mariners logo.svg', mime: 'image/svg+xml', content: ANCHOR_SVG },
];

interface Builder {
  els: GraphicElement[];
}

function add(b: Builder, el: GraphicElement): GraphicElement {
  b.els.push(el);
  return el;
}

function withRole(el: GraphicElement, role: FieldRole, index?: number): GraphicElement {
  el.role = role;
  el.bindings = ROLE_MAP[role].bindings(index);
  return el;
}

const solid = (color: string): Paint => ({ type: 'solid', color });
const txt = (o: Partial<TextProps>): TextProps => defaultTextProps({ fontFamily: 'Barlow Condensed', ...o });
const SHADOW = { x: 0, y: 2, blur: 4, color: 'rgba(0,0,0,0.45)' };

function teamBlock(b: Builder, side: 'home' | 'away', x: number, y: number, h: number) {
  const W = 330;
  const g = add(b, createElement('group', { name: side === 'home' ? 'Home team' : 'Away team', x, y, width: W, height: h, meta: { source: 'template' } }));
  const p = g.id;
  const tok = (k: 'primary' | 'secondary' | 'text') => `$${side}.${k}`;
  add(
    b,
    withRole(
      createElement('rect', {
        name: `${side} colour panel`,
        parentId: p,
        x,
        y,
        width: W,
        height: h,
        fill: { type: 'linear', angle: 180, stops: [{ offset: 0, color: tok('primary') }, { offset: 1, color: tok('secondary') }] },
        meta: { source: 'template' },
      }),
      `${side}Panel`,
    ),
  );
  // The panel role normally binds fill to a solid colour; the template keeps its gradient via tokens instead.
  b.els[b.els.length - 1]!.bindings = [];
  add(b, createElement('rect', { name: `${side} logo plate`, parentId: p, x: x + 6, y: y + 6, width: h - 12, height: h - 12, radius: 6, fill: solid('rgba(255,255,255,0.12)') }));
  add(b, withRole(createElement('image', { name: `${side} logo`, parentId: p, x: x + 9, y: y + 9, width: h - 18, height: h - 18, image: { assetId: null, fit: 'contain' } }), `${side}Logo`));
  add(
    b,
    withRole(
      createElement('text', {
        name: `${side} abbreviation`,
        parentId: p,
        x: x + h + 6,
        y: y + 2,
        width: 128,
        height: 44,
        text: txt({ content: side === 'home' ? 'IRW' : 'BAY', fontSize: 42, fontWeight: 700, align: 'left', color: tok('text'), letterSpacing: 1, shadow: SHADOW }),
      }),
      `${side}Abbr`,
    ),
  );
  add(
    b,
    withRole(
      createElement('text', {
        name: `${side} record`,
        parentId: p,
        x: x + h + 7,
        y: y + 43,
        width: 90,
        height: 18,
        opacity: 0.85,
        text: txt({ content: '7-1', fontSize: 16, fontWeight: 600, align: 'left', color: tok('text'), letterSpacing: 1 }),
      }),
      `${side}Record`,
    ),
  );
  for (let i = 1; i <= 3; i++) {
    add(
      b,
      withRole(
        createElement('rect', {
          name: `${side} timeout ${i}`,
          parentId: p,
          x: x + h + 7 + (i - 1) * 34,
          y: y + h - 9,
          width: 28,
          height: 5,
          radius: 2,
          fill: solid('#ffd84a'),
        }),
        `${side}Timeout`,
        i,
      ),
    );
  }
  // Possession football
  const pg = add(b, createElement('group', { name: `${side} possession`, x: x + 206, y: y + 28, width: 22, height: 14 }));
  pg.parentId = p;
  withRole(pg, `${side}Possession`);
  add(b, createElement('ellipse', { name: 'football', parentId: pg.id, x: x + 206, y: y + 28, width: 22, height: 14, fill: solid('#8a4b22'), stroke: { color: '#ffffff', width: 1.5 } }));
  add(b, createElement('rect', { name: 'laces', parentId: pg.id, x: x + 212, y: y + 34, width: 10, height: 2, fill: solid('#ffffff') }));
  // Score
  add(b, createElement('rect', { name: `${side} score plate`, parentId: p, x: x + W - 96, y, width: 96, height: h, fill: solid('rgba(0,0,0,0.28)') }));
  add(
    b,
    withRole(
      createElement('text', {
        name: `${side} score`,
        parentId: p,
        x: x + W - 96,
        y,
        width: 96,
        height: h,
        text: txt({ content: side === 'home' ? '21' : '17', fontSize: 58, fontWeight: 700, color: '#ffffff', shadow: SHADOW }),
      }),
      `${side}Score`,
    ),
  );
}

export function createFootballTemplateBase(): Scene {
  const scene = createScene(1920, 1080);
  const b: Builder = { els: [] };
  const H = 72;
  const Y = 952;
  const X = 340;

  // Optional title tab (hidden while the "title" label is empty).
  const tab = add(b, createElement('group', { name: 'Title tab', x: X, y: Y - 26, width: 260, height: 26 }));
  tab.bindings = [{ field: 'label.title', target: 'visible', mode: 'hide' }];
  add(b, createElement('rect', { name: 'Title tab bg', parentId: tab.id, x: X, y: Y - 26, width: 260, height: 26, fill: solid('#0e131b') }));
  add(
    b,
    withRole(
      createElement('text', {
        name: 'Title label',
        parentId: tab.id,
        x: X + 10,
        y: Y - 26,
        width: 240,
        height: 26,
        text: txt({ content: 'HOMECOMING', fontSize: 18, fontWeight: 600, align: 'left', color: '#ffd84a', letterSpacing: 3 }),
      }),
      'label',
    ),
  );

  teamBlock(b, 'away', X, Y, H);
  teamBlock(b, 'home', X + 330, Y, H);

  // Clock block
  const cx = X + 660;
  const clock = add(b, createElement('group', { name: 'Clock', x: cx, y: Y, width: 300, height: H }));
  add(
    b,
    createElement('rect', {
      name: 'Clock bg',
      parentId: clock.id,
      x: cx,
      y: Y,
      width: 300,
      height: H,
      fill: { type: 'linear', angle: 180, stops: [{ offset: 0, color: '#1d2430' }, { offset: 1, color: '#0c1017' }] },
    }),
  );
  add(b, withRole(createElement('text', { name: 'Quarter', parentId: clock.id, x: cx + 8, y: Y, width: 86, height: H, text: txt({ content: '3RD', fontSize: 34, fontWeight: 600, color: '#d7dde8' }) }), 'period'));
  add(b, withRole(createElement('text', { name: 'Game clock', parentId: clock.id, x: cx + 94, y: Y, width: 124, height: H, text: txt({ content: '7:42', fontSize: 46, fontWeight: 700, color: '#ffffff', shadow: SHADOW }) }), 'gameClock'));
  add(b, createElement('rect', { name: 'Play clock plate', parentId: clock.id, x: cx + 226, y: Y + 12, width: 64, height: H - 24, radius: 4, fill: solid('#2b3442') }));
  add(b, withRole(createElement('text', { name: 'Play clock', parentId: clock.id, x: cx + 226, y: Y + 12, width: 64, height: H - 24, text: txt({ content: '25', fontSize: 32, fontWeight: 700, color: '#ffd84a' }) }), 'playClock'));

  // Situation block
  const sx = X + 960;
  const sit = add(b, createElement('group', { name: 'Situation', x: sx, y: Y, width: 280, height: H }));
  add(b, createElement('rect', { name: 'Situation bg', parentId: sit.id, x: sx, y: Y, width: 280, height: H, fill: solid('#141a23') }));
  add(b, createElement('rect', { name: 'Situation accent', parentId: sit.id, x: sx, y: Y, width: 4, height: H, fill: solid('$possession.primary') }));
  add(b, withRole(createElement('text', { name: 'Down & distance', parentId: sit.id, x: sx + 14, y: Y, width: 150, height: H, text: txt({ content: '3RD & 6', fontSize: 34, fontWeight: 700, align: 'left', color: '#ffffff' }) }), 'downDistance'));
  add(b, withRole(createElement('text', { name: 'Ball on', parentId: sit.id, x: sx + 166, y: Y, width: 104, height: H, text: txt({ content: 'BAY 34', fontSize: 24, fontWeight: 600, align: 'right', color: '#aeb8cb' }) }), 'ballOn'));

  for (const el of b.els) el.meta = { ...(el.meta ?? {}), source: 'template' };
  scene.elements = b.els;
  scene.settings.editorBackground = '#355235';
  return scene;
}

/** Complete example template: base layout plus generated animations and takeover graphics. */
export function createFootballTemplateScene(width = 1920, height = 1080): Scene {
  const { scene } = generateAnimations(createFootballTemplateBase(), { touchdownStyle: 'replace', intensity: 'standard' });
  return width === 1920 && height === 1080 ? scene : scaleScene(scene, width, height);
}
