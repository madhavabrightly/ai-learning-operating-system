import { cn } from '@/utils/cn';
import { LoadingSpinner } from './LoadingSpinner';
import { EmptyState } from './EmptyState';
import { ErrorRetry } from './ErrorRetry';

interface AsyncBoundaryProps<T> {
  state: {
    loading: boolean;
    error?: string;
    data?: T;
  };
  empty?: boolean;
  emptyTitle?: string;
  emptyMessage?: string;
  emptyAction?: React.ReactNode;
  onRetry?: () => void;
  children: (data: T) => React.ReactNode;
  className?: string;
}

export function AsyncBoundary<T>({
  state,
  empty,
  emptyTitle,
  emptyMessage,
  emptyAction,
  onRetry,
  children,
  className,
}: AsyncBoundaryProps<T>) {
  if (state.loading) {
    return (
      <div className={cn('flex h-full min-h-[8rem] items-center justify-center', className)}>
        <LoadingSpinner />
      </div>
    );
  }
  if (state.error) {
    return <ErrorRetry message={state.error} onRetry={onRetry} className={className} />;
  }
  if (empty || state.data === undefined) {
    return <EmptyState title={emptyTitle} message={emptyMessage} action={emptyAction} className={className} />;
  }
  return <>{children(state.data)}</>;
}
