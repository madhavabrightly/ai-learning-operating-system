import type { Result } from '@/errors/types';
import { ok, err } from '@/errors/ResultFactory';

export interface BrowserCapabilities {
  openFile: boolean;
  saveFile: boolean;
  showNotification: boolean;
  clipboardRead: boolean;
  clipboardWrite: boolean;
  openExternal: boolean;
}

export interface BrowserBridge {
  getPlatform(): string;
  getAppVersion(): string;
  getCapabilities(): BrowserCapabilities;
  openFile(accept?: string): Promise<Result<File>>;
  saveFile(filename: string, blob: Blob): Promise<Result<void>>;
  showNotification(title: string, body: string): Promise<Result<void>>;
  clipboardRead(): Promise<Result<string>>;
  clipboardWrite(text: string): Promise<Result<void>>;
  openExternal(url: string): Promise<Result<void>>;
}

export function createBrowserBridge(): BrowserBridge {
  return {
    getPlatform: () => (typeof navigator !== 'undefined' ? navigator.platform : 'unknown'),
    getAppVersion: () => (typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown'),
    getCapabilities: () => ({
      openFile: typeof window !== 'undefined' && 'showOpenFilePicker' in window,
      saveFile: typeof window !== 'undefined' && 'showSaveFilePicker' in window,
      showNotification: typeof window !== 'undefined' && 'Notification' in window,
      clipboardRead: typeof navigator !== 'undefined' && 'clipboard' in navigator && 'readText' in navigator.clipboard,
      clipboardWrite: typeof navigator !== 'undefined' && 'clipboard' in navigator && 'writeText' in navigator.clipboard,
      openExternal: true,
    }),
    openFile: async (accept = '*/*') => {
      if (typeof window === 'undefined' || !('showOpenFilePicker' in window)) {
        return err('File open not supported in this environment');
      }
      try {
        const [handle] = await (window as any).showOpenFilePicker({ types: [{ description: 'Documents', accept: { [accept]: [] } }] });
        const file = await (handle as any).getFile();
        return ok(file);
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e));
      }
    },
    saveFile: async (filename: string, blob: Blob) => {
      try {
        const a = document.createElement('a');
        const url = URL.createObjectURL(blob);
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return ok(undefined);
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e));
      }
    },
    showNotification: async (title: string, body: string) => {
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        new Notification(title, { body });
        return ok(undefined);
      }
      return err('Notifications not permitted');
    },
    clipboardRead: async () => {
      try {
        if (typeof navigator !== 'undefined' && 'clipboard' in navigator && 'readText' in navigator.clipboard) {
          const text = await navigator.clipboard.readText();
          return ok(text);
        }
        return err('Clipboard read not supported');
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e));
      }
    },
    clipboardWrite: async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        return ok(undefined);
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e));
      }
    },
    openExternal: async (url: string) => {
      if (typeof window !== 'undefined') {
        window.open(url, '_blank', 'noopener,noreferrer');
        return ok(undefined);
      }
      return err('Cannot open external URL in this environment');
    },
  };
}
