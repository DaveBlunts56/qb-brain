import { useRef, useState } from 'react';
import { Trash2, Type, Upload } from 'lucide-react';
import { createElement } from '@bf/shared';
import { api, assetUrl, endpoints, type Asset } from '../../lib/api';
import { toast } from '../../components/toast';
import { ConfirmDialog } from '../../components/ui';
import { useEditor } from './editorStore';
import { insertAboveBase } from './EditorCanvas';

export function AssetsPanel() {
  const { assets, projectId, scene, setAssets, update } = useEditor();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Asset | null>(null);

  const upload = async (files: FileList) => {
    setBusy(true);
    for (const f of [...files]) {
      try {
        const a = await endpoints.upload(f, f.name, projectId);
        if (a.kind === 'font') {
          const family = f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/\b(regular|bold|italic|webfont)\b/gi, '').trim() || 'Custom Font';
          update((s) => void s.fonts.push({ family, assetId: a.id }));
          toast.success(`Font "${family}" added — pick it in the text inspector.`);
        }
      } catch (e) {
        toast.error((e as Error).message);
      }
    }
    setAssets(await endpoints.assets(projectId).catch(() => assets));
    setBusy(false);
  };

  const addImage = (a: Asset) => {
    if (!scene) return;
    const maxW = scene.width * 0.3;
    const w = a.width ?? 200;
    const h = a.height ?? 200;
    const k = Math.min(1, maxW / w, (scene.height * 0.3) / h);
    insertAboveBase(
      createElement('image', {
        name: a.originalName.replace(/\.[^.]+$/, ''),
        x: Math.round((scene.width - w * k) / 2),
        y: Math.round((scene.height - h * k) / 2),
        width: Math.round(w * k),
        height: Math.round(h * k),
        image: { assetId: a.id, fit: 'contain' },
        meta: { source: 'user' },
      }),
    );
  };

  const used = (id: string) => Boolean(scene?.elements.some((e) => e.image?.assetId === id) || scene?.fonts.some((f) => f.assetId === id));
  const images = assets.filter((a) => a.kind === 'image');
  const fonts = assets.filter((a) => a.kind === 'font');

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="p-2">
        <button
          className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-ink-500 py-2 text-xs text-ink-300 hover:border-accent hover:text-ink-100"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          <Upload className="h-3.5 w-3.5" /> {busy ? 'Uploading…' : 'Upload images or fonts'}
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.woff,.woff2,.ttf,.otf"
          onChange={(e) => {
            if (e.target.files?.length) void upload(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        <div className="panel-title mb-1.5">Images · click to add</div>
        <div className="grid grid-cols-3 gap-1.5">
          {images.map((a) => (
            <div key={a.id} className="group relative">
              <button className="checker block aspect-square w-full overflow-hidden rounded border border-ink-700 p-1 hover:border-accent" onClick={() => addImage(a)} title={`${a.originalName}${a.width ? ` · ${a.width}×${a.height}` : ''}`}>
                <img src={assetUrl(a.id)} alt={a.originalName} className="h-full w-full object-contain" loading="lazy" />
              </button>
              {a.projectId && (
                <button className="absolute right-0.5 top-0.5 hidden rounded bg-black/70 p-0.5 text-ink-300 hover:text-red-300 group-hover:block" onClick={() => setConfirm(a)} aria-label="Delete asset">
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
        </div>
        {!images.length && <div className="py-3 text-center text-xs text-ink-500">No images yet.</div>}
        <div className="panel-title mb-1.5 mt-4">Fonts</div>
        {scene?.fonts.map((f) => (
          <div key={f.assetId} className="flex items-center gap-2 py-1 text-xs text-ink-200">
            <Type className="h-3.5 w-3.5 text-ink-400" /> {f.family}
          </div>
        ))}
        {!fonts.length && <div className="text-xs text-ink-500">Bundled: Barlow Condensed, Oswald, Teko, Bebas Neue, Roboto Condensed, Inter. Upload WOFF2/TTF/OTF for more.</div>}
      </div>
      <ConfirmDialog
        open={Boolean(confirm)}
        title="Delete asset?"
        danger
        confirmLabel="Delete"
        message={<p>{confirm && used(confirm.id) ? 'This file is used in the scene; those elements will show nothing.' : 'This file is not used in the current scene.'} Published overlays that use it will lose it too.</p>}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          const a = confirm!;
          setConfirm(null);
          try {
            await api.del(`/api/assets/${a.id}`);
            setAssets(assets.filter((x) => x.id !== a.id));
          } catch (e) {
            toast.error((e as Error).message);
          }
        }}
      />
    </div>
  );
}
