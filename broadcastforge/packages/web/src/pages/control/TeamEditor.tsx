import { useEffect, useRef, useState } from 'react';
import { ImageOff, Upload } from 'lucide-react';
import { LIMITS, type GameCommand, type TeamSide, type TeamState } from '@bf/shared';
import { assetUrl, endpoints, type Asset } from '../../lib/api';
import { Button, Modal } from '../../components/ui';
import { toast } from '../../components/toast';

export function TeamEditor({
  open,
  side,
  team,
  projectId,
  onClose,
  send,
}: {
  open: boolean;
  side: TeamSide;
  team: TeamState;
  projectId: string;
  onClose: () => void;
  send: (c: GameCommand) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(team);
  const [assets, setAssets] = useState<Asset[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(team);
    endpoints
      .assets(projectId)
      .then((a) => setAssets(a.filter((x) => x.kind === 'image')))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const upload = async (file: File) => {
    try {
      const a = await endpoints.upload(file, file.name, projectId);
      setAssets((list) => [a, ...list]);
      setDraft((d) => ({ ...d, logoAssetId: a.id }));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const save = async () => {
    const patch = {
      name: draft.name.trim(),
      mascot: draft.mascot.trim(),
      abbreviation: draft.abbreviation.trim().toUpperCase(),
      record: draft.record.trim(),
      primaryColor: draft.primaryColor,
      secondaryColor: draft.secondaryColor,
      textColor: draft.textColor,
      logoAssetId: draft.logoAssetId,
    };
    if (await send({ type: 'team.update', team: side, patch })) onClose();
  };

  const set = (k: keyof TeamState, v: string | null) => setDraft((d) => ({ ...d, [k]: v }));
  const color = (k: 'primaryColor' | 'secondaryColor' | 'textColor', label: string) => (
    <div>
      <label className="label">{label}</label>
      <div className="flex items-center gap-2">
        <input type="color" className="h-9 w-12 cursor-pointer rounded border border-ink-600 bg-ink-900" value={draft[k]} onChange={(e) => set(k, e.target.value)} />
        <input className="field font-mono" value={draft[k]} onChange={(e) => /^#[0-9a-fA-F]{0,6}$/.test(e.target.value) && set(k, e.target.value)} />
      </div>
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Edit ${side} team`}
      width="max-w-2xl"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={!/^#[0-9a-fA-F]{6}$/.test(draft.primaryColor + '') || !/^#[0-9a-fA-F]{6}$/.test(draft.secondaryColor) || !/^#[0-9a-fA-F]{6}$/.test(draft.textColor)}>
            Update on air
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label">School / team name</label>
          <input className="field" value={draft.name} maxLength={LIMITS.maxTeamNameLength} onChange={(e) => set('name', e.target.value)} />
        </div>
        <div>
          <label className="label">Mascot</label>
          <input className="field" value={draft.mascot} maxLength={LIMITS.maxTeamNameLength} onChange={(e) => set('mascot', e.target.value)} />
        </div>
        <div>
          <label className="label">Abbreviation</label>
          <input className="field uppercase" value={draft.abbreviation} maxLength={LIMITS.maxAbbrLength} onChange={(e) => set('abbreviation', e.target.value)} />
        </div>
        <div>
          <label className="label">Record / label</label>
          <input className="field" value={draft.record} maxLength={16} placeholder="7-1" onChange={(e) => set('record', e.target.value)} />
        </div>
        {color('primaryColor', 'Primary colour')}
        {color('secondaryColor', 'Secondary colour')}
        {color('textColor', 'Text colour')}
        <div className="flex items-end">
          <div className="h-9 w-full rounded" style={{ background: `linear-gradient(90deg, ${draft.primaryColor}, ${draft.secondaryColor})`, color: draft.textColor }}>
            <div className="flex h-full items-center px-3 font-display text-lg font-bold">{draft.abbreviation || 'ABC'}</div>
          </div>
        </div>
      </div>
      <div className="mt-5">
        <label className="label">Logo</label>
        <div className="flex flex-wrap gap-2">
          <button className={`checker flex h-16 w-16 items-center justify-center rounded border ${draft.logoAssetId === null ? 'border-accent' : 'border-ink-600'}`} onClick={() => set('logoAssetId', null)} title="No logo">
            <ImageOff className="h-5 w-5 text-ink-400" />
          </button>
          {assets.map((a) => (
            <button key={a.id} className={`checker h-16 w-16 overflow-hidden rounded border p-1 ${draft.logoAssetId === a.id ? 'border-accent ring-1 ring-accent' : 'border-ink-600'}`} onClick={() => set('logoAssetId', a.id)} title={a.originalName}>
              <img src={assetUrl(a.id)} alt={a.originalName} className="h-full w-full object-contain" />
            </button>
          ))}
          <button className="flex h-16 w-16 flex-col items-center justify-center gap-1 rounded border border-dashed border-ink-500 text-[10px] text-ink-300 hover:border-accent" onClick={() => fileRef.current?.click()}>
            <Upload className="h-4 w-4" /> Upload
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
              e.target.value = '';
            }}
          />
        </div>
      </div>
    </Modal>
  );
}
