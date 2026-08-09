import { useCallback, useEffect, useRef, useState } from 'react';
import { Library, MessageSquare, StickyNote, Activity, Network, GraduationCap } from 'lucide-react';
import { useDependency } from '@/hooks/useContainer';
import { useRuntime, useRuntimeTasks } from '@/hooks/useRuntime';
import { TOKENS } from '@/di/tokens';
import { DocumentLibrary } from '@/components/workspace/DocumentLibrary';
import { DocumentViewer } from '@/components/workspace/DocumentViewer';
import { ChatPanel } from '@/components/workspace/ChatPanel';
import { NotesPanel } from '@/components/workspace/NotesPanel';
import { RuntimeLab } from '@/components/workspace/RuntimeLab';
import { KnowledgeGraphPanel } from '@/components/workspace/KnowledgeGraphPanel';
import { QuizFlashcardsPanel } from '@/components/workspace/QuizFlashcardsPanel';
import type { DocumentStore as DocumentStoreApi } from '@/store/DocumentStore';
import type { ChatStore as ChatStoreApi } from '@/store/ChatStore';
import type { NotesService } from '@/modules/notes/service/NotesService';
import type { IResearchService } from '@/modules/research/ResearchService';
import type { GraphService } from '@/modules/graph/service/GraphService';
import type { LearningService } from '@/modules/learning/LearningService';
import type { WorkspaceSessionManager } from '@/modules/session/WorkspaceSessionManager';
import type { FailureInjector } from '@/runtime/injection/FailureInjector';
import { cn } from '@/utils/cn';
import type { UseBoundStore, StoreApi } from 'zustand';

type DocumentStore = UseBoundStore<StoreApi<DocumentStoreApi>>;
type ChatStore = UseBoundStore<StoreApi<ChatStoreApi>>;

type WorkspaceTab = 'library' | 'chat' | 'notes' | 'runtime' | 'graph' | 'study';

export function WorkspacePage() {
  const documentStore = useDependency<DocumentStore>(TOKENS.documentStore);
  const chatStore = useDependency<ChatStore>(TOKENS.chatStore);
  const notesService = useDependency<NotesService>(TOKENS.notesService);
  const researchService = useDependency<IResearchService>(TOKENS.researchService);
  const graphService = useDependency<GraphService>(TOKENS.graphService);
  const learningService = useDependency<LearningService>(TOKENS.learningService);
  const sessionManager = useDependency<WorkspaceSessionManager>(TOKENS.sessionManager);
  const { orchestrator, runDocumentPipeline, reset } = useRuntime();
  const runtimeTasks = useRuntimeTasks();
  const failureInjector = useDependency<FailureInjector>(TOKENS.failureInjector);
  const [tab, setTab] = useState<WorkspaceTab>('library');

  const state = documentStore();
  const chat = chatStore();

  // Load existing documents + conversations on mount, then restore the last
  // saved workspace session once documents are available.
  const sessionReady = useRef(false);
  useEffect(() => {
    let cancelled = false;
    async function boot() {
      await documentStore.getState().list();
      await chatStore.getState().init();
      if (cancelled) return;
      await sessionManager.restore();
      sessionReady.current = true;
    }
    void boot();
    return () => {
      cancelled = true;
    };
  }, [documentStore, chatStore, sessionManager]);

  // Persist the workspace session as real state changes (only after restore
  // has completed so a fresh boot never clobbers the saved snapshot).
  useEffect(() => {
    const unsub = documentStore.subscribe(() => {
      if (!sessionReady.current) return;
      void sessionManager.save();
    });
    return unsub;
  }, [documentStore, sessionManager]);

  const handleUpload = useCallback(
    async (file: File) => {
      const doc = await documentStore.getState().upload(file);
      if (doc) {
        // Kick off the real pipeline for the uploaded document.
        const pipelineId = runDocumentPipeline(doc.id);
        if (pipelineId) setTab('runtime');
      }
    },
    [documentStore, runDocumentPipeline],
  );

  const handleOpen = useCallback(
    async (documentId: string) => {
      await documentStore.getState().open(documentId);
      setTab('chat');
    },
    [documentStore],
  );

  const handleDelete = useCallback(
    async (documentId: string) => {
      await documentStore.getState().delete(documentId);
    },
    [documentStore],
  );

  const handleRefresh = useCallback(async () => {
    await documentStore.getState().list();
  }, [documentStore]);

  const handleOpenSource = useCallback(
    (url: string) => {
      void researchService.openSource(url);
    },
    [researchService],
  );

  const selectedText = state.selection?.text;

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-heading text-lg font-semibold text-foreground">Study Workspace</h2>
        <div className="flex gap-1 rounded-lg border border-border bg-muted/30 p-0.5">
          <TabButton active={tab === 'library'} onClick={() => setTab('library')} icon={<Library className="h-3.5 w-3.5" />}>
            Library
          </TabButton>
          <TabButton active={tab === 'chat'} onClick={() => setTab('chat')} icon={<MessageSquare className="h-3.5 w-3.5" />}>
            Chat
          </TabButton>
          <TabButton active={tab === 'graph'} onClick={() => setTab('graph')} icon={<Network className="h-3.5 w-3.5" />}>
            Graph
          </TabButton>
          <TabButton active={tab === 'study'} onClick={() => setTab('study')} icon={<GraduationCap className="h-3.5 w-3.5" />}>
            Study
          </TabButton>
          <TabButton active={tab === 'notes'} onClick={() => setTab('notes')} icon={<StickyNote className="h-3.5 w-3.5" />}>
            Notes
          </TabButton>
          <TabButton active={tab === 'runtime'} onClick={() => setTab('runtime')} icon={<Activity className="h-3.5 w-3.5" />}>
            Runtime Lab
          </TabButton>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        {/* Left column */}
        <div className="flex min-h-0 flex-col gap-3 overflow-auto pr-1">
          <DocumentLibrary
            documents={state.documents}
            currentDocumentId={state.currentDocumentId}
            uploading={state.loading}
            error={state.error}
            onUpload={handleUpload}
            onOpen={handleOpen}
            onDelete={handleDelete}
            onRefresh={handleRefresh}
          />

          {state.currentDocument && (
            <div className="rounded-lg border border-border bg-muted/20 p-3">
              <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Search</h3>
              <SearchBox
                onSearch={async (q) => {
                  await documentStore.getState().search(q);
                }}
              />
              <div className="mt-2 max-h-40 space-y-1 overflow-auto">
                {state.searchResults.map((r, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => documentStore.getState().setPage(r.page)}
                    className="w-full rounded border border-border bg-muted/30 p-1.5 text-left text-[11px] text-muted-foreground transition-colors hover:bg-muted"
                  >
                    <span className="block text-[10px] text-foreground/60">Page {r.page}</span>
                    {r.text}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right column */}
        <div className="min-h-0 flex-1">
          {tab === 'library' && state.currentDocument && (
            <DocumentViewer
              document={state.currentDocument}
              page={state.page}
              zoom={state.zoom}
              onPageChange={(p) => documentStore.getState().setPage(p)}
              onSelectText={(text) => documentStore.getState().setSelection({ text })}
            />
          )}
          {tab === 'library' && !state.currentDocument && (
            <EmptyWorkspace />
          )}
          {tab === 'chat' && (
            <div className="h-full rounded-lg border border-border bg-background p-3">
              <ChatPanel
                chat={chat}
                documentId={state.currentDocumentId}
                selection={selectedText}
                onOpenSource={handleOpenSource}
              />
            </div>
          )}
          {tab === 'notes' && (
            <div className="h-full rounded-lg border border-border bg-background p-3">
              <NotesPanel
                notesService={notesService}
                workspaceId="workspace-default"
                documentId={state.currentDocumentId}
                page={state.page}
                selection={selectedText}
              />
            </div>
          )}
          {tab === 'graph' && (
            <div className="h-full rounded-lg border border-border bg-background p-3">
              <KnowledgeGraphPanel
                graphService={graphService}
                documentId={state.currentDocumentId}
                document={state.currentDocument}
                chatStore={chatStore}
                onNavigateToPage={(p) => documentStore.getState().setPage(p)}
                onSelectText={(text) => documentStore.getState().setSelection({ text })}
              />
            </div>
          )}
          {tab === 'study' && (
            <div className="h-full rounded-lg border border-border bg-background p-3">
              <QuizFlashcardsPanel
                learningService={learningService}
                documentId={state.currentDocumentId}
                onAskAi={(question) => {
                  setTab('chat');
                  void chatStore.getState().sendMessage(question, { documentId: state.currentDocumentId });
                }}
              />
            </div>
          )}
          {tab === 'runtime' && (
            <div className="h-full rounded-lg border border-border bg-background p-3">
              <RuntimeLab
                tasks={runtimeTasks}
                runPipeline={(id) => runDocumentPipeline(id)}
                reset={reset}
                documents={state.documents.map((d) => ({ id: d.id, title: d.title, status: d.status }))}
                getTelemetry={() => orchestrator.getTelemetry()}
                failureInjector={failureInjector}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children, icon }: { active: boolean; onClick: () => void; children: React.ReactNode; icon: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors',
        active ? 'bg-primary text-on-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {icon}
      {children}
    </button>
  );
}

function EmptyWorkspace() {
  return (
    <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border bg-muted/10 p-8 text-center">
      <div>
        <h3 className="font-heading text-base font-medium text-foreground">No document open</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload a document in the library, or open one from the list to view it here.
        </p>
      </div>
    </div>
  );
}

function SearchBox({ onSearch }: { onSearch: (query: string) => Promise<void> }) {
  const [query, setQuery] = useState('');
  const [timer, setTimer] = useState<ReturnType<typeof setTimeout> | undefined>(undefined);

  const handleChange = (value: string) => {
    setQuery(value);
    if (timer) clearTimeout(timer);
    // Debounced search — 300ms.
    setTimer(setTimeout(() => void onSearch(value), 300));
  };

  return (
    <input
      type="text"
      value={query}
      onChange={(e) => handleChange(e.target.value)}
      placeholder="Search in document…"
      className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
    />
  );
}
