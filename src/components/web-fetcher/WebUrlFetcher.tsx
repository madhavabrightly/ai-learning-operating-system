import { useState, useCallback } from 'react';
import { Globe, Upload, X } from 'lucide-react';
import { fetchPageContent, BrightDataError } from '@/services/BrightDataService';

const MAX_PREVIEW_CHARS = 2000;

export interface WebUrlFetcherProps {
  onInject: (content: { url: string; title: string; text: string }) => void;
}

export function WebUrlFetcher({ onInject }: WebUrlFetcherProps) {
  const [url, setUrl] = useState('');
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const handleFetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    setContent(null);
    try {
      const result = await fetchPageContent(url);
      setContent(result.content);
      setPreviewOpen(true);
    } catch (err) {
      const message = err instanceof BrightDataError ? err.message : 'Something went wrong fetching the page.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [url]);

  const handleInject = useCallback(() => {
    if (!content) return;
    const title = extractTitle(content) || new URL(url).hostname;
    onInject({ url, title, text: content });
    setUrl('');
    setContent(null);
    setPreviewOpen(false);
    setError(null);
  }, [content, url, onInject]);

  const handleClear = useCallback(() => {
    setContent(null);
    setPreviewOpen(false);
    setError(null);
  }, []);

  return (
    <div className="space-y-3 rounded-xl border border-border bg-muted/40 p-4">
      <div className="flex items-center gap-2">
        <Globe className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <h3 className="text-sm font-medium text-foreground">Fetch a web page</h3>
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && url.trim() && !loading) {
              void handleFetch();
            }
          }}
          placeholder="https://example.com/article"
          className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Web page URL"
        />
        <button
          type="button"
          onClick={() => void handleFetch()}
          disabled={loading || !url.trim()}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]"
        >
          {loading ? (
            <>
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
              Fetching…
            </>
          ) : (
            <>
              <Globe className="h-3.5 w-3.5" aria-hidden="true" />
              Fetch page
            </>
          )}
        </button>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {previewOpen && content && (
        <div className="space-y-3">
          <div className="relative max-h-64 overflow-auto rounded-lg border border-border bg-background p-3">
            <button
              type="button"
              onClick={handleClear}
              className="absolute right-2 top-2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Close preview"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <pre className="whitespace-pre-wrap text-xs text-foreground">
              {content.length > MAX_PREVIEW_CHARS ? `${content.slice(0, MAX_PREVIEW_CHARS)}…` : content}
            </pre>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {content.length.toLocaleString()} characters fetched
            </p>
            <button
              type="button"
              onClick={handleInject}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97]"
            >
              <Upload className="h-3.5 w-3.5" aria-hidden="true" />
              Inject into current document
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function extractTitle(html: string): string | null {
  const match = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  return match?.[1]?.trim() ?? null;
}
