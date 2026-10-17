import type { ElementAnimations, EventTimeline } from '../animation/types.js';
import type { FieldRole } from './roles.js';

/**
 * Colour values are CSS colours (#rgb, #rrggbb, #rrggbbaa, rgb[a](), named)
 * or live tokens resolved at render time:
 *   $home.primary  $home.secondary  $home.text   (same for $away)
 *   $event.primary $event.secondary $event.text  (team of the current graphic)
 *   $possession.primary ...                      (team with the ball)
 */
export type ColorValue = string;

export interface GradientStop {
  offset: number;
  color: ColorValue;
}

export type Paint =
  | { type: 'none' }
  | { type: 'solid'; color: ColorValue }
  | { type: 'linear'; angle: number; stops: GradientStop[] };

export interface Stroke {
  color: ColorValue;
  width: number;
}

export interface Shadow {
  x: number;
  y: number;
  blur: number;
  color: ColorValue;
}

export type TextAlign = 'left' | 'center' | 'right';
export type VerticalAlign = 'top' | 'middle' | 'bottom';

export interface TextProps {
  /** Static text. Bound text elements replace this at render time. */
  content: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  color: ColorValue;
  align: TextAlign;
  verticalAlign: VerticalAlign;
  letterSpacing: number;
  lineHeight: number;
  uppercase: boolean;
  /** shrink: reduce font size; squeeze: condense horizontally (broadcast style). */
  fit: 'none' | 'shrink' | 'squeeze';
  tabularNums: boolean;
  stroke: Stroke | null;
  shadow: Shadow | null;
}

export interface ImageProps {
  assetId: string | null;
  fit: 'contain' | 'cover' | 'fill';
}

export interface PathProps {
  d: string;
  viewBox: [number, number, number, number];
  fillRule: 'nonzero' | 'evenodd';
}

export interface PolygonProps {
  /** Points in element-local pixels. */
  points: [number, number][];
}

export const ELEMENT_TYPES = ['group', 'rect', 'ellipse', 'text', 'image', 'path', 'polygon'] as const;
export type ElementType = (typeof ELEMENT_TYPES)[number];

export type BindingTarget = 'text' | 'image' | 'visible' | 'fill' | 'color';

export interface FieldBinding {
  /** Data field, e.g. "home.score", "gameClock", "event.team.logo". See FIELD_DEFS. */
  field: string;
  target: BindingTarget;
  /** Text template, e.g. "{value} PTS". */
  format?: string;
  /** For visible bindings on numbers: on when value >= index (timeout pips). */
  index?: number;
  /** For visible bindings: hide completely, or dim to dimOpacity. */
  mode?: 'hide' | 'dim';
  dimOpacity?: number;
}

export interface ElementMeta {
  source?: 'template' | 'svg' | 'psd' | 'raster' | 'user' | 'generator';
  /** Covers baked-in artwork (filled from sampled colours). */
  isMask?: boolean;
  /** Locked flattened artwork imported from PNG/JPEG. */
  isBaseArt?: boolean;
  /** Which generated takeover component this belongs to. */
  component?: 'tdTakeover' | 'eventBanner' | 'flagPanel' | 'sweep';
  /** Named part inside a generated component (panel, stripe, title...). */
  part?: string;
  note?: string;
  warnings?: string[];
}

export interface GraphicElement {
  id: string;
  name: string;
  type: ElementType;
  parentId: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  /** Editor visibility: hidden elements are not rendered anywhere. */
  visible: boolean;
  locked: boolean;
  /** Not shown at rest in the overlay; only animations reveal it (takeover graphics). */
  restHidden: boolean;
  fill: Paint;
  stroke: Stroke | null;
  radius: number;
  skewX: number;
  shadow: Shadow | null;
  blendMode: string;
  text?: TextProps;
  image?: ImageProps;
  path?: PathProps;
  polygon?: PolygonProps;
  role: FieldRole | null;
  bindings: FieldBinding[];
  anim: ElementAnimations;
  meta?: ElementMeta;
}

export interface SceneFont {
  family: string;
  assetId: string;
}

export interface SceneSettings {
  safeZones: boolean;
  snap: boolean;
  grid: number;
  /** Editor-only backdrop colour (never rendered in the overlay). */
  editorBackground: string;
}

export interface Scene {
  version: 1;
  width: number;
  height: number;
  elements: GraphicElement[];
  timelines: EventTimeline[];
  fonts: SceneFont[];
  settings: SceneSettings;
}

export const CANVAS_PRESETS = [
  { id: '1080p', label: '1920 × 1080 (1080p)', width: 1920, height: 1080 },
  { id: '720p', label: '1280 × 720 (720p)', width: 1280, height: 720 },
] as const;
