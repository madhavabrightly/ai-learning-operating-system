import type { Result } from '@/errors/types';
import type { IContainer } from '@/di/types';
import type { IEventBus } from '@/events/types';
import type { IPlugin, PluginMetadata } from '../types/PluginTypes';

export abstract class BasePlugin implements IPlugin {
  abstract readonly metadata: PluginMetadata;

  abstract initialize(_container: IContainer): Promise<Result<void>>;

  abstract shutdown(): Promise<Result<void>>;

  abstract execute<TInput, TOutput>(payload: TInput): Promise<Result<TOutput>>;

  abstract subscribe(_bus: IEventBus): void;
}
