import type { Result } from '@/errors/types';
import type { IContainer } from '@/di/types';
import type { IEventBus } from '@/events/types';

export interface PluginMetadata {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  entry: string;
}

export interface IPlugin {
  readonly metadata: PluginMetadata;
  initialize(container: IContainer): Promise<Result<void>>;
  shutdown(): Promise<Result<void>>;
  execute<TInput, TOutput>(payload: TInput): Promise<Result<TOutput>>;
  subscribe(bus: IEventBus): void;
}

export interface PluginManifest {
  plugins: PluginMetadata[];
}
