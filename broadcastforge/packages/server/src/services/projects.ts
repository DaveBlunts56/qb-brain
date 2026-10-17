import {
  createFootballTemplateScene,
  createId,
  createInitialGameState,
  createScene,
  gameConfigPatchSchema,
  sceneAssetIds,
  teamInfoOf,
  teamPatchSchema,
  validateScene,
  type GameConfig,
  type PublishedScene,
  type Scene,
  type TeamInfo,
} from '@bf/shared';
import { z } from 'zod';
import type { ProjectRecord, Store } from '../db/store.js';
import { badRequest, conflict, notFound } from '../http/errors.js';
import type { LiveHub } from '../live/LiveHub.js';
import type { AssetService } from './assets.js';

export interface ProjectNotifier {
  projectsChanged(): void;
  scenePublished(projectId: string, scene: PublishedScene): void;
}

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(80),
  width: z.union([z.literal(1920), z.literal(1280)]),
  height: z.union([z.literal(1080), z.literal(720)]),
  template: z.enum(['football', 'blank']),
  sport: z.literal('football').default('football'),
});

const EXPORT_FORMAT = 'broadcastforge-project';

const bundleSchema = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(1),
  project: z.object({ name: z.string().max(80), sport: z.string().max(20) }),
  scene: z.unknown(),
  teams: z.object({ home: teamPatchSchema.required(), away: teamPatchSchema.required() }).optional(),
  config: gameConfigPatchSchema.optional(),
  assets: z
    .array(z.object({ id: z.string().max(64), originalName: z.string().max(200), data: z.string() }))
    .max(500),
});

function remapScene(scene: Scene, map: Map<string, string>): Scene {
  const s = structuredClone(scene);
  for (const el of s.elements) if (el.image?.assetId && map.has(el.image.assetId)) el.image.assetId = map.get(el.image.assetId)!;
  for (const f of s.fonts) if (map.has(f.assetId)) f.assetId = map.get(f.assetId)!;
  return s;
}

export class ProjectService {
  constructor(
    private readonly store: Store,
    private readonly assets: AssetService,
    private readonly hub: LiveHub,
    private readonly notify: ProjectNotifier,
  ) {}

  create(input: z.infer<typeof createProjectSchema>): ProjectRecord {
    if (input.width / input.height !== 16 / 9) throw badRequest('Unsupported canvas size');
    const scene = input.template === 'football' ? createFootballTemplateScene(input.width, input.height) : createScene(input.width, input.height);
    const id = createId('proj');
    const now = Date.now();
    this.store.insertProject({
      id,
      name: input.name,
      sport: input.sport,
      width: input.width,
      height: input.height,
      draft: scene,
      published: scene,
      publishedVersion: 1,
      publishedAt: now,
      settings: {},
      createdAt: now,
      updatedAt: now,
    });
    if (input.template === 'football') this.hub.createExampleMatch(id);
    else this.hub.createMatch(id, createInitialGameState(), 'Game 1');
    this.notify.projectsChanged();
    return this.store.getProject(id)!;
  }

  get(id: string): ProjectRecord {
    const p = this.store.getProject(id);
    if (!p) throw notFound('Project not found');
    return p;
  }

  saveDraft(id: string, sceneInput: unknown, rev: number | null): number {
    this.get(id);
    const v = validateScene(sceneInput);
    if (!v.ok) throw badRequest(v.error);
    const next = this.store.saveDraft(id, v.scene, rev);
    if (next === null) throw conflict('This project was changed in another window. Reload to get the latest version.', 'REV_CONFLICT');
    this.notify.projectsChanged();
    return next;
  }

  /** Copy the draft to air. The live overlay only ever renders published scenes. */
  publish(id: string): PublishedScene {
    const r = this.store.publish(id);
    if (!r) throw notFound('Project not found');
    const pub: PublishedScene = { projectId: id, version: r.version, publishedAt: r.publishedAt, scene: r.scene };
    this.notify.scenePublished(id, pub);
    this.notify.projectsChanged();
    return pub;
  }

  published(id: string): PublishedScene | null {
    const p = this.store.getProject(id);
    if (!p?.published) return null;
    return { projectId: id, version: p.publishedVersion, publishedAt: p.publishedAt ?? 0, scene: p.published };
  }

  rename(id: string, name: string) {
    this.get(id);
    this.store.renameProject(id, name);
    this.notify.projectsChanged();
  }

  delete(id: string) {
    this.get(id);
    this.hub.dispose(id);
    const files = this.store.deleteProject(id);
    this.assets.deleteFiles(files);
    this.notify.projectsChanged();
  }

  /** Teams/config of the live match, used when duplicating or exporting. */
  private teamsOf(id: string): { home: TeamInfo; away: TeamInfo; config: GameConfig } {
    const state = this.hub.runtimeFor(id)!.getState();
    return { home: teamInfoOf(state.home), away: teamInfoOf(state.away), config: state.config };
  }

  /** Copy project-owned assets so the copy survives deletion of the original. */
  private copyAssets(ids: string[], projectId: string): Map<string, string> {
    const map = new Map<string, string>();
    for (const assetId of ids) {
      const a = this.assets.read(assetId);
      if (!a || a.record.projectId === null) continue; // shared/global assets are referenced, not copied
      const copy = this.assets.save(a.data, a.record.originalName, projectId);
      map.set(assetId, copy.id);
    }
    return map;
  }

  duplicate(id: string): ProjectRecord {
    const src = this.get(id);
    const teams = this.teamsOf(id);
    const newId = createId('proj');
    const ids = new Set([...sceneAssetIds(src.draft), ...(src.published ? sceneAssetIds(src.published) : [])]);
    for (const t of [teams.home, teams.away]) if (t.logoAssetId) ids.add(t.logoAssetId);
    const now = Date.now();
    this.store.insertProject({
      id: newId,
      name: `${src.name} copy`.slice(0, 80),
      sport: src.sport,
      width: src.width,
      height: src.height,
      draft: src.draft,
      published: src.published,
      publishedVersion: src.published ? 1 : 0,
      publishedAt: src.published ? now : null,
      settings: {},
      createdAt: now,
      updatedAt: now,
    });
    const map = this.copyAssets([...ids], newId);
    const p = this.store.getProject(newId)!;
    this.store.saveDraft(newId, remapScene(p.draft, map), null);
    if (p.published) {
      // Re-publish the remapped draft so both copies are consistent.
      this.store.publish(newId);
    }
    const remapLogo = (t: TeamInfo) => ({ ...t, logoAssetId: t.logoAssetId ? (map.get(t.logoAssetId) ?? t.logoAssetId) : null });
    this.hub.createMatch(newId, createInitialGameState({ home: remapLogo(teams.home), away: remapLogo(teams.away), config: teams.config }), 'Game 1');
    this.notify.projectsChanged();
    return this.store.getProject(newId)!;
  }

  export(id: string) {
    const p = this.get(id);
    const teams = this.teamsOf(id);
    const ids = new Set(sceneAssetIds(p.draft));
    for (const t of [teams.home, teams.away]) if (t.logoAssetId) ids.add(t.logoAssetId);
    const assets = [...ids]
      .map((assetId) => this.assets.read(assetId))
      .filter((a): a is NonNullable<typeof a> => Boolean(a))
      .map((a) => ({ id: a.record.id, originalName: a.record.originalName, data: a.data.toString('base64') }));
    return {
      format: EXPORT_FORMAT,
      version: 1 as const,
      exportedAt: new Date().toISOString(),
      project: { name: p.name, sport: p.sport },
      scene: p.draft,
      teams: { home: teams.home, away: teams.away },
      config: teams.config,
      assets,
    };
  }

  import(input: unknown): ProjectRecord {
    const parsed = bundleSchema.safeParse(input);
    if (!parsed.success) throw badRequest(`Not a BroadcastForge project file: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
    const bundle = parsed.data;
    const v = validateScene(bundle.scene);
    if (!v.ok) throw badRequest(`Project scene is invalid: ${v.error}`);
    const newId = createId('proj');
    const now = Date.now();
    this.store.insertProject({
      id: newId,
      name: bundle.project.name || 'Imported project',
      sport: 'football',
      width: v.scene.width,
      height: v.scene.height,
      draft: v.scene,
      published: null,
      settings: {},
      createdAt: now,
      updatedAt: now,
    });
    const map = new Map<string, string>();
    try {
      for (const a of bundle.assets) {
        // Template assets already exist under the same id: reuse them.
        if (this.store.getAsset(a.id)?.projectId === null) continue;
        const rec = this.assets.save(Buffer.from(a.data, 'base64'), a.originalName, newId);
        map.set(a.id, rec.id);
      }
    } catch (err) {
      this.delete(newId);
      throw err;
    }
    const scene = remapScene(v.scene, map);
    this.store.saveDraft(newId, scene, null);
    this.store.publish(newId);
    const remapLogo = (t: TeamInfo) => ({ ...t, logoAssetId: t.logoAssetId ? (map.get(t.logoAssetId) ?? (this.store.getAsset(t.logoAssetId) ? t.logoAssetId : null)) : null });
    const state = createInitialGameState({
      home: bundle.teams ? remapLogo(bundle.teams.home as TeamInfo) : undefined,
      away: bundle.teams ? remapLogo(bundle.teams.away as TeamInfo) : undefined,
    });
    if (bundle.config) state.config = { ...state.config, ...bundle.config };
    this.hub.createMatch(newId, state, 'Game 1');
    this.notify.projectsChanged();
    return this.store.getProject(newId)!;
  }

  /** First run: install the example project so the app is useful immediately. */
  ensureExample() {
    if (this.store.listProjects().length) return;
    this.create({ name: 'Gridiron Pro — Example', width: 1920, height: 1080, template: 'football', sport: 'football' });
  }
}
