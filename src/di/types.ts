export type Constructor<T> = new (...args: unknown[]) => T;
export type Factory<T> = (container: IContainer) => T;

export interface IContainer {
  register<T>(token: symbol, factory: Factory<T>): this;
  registerInstance<T>(token: symbol, instance: T): this;
  resolve<T>(token: symbol): T;
  has(token: symbol): boolean;
  createScope(): IContainer;
}
