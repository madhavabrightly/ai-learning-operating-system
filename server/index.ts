import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import { z } from 'zod';
import { aiRouter } from './routes/ai';
import { researchRouter } from './routes/research';

// Load server/.env (falls back to .env at the project root).
const serverDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(serverDir, '.env') });
dotenv.config(); // project-root .env as fallback

export const app = express();

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'ai-learning-os-backend',
    timestamp: Date.now(),
    config: {
      aiConfigured: Boolean(process.env.OPENAI_API_KEY),
      aiProvider: process.env.OPENAI_BASE_URL ? new URL(process.env.OPENAI_BASE_URL).hostname : null,
      aiModel: process.env.OPENAI_MODEL ?? null,
      brightDataConfigured: Boolean(process.env.BRIGHTDATA_BROWSER_WS_URL),
      directFetchAllowed: process.env.RESEARCH_ALLOW_DIRECT_FETCH === '1',
      supabaseConfigured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY),
    },
  });
});

app.use('/api/ai', aiRouter);
app.use('/api/research', researchRouter);

// Structured 404 for unknown API routes.
app.use('/api', (_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Unknown API route' } });
});

// Central error handler: never leak stack traces or secrets.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const isZod = err instanceof z.ZodError;
  const status = isZod ? 400 : 500;
  const message = isZod
    ? z.prettifyError(err)
    : err instanceof Error
      ? err.message
      : 'Internal server error';
  const code = isZod ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR';
  // eslint-disable-next-line no-console
  console.error('[server] error:', err);
  res.status(status).json({ error: { code, message } });
});

const port = Number(process.env.PORT ?? 8787);

if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`[server] AI Learning OS backend listening on http://localhost:${port}`);
  });
}
