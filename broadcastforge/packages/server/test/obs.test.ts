import { afterEach, describe, expect, it } from 'vitest';
import { startMockObs } from '../../../scripts/mock-obs.js';
import { api, boot } from './helpers.js';
import type { ObsStatus } from '@bf/shared';

const cleanup: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

async function setup(password: string | null = 'broadcast') {
  const obs = await startMockObs({ port: 0, password });
  cleanup.push(() => obs.close());
  const server = await boot();
  cleanup.push(() => server.close());
  const projectId = (await api<{ id: string }[]>(server, 'GET', '/api/projects')).body[0]!.id;
  return { obs, server, projectId };
}

const waitFor = async (fn: () => Promise<boolean> | boolean, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
};

describe('OBS integration (obs-websocket v5)', () => {
  it('authenticates and reports OBS details', async () => {
    const { obs, server } = await setup();
    await api(server, 'PUT', '/api/obs/settings', { host: '127.0.0.1', port: obs.port, password: 'broadcast', autoReconnect: false });
    const r = await api<ObsStatus>(server, 'POST', '/api/obs/connect');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ state: 'connected', obsVersion: '31.0.0-mock', websocketVersion: '5.5.0', baseWidth: 1920, currentProgramScene: 'Game Camera' });
    const scenes = await api<{ scenes: string[] }>(server, 'GET', '/api/obs/scenes');
    expect(scenes.body.scenes).toEqual(['Game Camera', 'Halftime', 'Starting Soon']);
  });

  it('explains a wrong password and does not retry it in a loop', async () => {
    const { obs, server } = await setup();
    await api(server, 'PUT', '/api/obs/settings', { host: '127.0.0.1', port: obs.port, password: 'nope', autoReconnect: true });
    const r = await api<{ error: string; status: ObsStatus }>(server, 'POST', '/api/obs/connect');
    expect(r.status).toBe(502);
    expect(r.body.error).toMatch(/Authentication failed/);
    expect(r.body.status.state).toBe('error');
  });

  it('explains an unreachable OBS', async () => {
    const { server } = await setup();
    await api(server, 'PUT', '/api/obs/settings', { host: '127.0.0.1', port: 1, autoReconnect: false });
    const r = await api<{ error: string }>(server, 'POST', '/api/obs/connect');
    expect(r.status).toBe(502);
    expect(r.body.error).toMatch(/Could not reach OBS|not respond/);
  });

  it('creates the browser source once and never duplicates it', async () => {
    const { obs, server, projectId } = await setup();
    await api(server, 'PUT', '/api/obs/settings', { host: '127.0.0.1', port: obs.port, password: 'broadcast', autoReconnect: false });
    await api(server, 'POST', '/api/obs/connect');
    const req = { projectId, sceneName: 'Game Camera', sourceName: 'BroadcastForge Scorebug', fps: 60, fitToCanvas: true };
    const first = await api<{ action: string; sceneItemId: number }>(server, 'POST', '/api/obs/browser-source', req);
    expect(first.body.action).toBe('created');
    const input = obs.state.inputs.find((i) => i.inputName === 'BroadcastForge Scorebug')!;
    expect(input.inputKind).toBe('browser_source');
    expect(input.inputSettings).toMatchObject({ url: `http://localhost:${server.port}/overlay/${projectId}`, width: 1920, height: 1080, fps: 60 });
    // Overlay sits on top of the camera.
    const scene = obs.state.scenes.find((s) => s.sceneName === 'Game Camera')!;
    expect(scene.items.at(-1)!.sourceName).toBe('BroadcastForge Scorebug');

    const again = await api<{ action: string }>(server, 'POST', '/api/obs/browser-source', req);
    expect(again.body.action).toBe('unchanged');
    // Same name, different scene: add the existing source instead of creating a second input.
    const other = await api<{ action: string }>(server, 'POST', '/api/obs/browser-source', { ...req, sceneName: 'Halftime' });
    expect(other.body.action).toBe('added-to-scene');
    // Different name but same overlay URL: reuse rather than duplicate.
    const renamed = await api<{ action: string; sourceName: string; reusedExisting: boolean }>(server, 'POST', '/api/obs/browser-source', { ...req, sourceName: 'Another name' });
    expect(renamed.body.sourceName).toBe('BroadcastForge Scorebug');
    expect(renamed.body.reusedExisting).toBe(true);
    expect(obs.state.inputs.filter((i) => i.inputKind === 'browser_source')).toHaveLength(1);

    await api(server, 'POST', '/api/obs/refresh-source', { sourceName: 'BroadcastForge Scorebug' });
    expect(obs.state.refreshes).toEqual(['BroadcastForge Scorebug']);
  });

  it('refuses to overwrite a non-browser source with the same name', async () => {
    const { obs, server, projectId } = await setup();
    await api(server, 'PUT', '/api/obs/settings', { host: '127.0.0.1', port: obs.port, password: 'broadcast', autoReconnect: false });
    await api(server, 'POST', '/api/obs/connect');
    const r = await api<{ error: string }>(server, 'POST', '/api/obs/browser-source', { projectId, sceneName: 'Game Camera', sourceName: 'Camera' });
    expect(r.status).toBe(502);
    expect(r.body.error).toMatch(/not a Browser Source/);
  });

  it('reconnects automatically after OBS drops the connection', async () => {
    const { obs, server } = await setup(null);
    await api(server, 'PUT', '/api/obs/settings', { host: '127.0.0.1', port: obs.port, autoReconnect: true });
    await api(server, 'POST', '/api/obs/connect');
    obs.dropClients();
    expect(await waitFor(async () => (await api<ObsStatus>(server, 'GET', '/api/obs/status')).body.state !== 'connected', 3000)).toBe(true);
    expect(await waitFor(async () => (await api<ObsStatus>(server, 'GET', '/api/obs/status')).body.state === 'connected', 6000)).toBe(true);
    await api(server, 'POST', '/api/obs/disconnect');
    expect((await api<ObsStatus>(server, 'GET', '/api/obs/status')).body.state).toBe('disconnected');
  });
});
