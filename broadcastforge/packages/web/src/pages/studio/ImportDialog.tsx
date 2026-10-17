import { useEffect, useRef, useState } from 'react';
import { FileImage, Info, TriangleAlert, Upload } from 'lucide-react';
import { createElement, createId, type GraphicElement } from '@bf/shared';
import { endpoints } from '../../lib/api';
import { Button, Modal, Toggle } from '../../components/ui';
import { toast } from '../../components/toast';
import { useEditor } from './editorStore';
import { importSvg, type ImportResult } from './importers/svgImport';
import { importPsd } from './importers/psdImport';

type Kind = 'raster' | 'svg' | 'psd';
type Placement = 'original' | 'fitCanvas' | 'fitWidth' | 'bottomCenter';

function kindOf(file: File): Kind | null {
  const n = file.name.toLowerCase();
  if (/\.(png|jpe?g|webp|gif)$/.test(n) || /^image\/(png|jpeg|webp|gif)$/.test(file.type)) return 'raster';
  if (n.endsWith('.svg') || file.type === 'image/svg+xml') return 'svg';
  if (n.endsWith('.psd') || file.type === 'image/vnd.adobe.photoshop') return 'psd';
  return null;
}

async function imageSize(file: File): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Scale + offset imported elements (geometry, fonts, strokes, radii). */
function placeElements(els: GraphicElement[], k: number, ox: number, oy: number): GraphicElement[] {
  return els.map((e) => {
    const c = structuredClone(e);
    c.x = Math.round((c.x * k + ox) * 100) / 100;
    c.y = Math.round((c.y * k + oy) * 100) / 100;
    c.width *= k;
    c.height *= k;
    c.radius *= k;
    if (c.stroke) c.stroke.width *= k;
    if (c.shadow) c.shadow = { ...c.shadow, x: c.shadow.x * k, y: c.shadow.y * k, blur: c.shadow.blur * k };
    if (c.text) {
      c.text.fontSize *= k;
      c.text.letterSpacing *= k;
    }
    if (c.polygon) c.polygon.points = c.polygon.points.map(([x, y]) => [x * k, y * k]);
    return c;
  });
}

export function ImportDialog({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: (kind: Kind) => void }) {
  const { scene, projectId } = useEditor();
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<Kind | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [placement, setPlacement] = useState<Placement>('original');
  const [svgMode, setSvgMode] = useState<'editable' | 'image'>('editable');
  const [psdOpts, setPsdOpts] = useState({ includeHidden: false, editableText: false });
  const [busy, setBusy] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setFile(null);
      setKind(null);
      setSize(null);
      setWarnings([]);
      setBusy(null);
    }
  }, [open]);

  const choose = async (f: File) => {
    const k = kindOf(f);
    if (!k) {
      toast.error(`"${f.name}" is not a supported design file (PNG, JPEG, WebP, SVG or PSD).`);
      return;
    }
    if (f.size > (k === 'psd' ? 300 : 30) * 1024 * 1024) {
      toast.error(`"${f.name}" is too large.`);
      return;
    }
    setFile(f);
    setKind(k);
    setWarnings([]);
    let s: { width: number; height: number } | null = null;
    try {
      if (k === 'raster') s = await imageSize(f);
      if (k === 'svg') {
        const doc = new DOMParser().parseFromString(await f.text(), 'image/svg+xml');
        const root = doc.documentElement;
        const vb = root.getAttribute('viewBox')?.split(/[\s,]+/).map(Number);
        s = vb && vb.length === 4 ? { width: vb[2]!, height: vb[3]! } : { width: parseFloat(root.getAttribute('width') ?? '0') || 0, height: parseFloat(root.getAttribute('height') ?? '0') || 0 };
      }
      if (k === 'psd') {
        const buf = new DataView(await f.slice(0, 26).arrayBuffer());
        if (buf.getUint32(0) !== 0x38425053) throw new Error('Not a Photoshop file');
        s = { width: buf.getUint32(18), height: buf.getUint32(14) };
      }
    } catch (e) {
      toast.error(`Could not read "${f.name}": ${(e as Error).message}`);
      setFile(null);
      return;
    }
    setSize(s);
    if (scene && s) {
      if (s.width === scene.width && s.height === scene.height) setPlacement('original');
      else if (s.width > scene.width || s.height > scene.height || Math.abs(s.width / s.height - 16 / 9) < 0.01) setPlacement('fitCanvas');
      else setPlacement('bottomCenter');
    }
  };

  const geometry = (w: number, h: number) => {
    const cw = scene!.width;
    const ch = scene!.height;
    switch (placement) {
      case 'fitCanvas': {
        const k = Math.min(cw / w, ch / h);
        return { k, ox: (cw - w * k) / 2, oy: (ch - h * k) / 2 };
      }
      case 'fitWidth': {
        const k = (cw * 0.9) / w;
        return { k, ox: cw * 0.05, oy: ch * 0.965 - h * k };
      }
      case 'bottomCenter':
        return { k: 1, ox: Math.round((cw - w) / 2), oy: Math.round(ch * 0.965 - h) };
      default:
        return { k: 1, ox: 0, oy: 0 };
    }
  };

  const run = async () => {
    if (!file || !kind || !scene || !size) return;
    const upload = async (blob: Blob, name: string) => (await endpoints.upload(blob, name, projectId)).id;
    const ctx = { canvasWidth: scene.width, canvasHeight: scene.height, upload };
    try {
      let result: ImportResult;
      if (kind === 'raster' || (kind === 'svg' && svgMode === 'image')) {
        setBusy('Uploading image…');
        const asset = await endpoints.upload(file, file.name, projectId);
        const w = asset.width ?? size.width;
        const h = asset.height ?? size.height;
        result = {
          elements: [
            createElement('image', {
              name: `Base artwork (${file.name})`,
              x: 0,
              y: 0,
              width: w,
              height: h,
              locked: true,
              image: { assetId: asset.id, fit: 'fill' },
              meta: { source: 'raster', isBaseArt: true, note: 'Flattened artwork. Its original layers cannot be recovered; mark live areas with Make It Live.' },
            }),
          ],
          fonts: [],
          warnings: [],
          width: w,
          height: h,
        };
      } else if (kind === 'svg') {
        setBusy('Converting SVG shapes…');
        result = await importSvg(await file.text(), ctx);
      } else {
        setBusy('Reading PSD layers…');
        result = await importPsd(await file.arrayBuffer(), ctx, psdOpts, (d, t) => setBusy(`Importing layer ${d} of ${t}…`));
      }
      const { k, ox, oy } = geometry(result.width || size.width, result.height || size.height);
      let els = placeElements(result.elements, k, ox, oy);
      const tops = els.filter((e) => e.parentId === null);
      if (kind !== 'raster' && tops.length > 1) {
        const gid = createId('el');
        els = [createElement('group', { id: gid, name: file.name.replace(/\.[^.]+$/, ''), meta: { source: kind === 'psd' ? 'psd' : 'svg' } }), ...els.map((e) => (e.parentId === null ? { ...e, parentId: gid } : e))];
      }
      useEditor.getState().update((s) => {
        // Base artwork goes to the bottom; vector/PSD imports go on top.
        if (kind === 'raster' || (kind === 'svg' && svgMode === 'image')) s.elements.unshift(...els);
        else s.elements.push(...els);
        for (const f of result.fonts) if (!s.fonts.some((x) => x.family === f.family)) s.fonts.push(f);
      });
      setWarnings(result.warnings);
      setBusy(null);
      endpoints.assets(projectId).then((a) => useEditor.getState().setAssets(a)).catch(() => {});
      toast.success(`Imported ${file.name}: ${els.length} element${els.length === 1 ? '' : 's'}`);
      if (!result.warnings.length) {
        onClose();
        onImported(kind);
      }
    } catch (e) {
      setBusy(null);
      toast.error((e as Error).message);
    }
  };

  const done = warnings.length > 0 && !busy;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Import design"
      width="max-w-2xl"
      footer={
        done ? (
          <Button
            variant="primary"
            onClick={() => {
              onClose();
              onImported(kind!);
            }}
          >
            Continue to Make It Live
          </Button>
        ) : (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={run} disabled={!file || !size || busy !== null}>
              {busy ?? 'Import'}
            </Button>
          </>
        )
      }
    >
      {done ? (
        <div className="space-y-2">
          <div className="text-sm font-semibold text-ink-100">Imported with notes:</div>
          {warnings.map((w) => (
            <div key={w} className="flex gap-2 rounded-md border border-warn/30 bg-warn/10 p-2.5 text-sm text-amber-100">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" /> {w}
            </div>
          ))}
        </div>
      ) : !file ? (
        <div
          className={`flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 text-center transition ${dragOver ? 'border-accent bg-accent/5' : 'border-ink-600'}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files[0];
            if (f) void choose(f);
          }}
        >
          <Upload className="h-10 w-10 text-ink-400" />
          <div className="font-semibold">Drop your scorebug artwork here</div>
          <div className="text-sm text-ink-400">PNG · JPEG · WebP · SVG · layered PSD</div>
          <Button onClick={() => inputRef.current?.click()}>Choose file…</Button>
          <input
            ref={inputRef}
            type="file"
            hidden
            accept=".png,.jpg,.jpeg,.webp,.gif,.svg,.psd,image/png,image/jpeg,image/webp,image/svg+xml"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void choose(f);
              e.target.value = '';
            }}
          />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-lg border border-ink-700 bg-ink-900 p-3">
            <FileImage className="h-8 w-8 text-ink-300" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{file.name}</div>
              <div className="text-xs text-ink-400">
                {kind === 'raster' ? 'Flattened image' : kind === 'svg' ? 'SVG vector' : 'Photoshop document'} · {size ? `${Math.round(size.width)}×${Math.round(size.height)}` : '…'} · {(file.size / 1024).toFixed(0)} KB
              </div>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setFile(null)}>
              Change
            </Button>
          </div>

          {kind === 'raster' && (
            <div className="flex gap-2 rounded-md border border-info/30 bg-info/10 p-3 text-sm text-sky-100">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" />
              <div>
                A PNG/JPEG is a single flat picture: its original layers <b>cannot</b> be recovered. It becomes a locked base layer, and in the next step you mark where the scores,
                names and clock are. Baked-in text can be covered with a sampled-colour mask or a replacement panel.
              </div>
            </div>
          )}
          {kind === 'svg' && (
            <div className="space-y-2">
              <label className="flex items-start gap-2 text-sm">
                <input type="radio" checked={svgMode === 'editable'} onChange={() => setSvgMode('editable')} className="mt-1" />
                <span>
                  <b>Editable shapes & text</b> (recommended) — rectangles, paths, text, groups and gradients become editable elements. Filters and masks are listed if left out.
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input type="radio" checked={svgMode === 'image'} onChange={() => setSvgMode('image')} className="mt-1" />
                <span>
                  <b>Single image</b> — pixel-exact, like a PNG; mark live areas afterwards.
                </span>
              </label>
            </div>
          )}
          {kind === 'psd' && (
            <div className="space-y-2">
              <Toggle checked={psdOpts.editableText} onChange={(v) => setPsdOpts({ ...psdOpts, editableText: v })} label="Convert text layers to editable text (font rendering may differ)" />
              <Toggle checked={psdOpts.includeHidden} onChange={(v) => setPsdOpts({ ...psdOpts, includeHidden: v })} label="Include hidden layers (imported hidden)" />
              <p className="text-xs text-ink-400">Pixel layers keep their exact positions. Layer effects and adjustment layers are reported, not silently flattened.</p>
            </div>
          )}

          <div>
            <label className="label">Placement on the {scene?.width}×{scene?.height} canvas</label>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {(
                [
                  ['original', 'Original position & size'],
                  ['fitCanvas', 'Scale to fit the canvas'],
                  ['bottomCenter', 'Original size, bottom centre'],
                  ['fitWidth', 'Full width, along the bottom'],
                ] as [Placement, string][]
              ).map(([v, l]) => (
                <button key={v} className={`rounded-md border px-3 py-2 text-left ${placement === v ? 'border-accent bg-accent/10' : 'border-ink-600 hover:border-ink-400'}`} onClick={() => setPlacement(v)}>
                  {l}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
