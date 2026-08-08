// Test setup: polyfills for code that touches browser APIs in tests.
import { vi } from 'vitest';

// Minimal localStorage polyfill for node tests (DiskCache, ResearchService).
if (typeof localStorage === 'undefined') {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  } as Storage;
}

// Minimal File/Blob for node-based parser tests.
if (typeof Blob === 'undefined') {
  class BlobImpl {
    constructor(public parts: BlobPart[] = [], public options: BlobPropertyBag = {}) {}
    get size(): number {
      return (this.parts as string[]).reduce((s, p) => s + String(p).length, 0);
    }
    get type(): string {
      return this.options.type ?? '';
    }
    async arrayBuffer(): Promise<ArrayBuffer> {
      return new TextEncoder().encode((this.parts as string[]).join('')).buffer;
    }
    async text(): Promise<string> {
      return (this.parts as string[]).join('');
    }
  }
  (globalThis as Record<string, unknown>).Blob = BlobImpl;
}

if (typeof File === 'undefined') {
  const BlobCtor = (globalThis as Record<string, unknown>).Blob as new (parts: BlobPart[], options?: BlobPropertyBag) => Blob;
  class FileImpl extends BlobCtor {
    name: string;
    constructor(parts: BlobPart[], name: string, options: FilePropertyBag = {}) {
      super(parts, options);
      this.name = name;
    }
    get lastModified(): number {
      return Date.now();
    }
  }
  (globalThis as Record<string, unknown>).File = FileImpl as unknown as typeof File;
}

// Silence unhandled rejection noise in tests.
process.on('unhandledRejection', (reason) => {
  console.warn('[test] unhandled rejection:', reason);
});

// Keep vi import referenced so the setup file registers cleanly.
void vi;
