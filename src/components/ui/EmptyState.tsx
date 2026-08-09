import { cn } from '@/utils/cn';
import { FileQuestion } from 'lucide-react';

interface EmptyStateProps {
  title?: string;
  message?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  title = 'Nothing here yet',
  message = 'When you have content, it will appear here.',
  action,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-4 p-8 text-center', className)}>
      <FileQuestion className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
      <div>
        <h3 className="font-heading text-base font-medium text-foreground">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{message}</p>
      </div>
      {action}
    </div>
  );
}
