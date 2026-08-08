import type { CancellationToken as ICancellationToken } from '../types';

export class MutableCancellationToken implements ICancellationToken {
  private _cancelled = false;
  private handlers = new Set<() => void>();

  get isCancelled(): boolean {
    return this._cancelled;
  }

  cancel(): void {
    if (this._cancelled) return;
    this._cancelled = true;
    for (const handler of this.handlers) handler();
    this.handlers.clear();
  }

  onCancel(handler: () => void): () => void {
    if (this._cancelled) {
      handler();
      return () => false;
    }
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  throwIfCancelled(): void {
    if (this._cancelled) {
      throw Object.assign(new Error('Operation cancelled'), { code: 'CANCELLED', retryable: false });
    }
  }
}
