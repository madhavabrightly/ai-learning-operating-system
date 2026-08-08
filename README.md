# AI Learning Operating System

A **real, production-ready AI Study Assistant** — a browser-first, event-driven learning workspace for uploading real study documents, extracting their structure (text, headings, math, tables, figures), building a knowledge graph from actual content, and chatting with a real AI provider grounded in your documents.

Built with **React 18**, **TypeScript**, **Vite 7**, **TailwindCSS v4**, **Zustand**, and a **local Node/Express backend** that holds all API credentials server-side.

---

## What actually works (no mocks)

| Capability | Implementation |
|---|---|
| **Document upload** | Real `File` bytes validated, stored in IndexedDB, deduplicated |
| **PDF parsing** | `pdfjs-dist` — real text items with positions, headings, tables, figure rasterization |
| **DOCX parsing** | `mammoth` — real HTML → blocks, real tables with headers |
| **TXT / Markdown** | Real line/structure parser — headings, lists, code, blockquotes, tables |
| **Math** | Real LaTeX extraction (`$...$`, `$$...$$`, `\[...\]`) + KaTeX rendering; plain-text equation hints converted to LaTeX |
| **Tables** | Real grid extraction, rendered as HTML tables; reduced-structure flag when incomplete |
| **Figures** | PDF images rasterized to data URLs with captions |
| **Canonical model** | Every parser output normalized to a shared `ParsedDocument` model (pages, blocks, sections, formulas, tables, figures, index) |
| **Search** | Real keyword search over extracted content with page provenance; section-aware retrieval |
| **Knowledge graph** | Concepts extracted from real document text via backend AI (with deterministic heuristic fallback); no hardcoded nodes |
| **AI chat** | Real OpenAI-compatible provider through the backend; streaming SSE; grounded context (selection, sections, pages, formulas, tables); conversation persistence |
| **Chat actions** | Explain / Simplify / Summarize / Teach / Example / Compare / Quiz / Flashcards / Notes — all call the backend |
| **Research** | Real web research via Bright Data Browser API (`playwright-core` CDP) or direct-fetch fallback; evidence model with full provenance (`sourceId, url, title, domain, retrievedAt, relevantText, confidence, requestId`) |
| **Persistence** | IndexedDB for documents + chat; localStorage cache for notes/sessions/research history |
| **Runtime Lab** | Real observability: select an uploaded document, run the real pipeline, watch real tasks/workers/retries/telemetry |
| **Failure injection** | Developer mode: arm a real failure in the parse or concept worker; the orchestrator's real retry/fallback path executes |
| **Retries / circuit breaker** | Real exponential backoff with jitter; CLOSED/OPEN/HALF_OPEN circuit breaker on the runtime and backend |
| **Partial success** | Pages that fail are preserved; document marked PARTIAL with a clear reason (e.g. OCR required) |

---

## Architecture

```
React UI (src/)
  ├── Workspace (upload → viewer → chat → notes → research → runtime lab)
  ├── Stores (DocumentStore, ChatStore, UIStore)
  ├── Module services (real implementations, DI-wired)
  └── Infrastructure (EventBus, Cache, DI, Logger, RuntimeOrchestrator)

Node Backend (server/)
  ├── Express + cors + zod validation
  ├── POST /api/ai/chat        — grounded chat (OpenAI-compatible, streaming)
  ├── POST /api/ai/action      — explain/summarize/quiz/etc.
  ├── POST /api/ai/extract     — concepts from document text
  ├── POST /api/research        — Bright Data / direct-fetch research
  └── GET  /api/health          — health + config presence (never secrets)
```

The six-layer architecture (UI → State → Module → Runtime → Infrastructure → Integration) is preserved from the original design. The **RuntimeOrchestrator** (DAG scheduler, retries, circuit breaker, checkpoints, telemetry) was real and remains — it now runs **real workers** instead of mock ones.

---

## Getting Started

### Prerequisites
- Node.js 20+
- npm

### Install & Run

```bash
npm install
npm run dev:all        # starts backend (:8787) + client (:5173)
```

Or run them separately:
```bash
npm run dev:server     # backend only
npm run dev            # client only
```

### Configuration

Copy `.env.example` values as needed:

- **Client** (`.env`): `VITE_BACKEND_URL` (default `http://localhost:8787`).
- **Backend** (`server/.env`):
  - `OPENAI_API_KEY` + optional `OPENAI_BASE_URL` + `OPENAI_MODEL` — enables real AI chat. Works with OpenAI, Ollama, Groq, OpenRouter, LM Studio.
  - `BRIGHTDATA_BROWSER_WS_URL` — enables real browser research.
  - `RESEARCH_ALLOW_DIRECT_FETCH=1` — enables direct-fetch research fallback (no browser required).

When a service is unconfigured, the app **fails clearly** with the exact configuration required — it never fakes success.

### Quality Checks

```bash
npm run typecheck      # TypeScript
npm run lint           # ESLint
npm test               # Vitest (unit + integration)
npm run build          # production build
node e2e/verify.mjs    # real end-to-end (requires dev servers running)
```

---

## Routes

| Path | Page | Description |
|---|---|---|
| `/` | Dashboard | App overview |
| `/workspace` | Workspace | Upload → view → chat → notes → research → runtime lab |
| `/history` | History | Real conversation history (persisted) |
| `/analytics` | Analytics | Real study + pipeline metrics from telemetry |
| `/plugins` | Plugins | Loaded plugin registry |
| `/settings` | Settings | Backend health + configuration status |

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
│   ├── workspace/        # DocumentViewer, ChatPanel, RuntimeLab, NotesPanel, MathRenderer, DocumentLibrary
│   └── ui/               # AsyncBoundary, EmptyState, ErrorRetry
├── config/               # AppConfig, FeatureFlags, SupabaseConfig (optional)
├── di/                   # DI Container, tokens
├── errors/               # AppError, Result<T>
├── events/               # EventBus, EventTopics
├── hooks/                # useContainer, useRuntime, useEvent
├── logging/              # ConsoleLogger, PerformanceTimer
├── modules/
│   ├── ai/               # AiProviderClient (backend client)
│   ├── chat/             # ChatService, persistence
│   ├── document/         # model, parsers (PDF/DOCX/TXT), math, retrieval, storage, service
│   ├── graph/            # GraphService, BackendGraphExtractor
│   ├── notes/            # NotesService (persisted)
│   ├── research/         # ResearchService (evidence, history)
│   ├── session/          # SessionEngine (save/restore)
│   └── analytics/        # AnalyticsService (real telemetry)
├── runtime/              # Orchestrator, workers, retry, circuit, checkpoints, failure injection
├── services/             # containerInit, BackendClient, BrightDataService
├── store/                # DocumentStore, ChatStore, UIStore
└── main.tsx              # Entry point

server/
├── index.ts              # Express app + health
└── routes/
    ├── ai.ts             # chat / action / extract (OpenAI-compatible)
    └── research.ts       # Bright Data + direct-fetch with evidence
```

---

## Security

- **AI and Bright Data credentials live only server-side** (`server/.env`), never in the client, logs, or error messages.
- Uploaded files are validated (type + 50 MB limit).
- Web content fetched by research is stripped of scripts/styles before rendering.
- Research URLs restricted to `http(s)`; evidence is never fabricated.
- The `GET /api/health` endpoint reports only *whether* services are configured, never the keys.
