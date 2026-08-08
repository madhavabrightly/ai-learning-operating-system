import { describe, it, expect } from 'vitest';
import { parseText } from '../textParser';
import { normalizeParserOutput } from '../../model/normalizer';
import { searchDocument, retrieveChunks } from '../../retrieval/retrieval';
import { extractFormulasFromPages } from '../../math/mathExtraction';

const MARKDOWN = `# Introduction to Algorithms

An algorithm is a finite sequence of well-defined instructions.

## Binary Search

Binary search finds an element in a sorted array by repeatedly halving the search interval.

Time complexity: T(n) = O(log n)

### Properties

- Requires a sorted array
- Runs in logarithmic time
- Constant extra space

## Example Table

| Input | Output |
|-------|--------|
| [1,3,5] | 2 |
| [1,2,3] | 1 |
`;

describe('text markdown parser', () => {
  it('parses headings, lists, code and tables from real markdown', () => {
    const output = parseText(MARKDOWN, { format: 'markdown', title: 'Algorithms' });
    expect(output.format).toBe('markdown');
    expect(output.pages).toHaveLength(1);
    expect(output.tables).toHaveLength(1);
    expect(output.tables?.[0]?.headers).toEqual(['Input', 'Output']);
    expect(output.tables?.[0]?.rows).toHaveLength(2);

    const types = (output.pages[0]?.blocks ?? []).map((b) => b.type);
    expect(types).toContain('heading');
    expect(types).toContain('list');
    expect(types).toContain('table');
    expect(types).toContain('text');
  });
});

describe('normalizer', () => {
  it('builds a canonical ParsedDocument with sections, formulas, tables', () => {
    const output = parseText(MARKDOWN, { format: 'markdown', title: 'Algorithms' });
    const doc = normalizeParserOutput(output, { documentId: 'doc-test-1' });

    expect(doc.id).toBe('doc-test-1');
    expect(doc.metadata.pageCount).toBe(1);
    expect(doc.sections.length).toBeGreaterThan(0);
    expect(doc.tables.length).toBe(1);
    expect(doc.tables[0]!.headers).toEqual(['Input', 'Output']);
    expect(doc.pages[0]!.blocks.length).toBeGreaterThan(0);
  });

  it('detects math and preserves provenance', () => {
    const output = parseText('# Math\n\n$E = mc^2$ is famous.\n\n$$\\int_0^1 x dx = \\frac{1}{2}$$\n', { format: 'markdown' });
    const doc = normalizeParserOutput(output, { documentId: 'doc-math' });
    expect(doc.formulas.length).toBeGreaterThan(0);
    const formula = doc.formulas[0]!;
    expect(formula.page).toBe(1);
    expect(formula.tex.length).toBeGreaterThan(0);
    expect(formula.source.page).toBe(1);
  });

  it('extracts formulas from plain text hints', () => {
    const pages = [{ index: 1, text: 'The recurrence is T(n) = 2T(n/2) + n and it solves to O(n log n).', blocks: [], blockIds: [] }];
    const formulas = extractFormulasFromPages(pages as never, 'doc-x');
    expect(formulas.length).toBeGreaterThan(0);
    expect(formulas[0]!.tex).toContain('\\log');
  });
});

describe('retrieval', () => {
  it('searches real extracted content with page provenance', () => {
    const output = parseText(MARKDOWN, { format: 'markdown', title: 'Algorithms' });
    const doc = normalizeParserOutput(output, { documentId: 'doc-search' });

    const results = searchDocument(doc, 'binary search');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.page).toBe(1);
    expect(results[0]!.text.toLowerCase()).toContain('binary search');
  });

  it('retrieves grounded chunks ranked by query terms', () => {
    const output = parseText(MARKDOWN, { format: 'markdown', title: 'Algorithms' });
    const doc = normalizeParserOutput(output, { documentId: 'doc-chunks' });

    const chunks = retrieveChunks(doc, 'sorted array halving');
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]!.text.toLowerCase()).toContain('sorted');
  });
});
