import { useCallback, useEffect, useRef, useState } from 'react';
import { Network, Search, ArrowRight, Lightbulb, GitBranch, X } from 'lucide-react';
import { cn } from '@/utils/cn';
import { useEvent } from '@/hooks/useEvent';
import { EventTopics } from '@/events/EventTopics';
import type { GraphService } from '@/modules/graph/service/GraphService';
import type { KnowledgeGraph, Concept, ConceptRelationship, LearningPathNode } from '@/modules/graph/types/GraphTypes';
import type { ChatStore } from '@/store/ChatStore';
import type { UseBoundStore, StoreApi } from 'zustand';

export interface KnowledgeGraphPanelProps {
  graphService: GraphService;
  documentId?: string;
  document?: unknown;
  chatStore: UseBoundStore<StoreApi<ChatStore>>;
  onNavigateToPage: (page: number) => void;
  onSelectText: (text: string) => void;
}

interface ConceptsExtractedPayload {
  documentId: string;
  concepts?: Concept[];
  relationships?: ConceptRelationship[];
}

const TYPE_LABELS: Record<ConceptRelationship['type'], string> = {
  prerequisite: 'needs',
  related: 'related',
  part_of: 'part of',
  leads_to: 'leads to',
};

export function KnowledgeGraphPanel({ graphService, documentId, document: _document, chatStore, onNavigateToPage, onSelectText }: KnowledgeGraphPanelProps) {
  const [graph, setGraph] = useState<KnowledgeGraph | undefined>();
  const [selected, setSelected] = useState<Concept | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  // Search state.
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Concept[] | undefined>();
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Selected-concept detail (related / learning path / recommendations).
  const [related, setRelated] = useState<{ prerequisites: Concept[]; related: Concept[] } | undefined>();
  const [learningPath, setLearningPath] = useState<LearningPathNode[] | undefined>();
  const [recommendations, setRecommendations] = useState<Concept[] | undefined>();
  const [detailLoading, setDetailLoading] = useState(false);

  // Tracks the document a load is currently fetching for. GraphService.load()
  // publishes CONCEPTS_EXTRACTED when extraction completes, and this panel
  // subscribes to that event — without this guard the panel would reload in
  // response to its own load (publish → reload → publish → … stack overflow).
  const inFlightDocRef = useRef<string | undefined>(undefined);

  const loadGraph = useCallback(async () => {
    if (!documentId) {
      inFlightDocRef.current = undefined;
      setGraph(undefined);
      setSelected(undefined);
      return;
    }
    inFlightDocRef.current = documentId;
    setLoading(true);
    setError(undefined);
    const result = await graphService.load(documentId);
    if (result.success) {
      setGraph(result.data);
    } else {
      setError(result.error ?? 'Failed to load graph');
    }
    if (inFlightDocRef.current === documentId) {
      inFlightDocRef.current = undefined;
    }
    setLoading(false);
  }, [graphService, documentId]);

  useEffect(() => { void loadGraph(); }, [loadGraph]);

  // load → CONCEPTS_EXTRACTED → keep the panel in sync when extraction
  // completes for the current document. Events published by our own in-flight
  // load() are skipped — that graph is already being delivered by the load.
  useEvent<ConceptsExtractedPayload>(EventTopics.CONCEPTS_EXTRACTED, (event) => {
    if (event.payload.documentId !== documentId) return;
    if (inFlightDocRef.current === documentId) return;
    void loadGraph();
  });

  const loadConceptDetail = useCallback(
    async (concept: Concept) => {
      setDetailLoading(true);
      try {
        const [relatedResult, pathResult, recResult] = await Promise.all([
          graphService.getRelated(concept.id, documentId),
          graphService.getLearningPath(concept.id, { documentId, depth: 3 }),
          graphService.getRecommendedConcepts({ documentId, limit: 6, prioritizeWeakConcepts: true }),
        ]);
        setRelated(relatedResult.success ? relatedResult.data : undefined);
        setLearningPath(pathResult.success ? pathResult.data : undefined);
        setRecommendations(recResult.success ? recResult.data : undefined);
      } finally {
        setDetailLoading(false);
      }
    },
    [graphService, documentId],
  );

  const selectConcept = useCallback(
    async (concept: Concept) => {
      setSelected(concept);
      // Publish CONCEPT_SELECTED through the domain service (single source of
      // truth for concept selection across the app).
      await graphService.selectConcept(concept.id, documentId);
      // Source navigation: jump to the page the concept was extracted from.
      if (typeof concept.sourcePage === 'number' && concept.sourcePage > 0) {
        onNavigateToPage(concept.sourcePage);
      }
      // Ground the selection in the evidence text so the chat can quote it.
      if (concept.evidence) {
        onSelectText(concept.evidence);
      }
      // Graph → Chat grounding: explain the concept with its evidence.
      void chatStore.getState().runAction('explain', {
        documentId,
        selection: concept.label,
      });
      void loadConceptDetail(concept);
    },
    [graphService, documentId, chatStore, onNavigateToPage, onSelectText, loadConceptDetail],
  );

  const runSearch = useCallback(
    async (value: string) => {
      if (!documentId || !value.trim()) {
        setSearchResults(undefined);
        return;
      }
      setSearching(true);
      const result = await graphService.search(value, { documentId, limit: 30 });
      setSearchResults(result.success ? result.data : []);
      setSearching(false);
    },
    [graphService, documentId],
  );

  const handleSearchChange = (value: string) => {
    setQuery(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => void runSearch(value), 250);
  };

  useEffect(() => () => { if (searchTimer.current) clearTimeout(searchTimer.current); }, []);

  const displayConcepts = searchResults ?? graph?.concepts ?? [];

  if (loading && !graph) {
    return <p className="text-xs text-muted-foreground">Extracting knowledge graph…</p>;
  }
  if (error && !graph) {
    return <p className="text-xs text-destructive">{error}</p>;
  }
  if (!graph) {
    return (
      <p className="flex h-full items-center justify-center text-xs text-muted-foreground">
        <span className="text-center">
          <Network className="mx-auto mb-1 h-5 w-5 opacity-40" />
          No knowledge graph yet.
          <br />
          Open a document to extract concepts.
        </span>
      </p>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">
          Knowledge Graph ({graph.concepts.length} concepts · {graph.relationships.length} links)
        </h3>
        {graph.metadata?.qualityScore !== undefined && (
          <span className="rounded border border-border bg-muted/30 px-1.5 py-0.5 text-[9px] text-muted-foreground">
            quality {Math.round(graph.metadata.qualityScore * 100)}%
          </span>
        )}
      </div>

      {/* Search — index-backed, documentId isolated via GraphService.search. */}
      <div>
        <label htmlFor="graph-search" className="mb-1 block text-[10px] font-medium uppercase text-muted-foreground">
          Search concepts
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            id="graph-search"
            type="search"
            value={query}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="e.g. gradient descent…"
            className="w-full rounded-lg border border-border bg-background py-1.5 pl-8 pr-7 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear concept search"
              onClick={() => { setQuery(''); setSearchResults(undefined); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        {searching && <p className="mt-1 text-[10px] text-muted-foreground">Searching…</p>}
        {searchResults && searchResults.length === 0 && !searching && (
          <p className="mt-1 text-[10px] text-muted-foreground">No concepts match “{query}”.</p>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
        {/* Concept list / search results */}
        <div className="space-y-1">
          {displayConcepts.map((concept) => (
            <button
              key={concept.id}
              type="button"
              onClick={() => void selectConcept(concept)}
              className={cn(
                'w-full cursor-pointer rounded border p-2 text-left text-xs transition-colors',
                selected?.id === concept.id
                  ? 'border-primary bg-primary/10'
                  : 'border-border bg-muted/20 hover:bg-muted',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-foreground">{concept.label}</span>
                {concept.mastery !== undefined && (
                  <span className="shrink-0 text-[9px] text-muted-foreground">{Math.round(concept.mastery * 100)}%</span>
                )}
              </div>
              {concept.description && (
                <p className="mt-0.5 line-clamp-2 text-[10px] text-muted-foreground">{concept.description}</p>
              )}
              {typeof concept.sourcePage === 'number' && concept.sourcePage > 0 && (
                <p className="mt-0.5 text-[9px] text-muted-foreground/70">p. {concept.sourcePage}</p>
              )}
              {concept.mastery !== undefined && (
                <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${concept.mastery * 100}%` }} />
                </div>
              )}
            </button>
          ))}
        </div>

        {/* Selected concept detail */}
        {selected && (
          <div className="space-y-3 rounded-lg border border-border bg-muted/10 p-3">
            <div>
              <h4 className="text-xs font-semibold text-foreground">{selected.label}</h4>
              {selected.description && <p className="mt-1 text-[11px] text-muted-foreground">{selected.description}</p>}
            </div>

            {selected.evidence && (
              <blockquote className="rounded border-l-2 border-primary bg-muted/20 px-2 py-1.5 text-[10px] italic text-muted-foreground">
                “{selected.evidence.slice(0, 220)}{selected.evidence.length > 220 ? '…' : ''}”
              </blockquote>
            )}

            {(selected.sourcePage || selected.sourceChunkId || selected.sources?.length) && (
              <p className="text-[10px] text-muted-foreground">
                Source:{' '}
                {selected.sourcePage ? ` page ${selected.sourcePage}` : ''}
                {selected.sourceChunkId ? ` · chunk ${selected.sourceChunkId}` : ''}
                {selected.sources && selected.sources.length > 1 ? ` · ${selected.sources.length} references` : ''}
              </p>
            )}

            {detailLoading && <p className="text-[10px] text-muted-foreground">Loading relationships…</p>}

            {related && (related.prerequisites.length > 0 || related.related.length > 0) && (
              <div className="space-y-1.5">
                {related.prerequisites.length > 0 && (
                  <RelatedRow label="Prerequisites" items={related.prerequisites} onSelect={(c) => void selectConcept(c)} />
                )}
                {related.related.length > 0 && (
                  <RelatedRow label="Related" items={related.related} onSelect={(c) => void selectConcept(c)} />
                )}
              </div>
            )}

            {learningPath && learningPath.length > 0 && (
              <div>
                <p className="mb-1 flex items-center gap-1 text-[10px] font-medium uppercase text-muted-foreground">
                  <GitBranch className="h-3 w-3" /> Learning path
                </p>
                <ol className="space-y-0.5">
                  {[...learningPath]
                    .sort((a, b) => a.depth - b.depth)
                    .map((node, i, arr) => (
                      <li key={node.concept.id} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <button
                          type="button"
                          onClick={() => void selectConcept(node.concept)}
                          className="cursor-pointer rounded px-1 py-0.5 text-left transition-colors hover:bg-muted hover:text-foreground"
                        >
                          {node.concept.label}
                          <span className="ml-1 text-[9px] text-muted-foreground/70">
                            {Math.round(node.mastery * 100)}%
                          </span>
                        </button>
                        {i < arr.length - 1 && <ArrowRight className="h-2.5 w-2.5 shrink-0 text-muted-foreground/50" />}
                      </li>
                    ))}
                </ol>
              </div>
            )}

            {recommendations && recommendations.length > 0 && (
              <div>
                <p className="mb-1 flex items-center gap-1 text-[10px] font-medium uppercase text-muted-foreground">
                  <Lightbulb className="h-3 w-3" /> Suggested next
                </p>
                <div className="flex flex-wrap gap-1">
                  {recommendations.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => void selectConcept(c)}
                      className="cursor-pointer rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {graph.relationships.length > 0 && (
          <div className="rounded border border-border bg-muted/20 p-2">
            <p className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">Relationships</p>
            <div className="space-y-0.5">
              {graph.relationships.slice(0, 8).map((rel) => (
                <p key={rel.id} className="text-[10px] text-muted-foreground">
                  <span className="text-foreground">{rel.source}</span>{' '}
                  <span className="text-primary">{TYPE_LABELS[rel.type] ?? rel.type}</span>{' '}
                  <span className="text-foreground">{rel.target}</span>
                </p>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function RelatedRow({ label, items, onSelect }: { label: string; items: Concept[]; onSelect: (concept: Concept) => void }) {
  return (
    <div>
      <p className="mb-0.5 text-[10px] font-medium uppercase text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-1">
        {items.slice(0, 8).map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelect(c)}
            className="cursor-pointer rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}
