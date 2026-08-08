import { cn } from '@/utils/cn';

interface LoadingSpinnerProps {
  className?: string;
  label?: string;
}

export function LoadingSpinner({ className, label = 'Loading…' }: LoadingSpinnerProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3', className)} role="status" aria-live="polite">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-current border-t-transparent text-primary" />
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  );
}
