import { IContainer } from '@/di/types';
import { ILogger } from '@/logging/ILogger';
import { IEventBus } from '@/events/types';
import { RuntimeOrchestrator } from '@/runtime/scheduler/RuntimeOrchestrator';
import { createMockWorker } from '@/runtime/mocks/createMockWorkers';
import { buildDemoPipeline } from '@/runtime/factories/buildDemoPipeline';
import { ICache } from '@/cache/types';
import { PerformanceTimer } from '@/logging/PerformanceTimer';

export interface RuntimeInitOptions {
  enableMockWorkers?: boolean;
  enableDemoTriggers?: boolean;
}

export function initializeRuntime(container: IContainer, options: RuntimeInitOptions = {}): RuntimeOrchestrator {
  const logger = container.resolve<ILogger>('logger' as unknown as symbol);
  const eventBus = container.resolve<IEventBus>('eventBus' as unknown as symbol);
  const cache = container.resolve<ICache>('diskCache' as unknown as symbol);
  const timer = container.resolve<PerformanceTimer>('performanceTimer' as unknown as symbol);

  // Runtime is intentionally registered as an instance in containerInit.ts.
  // To keep strict typing without duplicating logic, we re-resolve by runtime token convention.
  const orchestrator = new RuntimeOrchestrator(container, eventBus, logger.child('Runtime'), cache, timer, {
    maxConcurrency: 4,
    defaultTimeoutMs: 20_000,
  });

  if (options.enableMockWorkers ?? true) {
    orchestrator.registerWorker(createMockWorker('ocr', { delayMs: 800, failureRate: 0.4 }));
    orchestrator.registerWorker(createMockWorker('parser', { delayMs: 700, failureRate: 0.2 }));
    orchestrator.registerWorker(createMockWorker('knowledge', { delayMs: 900, failureRate: 0.2 }));
    orchestrator.registerWorker(createMockWorker('summary', { delayMs: 600 }));
    orchestrator.registerWorker(createMockWorker('graph', { delayMs: 700 }));
  }

  if (options.enableDemoTriggers ?? true) {
    eventBus.subscribe('demo.pipeline.start', (event) => {
      const documentId = (event.payload as { documentId?: string }).documentId ?? `doc-${Date.now()}`;
      const pipeline = orchestrator.createPipeline(buildDemoPipeline(documentId));
      void orchestrator.submitPipeline(pipeline);
      return;
    });
  }

  orchestrator.start();
  return orchestrator;
}
