import { Container } from '@/di/Container';
import { TOKENS } from '@/di/tokens';
import { createAppConfig } from '@/config/AppConfig';
import { ConsoleLogger } from '@/logging/Logger';
import { EventBus } from '@/events/EventBus';
import { MemoryCache } from '@/cache/MemoryCache';
import { DiskCache } from '@/cache/DiskCache';
import { PerformanceTimer } from '@/logging/PerformanceTimer';
import { SocketService } from '@/socket/SocketService';
import { PluginRegistry } from '@/modules/plugins/PluginRegistry';
import { createUIStore } from '@/store/UIStore';
import { RuntimeOrchestrator } from '@/runtime/scheduler/RuntimeOrchestrator';
import { createDocumentStore } from '@/store/DocumentStore';
import { createChatStore } from '@/store/ChatStore';
import { DocumentService } from '@/modules/document/service/DocumentService';
import { IndexedDbDocumentStorage } from '@/modules/document/storage/IndexedDbDocumentStorage';
import { BackendHttpClient } from '@/services/BackendClient';
import { createAiProviderClient } from '@/modules/ai/AiProviderClient';
import { ChatService } from '@/modules/chat/ChatService';
import type { ChatServiceDeps } from '@/modules/chat/ChatService';
import { IndexedDbChatPersistence } from '@/modules/chat/IndexedDbChatPersistence';
import { GraphService } from '@/modules/graph/service/GraphService';
import { createBackendGraphExtractor } from '@/modules/graph/service/BackendGraphExtractor';
import { NotesService } from '@/modules/notes/service/NotesService';
import { ResearchService } from '@/modules/research/ResearchService';
import { LearningService } from '@/modules/learning/LearningService';
import { createWorkspaceSessionManager } from '@/modules/session/WorkspaceSessionManager';
import { SessionEngine } from '@/modules/session/engine/SessionEngine';
import { AnalyticsService } from '@/modules/analytics/service/AnalyticsService';
import { createBrowserBridge } from '@/bridge/BrowserBridge';
import { createParseWorker, createConceptWorker } from '@/runtime/workers/documentWorkers';
import { FailureInjector } from '@/runtime/injection/FailureInjector';
import { buildDocumentPipeline } from '@/runtime/factories/buildDocumentPipeline';
import type { IContainer } from '@/di/types';
import type { ILogger } from '@/logging/ILogger';

/**
 * Builds the complete application dependency graph.
 *
 * Every service is registered here with explicit constructor dependencies —
 * no global singletons, no hidden mock wiring. The orchestrator runs REAL
 * pipeline workers (parse via DocumentService, concepts via GraphService).
 */
export function createContainer(): IContainer {
  const container = new Container();

  // --- Infrastructure -----------------------------------------------------
  const config = createAppConfig();
  container.registerInstance(TOKENS.config, config);

  const logger = new ConsoleLogger('app');
  container.registerInstance(TOKENS.logger, logger);

  const eventBus = new EventBus(logger.child('EventBus'));
  container.registerInstance(TOKENS.eventBus, eventBus);

  const performanceTimer = new PerformanceTimer(logger.child('PerfTimer'));
  container.registerInstance(TOKENS.performanceTimer, performanceTimer);

  const memoryCache = new MemoryCache();
  container.registerInstance(TOKENS.memoryCache, memoryCache);

  const diskCache = new DiskCache();
  container.registerInstance(TOKENS.diskCache, diskCache);

  const socketService = new SocketService(logger.child('Socket'), eventBus, {
    mode: config.socketMode,
    url: config.backendUrl.replace(/^http/, 'ws') + '/ws/v1/events',
    baseUrl: config.backendUrl,
  });
  container.registerInstance(TOKENS.socketClient, socketService);

  const pluginRegistry = new PluginRegistry(container, eventBus, logger.child('Plugins'));
  container.registerInstance(TOKENS.pluginRegistry, pluginRegistry);

  const uiStore = createUIStore({ eventBus });
  container.registerInstance(TOKENS.uiStore, uiStore);

  const browserBridge = createBrowserBridge();
  container.registerInstance(TOKENS.browserBridge, browserBridge);

  // --- Backend + AI provider ----------------------------------------------
  const backendClient = new BackendHttpClient({ baseUrl: config.backendUrl });
  container.registerInstance(TOKENS.backendClient, backendClient);

  const aiProvider = createAiProviderClient(backendClient);
  container.registerInstance(TOKENS.aiProvider, aiProvider);

  // --- Real domain services -----------------------------------------------
  const documentStorage = new IndexedDbDocumentStorage();
  const documentService = new DocumentService(eventBus, logger.child('Document'), documentStorage, {
    extractFigures: true,
    maxFigureSize: 1200,
  });
  container.registerInstance(TOKENS.documentService, documentService);

  const documentStore = createDocumentStore({
    service: documentService,
    eventBus,
  });
  container.registerInstance(TOKENS.documentStore, documentStore);

  const chatPersistence = new IndexedDbChatPersistence();
  const chatService = new ChatService({
    provider: aiProvider,
    documents: documentService,
    persistence: chatPersistence,
    eventBus,
    logger: logger.child('Chat'),
  });
  container.registerInstance(TOKENS.chatService, chatService);

  const chatStore = createChatStore({ service: chatService, eventBus });
  container.registerInstance(TOKENS.chatStore, chatStore);

  const graphExtractor = createBackendGraphExtractor(backendClient);
  const graphService = new GraphService(eventBus, logger.child('Graph'), documentService, { extractor: graphExtractor });
  container.registerInstance(TOKENS.graphService, graphService);

  // Chat gets the graph for concept injection AFTER the graph is registered.
  (chatService as unknown as { deps: ChatServiceDeps }).deps.graph = graphService;

  const notesService = new NotesService(diskCache, eventBus);
  container.registerInstance(TOKENS.notesService, notesService);

  const learningService = new LearningService(aiProvider, documentService, eventBus, logger.child('Learning'), diskCache, graphService);
  container.registerInstance(TOKENS.learningService, learningService);

  const researchService = new ResearchService(aiProvider, eventBus, logger.child('Research'), (url) => browserBridge.openExternal(url));
  container.registerInstance(TOKENS.researchService, researchService);

  const sessionEngine = new SessionEngine(diskCache);
  container.registerInstance(TOKENS.sessionEngine, sessionEngine);

  const sessionManager = createWorkspaceSessionManager(sessionEngine, eventBus, logger.child('Session'), {
    documentStore,
    getNotes: () => ({}),
    getCurrentTab: () => 'library',
  });
  container.registerInstance(TOKENS.sessionManager, sessionManager);

  const analyticsService = new AnalyticsService(diskCache);
  container.registerInstance(TOKENS.analyticsService, analyticsService);

  // Developer-only failure injection (disabled by default).
  const failureInjector = new FailureInjector();
  container.registerInstance(TOKENS.failureInjector, failureInjector);

  // --- Runtime orchestrator with REAL workers ------------------------------
  const orchestrator = new RuntimeOrchestrator(container, eventBus, logger.child('Orchestrator'), diskCache, performanceTimer);
  container.registerInstance(TOKENS.orchestrator, orchestrator);
  if (typeof analyticsService.attachOrchestrator === 'function') {
    analyticsService.attachOrchestrator(orchestrator);
  } else {
    logger.warn('AnalyticsService.attachOrchestrator unavailable — telemetry wiring skipped');
  }

  orchestrator.registerWorker(createParseWorker(documentService, failureInjector));
  orchestrator.registerWorker(createConceptWorker({
    extractConcepts: async (documentId) => {
      const result = await graphService.load(documentId);
      return { success: result.success, data: result.data, error: result.error };
    },
  }, failureInjector));

  // Document pipeline trigger: run the real pipeline for an uploaded document.
  eventBus.subscribe('document.process', (event) => {
    const documentId = (event.payload as { documentId?: string })?.documentId;
    if (!documentId) return;
    const pipeline = orchestrator.createPipeline(buildDocumentPipeline(documentId));
    void orchestrator.submitPipeline(pipeline);
  });

  orchestrator.start();

  return container;
}

/** Resolve the root logger from a container (used by tests). */
export function resolveLogger(container: IContainer): ILogger {
  return container.resolve<ILogger>(TOKENS.logger);
}
