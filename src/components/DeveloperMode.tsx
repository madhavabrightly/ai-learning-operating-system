import { useCallback, useEffect, useState } from 'react';
import { X, Activity, Cpu, HardDrive, Wifi, Gauge } from 'lucide-react';
import { cn } from '@/utils/cn';
import { useContainer } from '@/hooks/useContainer';
import { TOKENS } from '@/di/tokens';
import type { IEventBus } from '@/events/types';
import type { ICacheWithStats } from '@/cache/types';
import type { PerformanceTimer } from '@/logging/PerformanceTimer';
import type { PluginRegistry } from '@/modules/plugins/PluginRegistry';
import type { ISocketClient } from '@/socket/types';
import type { IContainer } from '@/di/types';

export function DeveloperMode() {
  const container = useContainer();
  const uiStore = container.resolve<ReturnType<typeof import('@/store/UIStore').createUIStore>>(TOKENS.uiStore);
  const [open, setOpen] = useState(() => uiStore.getState().developerMode);
  const [tab, setTab] = useState<'events' | 'plugins' | 'cache' | 'socket' | 'perf'>('events');

  useEffect(() => {
    const unsub = uiStore.subscribe((s) => setOpen(s.developerMode));
    return unsub;
  }, [uiStore]);

  const handleClose = useCallback(() => {
    uiStore.getState().toggleDeveloperMode();
  }, [uiStore]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="dev-mode-title"
      className="fixed inset-y-0 right-0 z-50 w-full max-w-md border-l border-border bg-background/95 shadow-xl backdrop-blur"
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 id="dev-mode-title" className="font-heading text-sm font-semibold text-foreground">
            Developer Mode
          </h2>
          <button
            type="button"
            onClick={handleClose}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Close developer mode"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex gap-1 border-b border-border px-2 py-2">
          <TabButton active={tab === 'events'} onClick={() => setTab('events')} icon={<Activity className="h-4 w-4" />}>
            Events
          </TabButton>
          <TabButton active={tab === 'plugins'} onClick={() => setTab('plugins')} icon={<Cpu className="h-4 w-4" />}>
            Plugins
          </TabButton>
          <TabButton active={tab === 'cache'} onClick={() => setTab('cache')} icon={<HardDrive className="h-4 w-4" />}>
            Cache
          </TabButton>
          <TabButton active={tab === 'socket'} onClick={() => setTab('socket')} icon={<Wifi className="h-4 w-4" />}>
            Socket
          </TabButton>
          <TabButton active={tab === 'perf'} onClick={() => setTab('perf')} icon={<Gauge className="h-4 w-4" />}>
            Perf
          </TabButton>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {tab === 'events' && <EventStream container={container} />}
          {tab === 'plugins' && <PluginState container={container} />}
          {tab === 'cache' && <CacheStats container={container} />}
          {tab === 'socket' && <SocketStatus container={container} />}
          {tab === 'perf' && <PerfMetrics container={container} />}
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-1 flex-col items-center gap-1 rounded px-2 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active ? 'bg-primary text-on-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {icon}
      <span>{children}</span>
    </button>
  );
}

function EventStream({ container }: { container: IContainer }) {
  const eventBus = container.resolve<IEventBus>(TOKENS.eventBus);
  const [events, setEvents] = useState(() => eventBus.snapshot().slice(-50).reverse());

  useEffect(() => {
    const observer = eventBus.addObserver({
      onEvent: (event) => {
        setEvents((prev) => [event, ...prev].slice(0, 100));
      },
    });
    return () => { observer(); };
  }, [eventBus]);

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">Live event stream from the EventBus.</p>
      <div className="space-y-1">
        {events.map((event) => (
          <details key={event.id} className="rounded border border-border bg-muted/30 px-2 py-1 text-xs">
            <summary className="cursor-pointer font-medium text-foreground">
              {new Date(event.timestamp).toLocaleTimeString()} · {event.topic}
            </summary>
            <pre className="mt-1 max-h-32 overflow-auto rounded bg-background p-2 text-[10px] text-muted-foreground">
              {JSON.stringify({ source: event.source, correlationId: event.correlationId, payload: event.payload }, null, 2)}
            </pre>
          </details>
        ))}
      </div>
    </div>
  );
}

function PluginState({ container }: { container: IContainer }) {
  const [plugins, setPlugins] = useState<import('@/modules/plugins/types/PluginTypes').PluginMetadata[]>([]);

  useEffect(() => {
    const registry = container.resolve<PluginRegistry>(TOKENS.pluginRegistry);
    setPlugins(registry.list());
  }, [container]);

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">Loaded plugins and their metadata.</p>
      {plugins.length === 0 ? (
        <p className="text-sm text-muted-foreground">No plugins registered.</p>
      ) : (
        <ul className="space-y-2">
          {plugins.map((p) => (
            <li key={p.id} className="rounded border border-border bg-muted/30 p-2 text-xs">
              <div className="font-medium text-foreground">{p.name}</div>
              <div className="text-muted-foreground">{p.id}</div>
              <div className="text-muted-foreground">v{p.version}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CacheStats({ container }: { container: IContainer }) {
  const memory = container.resolve<ICacheWithStats>(TOKENS.memoryCache);
  const disk = container.resolve<ICacheWithStats>(TOKENS.diskCache);
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 2000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">Cache statistics auto-refresh every 2s.</p>
      <StatCard title="Memory Cache" stats={memory.getStats()} />
      <StatCard title="Disk Cache" stats={disk.getStats()} />
    </div>
  );
}

function StatCard({ title, stats }: { title: string; stats: import('@/cache/types').CacheStats }) {
  return (
    <div className="rounded border border-border bg-muted/30 p-3 text-xs">
      <div className="mb-2 font-medium text-foreground">{title}</div>
      <div className="grid grid-cols-2 gap-2 text-muted-foreground">
        <div>Hits: {stats.hits}</div>
        <div>Misses: {stats.misses}</div>
        <div>Entries: {stats.entries}</div>
        <div>Size: {stats.size}</div>
      </div>
    </div>
  );
}

function SocketStatus({ container }: { container: IContainer }) {
  const client = container.resolve<ISocketClient>(TOKENS.socketClient);
  const [status, setStatus] = useState(client.status);

  useEffect(() => {
    setStatus(client.status);
    const interval = setInterval(() => setStatus(client.status), 1000);
    return () => clearInterval(interval);
  }, [client]);

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Current WebSocket / HTTP socket transport status.</p>
      <div className="flex items-center gap-2 text-sm font-medium">
        <span
          className={cn(
            'h-2 w-2 rounded-full',
            status === 'connected' && 'bg-green-500',
            status === 'connecting' && 'bg-yellow-500',
            status === 'error' && 'bg-destructive',
            (status === 'idle' || status === 'disconnected') && 'bg-muted-foreground',
          )}
        />
        <span className="uppercase text-foreground">{status}</span>
      </div>
    </div>
  );
}

function PerfMetrics({ container }: { container: IContainer }) {
  const timer = container.resolve<PerformanceTimer>(TOKENS.performanceTimer);
  const [stats, setStats] = useState(() => timer.getStats());

  useEffect(() => {
    const id = setInterval(() => setStats(timer.getStats()), 1000);
    return () => clearInterval(id);
  }, [timer]);

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">Performance timer aggregate metrics.</p>
      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
        <div className="rounded border border-border bg-muted/30 p-2">Active: {stats.active}</div>
        <div className="rounded border border-border bg-muted/30 p-2">Completed: {stats.completed}</div>
        <div className="rounded border border-border bg-muted/30 p-2">Avg: {Math.round(stats.averageDurationMs)}ms</div>
        <div className="rounded border border-border bg-muted/30 p-2">Max: {Math.round(stats.maxDurationMs)}ms</div>
      </div>
    </div>
  );
}
