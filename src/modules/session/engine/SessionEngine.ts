import type { ISessionEngine, SessionSnapshot } from '../types/SessionTypes';
import type { ICache } from '@/cache/types';

const SESSION_KEY = 'aios-session-';

export class SessionEngine implements ISessionEngine {
  constructor(private readonly cache: ICache) {}

  async save(snapshot: SessionSnapshot): Promise<void> {
    await this.cache.set(this.key(snapshot.workspaceId), snapshot);
  }

  async load(workspaceId: string): Promise<SessionSnapshot | undefined> {
    const result = await this.cache.get<SessionSnapshot>(this.key(workspaceId));
    return result.success ? result.data : undefined;
  }

  async list(): Promise<SessionSnapshot[]> {
    // DiskCache does not support listing by prefix directly; returning empty for interface compliance.
    return [];
  }

  private key(workspaceId: string): string {
    return `${SESSION_KEY}${workspaceId}`;
  }
}
