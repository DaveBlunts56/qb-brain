import crypto from 'node:crypto';
import os from 'node:os';
import type { IncomingMessage } from 'node:http';
import type { NextFunction, Request, Response } from 'express';
import { lanAddresses, type AppConfig } from '../config.js';
import type { Store } from '../db/store.js';

/**
 * Trust model (local-first):
 *  - Requests from this machine (loopback) are the operator: fully trusted.
 *  - Other devices must pair once with a short code shown in Settings on the
 *    host machine. Pairing sets an HttpOnly session cookie.
 *  - Overlay pages (read-only) may be opened from other machines without
 *    pairing so OBS can run elsewhere; set BF_PUBLIC_OVERLAY=false to require pairing.
 *  - The OBS connection (and its password) can only be managed from this
 *    machine unless BF_REMOTE_OBS=true.
 *  - Host headers are checked against known names to block DNS rebinding,
 *    and state-changing requests must come from our own origin.
 */

const COOKIE = 'bf_session';
const PAIR_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function isLoopback(addr: string | undefined): boolean {
  if (!addr) return false;
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1' || addr.startsWith('127.');
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export class Security {
  private allowedHosts: Set<string>;
  private pairAttempts = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly config: AppConfig,
    private readonly store: Store,
  ) {
    const host = os.hostname().toLowerCase();
    this.allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1', host, `${host}.local`, ...lanAddresses(), ...config.allowedHosts]);
    if (!this.store.getSetting<string>('pairingCode')) this.regeneratePairingCode();
  }

  get pairingCode(): string {
    return this.store.getSetting<string>('pairingCode') ?? '';
  }

  regeneratePairingCode(): string {
    const bytes = crypto.randomBytes(8);
    let code = '';
    for (let i = 0; i < 8; i++) code += PAIR_ALPHABET[bytes[i]! % PAIR_ALPHABET.length];
    code = `${code.slice(0, 4)}-${code.slice(4)}`;
    this.store.setSetting('pairingCode', code);
    return code;
  }

  /** Accept only Host headers that name this machine (DNS-rebinding protection). */
  hostAllowed(hostHeader: string | undefined): boolean {
    if (!hostHeader) return false;
    let host = hostHeader.toLowerCase();
    if (host.startsWith('[')) host = host.slice(0, host.indexOf(']') + 1);
    else host = host.replace(/:\d+$/, '');
    if (this.allowedHosts.has(host)) return true;
    // Interfaces can change at runtime (Wi-Fi join); re-check live addresses.
    if (lanAddresses().includes(host)) {
      this.allowedHosts.add(host);
      return true;
    }
    return false;
  }

  /** Same-origin check for state-changing requests and socket connections. */
  originAllowed(origin: string | undefined, hostHeader: string | undefined): boolean {
    if (!origin) return true; // non-browser clients (curl, Companion, OBS) send no Origin
    try {
      const u = new URL(origin);
      return u.host.toLowerCase() === (hostHeader ?? '').toLowerCase() && this.hostAllowed(u.host);
    } catch {
      return false;
    }
  }

  isAuthorized(req: IncomingMessage): boolean {
    if (isLoopback(req.socket.remoteAddress)) return true;
    const token = parseCookies(req.headers.cookie)[COOKIE];
    return Boolean(token && this.store.touchSession(hashToken(token)));
  }

  isLocal(req: IncomingMessage): boolean {
    return isLoopback(req.socket.remoteAddress);
  }

  /** Brute-force-limited pairing. Returns a session token on success. */
  pair(ip: string, code: string, label: string): { ok: true; token: string } | { ok: false; error: string } {
    const now = Date.now();
    const a = this.pairAttempts.get(ip);
    if (a && a.resetAt > now && a.count >= 5) return { ok: false, error: 'Too many attempts. Wait a minute and try again.' };
    const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const expected = this.pairingCode.replace(/-/g, '');
    const ok = normalized.length === expected.length && crypto.timingSafeEqual(Buffer.from(normalized), Buffer.from(expected));
    if (!ok) {
      this.pairAttempts.set(ip, { count: (a && a.resetAt > now ? a.count : 0) + 1, resetAt: a && a.resetAt > now ? a.resetAt : now + 60_000 });
      return { ok: false, error: 'That code is not correct.' };
    }
    this.pairAttempts.delete(ip);
    const token = crypto.randomBytes(32).toString('base64url');
    this.store.insertSession(hashToken(token), label.slice(0, 60) || 'Remote device');
    return { ok: true, token };
  }

  sessionCookie(token: string): string {
    return `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${60 * 60 * 24 * 180}`;
  }

  // ---- express middleware -------------------------------------------------

  hostGuard = (req: Request, res: Response, next: NextFunction) => {
    if (!this.hostAllowed(req.headers.host)) {
      res
        .status(403)
        .type('text/plain')
        .send(`Host "${req.headers.host}" is not allowed. Add it to BF_ALLOWED_HOSTS if you reach BroadcastForge through a custom hostname.`);
      return;
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !this.originAllowed(req.headers.origin, req.headers.host)) {
      res.status(403).json({ error: 'Cross-origin request blocked' });
      return;
    }
    next();
  };

  requireAuth = (req: Request, res: Response, next: NextFunction) => {
    if (this.isAuthorized(req)) return next();
    res.status(401).json({ error: 'This device is not paired. Open /pair and enter the code shown in Settings on the BroadcastForge computer.', code: 'PAIRING_REQUIRED' });
  };

  requireLocal = (req: Request, res: Response, next: NextFunction) => {
    if (this.isLocal(req)) return next();
    res.status(403).json({ error: 'This action is only available on the BroadcastForge computer itself.' });
  };

  requireObsAccess = (req: Request, res: Response, next: NextFunction) => {
    if (this.isLocal(req) || (this.config.remoteObs && this.isAuthorized(req))) return next();
    res.status(403).json({ error: 'OBS settings can only be changed on the BroadcastForge computer (set BF_REMOTE_OBS=true to allow paired devices).' });
  };
}
