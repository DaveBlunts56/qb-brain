/**
 * A small stand-in for OBS Studio's obs-websocket v5 server, used by the
 * automated tests and for trying the OBS Connection page without OBS:
 *
 *   npm run mock:obs            # ws://127.0.0.1:4455, password "broadcast"
 *   npm run mock:obs -- 4460 secret
 *
 * It implements the handshake (Hello/Identify/Identified with the real
 * challenge/salt authentication) and the requests BroadcastForge uses.
 */
import crypto from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';

interface Input {
  inputName: string;
  inputKind: string;
  unversionedInputKind: string;
  inputSettings: Record<string, unknown>;
}

export interface MockObsState {
  scenes: { sceneName: string; items: { sceneItemId: number; sourceName: string; transform: Record<string, unknown> }[] }[];
  inputs: Input[];
  currentProgramScene: string;
  refreshes: string[];
  video: { baseWidth: number; baseHeight: number; outputWidth: number; outputHeight: number };
}

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('base64');

export function startMockObs(opts: { port?: number; password?: string | null } = {}): Promise<{ port: number; state: MockObsState; close: () => Promise<void>; dropClients: () => void }> {
  const state: MockObsState = {
    scenes: [
      { sceneName: 'Game Camera', items: [{ sceneItemId: 1, sourceName: 'Camera', transform: {} }] },
      { sceneName: 'Halftime', items: [] },
      { sceneName: 'Starting Soon', items: [] },
    ],
    inputs: [{ inputName: 'Camera', inputKind: 'v4l2_input', unversionedInputKind: 'v4l2_input', inputSettings: {} }],
    currentProgramScene: 'Game Camera',
    refreshes: [],
    video: { baseWidth: 1920, baseHeight: 1080, outputWidth: 1920, outputHeight: 1080 },
  };
  let nextItemId = 10;
  const password = opts.password ?? null;

  const wss = new WebSocketServer({
    port: opts.port ?? 4455,
    host: '127.0.0.1',
    handleProtocols: (protocols) => (protocols.has('obswebsocket.json') ? 'obswebsocket.json' : false),
  });

  const handle = (requestType: string, d: Record<string, unknown>): { code: number; comment?: string; data?: unknown } => {
    const scene = (name: unknown) => state.scenes.find((s) => s.sceneName === name);
    const input = (name: unknown) => state.inputs.find((i) => i.inputName === name);
    switch (requestType) {
      case 'GetVersion':
        return { code: 100, data: { obsVersion: '31.0.0-mock', obsWebSocketVersion: '5.5.0', rpcVersion: 1, availableRequests: [], supportedImageFormats: [], platform: 'mock', platformDescription: 'Mock OBS' } };
      case 'GetStats':
        return { code: 100, data: { activeFps: 60 } };
      case 'GetVideoSettings':
        return { code: 100, data: { ...state.video, fpsNumerator: 60, fpsDenominator: 1 } };
      case 'GetSceneList':
        return {
          code: 100,
          data: {
            currentProgramSceneName: state.currentProgramScene,
            currentPreviewSceneName: null,
            scenes: state.scenes.map((s, i) => ({ sceneName: s.sceneName, sceneIndex: state.scenes.length - 1 - i })),
          },
        };
      case 'GetInputList':
        return { code: 100, data: { inputs: state.inputs.filter((i) => !d.inputKind || i.inputKind === d.inputKind).map(({ inputSettings: _s, ...rest }) => rest) } };
      case 'GetInputSettings': {
        const i = input(d.inputName);
        if (!i) return { code: 600, comment: 'No source was found by the name of `' + String(d.inputName) + '`.' };
        return { code: 100, data: { inputSettings: i.inputSettings, inputKind: i.inputKind } };
      }
      case 'CreateInput': {
        const s = scene(d.sceneName);
        if (!s) return { code: 600, comment: 'No scene was found' };
        if (input(d.inputName)) return { code: 601, comment: 'A source already exists by that input name.' };
        state.inputs.push({ inputName: String(d.inputName), inputKind: String(d.inputKind), unversionedInputKind: String(d.inputKind), inputSettings: (d.inputSettings as Record<string, unknown>) ?? {} });
        const sceneItemId = nextItemId++;
        s.items.push({ sceneItemId, sourceName: String(d.inputName), transform: {} });
        return { code: 100, data: { inputUuid: crypto.randomUUID(), sceneItemId } };
      }
      case 'SetInputSettings': {
        const i = input(d.inputName);
        if (!i) return { code: 600, comment: 'No source' };
        i.inputSettings = d.overlay === false ? (d.inputSettings as Record<string, unknown>) : { ...i.inputSettings, ...(d.inputSettings as Record<string, unknown>) };
        return { code: 100 };
      }
      case 'GetSceneItemList': {
        const s = scene(d.sceneName);
        if (!s) return { code: 600, comment: 'No scene' };
        return { code: 100, data: { sceneItems: s.items.map((it, idx) => ({ sceneItemId: it.sceneItemId, sourceName: it.sourceName, sceneItemIndex: idx, sceneItemEnabled: true })) } };
      }
      case 'CreateSceneItem': {
        const s = scene(d.sceneName);
        if (!s || !input(d.sourceName)) return { code: 600, comment: 'Not found' };
        const sceneItemId = nextItemId++;
        s.items.push({ sceneItemId, sourceName: String(d.sourceName), transform: {} });
        return { code: 100, data: { sceneItemId } };
      }
      case 'SetSceneItemTransform': {
        const it = scene(d.sceneName)?.items.find((x) => x.sceneItemId === d.sceneItemId);
        if (!it) return { code: 600, comment: 'Not found' };
        it.transform = { ...it.transform, ...(d.sceneItemTransform as Record<string, unknown>) };
        return { code: 100 };
      }
      case 'SetSceneItemIndex': {
        const s = scene(d.sceneName);
        const idx = s?.items.findIndex((x) => x.sceneItemId === d.sceneItemId) ?? -1;
        if (!s || idx < 0) return { code: 600, comment: 'Not found' };
        const [it] = s.items.splice(idx, 1);
        s.items.splice(Number(d.sceneItemIndex), 0, it!);
        return { code: 100 };
      }
      case 'PressInputPropertiesButton':
        if (!input(d.inputName)) return { code: 600, comment: 'Not found' };
        state.refreshes.push(String(d.inputName));
        return { code: 100 };
      default:
        return { code: 204, comment: `Mock OBS does not implement ${requestType}` };
    }
  };

  wss.on('connection', (ws: WebSocket) => {
    const challenge = crypto.randomBytes(16).toString('base64');
    const salt = crypto.randomBytes(16).toString('base64');
    let identified = false;
    ws.send(JSON.stringify({ op: 0, d: { obsWebSocketVersion: '5.5.0', rpcVersion: 1, ...(password ? { authentication: { challenge, salt } } : {}) } }));
    ws.on('message', (raw) => {
      let msg: { op: number; d: Record<string, unknown> };
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return ws.close(4002, 'Unable to parse');
      }
      if (msg.op === 1) {
        if (password) {
          const expected = sha(sha(password + salt) + challenge);
          if (msg.d.authentication !== expected) return ws.close(4009, 'Authentication failed.');
        }
        identified = true;
        return ws.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }));
      }
      if (!identified) return ws.close(4007, 'Not identified');
      if (msg.op === 6) {
        const { requestType, requestId, requestData } = msg.d as { requestType: string; requestId: string; requestData?: Record<string, unknown> };
        const r = handle(requestType, requestData ?? {});
        ws.send(
          JSON.stringify({
            op: 7,
            d: { requestType, requestId, requestStatus: { result: r.code === 100, code: r.code, ...(r.comment ? { comment: r.comment } : {}) }, ...(r.data ? { responseData: r.data } : {}) },
          }),
        );
      }
    });
  });

  return new Promise((resolve, reject) => {
    wss.once('error', reject);
    wss.once('listening', () => {
      const addr = wss.address();
      resolve({
        port: typeof addr === 'object' && addr ? addr.port : (opts.port ?? 4455),
        state,
        dropClients: () => {
          for (const c of wss.clients) c.terminate();
        },
        close: () =>
          new Promise<void>((r) => {
            for (const c of wss.clients) c.terminate();
            wss.close(() => r());
          }),
      });
    });
  });
}

// CLI entry: `npm run mock:obs -- [port] [password]`
if (process.argv[1] && /mock-obs\.ts$/.test(process.argv[1])) {
  const port = Number(process.argv[2] ?? 4455);
  const password = process.argv[3] ?? 'broadcast';
  startMockObs({ port, password }).then(({ port: p }) => {
    console.log(`Mock OBS (obs-websocket v5) listening on ws://127.0.0.1:${p}  password: "${password}"`);
    console.log('Scenes: Game Camera, Halftime, Starting Soon. Ctrl+C to stop.');
  });
}
