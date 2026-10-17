import type { AnimationClip, MatchSnapshot, ObsStatus, PublishedScene, Scene } from '@bf/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method, credentials: 'same-origin', headers: {} };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
  }
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ApiError(0, 'Cannot reach the BroadcastForge server. Is it running?');
  }
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!res.ok) {
    const d = data as { error?: string; code?: string } | null;
    if (d?.code === 'PAIRING_REQUIRED' && !location.pathname.startsWith('/pair')) {
      location.href = `/pair?next=${encodeURIComponent(location.pathname)}`;
    }
    throw new ApiError(res.status, d?.error ?? `Request failed (${res.status})`, d?.code);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body),
  put: <T>(url: string, body?: unknown) => request<T>('PUT', url, body),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body),
  del: <T>(url: string) => request<T>('DELETE', url),
};

export const assetUrl = (id: string) => `/assets/${encodeURIComponent(id)}`;

export interface SystemInfo {
  name: string;
  version: string;
  bootId: string;
  port: number;
  host: string;
  lanEnabled: boolean;
  lanAddresses: string[];
  isLocal: boolean;
  authorized: boolean;
  remoteObs: boolean;
  dev: boolean;
}

export interface ProjectSummary {
  id: string;
  name: string;
  sport: string;
  width: number;
  height: number;
  publishedVersion: number;
  publishedAt: number | null;
  createdAt: number;
  updatedAt: number;
  hasUnpublishedChanges: boolean;
}

export interface Project extends Omit<ProjectSummary, 'hasUnpublishedChanges'> {
  draft: Scene;
  draftRev: number;
  published: Scene | null;
  settings: { obsSourceName?: string; obsSceneName?: string };
}

export interface Asset {
  id: string;
  projectId: string | null;
  kind: 'image' | 'font';
  mime: string;
  originalName: string;
  size: number;
  width: number | null;
  height: number | null;
  createdAt: number;
}

export interface CommandHistory {
  commands: { id: number; commandId: string; ts: number; type: string; label: string; seq: number | null; undoable: boolean; undone: boolean }[];
}

export interface SavedPreset {
  id: string;
  name: string;
  clip: AnimationClip;
  createdAt: number;
}

export const endpoints = {
  info: () => api.get<SystemInfo>('/api/system/info'),
  projects: () => api.get<ProjectSummary[]>('/api/projects'),
  project: (id: string) => api.get<Project>(`/api/projects/${id}`),
  createProject: (body: { name: string; width: number; height: number; template: 'football' | 'blank' }) => api.post<Project>('/api/projects', body),
  saveScene: (id: string, scene: Scene, rev: number | null) => api.put<{ rev: number }>(`/api/projects/${id}/scene`, { scene, rev }),
  publish: (id: string) => api.post<PublishedScene>(`/api/projects/${id}/publish`),
  match: (id: string) => api.get<MatchSnapshot>(`/api/projects/${id}/match`),
  history: (id: string) => api.get<CommandHistory>(`/api/projects/${id}/match/history`),
  newMatch: (id: string, keepTeams: boolean) => api.post<MatchSnapshot>(`/api/projects/${id}/match/new`, { keepTeams }),
  overlayUrls: (id: string) => api.get<{ label: string; url: string }[]>(`/api/projects/${id}/overlay-urls`),
  assets: (projectId: string | null) => api.get<Asset[]>(`/api/assets${projectId ? `?projectId=${projectId}` : ''}`),
  upload: (file: Blob, name: string, projectId: string | null) => {
    const fd = new FormData();
    fd.append('file', file, name);
    if (projectId) fd.append('projectId', projectId);
    return api.post<Asset>('/api/assets', fd);
  },
  obsStatus: () => api.get<ObsStatus>('/api/obs/status'),
  presets: () => api.get<SavedPreset[]>('/api/presets'),
};
