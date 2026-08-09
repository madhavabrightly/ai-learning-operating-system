import { Router } from 'express';
import { z } from 'zod';

const router = Router();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GroundedContext {
  documentId?: string;
  documentTitle?: string;
  pages?: { page: number; text: string }[];
  selection?: string;
  sections?: { title: string; text: string; page: number }[];
  formulas?: { id: string; tex: string; page: number }[];
  tables?: { id: string; page: number; rows: string[][] }[];
  sources?: { url: string; title: string; text: string; retrievedAt: number }[];
  retrievedAt?: number;
}

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

const messageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string().min(1).max(200_000),
});

const groundedContextSchema = z.object({
  documentId: z.string().optional(),
  documentTitle: z.string().optional(),
  pages: z.array(z.object({ page: z.number(), text: z.string() })).optional(),
  selection: z.string().optional(),
  sections: z.array(z.object({ title: z.string(), text: z.string(), page: z.number() })).optional(),
  formulas: z.array(z.object({ id: z.string(), tex: z.string(), page: z.number() })).optional(),
  tables: z.array(z.object({ id: z.string(), page: z.number(), rows: z.array(z.array(z.string())) })).optional(),
  sources: z.array(z.object({ url: z.string(), title: z.string(), text: z.string(), retrievedAt: z.number() })).optional(),
  retrievedAt: z.number().optional(),
});

const chatSchema = z.object({
  conversationId: z.string().optional(),
  messages: z.array(messageSchema).min(1).max(100),
  context: groundedContextSchema.optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(16_000).optional(),
  stream: z.boolean().optional(),
});

const actionSchema = z.object({
  intent: z.enum(['explain', 'simplify', 'summarize', 'teach', 'example', 'compare', 'questions', 'quiz', 'flashcards', 'notes']),
  context: groundedContextSchema.optional(),
  messages: z.array(messageSchema).optional(),
});

const extractSchema = z.object({
  documentId: z.string(),
  text: z.string().min(1).max(500_000),
  existingConcepts: z.array(z.string()).optional(),
});

const learnSchema = z.object({
  documentId: z.string(),
  text: z.string().min(1).max(200_000),
  kind: z.enum(['questions', 'quiz', 'flashcards']),
  count: z.number().int().min(1).max(10).optional(),
  difficulty: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
});

// ---------------------------------------------------------------------------
// Provider helpers
// ---------------------------------------------------------------------------

function getProviderConfig() {
  const apiKey = process.env.OPENAI_API_KEY;
  const baseUrl = (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
  return { apiKey, baseUrl, model };
}

export function isAiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

function providerHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
  };
}

/** Non-streaming completion via the OpenAI-compatible API. */
export async function complete(messages: ChatMessage[], opts?: { temperature?: number; maxTokens?: number; responseFormat?: unknown }): Promise<string> {
  const { baseUrl, model } = getProviderConfig();
  const url = `${baseUrl}/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: providerHeaders(),
    body: JSON.stringify({
      model,
      messages,
      temperature: opts?.temperature ?? 0.3,
      max_tokens: opts?.maxTokens ?? 2048,
      ...(opts?.responseFormat ? { response_format: opts.responseFormat } : {}),
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`AI provider error ${res.status}: ${text.slice(0, 500)}`);
  }

  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('AI provider returned empty response');
  return content;
}

/** Streaming completion — pipes SSE chunks from the provider to the client. */
export async function streamComplete(
  messages: ChatMessage[],
  res: import('express').Response,
  opts?: { temperature?: number; maxTokens?: number },
): Promise<void> {
  const { baseUrl, model } = getProviderConfig();
  const url = `${baseUrl}/chat/completions`;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const providerRes = await fetch(url, {
    method: 'POST',
    headers: providerHeaders(),
    body: JSON.stringify({
      model,
      messages,
      temperature: opts?.temperature ?? 0.3,
      max_tokens: opts?.maxTokens ?? 2048,
      stream: true,
    }),
  });

  if (!providerRes.ok || !providerRes.body) {
    const text = await providerRes.text().catch(() => '');
    res.write(`event: error\ndata: ${JSON.stringify({ message: `AI provider error ${providerRes.status}: ${text.slice(0, 500)}` })}\n\n`);
    res.end();
    return;
  }

  const reader = providerRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by double newlines.
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';

      for (const frame of frames) {
        const lines = frame.split('\n');
        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const parsed = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] };
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              res.write(`data: ${JSON.stringify({ delta })}\n\n`);
            }
          } catch {
            // Ignore malformed frames; keep streaming.
          }
        }
      }
    }
  } finally {
    res.write('event: done\ndata: {}\n\n');
    res.end();
  }
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

const ACTION_PROMPTS: Record<string, string> = {
  explain: 'Explain the provided material clearly and in depth, building from first principles.',
  simplify: 'Explain the provided material as simply as possible, using analogies and avoiding jargon.',
  summarize: 'Provide a concise, well-structured summary of the provided material with the key points.',
  teach: 'Teach the provided material step by step as a tutor would, checking understanding along the way.',
  example: 'Provide concrete worked examples that illustrate the provided material.',
  compare: 'Compare and contrast the concepts present in the provided material.',
  questions: 'Generate thoughtful study questions about the provided material with brief answer hints.',
  quiz: 'Generate a short quiz (5 questions) about the provided material. Format each question as Q1., Q2. ... with answer options and mark the correct answer clearly.',
  flashcards: 'Generate flashcards from the provided material. Format each card as "Front: ... Back: ..." on separate lines.',
  notes: 'Create structured study notes from the provided material, organized by topic with bullet points.',
};

export function buildSystemPrompt(context?: GroundedContext, intent?: string): string {
  const parts: string[] = [];
  parts.push('You are the AI Study Assistant inside a learning operating system. You help users understand documents, concepts, and material. Be precise, structured, and pedagogical.');

  if (intent) {
    parts.push(`\nTask: ${ACTION_PROMPTS[intent] ?? 'Answer the user\'s question.'}`);
  }

  if (context) {
    const ctx: string[] = [];
    if (context.documentTitle) ctx.push(`Document: ${context.documentTitle}`);
    if (context.documentId) ctx.push(`Document ID: ${context.documentId}`);

    if (context.selection) ctx.push(`\nSelected text:\n"""\n${context.selection}\n"""`);
    if (context.pages && context.pages.length > 0) {
      ctx.push('\nRelevant pages:');
      for (const p of context.pages) ctx.push(`\n--- Page ${p.page} ---\n${p.text.slice(0, 8000)}`);
    }
    if (context.sections && context.sections.length > 0) {
      ctx.push('\nRelevant sections:');
      for (const s of context.sections) ctx.push(`\n[${s.title}] (page ${s.page})\n${s.text.slice(0, 6000)}`);
    }
    if (context.formulas && context.formulas.length > 0) {
      ctx.push('\nFormulas:');
      for (const f of context.formulas) ctx.push(`- [${f.id}] page ${f.page}: ${f.tex}`);
    }
    if (context.tables && context.tables.length > 0) {
      ctx.push('\nTables:');
      for (const t of context.tables) {
        ctx.push(`- [${t.id}] page ${t.page}: ${t.rows.map((r) => r.join(' | ')).join(' / ')}`);
      }
    }
    if (context.sources && context.sources.length > 0) {
      ctx.push('\nWeb sources (consulted during research):');
      for (const s of context.sources) {
        ctx.push(`- ${s.title} (${s.url})\n${s.text.slice(0, 4000)}`);
      }
    }

    parts.push(`\nGrounding context — answer using this material when it is relevant. Only cite a source if it was actually provided above; never invent URLs or claim a source was consulted when it was not.\n"""\n${ctx.join('\n')}\n"""`);
  }

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

router.post('/chat', async (req, res) => {
  const parsed = chatSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } });
    return;
  }

  if (!isAiConfigured()) {
    res.status(503).json({
      error: {
        code: 'AI_NOT_CONFIGURED',
        message: 'AI is not configured. Set OPENAI_API_KEY (and optionally OPENAI_BASE_URL / OPENAI_MODEL) in server/.env and restart the backend.',
      },
    });
    return;
  }

  const { messages, context, temperature, maxTokens, stream } = parsed.data;
  const systemPrompt = buildSystemPrompt(context);

  // Cap context so we never blow provider limits.
  const system: ChatMessage = { role: 'system', content: systemPrompt.slice(0, 100_000) };
  const history = messages.slice(-20);
  const fullMessages = [system, ...history];

  if (stream) {
    await streamComplete(fullMessages, res, { temperature, maxTokens });
    return;
  }

  try {
    const content = await complete(fullMessages, { temperature, maxTokens });
    res.json({ role: 'assistant', content });
  } catch (e) {
    res.status(502).json({
      error: {
        code: 'AI_PROVIDER_ERROR',
        message: e instanceof Error ? e.message : 'AI provider error',
      },
    });
  }
});

router.post('/action', async (req, res) => {
  const parsed = actionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } });
    return;
  }
  if (!isAiConfigured()) {
    res.status(503).json({ error: { code: 'AI_NOT_CONFIGURED', message: 'AI is not configured. Set OPENAI_API_KEY in server/.env.' } });
    return;
  }

  const { intent, context, messages } = parsed.data;
  const userContent =
    messages?.map((m) => `${m.role}: ${m.content}`).join('\n') ??
    context?.selection ??
    context?.sections?.map((s) => s.text).join('\n') ??
    context?.pages?.map((p) => p.text).join('\n') ??
    '';

  if (!userContent.trim()) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'No content provided for the action' } });
    return;
  }

  try {
    const content = await complete(
      [
        { role: 'system', content: buildSystemPrompt(context, intent) },
        { role: 'user', content: userContent.slice(0, 50_000) },
      ],
      { temperature: 0.4 },
    );
    res.json({ role: 'assistant', content, intent });
  } catch (e) {
    res.status(502).json({ error: { code: 'AI_PROVIDER_ERROR', message: e instanceof Error ? e.message : 'AI provider error' } });
  }
});

const EXTRACT_PROMPT = `Extract the key concepts from the provided document text and model how they relate.

Return STRICT JSON with this exact shape (no markdown fences):
{
  "concepts": [
    {
      "id": "kebab-case-unique-id",
      "label": "Human readable label",
      "description": "One-to-two sentence definition grounded in the text",
      "difficulty": "beginner | intermediate | advanced",
      "sourcePage": <page number or 0>,
      "example": "optional example from the text"
    }
  ],
  "relationships": [
    {
      "source": "concept-id",
      "target": "concept-id",
      "type": "prerequisite | related | part_of | leads_to",
      "reason": "one sentence justification grounded in the text"
    }
  ]
}
Do not invent concepts that are not present in the text.`;

router.post('/extract', async (req, res) => {
  const parsed = extractSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } });
    return;
  }

  if (!isAiConfigured()) {
    // Fallback: deterministic heuristic extraction (term frequency + sentence context).
    const result = heuristicExtract(parsed.data.text, parsed.data.documentId);
    res.json({ ...result, fallback: 'heuristic' });
    return;
  }

  try {
    const content = await complete(
      [
        { role: 'system', content: EXTRACT_PROMPT },
        { role: 'user', content: parsed.data.text.slice(0, 60_000) },
      ],
      { temperature: 0.2, responseFormat: { type: 'json_object' } },
    );

    const cleaned = content.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    const data = JSON.parse(cleaned) as {
      concepts?: { id: string; label: string; description?: string; difficulty?: string; sourcePage?: number; example?: string }[];
      relationships?: { source: string; target: string; type: string; reason?: string }[];
    };

    res.json({
      concepts: data.concepts ?? [],
      relationships: data.relationships ?? [],
      fallback: 'ai',
    });
  } catch (e) {
    // If AI extraction fails, degrade to the deterministic heuristic rather
    // than failing the whole pipeline — but mark it as a fallback.
    // eslint-disable-next-line no-console
    console.error('[server] AI extract failed, using heuristic', e);
    res.json({ ...heuristicExtract(parsed.data.text, parsed.data.documentId), fallback: 'heuristic' });
  }
});

// ---------------------------------------------------------------------------
// Deterministic heuristic concept extraction (no AI required)
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'was', 'with', 'that', 'this', 'have', 'from', 'they', 'will', 'would',
  'there', 'their', 'what', 'which', 'when', 'where', 'who', 'how', 'can', 'could', 'should', 'may',
  'might', 'must', 'than', 'then', 'them', 'these', 'those', 'upon', 'into', 'over', 'under', 'again',
  'further', 'once', 'here', 'about', 'above', 'below', 'between', 'through', 'during', 'before',
  'after', 'also', 'because', 'been', 'being', 'both', 'but', 'by', 'does', 'doing', 'each', 'few',
  'more', 'most', 'other', 'some', 'such', 'only', 'own', 'same', 'so', 'too', 'very', 'just',
  'out', 'up', 'down', 'off', 'on', 'in', 'at', 'to', 'of', 'a', 'an', 'is', 'it', 'as', 'or',
]);

// ---------------------------------------------------------------------------
// Learning content generation (questions / quiz / flashcards)
// ---------------------------------------------------------------------------

const LEARN_PROMPTS: Record<z.infer<typeof learnSchema>['kind'], string> = {
  questions:
    'Generate study questions about the provided material. Mix basic, conceptual, application, comparison and formula questions where the material supports them. Return STRICT JSON with this exact shape (no markdown fences): {"questions":[{"question":"...","type":"basic|conceptual|application|comparison|formula","difficulty":"beginner|intermediate|advanced","answerHint":"brief answer hint","sourceSection":"section or topic this comes from","sourcePage":<page number or 0>}]}',
  quiz:
    'Generate a multiple-choice quiz about the provided material. Return STRICT JSON with this exact shape (no markdown fences): {"quiz":[{"question":"...","options":["A. ...","B. ...","C. ...","D. ..."],"correctIndex":<number 0-3>,"explanation":"one-sentence explanation of the correct answer","difficulty":"beginner|intermediate|advanced","sourceSection":"section or topic","sourcePage":<page number or 0>}]}',
  flashcards:
    'Generate flashcards from the provided material. Return STRICT JSON with this exact shape (no markdown fences): {"flashcards":[{"front":"short prompt or term","back":"concise explanation grounded in the text","concept":"the concept this card covers","difficulty":"beginner|intermediate|advanced","sourceSection":"section or topic","sourcePage":<page number or 0>}]}',
};

function learnPromptFor(kind: z.infer<typeof learnSchema>['kind']): string {
  return LEARN_PROMPTS[kind];
}

router.post('/learn', async (req, res) => {
  const parsed = learnSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } });
    return;
  }

  const { documentId, text, kind, count, difficulty } = parsed.data;
  const target = count ?? (kind === 'quiz' ? 5 : 6);

  if (!isAiConfigured()) {
    // Deterministic fallback: build items from real sentences in the text.
    const fallback = heuristicLearn(text, documentId, kind, target);
    res.json({ ...fallback, fallback: 'heuristic' });
    return;
  }

  try {
    const content = await complete(
      [
        {
          role: 'system',
          content:
            learnPromptFor(kind) +
            (difficulty ? ` All items should target ${difficulty} difficulty.` : '') +
            ` Generate exactly ${target} items. Do not invent material that is not in the text.`,
        },
        { role: 'user', content: text.slice(0, 50_000) },
      ],
      { temperature: 0.4, responseFormat: { type: 'json_object' } },
    );

    const cleaned = content.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    const data = JSON.parse(cleaned) as Record<string, unknown>;
    res.json({ ...data, fallback: 'ai' });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[server] AI learn failed, using heuristic', e);
    res.json({ ...heuristicLearn(text, documentId, kind, target), fallback: 'heuristic' });
  }
});

function heuristicLearn(text: string, documentId: string, kind: z.infer<typeof learnSchema>['kind'], count: number) {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 40 && s.length < 400)
    .slice(0, Math.max(count, 8));

  if (kind === 'quiz') {
    const quiz = sentences.slice(0, count).map((sentence, i) => {
      const main = sentence.slice(0, 160);
      const isTrue = i % 2 === 0;
      return {
        question: `Which of the following statements about the material is correct? (Based on: "${main}…")`,
        options: [
          isTrue ? sentence : `The text does not discuss this.`,
          isTrue ? `The text does not discuss this.` : sentence,
          `The opposite of the material's claim.`,
          `An unrelated statement.`,
        ],
        correctIndex: isTrue ? 0 : 1,
        explanation: `The text states: "${sentence.slice(0, 220)}"`,
        difficulty: 'beginner' as const,
        sourceSection: 'document',
        sourcePage: 0,
      };
    });
    return { quiz };
  }

  if (kind === 'flashcards') {
    const flashcards = sentences.slice(0, count).map((sentence, i) => {
      const words = sentence.replace(/[^a-zA-Z ]/g, ' ').split(/\s+/).filter((w) => w.length > 4);
      const term = words[Math.floor(i / 2) % Math.max(1, words.length)] ?? 'concept';
      return {
        front: `What is ${term.toLowerCase()}?`,
        back: sentence,
        concept: term,
        difficulty: 'beginner' as const,
        sourceSection: 'document',
        sourcePage: 0,
      };
    });
    return { flashcards };
  }

  const questions = sentences.slice(0, count).map((sentence, i) => {
    const first = sentence.split(',')[0]?.replace(/[.!?]+$/, '') ?? sentence.slice(0, 80);
    const type = ['basic', 'conceptual', 'application', 'comparison', 'formula'][i % 5] as
      | 'basic'
      | 'conceptual'
      | 'application'
      | 'comparison'
      | 'formula';
    return {
      question: `Explain: ${first}${sentence.length > 120 ? '…' : ''}`,
      type,
      difficulty: 'beginner' as const,
      answerHint: sentence,
      sourceSection: 'document',
      sourcePage: 0,
    };
  });
  return { questions };
}

function heuristicExtract(text: string, documentId: string) {
  // Tokenize, count term frequency, find candidate concept terms.
  const tokens = text.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? [];
  const freq = new Map<string, number>();
  for (const t of tokens) {
    if (STOP_WORDS.has(t) || t.length < 4) continue;
    freq.set(t, (freq.get(t) ?? 0) + 1);
  }

  const ranked = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  const sentences = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);

  const concepts = ranked.map(([term, count], i) => {
    const sentence = sentences.find((s) => s.toLowerCase().includes(term)) ?? '';
    return {
      id: `${documentId}-concept-${i + 1}`,
      label: term.replace(/-/g, ' '),
      description: sentence ? `Appears in the text: "${sentence.slice(0, 200)}"` : `Frequent term in this document (${count} occurrences).`,
      difficulty: 'beginner' as const,
      sourcePage: 0,
      example: undefined,
    };
  });

  return { concepts, relationships: [] };
}

export { router as aiRouter };
