import { useDependency } from '@/hooks/useContainer';
import { TOKENS } from '@/di/tokens';
import type { PluginRegistry } from '@/modules/plugins/PluginRegistry';

export function PluginsPage() {
  const registry = useDependency<PluginRegistry>(TOKENS.pluginRegistry);
  const plugins = registry.list();

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <h2 className="font-heading text-lg font-semibold text-foreground">Plugins</h2>
      {plugins.length === 0 ? (
        <p className="text-sm text-muted-foreground">No plugins loaded.</p>
      ) : (
        <ul className="space-y-2">
          {plugins.map((p) => (
            <li key={p.id} className="rounded border border-border bg-muted/30 p-3 text-sm">
              <div className="font-medium text-foreground">{p.name}</div>
              <div className="text-muted-foreground">{p.id} · v{p.version}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
