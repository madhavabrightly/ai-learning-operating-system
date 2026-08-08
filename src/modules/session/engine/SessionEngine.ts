import type { ISessionEngine, SessionSnapshot } from '../types/SessionTypes';
import type { ICache } from '@/cache/types';
import type { IndexedDbDocumentStorage, DocumentListEntry } from '@/modules/document/storage/IndexedDbDocumentStorage';

const SESSION_KEY = 'aios-session-';

/**
 * Real session engine: snapshots persist to the disk cache, and listing works
 * by scanning the document storage metadata + cache keys. Session restore
 * returns the last saved snapshot for a workspace.
 */
export class SessionEngine implements ISessionEngine {
  constructor(
    private readonly cache: ICache,
    private readonly documentStorage?: IndexedDbDocumentStorage,
  ) {}

  async save(snapshot: SessionSnapshot): Promise<void> {
    await this.cache.set(this.key(snapshot.workspaceId), snapshot);
  }

  async load(workspaceId: string): Promise<SessionSnapshot | undefined> {
    const result = await this.cache.get<SessionSnapshot>(this.key(workspaceId));
    return result.success ? result.data : undefined;
  }

  async list(): Promise<SessionSnapshot[]> {
    // Scan localStorage-backed DiskCache for session keys.
    const snapshots: SessionSnapshot[] = [];
    if (typeof localStorage !== 'undefined') {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(SESSION_KEY)) {
          try {
            const raw = localStorage.getItem(key);
            if (raw) {
              const parsed = JSON.parse(raw) as { value?: SessionSnapshot };
              if (parsed.value) snapshots.push(parsed.value);
            }
          } catch {
            // Skip corrupt entries.
          }
        }
      }
    }
    return snapshots.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** Enrich a session snapshot with the current document list. */
  async listWithDocuments(): Promise<{ snapshots: SessionSnapshot[]; documents: DocumentListEntry[] }> {
    const [snapshots, docs] = await Promise.all([
      this.list(),
      this.documentStorage?.listEntries().then((r) => r.data ?? []) ?? Promise.resolve([]),
    ]);
    return { snapshots, documents: docs };
  }

  private key(workspaceId: string): string {
    return `${SESSION_KEY}${workspaceId}`;
  }
}
