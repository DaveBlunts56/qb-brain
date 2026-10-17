import { createElement, defaultTextProps, type GraphicElement } from '@bf/shared';
import type { ImportContext, ImportResult } from './svgImport';

/**
 * Layered PSD import via ag-psd (maintained, pure JavaScript).
 *
 * What is preserved: visible pixel layers at their exact positions, layer
 * groups, opacity, most blend modes, and (optionally) text as editable text.
 * What is not: layer effects (shadows, strokes, glows), adjustment layers,
 * smart-object transforms, and exact text rendering. Each case produces an
 * explicit warning instead of being silently flattened.
 */

const CSS_BLEND: Record<string, string> = {
  normal: 'normal',
  'pass through': 'normal',
  multiply: 'multiply',
  screen: 'screen',
  overlay: 'overlay',
  darken: 'darken',
  lighten: 'lighten',
  'color dodge': 'color-dodge',
  'color burn': 'color-burn',
  'hard light': 'hard-light',
  'soft light': 'soft-light',
  difference: 'difference',
  exclusion: 'exclusion',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity',
  'linear dodge': 'plus-lighter',
};

export interface PsdOptions {
  includeHidden: boolean;
  editableText: boolean;
}

interface PsdLayer {
  name?: string;
  hidden?: boolean;
  opacity?: number;
  blendMode?: string;
  left?: number;
  top?: number;
  right?: number;
  bottom?: number;
  canvas?: HTMLCanvasElement;
  children?: PsdLayer[];
  clipping?: boolean;
  effects?: Record<string, unknown>;
  mask?: unknown;
  adjustment?: unknown;
  placedLayer?: unknown;
  text?: { text: string; style?: { font?: { name: string }; fontSize?: number; fillColor?: { r?: number; g?: number; b?: number }; fauxBold?: boolean; fauxItalic?: boolean; tracking?: number }; transform?: number[] };
}

function canvasToBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'));
}

const FONT_MAP: [RegExp, string][] = [
  [/oswald/i, 'Oswald'],
  [/bebas/i, 'Bebas Neue'],
  [/teko/i, 'Teko'],
  [/roboto\s*cond/i, 'Roboto Condensed'],
  [/barlow/i, 'Barlow Condensed'],
  [/inter\b/i, 'Inter'],
];

export async function importPsd(buffer: ArrayBuffer, ctx: ImportContext, opts: PsdOptions, onProgress?: (done: number, total: number) => void): Promise<ImportResult> {
  const { readPsd } = await import('ag-psd');
  const warnings: string[] = [];
  let psd: { width: number; height: number; children?: PsdLayer[]; canvas?: HTMLCanvasElement };
  try {
    psd = readPsd(buffer, { skipThumbnail: true, skipLinkedFilesData: true }) as typeof psd;
  } catch (e) {
    // Some PSD features are unsupported by the parser: fall back to the flattened composite.
    try {
      psd = readPsd(buffer, { skipThumbnail: true, skipLayerImageData: true, skipLinkedFilesData: true }) as typeof psd;
      psd.children = undefined;
      warnings.push(`Layers could not be read (${(e as Error).message}); the flattened composite was imported instead.`);
    } catch (e2) {
      throw new Error(`This PSD could not be read: ${(e2 as Error).message}. Export it as PNG (or layered PNGs) and import that instead.`);
    }
  }

  const elements: GraphicElement[] = [];
  const effects = new Set<string>();
  const skipped: string[] = [];
  const blendApprox = new Set<string>();
  let clippingCount = 0;
  let maskCount = 0;

  const total = countLayers(psd.children ?? []);
  let done = 0;

  const walk = async (layers: PsdLayer[], parentId: string | null) => {
    // ag-psd lists layers bottom-to-top, which is our paint order.
    for (const layer of layers) {
      const name = layer.name || 'Layer';
      if (layer.hidden && !opts.includeHidden) continue;
      if (layer.children) {
        const g = createElement('group', { name, parentId, visible: !layer.hidden, opacity: layer.opacity ?? 1, meta: { source: 'psd' } });
        elements.push(g);
        await walk(layer.children, g.id);
        continue;
      }
      done++;
      onProgress?.(done, total);
      if (layer.adjustment) {
        skipped.push(`${name} (adjustment layer)`);
        continue;
      }
      if (layer.effects && Object.keys(layer.effects).some((k) => k !== 'scale' && k !== 'disabled')) effects.add(name);
      if (layer.clipping) clippingCount++;
      if (layer.mask) maskCount++;
      const left = layer.left ?? 0;
      const top = layer.top ?? 0;
      const width = (layer.right ?? 0) - left;
      const height = (layer.bottom ?? 0) - top;
      const blend = layer.blendMode ?? 'normal';
      const cssBlend = CSS_BLEND[blend];
      if (!cssBlend) blendApprox.add(blend);
      const common = { name, parentId, x: left, y: top, width, height, visible: !layer.hidden, opacity: layer.opacity ?? 1, blendMode: cssBlend ?? 'normal' };

      if (layer.text && opts.editableText) {
        const st = layer.text.style ?? {};
        const scaleY = layer.text.transform ? Math.hypot(layer.text.transform[2] ?? 0, layer.text.transform[3] ?? 1) : 1;
        const fontName = st.font?.name ?? '';
        const mapped = FONT_MAP.find(([re]) => re.test(fontName))?.[1];
        if (!mapped && fontName) warnings.push(`Text "${name}" uses font "${fontName}", which is not bundled — shown in Barlow Condensed. Upload the font in Assets to match.`);
        const c = st.fillColor;
        const color = c && c.r !== undefined ? `#${[c.r, c.g ?? 0, c.b ?? 0].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}` : '#ffffff';
        elements.push(
          createElement('text', {
            ...common,
            width: Math.max(width, 20),
            height: Math.max(height, 10),
            text: defaultTextProps({
              content: layer.text.text.replace(/\r/g, '\n'),
              fontFamily: mapped ?? 'Barlow Condensed',
              fontSize: Math.max(4, (st.fontSize ?? 24) * scaleY),
              fontWeight: st.fauxBold || /bold|black|heavy/i.test(fontName) ? 700 : /semi|medium/i.test(fontName) ? 600 : 400,
              italic: Boolean(st.fauxItalic) || /italic|oblique/i.test(fontName),
              color,
              align: 'left',
              letterSpacing: ((st.tracking ?? 0) / 1000) * (st.fontSize ?? 24) * scaleY,
              uppercase: false,
              fit: 'none',
              tabularNums: false,
            }),
            meta: { source: 'psd', note: `PSD text layer. Rendering may differ slightly from Photoshop.` },
          }),
        );
        continue;
      }
      if (!layer.canvas || width <= 0 || height <= 0) {
        if (!layer.text) skipped.push(`${name} (empty)`);
        continue;
      }
      const blob = await canvasToBlob(layer.canvas);
      const assetId = await ctx.upload(blob, `${name.replace(/[^\w-]+/g, '_').slice(0, 40) || 'layer'}.png`);
      elements.push(
        createElement('image', {
          ...common,
          image: { assetId, fit: 'fill' },
          meta: { source: 'psd', note: layer.text ? `PSD text layer "${layer.text.text.slice(0, 40)}" imported as an image.` : undefined },
        }),
      );
    }
  };

  if (psd.children?.length) {
    await walk(psd.children, null);
  } else if (psd.canvas) {
    const blob = await canvasToBlob(psd.canvas);
    const assetId = await ctx.upload(blob, 'psd-composite.png');
    elements.push(createElement('image', { name: 'PSD composite (flattened)', x: 0, y: 0, width: psd.width, height: psd.height, locked: true, image: { assetId, fit: 'fill' }, meta: { source: 'psd', isBaseArt: true } }));
    warnings.push('This PSD has no readable layers. It was imported as one flattened image: mark live areas with Make It Live.');
  } else {
    throw new Error('This PSD contains no image data.');
  }

  if (effects.size) warnings.push(`Layer effects (drop shadow, stroke, glow…) are not reproduced on: ${[...effects].slice(0, 6).join(', ')}${effects.size > 6 ? '…' : ''}. Re-create them with element shadows/strokes, or flatten the effects in Photoshop before exporting.`);
  if (skipped.length) warnings.push(`Skipped: ${skipped.slice(0, 6).join(', ')}${skipped.length > 6 ? '…' : ''}.`);
  if (clippingCount) warnings.push(`${clippingCount} clipping-masked layer(s) are shown unclipped.`);
  if (maskCount) warnings.push(`${maskCount} layer mask(s) may not be applied exactly.`);
  if (blendApprox.size) warnings.push(`Blend mode(s) without a browser equivalent shown as normal: ${[...blendApprox].join(', ')}.`);
  if (!opts.editableText && elements.some((e) => e.meta?.note?.includes('text layer'))) warnings.push('Text layers were imported as images (exact look). Replace the live ones with Make It Live, or re-import with "editable text".');
  return { elements, fonts: [], warnings, width: psd.width, height: psd.height };
}

function countLayers(layers: PsdLayer[]): number {
  return layers.reduce((n, l) => n + (l.children ? countLayers(l.children) : 1), 0);
}
