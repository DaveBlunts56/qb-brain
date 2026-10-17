import { useState } from 'react';
import { CheckCircle2, Sparkles, TriangleAlert } from 'lucide-react';
import { DEFAULT_GENERATOR_OPTIONS, generateAnimations, type GeneratorOptions, type GeneratorReport, type Scene } from '@bf/shared';
import { Button, Modal, Toggle } from '../../components/ui';

/**
 * Runs the rule-based Animation Generator. It proposes motion from the
 * semantic roles you assigned; it never claims to "read" motion from artwork.
 */
export function GeneratorDialog({ open, onClose, scene, apply }: { open: boolean; onClose: () => void; scene: Scene | null; apply: (s: Scene) => void }) {
  const [opts, setOpts] = useState<GeneratorOptions>(DEFAULT_GENERATOR_OPTIONS);
  const [report, setReport] = useState<GeneratorReport | null>(null);

  const run = () => {
    if (!scene) return;
    const r = generateAnimations(scene, opts);
    apply(r.scene);
    setReport(r.report);
  };

  const close = () => {
    setReport(null);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Generate animations"
      width="max-w-xl"
      footer={
        report ? (
          <Button variant="primary" onClick={close}>
            Done
          </Button>
        ) : (
          <>
            <Button onClick={close}>Cancel</Button>
            <Button variant="primary" onClick={run}>
              <Sparkles className="h-4 w-4" /> Generate
            </Button>
          </>
        )
      }
    >
      {!report ? (
        <div className="space-y-4 text-sm">
          <p className="text-ink-300">
            Proposes broadcast-style motion from each element’s <b>live role</b>: rolling scores, flipping quarters, a sliding possession marker, pulsing timeouts, a wiping FLAG panel, a coordinated entrance/exit and TOUCHDOWN / FIELD GOAL graphics. Everything stays editable in the timeline.
          </p>
          <div>
            <label className="label">Intensity</label>
            <div className="grid grid-cols-3 gap-2">
              {(['subtle', 'standard', 'bold'] as const).map((i) => (
                <button key={i} className={`rounded-md border py-2 capitalize ${opts.intensity === i ? 'border-accent bg-accent/10' : 'border-ink-600 hover:border-ink-400'}`} onClick={() => setOpts({ ...opts, intensity: i })}>
                  {i}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label">Touchdown style</label>
            <div className="grid grid-cols-2 gap-2">
              <button className={`rounded-md border p-2 text-left ${opts.touchdownStyle === 'replace' ? 'border-accent bg-accent/10' : 'border-ink-600 hover:border-ink-400'}`} onClick={() => setOpts({ ...opts, touchdownStyle: 'replace' })}>
                <div className="font-semibold">Takeover</div>
                <div className="text-xs text-ink-400">Scorebug animates away, team panel expands into its place, then it returns.</div>
              </button>
              <button className={`rounded-md border p-2 text-left ${opts.touchdownStyle === 'above' ? 'border-accent bg-accent/10' : 'border-ink-600 hover:border-ink-400'}`} onClick={() => setOpts({ ...opts, touchdownStyle: 'above' })}>
                <div className="font-semibold">Banner above</div>
                <div className="text-xs text-ink-400">Score stays visible; the graphic appears above it.</div>
              </button>
            </div>
          </div>
          <Toggle checked={opts.createMissing} onChange={(v) => setOpts({ ...opts, createMissing: v })} label="Create missing graphics (TOUCHDOWN takeover, event banner, FLAG panel, quarter sweep)" />
          <Toggle checked={opts.overwrite} onChange={(v) => setOpts({ ...opts, overwrite: v })} label="Replace animations I already edited (off = only fill gaps)" />
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          {report.created.length > 0 && (
            <div>
              <div className="panel-title mb-1">Created</div>
              {report.created.map((c) => (
                <div key={c} className="flex gap-2 text-ink-200">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok" /> {c}
                </div>
              ))}
            </div>
          )}
          <div>
            <div className="panel-title mb-1">Timelines</div>
            <div className="flex flex-wrap gap-1">
              {report.timelines.map((t) => (
                <span key={t} className="rounded bg-ink-700 px-2 py-0.5 text-xs">
                  {t}
                </span>
              ))}
              {report.kept.map((t) => (
                <span key={t} className="rounded bg-ink-800 px-2 py-0.5 text-xs text-ink-400" title="Kept your existing version">
                  {t} (kept)
                </span>
              ))}
            </div>
          </div>
          <div>
            <div className="panel-title mb-1">Element animations ({report.animated.length})</div>
            <div className="max-h-40 overflow-y-auto text-xs text-ink-300">{report.animated.join(' · ') || 'None'}</div>
          </div>
          {report.warnings.map((w) => (
            <div key={w} className="flex gap-2 rounded-md border border-warn/30 bg-warn/10 p-2 text-amber-100">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" /> {w}
            </div>
          ))}
          <p className="text-xs text-ink-400">Remember to Publish so the overlay gets the new animations.</p>
        </div>
      )}
    </Modal>
  );
}
