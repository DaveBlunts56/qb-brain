import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { openDatabase } from '../src/db/database.js';
import { Store } from '../src/db/store.js';
import { detectType, imageSize } from '../src/http/uploads.js';
import { hashToken, isLoopback, Security } from '../src/security/auth.js';
import { tempDir } from './helpers.js';

function setup(env: Record<string, string> = {}) {
  const dir = tempDir();
  const store = new Store(openDatabase(dir, ':memory:'));
  const config = loadConfig([], { BF_DATA_DIR: dir, ...env });
  return { store, sec: new Security(config, store) };
}

const req = (remoteAddress: string, cookie?: string) => ({ socket: { remoteAddress }, headers: cookie ? { cookie } : {} }) as unknown as IncomingMessage;

describe('trust model', () => {
  it('trusts loopback clients and nobody else by default', () => {
    const { sec } = setup();
    expect(isLoopback('127.0.0.1')).toBe(true);
    expect(isLoopback('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopback('::1')).toBe(true);
    expect(isLoopback('192.168.1.20')).toBe(false);
    expect(sec.isAuthorized(req('127.0.0.1'))).toBe(true);
    expect(sec.isAuthorized(req('192.168.1.20'))).toBe(false);
  });

  it('pairs a remote device with the code and authorises its cookie', () => {
    const { sec } = setup();
    const r = sec.pair('192.168.1.20', sec.pairingCode.toLowerCase(), 'iPad');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const cookie = sec.sessionCookie(r.token);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(sec.isAuthorized(req('192.168.1.20', `bf_session=${encodeURIComponent(r.token)}`))).toBe(true);
    expect(sec.isAuthorized(req('192.168.1.20', 'bf_session=forged'))).toBe(false);
  });

  it('rate-limits wrong pairing codes per address', () => {
    const { sec } = setup();
    for (let i = 0; i < 5; i++) expect(sec.pair('10.0.0.9', 'AAAA-AAAA', 'x').ok).toBe(false);
    const blocked = sec.pair('10.0.0.9', sec.pairingCode, 'x');
    expect(blocked).toMatchObject({ ok: false, error: expect.stringMatching(/Too many/) });
    expect(sec.pair('10.0.0.10', sec.pairingCode, 'x').ok).toBe(true); // other devices unaffected
  });

  it('regenerating the code invalidates the old one but keeps paired sessions', () => {
    const { sec, store } = setup();
    const old = sec.pairingCode;
    const r = sec.pair('10.0.0.2', old, 'x');
    const next = sec.regeneratePairingCode();
    expect(next).not.toBe(old);
    expect(next).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(sec.pair('10.0.0.3', old, 'y').ok).toBe(false);
    if (r.ok) expect(store.touchSession(hashToken(r.token))).toBe(true);
  });
});

describe('DNS rebinding & CSRF protection', () => {
  it('accepts only hostnames that name this machine', () => {
    const { sec } = setup({ BF_ALLOWED_HOSTS: 'studio.lan' });
    expect(sec.hostAllowed('localhost:3000')).toBe(true);
    expect(sec.hostAllowed('127.0.0.1:3000')).toBe(true);
    expect(sec.hostAllowed('[::1]:3000')).toBe(true);
    expect(sec.hostAllowed('studio.lan:3000')).toBe(true);
    expect(sec.hostAllowed('attacker.example:3000')).toBe(false);
    expect(sec.hostAllowed(undefined)).toBe(false);
  });

  it('requires same-origin for browser requests', () => {
    const { sec } = setup();
    expect(sec.originAllowed(undefined, 'localhost:3000')).toBe(true); // curl / Companion
    expect(sec.originAllowed('http://localhost:3000', 'localhost:3000')).toBe(true);
    expect(sec.originAllowed('http://evil.example', 'localhost:3000')).toBe(false);
    expect(sec.originAllowed('http://localhost:3001', 'localhost:3000')).toBe(false);
    expect(sec.originAllowed('not a url', 'localhost:3000')).toBe(false);
  });
});

describe('upload content detection', () => {
  it('identifies formats by magic bytes, not names', () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000280000001e008060000', 'hex');
    expect(detectType(png)?.mime).toBe('image/png');
    expect(imageSize(png, 'image/png')).toEqual({ width: 640, height: 480 });
    expect(detectType(Buffer.from('ffd8ffe000104a46494600010100', 'hex'))?.mime).toBe('image/jpeg');
    expect(detectType(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'binary'))?.mime).toBe('image/webp');
    expect(detectType(Buffer.from('wOF2\0\0\0\0\0\0\0\0'))?.mime).toBe('font/woff2');
    expect(detectType(Buffer.from('﻿<?xml version="1.0"?><!-- c --><svg viewBox="0 0 10 20"></svg>'))?.mime).toBe('image/svg+xml');
    expect(detectType(Buffer.from('<html><script>alert(1)</script></html>'))).toBeNull();
    expect(detectType(Buffer.from('#!/bin/sh echo hi there'))).toBeNull();
    expect(imageSize(Buffer.from('<svg viewBox="0 0 120 40">'), 'image/svg+xml')).toEqual({ width: 120, height: 40 });
  });
});
