import { useMemo } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

export interface MathRendererProps {
  tex: string;
  inline?: boolean;
  fallbackText?: string;
}

export function MathRenderer({ tex, inline, fallbackText }: MathRendererProps) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, {
        displayMode: !inline,
        throwOnError: false,
        output: 'html',
      });
    } catch {
      return fallbackText ?? tex;
    }
  }, [tex, inline, fallbackText]);

  if (typeof html === 'string' && !html.startsWith('<')) {
    return <span className="text-sm italic text-muted-foreground">{html}</span>;
  }

  return (
    <span
      dangerouslySetInnerHTML={{ __html: html }}
      className={inline ? 'inline-block' : 'block text-center'}
    />
  );
}