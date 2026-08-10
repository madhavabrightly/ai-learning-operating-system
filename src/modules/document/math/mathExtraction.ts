import type { Formula } from '../model/DocumentModel';

export interface MathExtractionResult {
  clean: string;
  formulas: Formula[];
}

const DISPLAY_MATH_RE = /\$\$([\s\S]+?)\$\$/g;
const INLINE_MATH_RE = /\$([^$\n]+?)\$/g;

/**
 * Detect TeX math in raw text and replace it with marker placeholders so the
 * normalizer can split text paragraphs around formula blocks. When keepMarkers
 * is true the original text is preserved and markers are only reported.
 */
export function detectDisplayMath(
  text: string,
  page: number,
  documentId: string,
  keepMarkers = false,
): MathExtractionResult {
  const formulas: Formula[] = [];
  let clean = text;

  const replace = (re: RegExp, inline: boolean, counter: () => number) => {
    let match: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((match = re.exec(text)) !== null) {
      const tex = match[1]?.trim() ?? '';
      if (!tex) continue;
      const id = `${documentId}-formula-${page}-${counter()}`;
      formulas.push({
        id,
        page,
        tex,
        inline,
        confidence: inline ? 0.8 : 0.9,
        fallbackText: tex,
      });
      if (!keepMarkers) {
        clean = clean.replace(match[0], `\uFFFC[formula:${id}]\uFFFC`);
      }
    }
  };

  let displayCount = 0;
  let inlineCount = 0;
  replace(DISPLAY_MATH_RE, false, () => ++displayCount);
  replace(INLINE_MATH_RE, true, () => ++inlineCount);

  return { clean, formulas };
}
