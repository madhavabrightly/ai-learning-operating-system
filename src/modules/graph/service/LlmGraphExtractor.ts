import { ok, err } from '@/errors/ResultFactory';
import type { Result } from '@/errors/types';
import { AppError } from '@/errors/AppError';
import type { AiProviderClient } from '@/modules/ai/AiProviderClient';
import type { DocumentService } from '@/modules/document/service/DocumentService';
import type {
  Concept,
  ConceptRelationship,
  KnowledgeGraph,
  RelationshipType,
} from '@/modules/graph/types/GraphTypes';
import type {
  GraphExtractor,
  GraphExtractionOptions,
} from './BackendGraphExtractor';

const VALID_RELATIONSHIP_TYPES: RelationshipType[] = [
  'prerequisite',
  'related',
  'part_of',
  'leads_to',
];

const VALID_DIFFICULTIES = [
  'beginner',
  'intermediate',
  'advanced',
] as const;

interface LlmGraphShape {
  concepts?: Array<{
    label?: unknown;
    description?: unknown;
    difficulty?: unknown;
    aliases?: unknown;
  }>;
  relationships?: Array<{
    source?: unknown;
    target?: unknown;
    type?: unknown;
    evidence?: unknown;
  }>;
}

/**
 * LLM-powered graph extractor. Routes through the OpenRouter Edge Function
 * (the same transport the chat pipeline uses) with a strict-JSON prompt, then
 * normalizes the model's concepts/relationships into a KnowledgeGraph.
 *
 * No localhost backend involved. If the LLM call fails, a deterministic local
 * fallback (frequency-based concepts + co-occurrence edges) keeps the graph
 * tab functional instead of dead.
 */
export function createLlmGraphExtractor(deps: {
  provider: AiProviderClient;
  documents: DocumentService;
}): GraphExtractor {
  return {
    async extract(
      documentId: string,
      options: GraphExtractionOptions = {},
    ): Promise<Result<KnowledgeGraph>> {
      const id = documentId.trim();

      if (!id) {
        return err(
          AppError.from(
            new Error(
              'documentId is required for graph extraction',
            ),
          ),
        );
      }

      // Load the document text so it can be passed to the LLM.
      const docResult =
        await deps.documents.getDocument(id);

      if (
        !docResult.success ||
        !docResult.data
      ) {
        return err(
          AppError.from(
            new Error(
              `Document ${id} could not be loaded for graph extraction`,
            ),
          ),
        );
      }

      const text =
        docResult.data.pages
          ?.map((p) => p.text)
          .join('\n') ?? '';

      if (!text.trim()) {
        return err(
          AppError.from(
            new Error(
              'This document has no extractable text yet.',
            ),
          ),
        );
      }

      try {
        const raw =
          await deps.provider.extractGraph(
            id,
            text.slice(0, 20000),
          );

        const graph =
          normalizeLlmGraph(
            raw,
            id,
            options.maxConcepts ?? 20,
          );

        if (
          graph.concepts.length === 0 ||
          graph.relationships.length === 0
        ) {
          throw new AppError({
            message:
              'Model returned an empty graph',
            code: 'JSON_PARSE_ERROR',
            retryable: false,
          });
        }

        return ok(graph);
      } catch (error) {
        // Deterministic fallback so the graph tab never hard-fails on a
        // transient AI error — never fabricated data, but real text-derived
        // concepts and co-occurrence edges.
        const fallback =
          localFallbackExtraction(
            text,
            id,
            options.maxConcepts ?? 20,
          );

        return ok({
          ...fallback,

          metadata: {
            ...fallback.metadata,

            fallbackReason:
              error instanceof AppError
                ? error.message
                : 'LLM extraction failed',
          },
        });
      }
    },
  };
}

// ===========================================================================
// LLM result → KnowledgeGraph normalization
// ===========================================================================

function normalizeLlmGraph(
  raw: unknown,
  documentId: string,
  maxConcepts: number,
): KnowledgeGraph {
  if (
    typeof raw !== 'object' ||
    raw === null
  ) {
    throw new AppError({
      message:
        'Model did not return a JSON object for the graph',
      code: 'JSON_PARSE_ERROR',
      retryable: false,
    });
  }

  const data = raw as LlmGraphShape;
  const rawConcepts = Array.isArray(
    data.concepts,
  )
    ? data.concepts
    : [];

  const labelToId = new Map<
    string,
    string
  >();

  const concepts: Concept[] = [];

  for (
    const entry of rawConcepts.slice(
      0,
      maxConcepts,
    )
  ) {
    if (
      typeof entry !== 'object' ||
      entry === null
    ) {
      continue;
    }

    const label =
      typeof entry.label === 'string'
        ? entry.label.trim()
        : '';

    if (!label) continue;

    const id = slugify(label);
    if (
      !id ||
      labelToId.has(
        label.toLowerCase(),
      )
    ) {
      continue;
    }

    labelToId.set(
      label.toLowerCase(),
      id,
    );

    concepts.push({
      id,

      label,

      description:
        typeof entry.description ===
        'string'
          ? entry.description.trim()
          : undefined,

      difficulty: normalizeDifficulty(
        entry.difficulty,
      ),

      aliases: normalizeAliases(
        entry.aliases,
      ),

      confidence: 0.85,

      mastery: 0,

      sourceDocumentId:
        documentId,
    });
  }

  const relationships:
    ConceptRelationship[] = [];

  for (
    const entry of
    data.relationships ?? []
  ) {
    if (
      typeof entry !== 'object' ||
      entry === null
    ) {
      continue;
    }

    const sourceLabel =
      typeof entry.source === 'string'
        ? entry.source.trim()
        : '';

    const targetLabel =
      typeof entry.target === 'string'
        ? entry.target.trim()
        : '';

    const source =
      labelToId.get(
        sourceLabel.toLowerCase(),
      );

    const target =
      labelToId.get(
        targetLabel.toLowerCase(),
      );

    if (
      !source ||
      !target ||
      source === target
    ) {
      continue;
    }

    const type = normalizeType(
      entry.type,
    );

    const id = `${source}:${target}:${type}`;

    relationships.push({
      id,

      source,

      target,

      type,

      strength: 0.8,

      confidence: 0.8,

      evidence:
        typeof entry.evidence ===
        'string'
          ? entry.evidence.trim()
          : undefined,
    });
  }

  return {
    documentId,

    concepts,

    relationships,

    metadata: {
      version: '1',

      extractor: 'openrouter-llm',

      generatedAt:
        new Date().toISOString(),

      conceptCount:
        concepts.length,

      relationshipCount:
        relationships.length,
    },
  };
}

function normalizeDifficulty(
  value: unknown,
): Concept['difficulty'] {
  if (
    typeof value === 'string' &&
    (
      VALID_DIFFICULTIES as readonly string[]
    ).includes(value)
  ) {
    return value as Concept['difficulty'];
  }

  return undefined;
}

function normalizeAliases(
  value: unknown,
): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const aliases = value
    .filter(
      (a): a is string =>
        typeof a === 'string' &&
        a.trim().length > 0,
    )
    .map((a) => a.trim())
    .slice(0, 5);

  return aliases.length > 0
    ? aliases
    : undefined;
}

function normalizeType(
  value: unknown,
): RelationshipType {
  if (
    typeof value === 'string' &&
    (
      VALID_RELATIONSHIP_TYPES as string[]
    ).includes(value)
  ) {
    return value as RelationshipType;
  }

  return 'related';
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(
      /[^a-z0-9]+/g,
      '-',
    )
    .replace(
      /^-+|-+$/g,
      '',
    );
}

// ===========================================================================
// Local fallback: frequency-based concepts + sentence co-occurrence edges
// ===========================================================================

const STOPWORDS = new Set(
  `
a an and are as at be but by for from has have he her his i if in is it its
of on or she that the their them they this to was we were will with you your
our their there when where which while who whom whose why how what all any
both each few more most other some such no nor not only own same so than too
very can just should could would may might must about into over after before
between out up down off on under again further then once here also because
these those during doing does did done being been have having do does did
new page chapter section figure table source document text
  `.trim().split(/\s+/),
);

function localFallbackExtraction(
  text: string,
  documentId: string,
  maxConcepts: number,
): KnowledgeGraph {
  const sentences = text
    .split(/[.!?]\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // Frequency-based concept candidates: capitalized multi-word phrases are
  // strong signal for proper nouns / key terms.
  const counts = new Map<
    string,
    number
  >();

  const phraseRe =
    /\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*\b/g;

  for (
    const sentence of sentences
  ) {
    const matches =
      sentence.match(phraseRe) ?? [];

    for (
      const phrase of matches
    ) {
      const words =
        phrase.split(/\s+/);

      if (
        words.every((w) =>
          STOPWORDS.has(
            w.toLowerCase(),
          ),
        )
      ) {
        continue;
      }

      const key = phrase.toLowerCase();
      counts.set(
        key,
        (counts.get(key) ?? 0) + 1,
      );
    }
  }

  const ranked = [
    ...counts.entries(),
  ]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxConcepts);

  const concepts: Concept[] = [];
  const labelToId = new Map<
    string,
    string
  >();

  for (
    const [
      key,
      frequency,
    ] of ranked
  ) {
    const id = slugify(key);

    if (!id) continue;

    labelToId.set(key, id);

    concepts.push({
      id,

      label: key
        .split(/\s+/)
        .map(
          (w) =>
            w.charAt(0).toUpperCase() +
            w.slice(1),
        )
        .join(' '),

      confidence: Math.min(
        1,
        0.4 + frequency * 0.1,
      ),

      mastery: 0,

      sourceDocumentId:
        documentId,
    });
  }

  // Co-occurrence edges: two concepts in the same sentence are related.
  const seen = new Set<string>();
  const relationships:
    ConceptRelationship[] = [];

  for (
    const sentence of sentences
  ) {
    const present = concepts.filter(
      (c) =>
        sentence
          .toLowerCase()
          .includes(
            c.label.toLowerCase(),
          ),
    );

    for (
      let i = 0;
      i < present.length;
      i++
    ) {
      for (
        let j = i + 1;
        j < present.length;
        j++
      ) {
        const a = present[i];
        const b = present[j];
        const key = [a.id, b.id].sort().join(':'); // undirected
        if (seen.has(key)) continue;
        seen.add(key);

        relationships.push({
          id: `${a.id}:${b.id}:related`,

          source: a.id,

          target: b.id,

          type: 'related',

          strength: 0.5,

          confidence: 0.5,
        });

        if (
          relationships.length >= 60
        ) {
          break;
        }
      }

      if (
        relationships.length >= 60
      ) {
        break;
      }
    }

    if (
      relationships.length >= 60
    ) {
      break;
    }
  }

  return {
    documentId,

    concepts,

    relationships,

    metadata: {
      version: '1',

      extractor: 'local-fallback',

      generatedAt:
        new Date().toISOString(),

      conceptCount:
        concepts.length,

      relationshipCount:
        relationships.length,
    },
  };
}
