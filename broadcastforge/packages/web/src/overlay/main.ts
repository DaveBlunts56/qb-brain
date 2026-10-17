import '../fonts';
import '../render/renderer.css';
import './overlay.css';
import { LiveConnection } from '../lib/live';
import { SceneRenderer } from '../render/SceneRenderer';

/**
 * The OBS Browser Source page. Display only: no controls, transparent
 * background, state comes exclusively from the server. Works without any
 * dashboard open and recovers the full state after refresh or reconnect.
 *
 * Query options (for browser previews; OBS needs none):
 *   ?checker=1   checkerboard transparency preview
 *   ?status=1    show a small connection indicator
 */
const params = new URLSearchParams(location.search);
const projectId = decodeURIComponent(location.pathname.split('/')[2] ?? '');
const isObs = /OBS\//.test(navigator.userAgent) || 'obsstudio' in window;
const showStatus = params.get('status') === '1' || (!isObs && params.get('status') !== '0');

document.documentElement.classList.toggle('checker', params.get('checker') === '1');
const container = document.getElementById('overlay')!;

// The renderer needs server time from the connection, and the connection drives the renderer.
const live: { conn: LiveConnection | null } = { conn: null };
const renderer = new SceneRenderer(container, {
  mode: 'overlay',
  fit: 'contain',
  assetUrl: (id) => `/assets/${encodeURIComponent(id)}`,
  now: () => live.conn?.serverNow() ?? performance.now(),
  onMissingAsset: (id) => console.warn(`[BroadcastForge] missing asset ${id}`),
  onQualityChange: (q) => console.info(`[BroadcastForge] render quality: ${q}`),
});

const statusEl = document.getElementById('status')!;
statusEl.hidden = !showStatus;

const conn = new LiveConnection(projectId, 'overlay', {
  onScene: (pub) => {
    renderer.setScene(pub.scene);
    if (conn.snapshot) renderer.setState(conn.snapshot.state, false);
  },
  onSnapshot: (snap) => renderer.setState(snap.state, false),
  onEvents: (msg) => {
    if (msg.events.some((e) => e.type === 'GRAPHICS_CLEARED')) renderer.clearGraphics();
    renderer.setState(msg.snapshot.state, true);
    renderer.handleEvents(msg.events);
  },
  onStatus: (s) => {
    statusEl.dataset.state = s.state;
    statusEl.textContent = s.state === 'connected' ? `● LIVE ${s.rttMs ?? '–'} ms` : s.state === 'error' ? `● ${s.error}` : `● ${s.state}…`;
  },
  onReload: () => location.reload(),
});
live.conn = conn;

if (!projectId) {
  statusEl.hidden = false;
  statusEl.textContent = 'No project id in URL (expected /overlay/PROJECT_ID)';
} else {
  conn.start();
}

window.addEventListener('keydown', (e) => {
  if (isObs) return;
  if (e.key === 'f') void (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen());
  if (e.key === 'c') document.documentElement.classList.toggle('checker');
  if (e.key === 's') statusEl.hidden = !statusEl.hidden;
});
