import { cn } from '@/utils/cn';
import { AlertCircle } from 'lucide-react';

interface ErrorRetryProps {
  title?: string;
  message?: string;
  error?: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorRetry({
  title = 'Something went wrong',
  message = 'We could not load this. You can retry or try again later.',
  error,
  onRetry,
  className,
}: ErrorRetryProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-4 p-8 text-center', className)} role="alert">
      <AlertCircle className="h-10 w-10 text-destructive" aria-hidden="true" />
      <div>
        <h3 className="font-heading text-base font-medium text-foreground">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{message}</p>
        {error && (
          <p className="mt-2 max-w-md rounded border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-transform hover:opacity-90 active:scale-[0.97]"
        >
          Try again
        </button>
      )}
    </div>
  );
}
