import type { Result } from '@/errors/types';
import { err, ok } from '@/errors/ResultFactory';
import type { IContainer } from '@/di/types';
import type { IEventBus } from '@/events/types';
import type { ILogger } from '@/logging/ILogger';
import type { IPlugin, PluginMetadata } from './types/PluginTypes';

export class PluginRegistry {
  private plugins = new Map<string, IPlugin>();

  constructor(
    private readonly container: IContainer,
    private readonly eventBus: IEventBus,
    private readonly logger: ILogger,
  ) {}

  async register(plugin: IPlugin): Promise<Result<void>> {
    if (this.plugins.has(plugin.metadata.id)) {
      return err(`Plugin ${plugin.metadata.id} already registered`);
    }
    const init = await plugin.initialize(this.container);
    if (!init.success) return init;
    plugin.subscribe(this.eventBus);
    this.plugins.set(plugin.metadata.id, plugin);
    this.logger.info('Plugin registered', { pluginId: plugin.metadata.id });
    return ok(undefined);
  }

  async unregister(id: string): Promise<Result<void>> {
    const plugin = this.plugins.get(id);
    if (!plugin) return err(`Plugin ${id} not found`);
    await plugin.shutdown();
    this.plugins.delete(id);
    return ok(undefined);
  }

  list(): PluginMetadata[] {
    return [...this.plugins.values()].map((p) => p.metadata);
  }

  get(id: string): IPlugin | undefined {
    return this.plugins.get(id);
  }
}
