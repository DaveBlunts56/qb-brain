import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientRole, EventsMessage, GameCommand, MatchSnapshot, ObsStatus, PresenceInfo, PublishedScene } from '@bf/shared';
import { LiveConnection, type ConnectionStatus } from './live';
import { toast } from '../components/toast';

export interface LiveHandle {
  conn: LiveConnection | null;
  snapshot: MatchSnapshot | null;
  scene: PublishedScene | null;
  status: ConnectionStatus;
  presence: PresenceInfo | null;
  obs: ObsStatus | null;
  /** Send a command; failures are surfaced as toasts. Returns true on success. */
  send: (cmd: GameCommand) => Promise<boolean>;
  /** Subscribe to live event batches (for animation previews, logs). */
  onEvents: (fn: (msg: EventsMessage) => void) => () => void;
}

export function useLive(projectId: string | undefined, role: ClientRole): LiveHandle {
  const [snapshot, setSnapshot] = useState<MatchSnapshot | null>(null);
  const [scene, setScene] = useState<PublishedScene | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>({ state: 'connecting', rttMs: null, resyncing: false });
  const [presence, setPresence] = useState<PresenceInfo | null>(null);
  const [obs, setObs] = useState<ObsStatus | null>(null);
  const connRef = useRef<LiveConnection | null>(null);
  const listeners = useRef(new Set<(msg: EventsMessage) => void>());

  useEffect(() => {
    if (!projectId) return;
    const conn = new LiveConnection(projectId, role, {
      onSnapshot: (s) => setSnapshot(s),
      onEvents: (msg) => {
        setSnapshot(msg.snapshot);
        for (const l of listeners.current) l(msg);
      },
      onScene: (s) => setScene(s),
      onStatus: (s) => setStatus(s),
      onPresence: (p) => setPresence(p),
      onObsStatus: (o) => setObs(o),
    });
    connRef.current = conn;
    conn.start();
    return () => {
      conn.stop();
      connRef.current = null;
    };
  }, [projectId, role]);

  const send = useCallback(async (cmd: GameCommand) => {
    const conn = connRef.current;
    if (!conn) return false;
    const ack = await conn.send(cmd);
    if (!ack.ok) {
      toast.error(ack.error ?? 'Command failed');
      return false;
    }
    return true;
  }, []);

  const onEvents = useCallback((fn: (msg: EventsMessage) => void) => {
    listeners.current.add(fn);
    return () => listeners.current.delete(fn);
  }, []);

  return { conn: connRef.current, snapshot, scene, status, presence, obs, send, onEvents };
}
