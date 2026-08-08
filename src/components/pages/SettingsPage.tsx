import { useEffect, useState } from 'react';
import { useDependency } from '@/hooks/useContainer';
import { TOKENS } from '@/di/tokens';
import type { AiProviderClient } from '@/modules/ai/AiProviderClient';

interface HealthState {
  status: string;
  config: Record<string, unknown>;
  error?: string;
}

export function SettingsPage() {
  const ai = useDependency<AiProviderClient>(TOKENS.aiProvider);
  const [health, setHealth] = useState<HealthState | null>(null);

  useEffect(() => {
    void ai
      .health()
      .then((h) => setHealth({ status: h.status, config: h.config }))
      .catch((e) => setHealth({ status: 'error', config: {}, error: e instanceof Error ? e.message : String(e) }));
  }, [ai]);

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <h2 className="font-heading text-lg font-semibold text-foreground">Settings</h2>

      <div className="rounded-lg border border-border bg-muted/20 p-4">
        <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Backend status</h3>
        {!health && <p className="text-sm text-muted-foreground">Checking backend…</p>}
        {health?.status === 'error' && (
          <p className="text-sm text-destructive">
            Backend unreachable. Start it with <code className="rounded bg-muted px-1">npm run dev:server</code>.
            {health.error && <span className="block text-xs opacity-70">{health.error}</span>}
          </p>
        )}
        {health?.status === 'ok' && (
          <div className="space-y-1 text-sm text-foreground">
            <p>
              Status: <span className="font-medium text-status-success">{health.status}</span>
            </p>
            {Object.entries(health.config).map(([k, v]) => (
              <p key={k} className="text-muted-foreground">
                {k}: <span className="text-foreground">{String(v)}</span>
              </p>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
        <h3 className="mb-2 text-xs font-semibold uppercase text-foreground">Configuration</h3>
        <p>AI credentials and Bright Data configuration live server-side in <code className="rounded bg-muted px-1">server/.env</code>.</p>
        <p className="mt-1">See <code className="rounded bg-muted px-1">.env.example</code> for the full list of supported variables.</p>
      </div>
    </div>
  );
}
