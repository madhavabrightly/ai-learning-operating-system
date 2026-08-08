import { AppError } from '@/errors/AppError';
import type { Factory, IContainer } from './types';

export class Container implements IContainer {
  private readonly registrations = new Map<symbol, Factory<unknown>>();
  private readonly instances = new Map<symbol, unknown>();
  private readonly parent?: Container;

  constructor(parent?: Container) {
    this.parent = parent;
  }

  register<T>(token: symbol, factory: Factory<T>): this {
    this.registrations.set(token, factory as Factory<unknown>);
    return this;
  }

  registerInstance<T>(token: symbol, instance: T): this {
    this.instances.set(token, instance);
    return this;
  }

  has(token: symbol): boolean {
    return this.instances.has(token) || this.registrations.has(token) || Boolean(this.parent?.has(token));
  }

  resolve<T>(token: symbol): T {
    if (this.instances.has(token)) return this.instances.get(token) as T;
    const factory = this.registrations.get(token) ?? this.parent?.registrations.get(token);
    if (!factory) {
      throw new AppError({ message: `Dependency not registered: ${token.toString()}`, code: 'DI_MISSING' });
    }
    const instance = factory(this);
    this.instances.set(token, instance);
    return instance as T;
  }

  createScope(): IContainer {
    return new Container(this);
  }
}
