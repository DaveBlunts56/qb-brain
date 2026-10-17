import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type { Socket } from 'socket.io-client';
import type { MatchSnapshot, ProjectSummaryLike } from './types.js';
import { api, boot, command, connect, hello, nextEvents, tempDir } from './helpers.js';

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

async function setup(dataDir?: string) {
  const server = await boot(dataDir);
  cleanup.push(() => server.close());
  const projects = (await api<ProjectSummaryLike[]>(server, 'GET', '/api/projects')).body;
  const projectId = projects[0]!.id;
  return { server, projectId };
}

async function socket(server: Awaited<ReturnType<typeof boot>>): Promise<Socket> {
  const s = await connect(server);
  cleanup.push(() => void s.disconnect());
  return s;
}

describe('live match over Socket.IO', () => {
  it('seeds the example project and returns a snapshot + published scene on hello', async () => {
    const { server, projectId } = await setup();
    const s = await socket(server);
    const ack = await hello(s, projectId, 'overlay');
    expect(ack.ok).toBe(true);
    expect(ack.snapshot?.state.home.abbreviation).toBe('IRW');
    expect(ack.scene?.scene.elements.length).toBeGreaterThan(20);
    expect(ack.scene?.version).toBe(1);
  });

  it('broadcasts score changes to overlays instantly', async () => {
    const { server, projectId } = await setup();
    const control = await socket(server);
    const overlay = await socket(server);
    await hello(control, projectId, 'control');
    const ov = await hello(overlay, projectId, 'overlay');
    const before = ov.snapshot!.state.home.score;
    const evP = nextEvents(overlay);
    const ack = await command(control, projectId, { type: 'score.add', team: 'home', delta: 6 });
    expect(ack).toMatchObject({ ok: true, label: 'IRW +6' });
    const msg = await evP;
    expect(msg.events).toHaveLength(1);
    expect(msg.events[0]).toMatchObject({ type: 'SCORE_CHANGED', persistent: true, payload: { team: 'home', from: before, to: before + 6 } });
    expect(msg.events[0]!.seq).toBe(msg.snapshot.seq);
    expect(msg.snapshot.state.home.score).toBe(before + 6);
    expect(msg.events[0]!.id).toMatch(/^ev_/);
  });

  it('applies a retried command id only once (reconnect safety)', async () => {
    const { server, projectId } = await setup();
    const s = await socket(server);
    await hello(s, projectId, 'control');
    const a1 = await command(s, projectId, { type: 'score.add', team: 'away', delta: 3 }, 'retry-me-1');
    const a2 = await command(s, projectId, { type: 'score.add', team: 'away', delta: 3 }, 'retry-me-1');
    expect(a1.duplicate).toBeUndefined();
    expect(a2).toMatchObject({ ok: true, duplicate: true, seq: a1.seq });
    const snap = (await api<MatchSnapshot>(server, 'GET', `/api/projects/${projectId}/match`)).body;
    expect(snap.state.away.score).toBe(10 + 3);
  });

  it('overlays are read-only', async () => {
    const { server, projectId } = await setup();
    const s = await socket(server);
    await hello(s, projectId, 'overlay');
    const ack = await command(s, projectId, { type: 'score.add', team: 'home', delta: 6 });
    expect(ack).toMatchObject({ ok: false, error: 'Not allowed' });
  });

  it('rejects invalid and system-only commands', async () => {
    const { server, projectId } = await setup();
    const s = await socket(server);
    await hello(s, projectId, 'control');
    expect((await command(s, projectId, { type: 'score.add', team: 'home', delta: 1.5 } as never)).ok).toBe(false);
    expect((await command(s, projectId, { type: 'clock.expire', clock: 'game' })).error).toBe('Not allowed');
    expect((await command(s, 'missing', { type: 'flag.set', on: true })).error).toBe('Project not found');
  });

  it('undo reverts the last score change and survives across commands', async () => {
    const { server, projectId } = await setup();
    const s = await socket(server);
    await hello(s, projectId, 'control');
    await command(s, projectId, { type: 'score.add', team: 'home', delta: 6 });
    await command(s, projectId, { type: 'flag.set', on: true });
    let snap = (await api<MatchSnapshot>(server, 'GET', `/api/projects/${projectId}/match`)).body;
    expect(snap.undo).toMatchObject({ available: true, label: 'FLAG on' });
    const evP = nextEvents(s);
    expect((await command(s, projectId, { type: 'undo' })).label).toBe('Undo: FLAG on');
    const msg = await evP;
    expect(msg.events.map((e) => e.type)).toEqual(['FLAG_CHANGED', 'STATE_RESTORED']);
    await command(s, projectId, { type: 'undo' });
    snap = (await api<MatchSnapshot>(server, 'GET', `/api/projects/${projectId}/match`)).body;
    expect(snap.state.home.score).toBe(14);
    expect(snap.state.flag).toBe(false);
    expect((await command(s, projectId, { type: 'undo' })).error).toBe('Nothing to undo');
  });

  it('runs the game clock on the server and expires it at zero', async () => {
    const { server, projectId } = await setup();
    const s = await socket(server);
    await hello(s, projectId, 'control');
    await command(s, projectId, { type: 'clock.set', clock: 'game', ms: 300 });
    const started = await command(s, projectId, { type: 'clock.start', clock: 'game' });
    expect(started.ok).toBe(true);
    const expired = await new Promise<{ events: { type: string; payload: { reason?: string } }[] }>((resolve) => {
      s.on('match:events', (m) => {
        if (m.events.some((e: { type: string }) => e.type === 'CLOCK_PAUSED')) resolve(m);
      });
    });
    expect(expired.events.find((e) => e.type === 'CLOCK_PAUSED')!.payload.reason).toBe('expired');
    const snap = (await api<MatchSnapshot>(server, 'GET', `/api/projects/${projectId}/match`)).body;
    expect(snap.state.gameClock).toMatchObject({ running: false, remainingMs: 0 });
  });

  it('answers time pings for clock synchronisation', async () => {
    const { server, projectId } = await setup();
    const s = await socket(server);
    await hello(s, projectId, 'overlay');
    const pong = await s.timeout(2000).emitWithAck('time:ping', 123);
    expect(pong).toMatchObject({ t0: 123 });
    expect(typeof pong.serverMono).toBe('number');
  });

  it('persists state and recovers a running clock after a restart', async () => {
    const dir = tempDir();
    const first = await boot(dir);
    const projectId = (await api<ProjectSummaryLike[]>(first, 'GET', '/api/projects')).body[0]!.id;
    const s = await connect(first);
    await hello(s, projectId, 'control');
    await command(s, projectId, { type: 'score.set', team: 'away', value: 28 });
    await command(s, projectId, { type: 'clock.set', clock: 'game', ms: 120_000 });
    await command(s, projectId, { type: 'clock.start', clock: 'game' });
    s.disconnect();
    await first.close();
    await new Promise((r) => setTimeout(r, 400));
    const second = await boot(dir);
    cleanup.push(() => second.close());
    const snap = (await api<MatchSnapshot>(second, 'GET', `/api/projects/${projectId}/match`)).body;
    expect(snap.state.away.score).toBe(28);
    expect(snap.state.gameClock.running).toBe(true);
    // ~400 ms+ elapsed while the server was down is accounted for via wall time.
    expect(snap.state.gameClock.remainingMs).toBeLessThan(120_000 - 300);
    expect(snap.state.gameClock.remainingMs).toBeGreaterThan(110_000);
    // Exactly one example project after restart (no duplicate seeding).
    expect((await api<unknown[]>(second, 'GET', '/api/projects')).body).toHaveLength(1);
  });
});

describe('HTTP API', () => {
  it('creates, publishes, duplicates, exports, imports and deletes projects', async () => {
    const { server } = await setup();
    const created = await api<{ id: string; draft: { elements: unknown[] } }>(server, 'POST', '/api/projects', { name: 'Friday Night', width: 1280, height: 720, template: 'football' });
    expect(created.status).toBe(201);
    const id = created.body.id;
    const proj = (await api<{ draft: { width: number; elements: { id: string; name: string }[] }; draftRev: number }>(server, 'GET', `/api/projects/${id}`)).body;
    expect(proj.draft.width).toBe(1280);
    const scene = structuredClone(proj.draft);
    scene.elements[0]!.name = 'Renamed';
    const saved = await api<{ rev: number }>(server, 'PUT', `/api/projects/${id}/scene`, { scene, rev: proj.draftRev });
    expect(saved.status).toBe(200);
    const stale = await api<{ code: string }>(server, 'PUT', `/api/projects/${id}/scene`, { scene, rev: proj.draftRev });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('REV_CONFLICT');
    const bad = await api(server, 'PUT', `/api/projects/${id}/scene`, { scene: { version: 1 }, rev: null });
    expect(bad.status).toBe(400);
    const pub = await api<{ version: number }>(server, 'POST', `/api/projects/${id}/publish`);
    expect(pub.body.version).toBe(2);
    const dup = await api<{ id: string; name: string }>(server, 'POST', `/api/projects/${id}/duplicate`);
    expect(dup.body.name).toBe('Friday Night copy');
    const bundle = await api<{ format: string; assets: unknown[] }>(server, 'GET', `/api/projects/${id}/export`);
    expect(bundle.body.format).toBe('broadcastforge-project');
    expect(bundle.body.assets.length).toBe(2);
    const imported = await api<{ id: string }>(server, 'POST', '/api/projects/import', bundle.body);
    expect(imported.status).toBe(201);
    expect((await api(server, 'POST', '/api/projects/import', { format: 'nope' })).status).toBe(400);
    expect((await api(server, 'DELETE', `/api/projects/${id}`)).status).toBe(200);
    expect((await api(server, 'GET', `/api/projects/${id}`)).status).toBe(404);
  });

  it('validates uploads by content, not extension', async () => {
    const { server, projectId } = await setup();
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAEklEQVR4nGP4z8DwnwEIGGAMAEbmAf8zv0kZAAAAAElFTkSuQmCC',
      'base64',
    );
    const form = new FormData();
    form.append('file', new Blob([png]), 'logo.png');
    form.append('projectId', projectId);
    let res = await fetch(`${server.url}/api/assets`, { method: 'POST', body: form });
    const asset = (await res.json()) as { id: string; width: number; height: number; mime: string };
    expect(res.status).toBe(201);
    expect(asset).toMatchObject({ width: 2, height: 3, mime: 'image/png' });
    const file = await fetch(`${server.url}/assets/${asset.id}`);
    expect(file.headers.get('content-type')).toBe('image/png');

    const evil = new FormData();
    evil.append('file', new Blob(['#!/bin/sh\nrm -rf /']), 'innocent.png');
    res = await fetch(`${server.url}/api/assets`, { method: 'POST', body: evil });
    expect(res.status).toBe(400);

    const svg = new FormData();
    svg.append('file', new Blob(['<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="10" height="20"><script>alert(1)</script></svg>']), 'x.svg');
    res = await fetch(`${server.url}/api/assets`, { method: 'POST', body: svg });
    const svgAsset = (await res.json()) as { id: string; width: number };
    expect(svgAsset.width).toBe(10);
    const served = await fetch(`${server.url}/assets/${svgAsset.id}`);
    expect(served.headers.get('content-security-policy')).toContain("default-src 'none'");
  });

  it('accepts HTTP commands for external controllers', async () => {
    const { server, projectId } = await setup();
    const r = await api<{ ok: boolean; label: string }>(server, 'POST', `/api/projects/${projectId}/command`, { command: { type: 'possession.set', team: 'away' } });
    expect(r.body).toMatchObject({ ok: true, label: 'Possession BAY' });
    const bad = await api(server, 'POST', `/api/projects/${projectId}/command`, { command: { type: 'clock.expire', clock: 'game' } });
    expect(bad.status).toBe(400);
  });

  it('blocks DNS-rebinding hosts and cross-origin writes', async () => {
    const { server } = await setup();
    // fetch() refuses to override Host, so use a raw request like a rebinding attack would.
    const evilStatus = await new Promise<number>((resolve, reject) => {
      http.get({ host: '127.0.0.1', port: server.port, path: '/api/projects', headers: { Host: 'evil.example.com' } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      }).on('error', reject);
    });
    expect(evilStatus).toBe(403);
    const crossOrigin = await fetch(`${server.url}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example.com' },
      body: JSON.stringify({ name: 'x', width: 1920, height: 1080, template: 'blank' }),
    });
    expect(crossOrigin.status).toBe(403);
  });

  it('never exposes the OBS password', async () => {
    const { server } = await setup();
    const r = await api<Record<string, unknown>>(server, 'PUT', '/api/obs/settings', { host: '127.0.0.1', port: 4455, password: 'super-secret' });
    expect(r.body.hasPassword).toBe(true);
    expect(JSON.stringify(r.body)).not.toContain('super-secret');
    const status = await api(server, 'GET', '/api/obs/status');
    expect(JSON.stringify(status.body)).not.toContain('super-secret');
  });
});
