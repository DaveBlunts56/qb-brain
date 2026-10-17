import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Root of the broadcastforge workspace (works from src/ under tsx and from dist/ when bundled). */
export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export interface AppConfig {
  port: number;
  host: string;
  dev: boolean;
  lan: boolean;
  dataDir: string;
  webRoot: string;
  webDist: string;
  /** Extra hostnames accepted in the Host header (DNS-rebinding protection). */
  allowedHosts: string[];
  /** Allow paired remote devices to manage the OBS connection (off by default). */
  remoteObs: boolean;
  /** Allow overlay pages from other machines without pairing (read-only). */
  publicOverlay: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  obs: { host: string; port: number; password: string | null };
}

function loadDotEnv() {
  for (const file of ['.env.local', '.env']) {
    const p = path.join(ROOT_DIR, file);
    if (fs.existsSync(p)) {
      try {
        process.loadEnvFile(p);
      } catch {
        // ignore malformed env files; explicit env vars still apply
      }
    }
  }
}

function bool(v: string | undefined, def: boolean): boolean {
  if (v === undefined || v === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}

export function loadConfig(argv = process.argv.slice(2), env = process.env): AppConfig {
  loadDotEnv();
  const arg = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? (argv[i + 1] ?? '') : undefined;
  };
  const lan = argv.includes('--lan') || bool(env.BF_LAN, false);
  const dev = argv.includes('--dev') || env.NODE_ENV === 'development';
  const port = Number(arg('port') ?? env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`Invalid PORT "${port}"`);
  const dataDir = path.resolve(ROOT_DIR, arg('data') ?? env.BF_DATA_DIR ?? 'data');
  return {
    port,
    host: arg('host') ?? env.HOST ?? (lan ? '0.0.0.0' : '127.0.0.1'),
    dev,
    lan,
    dataDir,
    webRoot: path.join(ROOT_DIR, 'packages/web'),
    webDist: path.join(ROOT_DIR, 'packages/web/dist'),
    allowedHosts: (env.BF_ALLOWED_HOSTS ?? '')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
    remoteObs: bool(env.BF_REMOTE_OBS, false),
    publicOverlay: bool(env.BF_PUBLIC_OVERLAY, true),
    logLevel: (env.LOG_LEVEL as AppConfig['logLevel']) ?? 'info',
    obs: {
      host: env.OBS_HOST ?? '127.0.0.1',
      port: Number(env.OBS_PORT ?? 4455),
      password: env.OBS_PASSWORD || null,
    },
  };
}

/** IPv4 addresses of this machine's non-internal interfaces (for LAN URLs and host checks). */
export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}
