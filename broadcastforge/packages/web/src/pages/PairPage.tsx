import { useState } from 'react';
import { Smartphone } from 'lucide-react';
import { api } from '../lib/api';
import { Button } from '../components/ui';

export function PairPage() {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const next = new URLSearchParams(location.search).get('next') ?? '/';

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/pair', { code, label: `${navigator.platform || 'Device'} · ${navigator.userAgent.match(/(Chrome|Safari|Firefox|Edg)\/[\d.]+/)?.[0] ?? 'browser'}` });
      location.href = next.startsWith('/') && !next.startsWith('//') ? next : '/';
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-full items-center justify-center p-6">
      <div className="panel w-full max-w-sm p-6 text-center">
        <Smartphone className="mx-auto h-10 w-10 text-accent" />
        <h1 className="mt-3 font-display text-2xl font-bold">Pair this device</h1>
        <p className="mt-1 text-sm text-ink-400">Enter the code shown on the BroadcastForge computer under Settings → Remote control.</p>
        <input
          className="field mt-5 text-center font-mono text-2xl uppercase tracking-[0.25em]"
          value={code}
          maxLength={9}
          placeholder="XXXX-XXXX"
          autoFocus
          autoCapitalize="characters"
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
        />
        {error && <div className="mt-3 text-sm text-red-300">{error}</div>}
        <Button variant="primary" size="lg" className="mt-4 w-full" onClick={submit} disabled={busy || code.replace(/[^A-Z0-9]/g, '').length < 8}>
          {busy ? 'Pairing…' : 'Pair'}
        </Button>
      </div>
    </div>
  );
}
