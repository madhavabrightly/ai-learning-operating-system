import { ok } from '@/errors/ResultFactory';
import type { Result } from '@/errors/types';
import { EventTopics } from '@/events/EventTopics';
import type { IEventBus } from '@/events/types';
import type { ILogger } from '@/logging/ILogger';
import type { AssistantContext, AssistantAction, AssistantResponse, IAssistantService } from '../types/AssistantTypes';

export class AssistantService implements IAssistantService {
  constructor(
    private readonly eventBus: IEventBus,
    private readonly logger: ILogger,
  ) {}

  async request(context: AssistantContext, action: AssistantAction['intent']): Promise<Result<AssistantResponse>> {
    this.eventBus.publish(EventTopics.ASSISTANT_REQUESTED, { context, action }, 'client');
    this.logger.info('Assistant request', { action, contextType: context.type });

    const response: AssistantResponse = {
      explanation: 'This is a context-aware explanation produced by the backend service contract.',
      keyIdeas: ['Identify the problem', 'Apply the algorithm', 'Verify the result'],
      examples: ['Find 7 in [1, 3, 5, 7, 9] → compare middle, then right half.'],
      prerequisites: ['Sorted input', 'Comparison operation'],
      relatedConcepts: ['Time Complexity', 'Recursion'],
      questions: ['Why must the input be sorted?', 'What is the worst-case number of comparisons?'],
      simplified: 'The algorithm repeatedly cuts the search range in half.',
    };

    this.eventBus.publish(EventTopics.ASSISTANT_RESPONSE, { context, response }, 'client');
    return ok(response);
  }
}

export type { AssistantContext, AssistantResponse };
