import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { io as ioClient, type Socket } from 'socket.io-client';
import type { CommandAck, EventsMessage, GameCommand, HelloAck } from '@bf/shared';
import { loadConfig } from '../src/config.js';
import { startServer, type RunningServer } from '../src/server.js';

export function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bf-test-'));
}

export async function boot(dataDir = tempDir(), extraEnv: Record<string, string> = {}): Promise<RunningServer & { dataDir: string }> {
  const config = loadConfig([], { PORT: '0', BF_DATA_DIR: dataDir, LOG_LEVEL: 'error', ...extraEnv });
  const server = await startServer(config, { headless: true });
  return Object.assign(server, { dataDir });
}

export function connect(server: RunningServer): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = ioClient(server.url, { transports: ['websocket'], forceNew: true, reconnection: false });
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });
}

export function hello(s: Socket, projectId: string, role: 'overlay' | 'control' | 'editor' = 'control'): Promise<HelloAck> {
  return s.timeout(3000).emitWithAck('hello', { role, projectId });
}

let n = 0;
export function command(s: Socket, projectId: string, command: GameCommand, commandId = `test-${Date.now()}-${n++}`): Promise<CommandAck> {
  return s.timeout(3000).emitWithAck('command', { commandId, projectId, command });
}

export function nextEvents(s: Socket): Promise<EventsMessage> {
  return new Promise((resolve) => s.once('match:events', resolve));
}

export async function api<T = unknown>(server: RunningServer, method: string, url: string, body?: unknown): Promise<{ status: number; body: T }> {
  const res = await fetch(server.url + url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: (text ? JSON.parse(text) : null) as T };
}
