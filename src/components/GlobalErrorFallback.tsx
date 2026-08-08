import { FallbackProps } from 'react-error-boundary';
import { AlertTriangle, RotateCcw, RefreshCw } from 'lucide-react';
import { cn } from '@/utils/cn';

export function GlobalErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6 text-center"
      role="alert"
      aria-live="assertive"
    >
      <div className="rounded-full bg-destructive/10 p-4">
        <AlertTriangle className="h-10 w-10 text-destructive" aria-hidden="true" />
      </div>
      <div className="max-w-md space-y-2">
        <h1 className="font-heading text-xl font-semibold text-foreground">We hit a problem</h1>
        <p className="text-sm text-muted-foreground">
          Something unexpected happened. You can retry or reload the app. Your session is saved locally.
        </p>
        {error instanceof Error && (
          <p className="rounded border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error.message}
          </p>
        )}
      </div>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={resetErrorBoundary}
          className={cn(
            'inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary',
            'transition-transform hover:opacity-90 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          <RotateCcw className="h-4 w-4" />
          Try again
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className={cn(
            'inline-flex items-center gap-2 rounded-md border border-border bg-muted px-4 py-2 text-sm font-medium text-foreground',
            'transition-transform hover:bg-muted/80 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          <RefreshCw className="h-4 w-4" />
          Reload app
        </button>
      </div>
    </div>
  );
}
