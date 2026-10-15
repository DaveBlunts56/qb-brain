import type { Difficulty } from "../core/match";
import type { KeyValueStore } from "./storage";

export type CameraZoom = "near" | "normal" | "far";

export interface Settings {
  sound: boolean;
  /** 0..1 */
  volume: number;
  quarterMinutes: 2 | 3 | 5;
  difficulty: Difficulty;
  camera: CameraZoom;
  /** Joystick on the right, throw buttons on the left. */
  leftHanded: boolean;
  /** Show faint route lines after the snap (learning aid). */
  routesDuringPlay: boolean;
  userTeam: string;
  cpuTeam: string;
}

export interface Records {
  played: number;
  wins: number;
  losses: number;
  ties: number;
  bestMargin: number;
}

export const DEFAULT_SETTINGS: Settings = {
  sound: true,
  volume: 0.7,
  quarterMinutes: 3,
  difficulty: "pro",
  camera: "normal",
  leftHanded: false,
  routesDuringPlay: false,
  userTeam: "gulls",
  cpuTeam: "rattlers",
};

export const DEFAULT_RECORDS: Records = { played: 0, wins: 0, losses: 0, ties: 0, bestMargin: 0 };

const SETTINGS_KEY = "settings.v1";
const RECORDS_KEY = "records.v1";

/** Merges stored values over defaults and drops anything malformed. */
export function sanitizeSettings(raw: unknown): Settings {
  const s = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== "object") return s;
  const r = raw as Record<string, unknown>;
  if (typeof r.sound === "boolean") s.sound = r.sound;
  if (typeof r.volume === "number" && r.volume >= 0 && r.volume <= 1) s.volume = r.volume;
  if (r.quarterMinutes === 2 || r.quarterMinutes === 3 || r.quarterMinutes === 5) s.quarterMinutes = r.quarterMinutes;
  if (r.difficulty === "rookie" || r.difficulty === "pro" || r.difficulty === "allpro") s.difficulty = r.difficulty;
  if (r.camera === "near" || r.camera === "normal" || r.camera === "far") s.camera = r.camera;
  if (typeof r.leftHanded === "boolean") s.leftHanded = r.leftHanded;
  if (typeof r.routesDuringPlay === "boolean") s.routesDuringPlay = r.routesDuringPlay;
  if (typeof r.userTeam === "string") s.userTeam = r.userTeam;
  if (typeof r.cpuTeam === "string") s.cpuTeam = r.cpuTeam;
  return s;
}

export class SettingsStore {
  settings: Settings = { ...DEFAULT_SETTINGS };
  records: Records = { ...DEFAULT_RECORDS };
  private listeners = new Set<(s: Settings) => void>();

  constructor(private store: KeyValueStore) {}

  get storageKind() {
    return this.store.kind;
  }

  async load(): Promise<void> {
    this.settings = sanitizeSettings(await this.store.get(SETTINGS_KEY));
    const rec = await this.store.get<Records>(RECORDS_KEY);
    if (rec && typeof rec.played === "number") this.records = { ...DEFAULT_RECORDS, ...rec };
  }

  update(patch: Partial<Settings>): void {
    this.settings = sanitizeSettings({ ...this.settings, ...patch });
    void this.store.set(SETTINGS_KEY, this.settings);
    for (const l of this.listeners) l(this.settings);
  }

  onChange(fn: (s: Settings) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  recordGame(user: number, cpu: number): void {
    const r = this.records;
    r.played++;
    if (user > cpu) r.wins++;
    else if (user < cpu) r.losses++;
    else r.ties++;
    r.bestMargin = Math.max(r.bestMargin, user - cpu);
    void this.store.set(RECORDS_KEY, r);
  }
}
