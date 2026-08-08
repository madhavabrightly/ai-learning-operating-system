import { useMemo } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

export interface MathRendererProps {
  tex: string;
  inline?: boolean;
  fallbackText?: string;
  className?: string;
}

/**
 * Real KaTeX math renderer. Renders LaTeX to HTML; on failure shows the
 * original source text so formulas are never silently lost.
 */
export function MathRenderer({ tex, inline = false, fallbackText, className }: MathRendererProps) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, {
        displayMode: !inline,
        throwOnError: false,
        strict: false,
      });
    } catch {
      return null;
    }
  }, [tex, inline]);

  if (html === null) {
    return (
      <span className={`font-mono text-sm ${inline ? 'inline' : 'block'} ${className ?? ''}`} title={fallbackText}>
        {tex}
      </span>
    );
  }

  return (
    <span
      className={inline ? 'inline-block' : 'block overflow-x-auto py-1'}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
