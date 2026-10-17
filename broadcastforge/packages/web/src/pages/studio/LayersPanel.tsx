import { useState } from 'react';
import { ChevronDown, ChevronRight, Circle, Eye, EyeOff, Folder, Image as ImageIcon, Lock, Spline, Square, Type, Unlock, Zap } from 'lucide-react';
import { descendantIds, layerTree, ROLE_MAP, type GraphicElement } from '@bf/shared';
import { useEditor } from './editorStore';

const ICONS = { group: Folder, rect: Square, ellipse: Circle, text: Type, image: ImageIcon, path: Spline, polygon: Spline } as const;

export function LayersPanel() {
  const { scene, selection, select, update } = useEditor();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; into: boolean } | null>(null);
  if (!scene) return null;

  const rows = layerTree(scene);
  const hiddenByCollapse = new Set<string>();
  for (const id of collapsed) for (const d of descendantIds(scene, id)) hiddenByCollapse.add(d);

  const onClick = (e: React.MouseEvent, el: GraphicElement) => {
    if (e.shiftKey || e.metaKey || e.ctrlKey) select(selection.includes(el.id) ? selection.filter((x) => x !== el.id) : [...selection, el.id]);
    else select([el.id]);
  };

  const drop = (targetId: string, into: boolean) => {
    if (!dragId || dragId === targetId) return;
    if (descendantIds(scene, dragId).includes(targetId)) return; // can't drop into own child
    update((s) => {
      const dragged = s.elements.find((e) => e.id === dragId)!;
      const target = s.elements.find((e) => e.id === targetId)!;
      const subtree = new Set([dragId, ...descendantIds(s, dragId)]);
      const moving = s.elements.filter((e) => subtree.has(e.id));
      s.elements = s.elements.filter((e) => !subtree.has(e.id));
      if (into && target.type === 'group') {
        dragged.parentId = target.id;
        // top of the group = after its last descendant
        const tsub = new Set([target.id, ...descendantIds(s, target.id)]);
        let last = s.elements.findIndex((e) => e.id === target.id);
        s.elements.forEach((e, i) => tsub.has(e.id) && (last = i));
        s.elements.splice(last + 1, 0, ...moving);
      } else {
        dragged.parentId = target.parentId;
        // Display order is reversed: dropping "on" a row puts the item just above it.
        const tsub = new Set([target.id, ...descendantIds(s, target.id)]);
        let last = s.elements.findIndex((e) => e.id === target.id);
        s.elements.forEach((e, i) => tsub.has(e.id) && (last = i));
        s.elements.splice(last + 1, 0, ...moving);
      }
    });
    setDragId(null);
    setDropTarget(null);
  };

  return (
    <div className="flex-1 overflow-y-auto py-1 text-[13px]" role="tree" aria-label="Layers">
      {rows.map(({ el, depth }) => {
        if (hiddenByCollapse.has(el.id)) return null;
        const Icon = ICONS[el.type];
        const sel = selection.includes(el.id);
        const isDrop = dropTarget?.id === el.id;
        return (
          <div
            key={el.id}
            role="treeitem"
            aria-selected={sel}
            draggable={renaming !== el.id}
            onDragStart={(e) => {
              setDragId(el.id);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={(e) => {
              e.preventDefault();
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              setDropTarget({ id: el.id, into: el.type === 'group' && e.clientX - r.left > r.width * 0.5 });
            }}
            onDragLeave={() => setDropTarget(null)}
            onDrop={(e) => {
              e.preventDefault();
              drop(el.id, Boolean(dropTarget?.into));
            }}
            onClick={(e) => onClick(e, el)}
            onDoubleClick={() => setRenaming(el.id)}
            className={`group flex cursor-default items-center gap-1 py-[3px] pr-1.5 ${sel ? 'bg-info/25 text-white' : 'text-ink-200 hover:bg-ink-750'} ${isDrop ? (dropTarget!.into ? 'ring-1 ring-inset ring-accent' : 'border-t-2 border-accent') : ''} ${!el.visible ? 'opacity-50' : ''}`}
            style={{ paddingLeft: 6 + depth * 14 }}
          >
            {el.type === 'group' ? (
              <button
                className="text-ink-400 hover:text-ink-100"
                onClick={(e) => {
                  e.stopPropagation();
                  const n = new Set(collapsed);
                  if (n.has(el.id)) n.delete(el.id);
                  else n.add(el.id);
                  setCollapsed(n);
                }}
                aria-label={collapsed.has(el.id) ? 'Expand' : 'Collapse'}
              >
                {collapsed.has(el.id) ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
            ) : (
              <span className="w-3.5" />
            )}
            <Icon className={`h-3.5 w-3.5 shrink-0 ${el.meta?.isBaseArt ? 'text-accent' : 'text-ink-400'}`} />
            {renaming === el.id ? (
              <input
                className="field-sm py-0"
                autoFocus
                defaultValue={el.name}
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  setRenaming(null);
                  if (v && v !== el.name) update((s) => void (s.elements.find((x) => x.id === el.id)!.name = v.slice(0, 120)));
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  if (e.key === 'Escape') setRenaming(null);
                }}
              />
            ) : (
              <span className="min-w-0 flex-1 truncate">{el.name}</span>
            )}
            {el.role && (
              <span className="flex shrink-0 items-center gap-0.5 rounded bg-accent/15 px-1 text-[10px] font-semibold text-accent" title={`Live: ${ROLE_MAP[el.role]?.label}`}>
                <Zap className="h-2.5 w-2.5" />
                {ROLE_MAP[el.role]?.label.replace(/^(Home|Away) /, (m) => m[0]! + ' ').slice(0, 14)}
              </span>
            )}
            {el.restHidden && <span className="shrink-0 rounded bg-ink-600 px-1 text-[9px] text-ink-300" title="Hidden until an animation shows it">FX</span>}
            <button
              className={`shrink-0 text-ink-500 hover:text-ink-100 ${el.locked ? 'text-ink-200' : 'opacity-0 group-hover:opacity-100'}`}
              onClick={(e) => {
                e.stopPropagation();
                update((s) => void (s.elements.find((x) => x.id === el.id)!.locked = !el.locked));
              }}
              aria-label={el.locked ? 'Unlock' : 'Lock'}
            >
              {el.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
            </button>
            <button
              className={`shrink-0 text-ink-500 hover:text-ink-100 ${!el.visible ? 'text-ink-200' : 'opacity-0 group-hover:opacity-100'}`}
              onClick={(e) => {
                e.stopPropagation();
                update((s) => void (s.elements.find((x) => x.id === el.id)!.visible = !el.visible));
              }}
              aria-label={el.visible ? 'Hide' : 'Show'}
            >
              {el.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            </button>
          </div>
        );
      })}
      {!rows.length && <div className="p-4 text-center text-xs text-ink-500">No layers yet. Import a design or draw shapes.</div>}
    </div>
  );
}
