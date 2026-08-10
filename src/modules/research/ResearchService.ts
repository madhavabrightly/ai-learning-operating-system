import type { Result } from '@/errors/types';
import { ok, err } from '@/errors/ResultFactory';
import { AppError } from '@/errors/AppError';
import type { AiProviderClient, ResearchEvidence } from '@/modules/ai/AiProviderClient';
import type { IEventBus } from '@/events/types';
import type { ILogger } from '@/logging/ILogger';

export interface IResearchService {
  research(query: string, url?: string): Promise<Result<{ evidence: ResearchEvidence[] }>>;
  openSource(url: string): Promise<Result<void>>;
  getRecent(): ResearchEvidence[];
}

export class ResearchService implements IResearchService {
  private recent: ResearchEvidence[] = [];

  constructor(
    private readonly provider: AiProviderClient,
    private readonly eventBus: IEventBus,
    private readonly logger: ILogger,
    private readonly openExternal: (url: string) => Promise<Result<void>>,
  ) {}

  async research(query: string, url?: string): Promise<Result<{ evidence: ResearchEvidence[] }>> {
    try {
      this.eventBus.publish('research.started', { query, url }, 'client');
      const result = await this.provider.research(query, url);
      if (result.mechanism === 'error' || result.error) {
        return err(result.error?.message ?? 'Research failed');
      }
      this.recent = result.evidence;
      this.eventBus.publish('research.completed', { query, evidenceCount: result.evidence.length }, 'client');
      return ok({ evidence: result.evidence });
    } catch (e) {
      return err(AppError.from(e));
    }
  }

  async openSource(url: string): Promise<Result<void>> {
    return this.openExternal(url);
  }

  getRecent(): ResearchEvidence[] {
    return [...this.recent];
  }
}