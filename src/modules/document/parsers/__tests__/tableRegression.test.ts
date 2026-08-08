import { describe, it, expect } from 'vitest';
import { parseText } from '../textParser';
import { normalizeParserOutput } from '../../model/normalizer';

describe('markdown table extraction (regression)', () => {
  it('extracts a real table from markdown', () => {
    const md = `## Gradient Descent

Gradient descent iteratively updates parameters.

| Iteration | Loss |
|-----------|------|
| 1 | 0.95 |
| 10 | 0.31 |
| 50 | 0.02 |
`;
    const out = parseText(md, { format: 'markdown' });
    expect(out.tables).toBeDefined();
    expect(out.tables!.length).toBe(1);
    expect(out.tables![0]!.headers).toEqual(['Iteration', 'Loss']);
    expect(out.tables![0]!.rows.length).toBe(3);

    const doc = normalizeParserOutput(out, { documentId: 'doc-t' });
    expect(doc.tables.length).toBe(1);
    expect(doc.tables[0]!.headers).toEqual(['Iteration', 'Loss']);
    expect(doc.tables[0]!.rows.length).toBe(3);
    expect(doc.pages[0]!.blocks.some((b) => b.type === 'table')).toBe(true);
  });
});
