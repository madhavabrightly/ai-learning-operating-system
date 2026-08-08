import type { Formula, DocumentPage } from '../model/DocumentModel';

/**
 * Math extraction utilities.
 *
 * This is a real, deterministic extraction layer: it detects LaTeX-style math
 * in parsed text (inline `$...$`, display `$$...$$`, `\[...\]`, `\(...\)`)
 * and converts plain-text math expressions to LaTeX where the shape is
 * recognizable (e.g. "T(n) = O(log n)"). When a formula is found only as a
 * visual region, callers preserve the original bbox/fallback text.
 */

const DISPLAY_PATTERNS: { re: RegExp; inline: boolean }[] = [
  { re: /\$\$([\s\S]+?)\$\$/g, inline: false },
  { re: /\\\[([\s\S]+?)\\\]/g, inline: false },
  { re: /\$([^$\n]{1,300}?)\$/g, inline: true },
  { re: /\\\(([^\\\n]{1,300}?)\\\)/g, inline: true },
];

const PLAIN_MATH_HINTS = [
  /^[A-Za-z]\([^)]*\)\s*=.*[+−\-÷×=√^_]/,
  /\b(?:log|ln|exp|sin|cos|tan|lim|sum|prod|sqrt|int|frac)\b/,
  /[0-9]\s*[+\-÷×]\s*[0-9]/,
  /\\?[A-Za-z]+_{[^}]+}|\^[^{]|x\^\d/,
];

export interface MathExtractionOptions {
  /** Keep plain-text equations too (lower confidence). */
  includePlainMath?: boolean;
}

export interface MathScanResult {
  formulas: Formula[];
  /** Page text with math regions replaced by placeholders. */
  cleanText: string;
}

function detectDisplayMath(text: string, page: number, documentId: string, includePlain: boolean): { formulas: Formula[]; clean: string } {
  const formulas: Formula[] = [];
  let clean = text;

  // Replace display/inline LaTeX first (longest first).
  for (const { re, inline } of DISPLAY_PATTERNS) {
    let m: RegExpExecArray | null;
    // Reset lastIndex for each pattern pass.
    re.lastIndex = 0;
    const occurrences: { start: number; end: number; tex: string }[] = [];
    while ((m = re.exec(clean)) !== null) {
      const tex = m[1]?.trim() ?? '';
      if (!tex) continue;
      occurrences.push({ start: m.index, end: m.index + m[0].length, tex });
      if (re.lastIndex === m.index) re.lastIndex++;
    }
    if (occurrences.length === 0) continue;
    // Build a new string replacing occurrences right-to-left.
    let out = clean;
    for (let i = occurrences.length - 1; i >= 0; i--) {
      const occ = occurrences[i]!;
      const id = `${documentId}-formula-${formulas.length + 1}`;
      formulas.push({
        id,
        page,
        tex: occ.tex,
        inline,
        confidence: inline ? 0.85 : 0.9,
        source: { page },
      });
      out = out.slice(0, occ.start) + `\uFFFC[formula:${id}]\uFFFC` + out.slice(occ.end);
    }
    clean = out;
  }

  // Plain-text math (line-based, no $ delimiters).
  if (includePlain) {
    const lines = clean.split('\n');
    const outLines: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      const isMath =
        trimmed.length > 2 &&
        trimmed.length < 300 &&
        !trimmed.includes('\uFFFC') &&
        PLAIN_MATH_HINTS.some((hint) => hint.test(trimmed));
      if (isMath) {
        const id = `${documentId}-formula-${formulas.length + 1}`;
        formulas.push({
          id,
          page,
          tex: plainToLatex(trimmed),
          inline: false,
          confidence: 0.5,
          source: { page },
          fallbackText: trimmed,
        });
        outLines.push(`\uFFFC[formula:${id}]\uFFFC`);
      } else {
        outLines.push(line);
      }
    }
    clean = outLines.join('\n');
  }

  return { formulas, clean };
}

/** Best-effort conversion of common plain-text math to LaTeX. */
export function plainToLatex(expr: string): string {
  return expr
    .replace(/\blog\b/g, '\\log')
    .replace(/\bln\b/g, '\\ln')
    .replace(/\bexp\b/g, '\\exp')
    .replace(/\bsin\b/g, '\\sin')
    .replace(/\bcos\b/g, '\\cos')
    .replace(/\btan\b/g, '\\tan')
    .replace(/\blim\b/g, '\\lim')
    .replace(/\bsum\b/g, '\\sum')
    .replace(/\bprod\b/g, '\\prod')
    .replace(/\bsqrt\s*\(/g, '\\sqrt{')
    .replace(/^([A-Za-z]+)\(([^)]*)\)\s*=/g, '$1($2) = ')
    .replace(/\bfrac\b/g, '\\frac')
    .replace(/\binfinity\b/g, '\\infty')
    .trim();
}

/** Extract formulas from a list of parsed pages. */
export function extractFormulasFromPages(
  pages: DocumentPage[],
  documentId: string,
  options: MathExtractionOptions = {},
): Formula[] {
  const all: Formula[] = [];
  for (const page of pages) {
    const { formulas } = detectDisplayMath(page.text, page.index, documentId, options.includePlainMath ?? true);
    all.push(...formulas);
  }
  return all;
}

export { detectDisplayMath };
