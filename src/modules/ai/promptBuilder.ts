import type { GroundingContext, AiChatMessage } from '@/modules/ai/AiProviderClient';
import { CONTEXT_BUDGET, HISTORY_KEEP_ROUNDS } from '@/constants/config';

// ---------------------------------------------------------------------------
// Token budgeting
// Rough heuristic: ~4 chars per token. Good enough for truncation decisions.
// ---------------------------------------------------------------------------

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Cap a single text chunk to a token budget, keeping head + tail. */
export function truncateTokens(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) return text;
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  const head = text.slice(0, Math.floor(maxChars * 0.7));
  const tail = text.slice(-Math.floor(maxChars * 0.25));
  return `${head}\n… [truncated] …\n${tail}`;
}

export interface BuiltPrompt {
  messages: AiChatMessage[];
  /** Numbered sources in the order they were presented, for provenance. */
  sources: { number: number; title: string; page?: number; url?: string; text: string }[];
}

/**
 * Builds a per-request prompt from the grounding context, history, and the
 * current user message, staying inside the configured token budget.
 *
 * Budget split (from STEP 2 spec):
 *   system prompt        ~500
 *   ground context       ~9000
 *   recent history       ~2000
 *   current user message ~500
 */
export function buildChatPrompt(params: {
  grounding?: GroundingContext;
  history: AiChatMessage[];
  userContent: string;
  intent?: string;
}): BuiltPrompt {
  const { grounding, history, userContent, intent } = params;

  const sources: BuiltPrompt['sources'] = [];
  const groundBlocks: string[] = [];

  if (grounding) {
    // Pages first — these are the primary source material.
    if (grounding.pages?.length) {
      for (const page of grounding.pages) {
        sources.push({ number: sources.length + 1, title: `Page ${page.page}`, page: page.page, text: page.text });
        groundBlocks.push(`[${sources.length}] (Page ${page.page})\n${truncateTokens(page.text, 2400)}`);
      }
    }
    if (grounding.sections?.length) {
      for (const s of grounding.sections) {
        sources.push({ number: sources.length + 1, title: `Section "${s.title}" (Page ${s.page})`, page: s.page, text: s.text });
        groundBlocks.push(`[${sources.length}] (Section "${s.title}", Page ${s.page})\n${truncateTokens(s.text, 1600)}`);
      }
    }
    if (grounding.formulas?.length) {
      const formulas = grounding.formulas.map((f) => `Formula ${f.id} (page ${f.page}): ${f.tex}`).join('\n');
      groundBlocks.push(`[Formulas]\n${formulas}`);
    }
    if (grounding.tables?.length) {
      const tables = grounding.tables
        .map((t) => `Table ${t.id} (page ${t.page}):\n${t.rows.map((r) => r.join(' | ')).join('\n')}`)
        .join('\n\n');
      groundBlocks.push(`[Tables]\n${truncateTokens(tables, 1500)}`);
    }
    if (grounding.selection) {
      groundBlocks.push(`[User selection]\n${truncateTokens(grounding.selection, 600)}`);
    }
  }

  // Allocate the ground-context budget (~9000 tokens).
  let groundText = groundBlocks.join('\n\n');
  if (estimateTokens(groundText) > CONTEXT_BUDGET.GROUND_CONTEXT) {
    groundText = truncateTokens(groundText, CONTEXT_BUDGET.GROUND_CONTEXT);
  }

  // History: keep the last N complete rounds (user+assistant pairs).
  const kept = history.slice(-HISTORY_KEEP_ROUNDS * 2);

  // System prompt: grounded, citation-enforcing, no pinned persona.
  const systemPrompt = [
    'You are the study assistant inside a document learning workspace.',
    'Answer the user using ONLY the provided source material below.',
    'Every factual claim must be supported by the sources. Cite sources inline like [1], [2] matching the numbered source blocks.',
    'If the sources do not contain the answer, say so explicitly — never invent content.',
    'Keep answers concise and structured. Use math in LaTeX with $...$ / $$...$$ when relevant.',
    intent ? `Current task: ${intent}.` : '',
    groundText ? `\n--- Source material ---\n${groundText}\n--- End of source material ---` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const messages: AiChatMessage[] = [{ role: 'system', content: systemPrompt }];

  for (const m of kept) {
    if (m.role === 'system') continue;
    messages.push(m);
  }

  // Current user message (keep within budget).
  messages.push({ role: 'user', content: truncateTokens(userContent, CONTEXT_BUDGET.CURRENT) });

  return { messages, sources };
}

/**
 * Strict-JSON prompt used for structured generation (questions/quiz/flashcards).
 * The model returns ONLY a JSON array; the client parses and validates it.
 */
export function buildStructuredPrompt(params: {
  kind: 'questions' | 'quiz' | 'flashcards';
  text: string;
  count?: number;
  difficulty?: string;
}): string {
  const { kind, text, count = 5, difficulty = 'medium' } = params;
  const shapes: Record<string, string> = {
    questions: `[{"id":"q1","question":"...","answer":"..."}]`,
    quiz: `[{"id":"q1","question":"...","options":["A","B","C","D"],"correctIndex":0,"explanation":"..."}]`,
    flashcards: `[{"id":"fc1","front":"...","back":"..."}]`,
  };
  return [
    `Generate ${count} ${kind} about the document text below.`,
    `Difficulty: ${difficulty}.`,
    kind === 'quiz' ? 'Each quiz question must have exactly 4 options, exactly 1 correct, correctIndex is an integer 0-3, plus a short explanation.' : '',
    `Return ONLY valid JSON in this exact shape (an array): ${shapes[kind]}`,
    'Do not wrap it in markdown. Do not include any text outside the JSON array.',
    '',
    '--- Document text ---',
    truncateTokens(text, 6000),
    '--- End ---',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Strict-JSON prompt for knowledge-graph extraction. The model returns ONLY a
 * JSON object with `concepts` and `relationships` (source/target/type); the
 * client parses, validates, and normalizes it into a KnowledgeGraph.
 */
export function buildGraphExtractionPrompt(params: {
  text: string;
  maxConcepts?: number;
}): string {
  const { text, maxConcepts = 20 } = params;
  return [
    'You are a knowledge-graph extraction engine for a study app.',
    'Analyze the document text below and extract its key concepts and the relationships between them.',
    'Return ONLY valid JSON (no markdown, no code fences, no commentary) in EXACTLY this shape:',
    '{',
    '  "concepts": [',
    '    {"label": "Concept name", "description": "one-sentence explanation", "difficulty": "beginner|intermediate|advanced", "aliases": ["alt name"]}',
    '  ],',
    '  "relationships": [',
    '    {"source": "Concept name", "target": "Other concept", "type": "prerequisite|related|part_of|leads_to", "evidence": "short verbatim quote"}',
    '  ]',
    '}',
    `Extract between 6 and ${maxConcepts} concepts covering the document's main ideas.`,
    'Use the exact same label string for a concept everywhere it appears.',
    'relationship.type must be one of: prerequisite (this concept is needed first), related (associated), part_of (is a component of), leads_to (results in).',
    'Only create relationships between concepts that actually appear in the text.',
    'When possible, quote evidence verbatim from the text.',
    '',
    '--- Document text ---',
    truncateTokens(text, 12000),
    '--- End of document text ---',
  ].join('\n');
}