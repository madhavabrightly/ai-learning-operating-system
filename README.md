# AI Learning Operating System

A **real, production-ready AI Study Assistant** — a browser-first, event-driven learning workspace for uploading real study documents, extracting their structure (text, headings, math, tables), building a knowledge graph from actual content, and chatting with a real AI provider grounded in your documents.

Built with **React 18**, **TypeScript**, **Vite 7**, **TailwindCSS v4**, **Zustand**, **React Router 7**, **react-markdown**, **KaTeX**, **pdfjs-dist**, and **d3-force / d3-zoom / d3-selection** (interactive knowledge-graph visualization). All AI and web-fetching capabilities run through **Supabase Edge Functions** that proxy **OpenRouter** and **Bright Data** — provider credentials stay server-side, never in the client.

---

## What actually works (no mocks)

| Capability | Implementation |
|---|---|
| **Document upload** | Real `File` bytes validated, stored in IndexedDB, deduplicated |
| **PDF parsing** | `pdfjs-dist` — real per-page text extraction with positions; headings, formulas and tables derived from the real content |
| **DOCX parsing** | Minimal ZIP central-directory reader + `DecompressionStream('deflate-raw')` inflate (no dependency) — pulls `word/document.xml` out of the package and converts it to text |
| **TXT / Markdown / HTML** | Real line/structure parser — headings, lists, code, blockquotes, pipe tables |
| **Math** | Real LaTeX extraction (`$...$`, `$$...$$`, `\[...\]`) + KaTeX rendering |
| **Tables** | Real markdown pipe-table extraction into rows, rendered as HTML tables |
| **Canonical model** | Every parser output normalized to a shared `ParsedDocument` model (pages, blocks, sections, formulas, tables, figures, index) |
| **Search** | Real keyword search over extracted content with page provenance; section-aware retrieval |
| **Document quality** | Real metrics derived from the extracted content (text / layout / formula / table confidence) — never hardcoded |
| **Knowledge graph** | Concepts + relationships extracted from real document text via the Supabase AI edge function (with a deterministic heuristic fallback); no hardcoded nodes. Interactive graph UI: click a concept → description, evidence, source page, related concepts, learning path, suggestions and ask-AI actions; index-backed concept search; mastery per concept. d3-force / d3-zoom / d3-selection drive the graph rendering |
| **AI chat** | Real OpenRouter chat through the Supabase `openrouter-chat` edge function; streaming SSE (including reasoning deltas); grounded context (selection, sections, pages, formulas, tables); client-side retry with exponential backoff + jitter; conversation persistence |
| **Chat actions** | Explain / Simplify / Summarize / Teach / Example / Compare / Quiz / Flashcards / Notes — all call the AI edge function |
| **Web research** | Server-side page fetching via the `bright-data-proxy` Supabase edge function (Bright Data); scripts/styles stripped before render; URLs restricted to `http(s)` |
| **Persistence** | IndexedDB for documents + chat; localStorage cache for notes/sessions/research history; full workspace session save/restore (open document, page, selection survive refresh) |
| **Study panel** | Real quiz generation (multiple choice with evaluation), flashcards (with review state), and study questions — all generated from actual document content via the AI edge function, persisted across sessions |
| **Runtime Lab** | Real observability: select an uploaded document, run the real pipeline, watch real tasks/workers/retries/telemetry |
| **Failure injection** | Developer mode: arm a real failure in the parse or concept worker; the orchestrator's real retry/fallback path executes |
| **Retries / circuit breaker** | Real exponential backoff with jitter; CLOSED/OPEN/HALF_OPEN circuit breaker on the runtime and AI client |
| **Partial success** | Pages that fail are preserved; document marked PARTIAL with a clear reason (e.g. OCR required) |

---

## Architecture

```
Browser client (src/) — event-driven, DI-wired
  UI (React components)
    → Stores (Zustand: DocumentStore, ChatStore, UIStore)
    → Module services (document, graph, chat, notes, research, learning, analytics)
    → Runtime (RuntimeOrchestrator, workers, retry, circuit breaker, checkpoints)
    → Infrastructure (EventBus, Cache, DI container, Logger, Socket)
    → Integration (BackendClient → Supabase Edge Functions)

Supabase Edge Functions — the deployed backend (secrets live here, never in the client)
  ├── openrouter-chat    — chat / actions / concept + graph extraction / quiz / flashcards
  │                       (proxies OpenRouter; streaming SSE; JSON mode for structured output)
  └── bright-data-proxy  — server-side web page fetching via Bright Data

Legacy (not part of the deployed app):
  server/routes/ai.ts    — Express route sketch kept for reference
```

The six-layer architecture (UI → State → Module → Runtime → Infrastructure → Integration) is preserved from the original design. The **RuntimeOrchestrator** (DAG scheduler, retries, circuit breaker, checkpoints, telemetry) runs **real workers** — parse via `DocumentService`, concepts via `GraphService` — instead of mock ones.

---

## Getting Started

### Prerequisites
- Node.js 20+
- npm

### Install & Run

```bash
npm install
npm run dev     # start the Vite dev server
```

### Build

```bash
npm run build   # type-check (tsc -b) + production build (vite build)
```

### Configuration

No `.env` file is required to run — publishable defaults are baked into `src/constants/config.ts` and can be overridden with environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://subtsxwbxlyinuspakec.supabase.co` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | project publishable key (`sb_publishable_…`) | Public key for client → Edge Function calls |
| `VITE_OPENROUTER_MODEL` | `mistralai/mistral-small-24b-instruct-2501` | Chat model |
| `VITE_OPENROUTER_STRUCTURED_MODEL` | `google/gemma-4-26b-a4b-it:free` | Model for strict-JSON tasks (graph extraction, quiz/flashcards) |

**Secrets never go in `.env` or client code.** The OpenRouter API key (and any Bright Data credentials) live in **Supabase Edge Function secrets** and are read only server-side via `Deno.env.get(...)`.

When a service is unconfigured, the app **fails clearly** with the exact configuration required — it never fakes success.

### Quality Checks

```bash
npm run build   # TypeScript type-check + production build
```

---

## Routes

| Path | Page | Description |
|---|---|---|
| `/` | Dashboard | App overview |
| `/workspace` | Workspace | Upload → view → graph → study (quiz/flashcards) → chat → notes → runtime lab |
| `/history` | History | Real conversation history (persisted) |
| `/analytics` | Analytics | Real study + pipeline metrics from telemetry |
| `/plugins` | Plugins | Loaded plugin registry |
| `/settings` | Settings | Supabase health + configuration status |

Developer Mode (`Shift + D`) shows the live event stream, plugins, cache stats, socket status, and performance timers.

---

## Project Structure

```
src/
├── app/                  # App bootstrap: ContainerProvider, Router
├── bridge/               # BrowserBridge (open source, external navigation)
├── cache/                # ICache, MemoryCache, DiskCache
├── components/
│   ├── layouts/          # MainLayout, Sidebar, Topbar, StatusBar
│   ├── pages/            # Workspace, History, Analytics, Settings, ...
│   ├── workspace/        # DocumentViewer, ChatPanel, KnowledgeGraphPanel, RuntimeLab, NotesPanel, QuizFlashcardsPanel, MathRenderer, DocumentLibrary
│   └── ui/               # AsyncBoundary, EmptyState, ErrorRetry, LoadingSpinner
├── config/               # AppConfig, FeatureFlags, SupabaseConfig (publishable keys)
├── constants/            # Publishable config + OpenRouter model defaults
├── di/                   # DI Container, tokens
├── errors/               # AppError, Result<T>
├── events/               # EventBus, EventTopics
├── hooks/                # useContainer, useRuntime, useEvent
├── logging/              # ConsoleLogger, PerformanceTimer
├── modules/
│   ├── ai/               # AiProviderClient (Supabase Edge Function client), promptBuilder
│   ├── chat/             # ChatService, IndexedDB persistence
│   ├── document/         # model, parsers (PDF/DOCX/TXT/MD/HTML), math, retrieval, storage, service
│   ├── graph/            # GraphService, LlmGraphExtractor, BackendGraphExtractor
│   ├── learning/         # LearningService (quiz/flashcards/questions)
│   ├── notes/            # NotesService (persisted)
│   ├── research/         # ResearchService (evidence model)
│   ├── session/          # SessionEngine (save/restore)
│   └── analytics/        # AnalyticsService (real telemetry)
├── runtime/              # Orchestrator, workers, retry, circuit, checkpoints, failure injection
├── services/             # containerInit, BackendClient, BrightDataService, authSession
├── store/                # DocumentStore, ChatStore, UIStore
└── main.tsx              # Entry point

supabase/                 # Edge Functions (openrouter-chat, bright-data-proxy) — deployed backend
server/
└── routes/ai.ts          # Legacy Express route sketch (not part of the deployed app)
```

---

## Security

- **AI and Bright Data credentials live only in Supabase Edge Function secrets** — never in the client bundle, logs, or error messages.
- The Supabase **publishable key** is safe to embed in the client (row-level security protects the data); the service-role key is never exposed.
- Uploaded files are validated (type + size limit).
- Web content fetched by research is stripped of scripts/styles before rendering.
- Research URLs restricted to `http(s)`; evidence is never fabricated.
- Health/config endpoints report only *whether* services are configured, never the keys.
