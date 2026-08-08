import type { AiProviderClient, ResearchResult } from '@/modules/ai/AiProviderClient';
import { ok, err } from '@/errors/ResultFactory';
import type { Result } from '@/errors/types';
import { AppError } from '@/errors/AppError';
import type { IEventBus } from '@/events/types';
import type { ILogger } from '@/logging/ILogger';

export interface ResearchRequest {
  query: string;
  url?: string;
  maxResults?: number;
}

export interface ResearchHistoryEntry {
  requestId: string;
  query: string;
  url?: string;
  at: number;
  result: ResearchResult;
}

export interface IResearchService {
  research(request: ResearchRequest): Promise<Result<ResearchResult>>;
  history(): Promise<Result<ResearchHistoryEntry[]>>;
  /** Open a source URL via the browser bridge. */
  openSource(url: string): Promise<Result<void>>;
}

const HISTORY_KEY = 'aios-research-history';

/**
 * Real research service. Delegates to the backend (Bright Data browser or
 * direct fetch). Preserves evidence and history. Never fabricates results —
 * when the backend cannot research, it returns a structured error.
 */
export class ResearchService implements IResearchService {
  private entries: ResearchHistoryEntry[] = [];

  constructor(
    private readonly provider: AiProviderClient,
    private readonly eventBus: IEventBus,
    private readonly logger: ILogger,
    private readonly openExternal: (url: string) => Promise<Result<void>>,
  ) {
    this.loadHistory();
  }

  async research(request: ResearchRequest): Promise<Result<ResearchResult>> {
    this.eventBus.publish('research.started', { query: request.query }, 'client');
    try {
      const result = await this.provider.research(request.query, request.url, request.maxResults);
      if (result.mechanism === 'error' || result.error) {
        this.eventBus.publish('research.failed', { query: request.query, error: result.error?.message }, 'client');
        return err(
          new AppError({
            message: result.error?.message ?? 'Research failed',
            code: result.error?.code ?? 'RESEARCH_FAILED',
            retryable: true,
            fallbackAvailable: false,
          }),
        );
      }

      const entry: ResearchHistoryEntry = {
        requestId: result.requestId,
        query: request.query,
        url: request.url,
        at: Date.now(),
        result,
      };
      this.entries.unshift(entry);
      this.entries = this.entries.slice(0, 50);
      this.persistHistory();

      this.eventBus.publish('research.completed', {
        query: request.query,
        sources: result.evidence.length,
        mechanism: result.mechanism,
      }, 'client');
      this.logger.info('Research completed', { query: request.query, sources: result.evidence.length, mechanism: result.mechanism });
      return ok(result);
    } catch (e) {
      const error = AppError.from(e);
      this.eventBus.publish('research.failed', { query: request.query, error: error.message }, 'client');
      return err(error);
    }
  }

  async history(): Promise<Result<ResearchHistoryEntry[]>> {
    return ok([...this.entries]);
  }

  /** Open a researched source in a new tab (BrowserBridge external). */
  async openSource(url: string): Promise<Result<void>> {
    try {
      return await this.openExternal(url);
    } catch (e) {
      return err(AppError.from(e));
    }
  }

  private loadHistory(): void {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (raw) this.entries = JSON.parse(raw) as ResearchHistoryEntry[];
    } catch {
      this.entries = [];
    }
  }

  private persistHistory(): void {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(this.entries));
    } catch {
      // Ignore quota errors; history is best-effort.
    }
  }
}
