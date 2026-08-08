export function DashboardPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center text-center">
      <h2 className="font-heading text-2xl font-semibold text-foreground">AI Learning OS</h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">
        Self-healing runtime is active. Pipelines are scheduled, retried, and recovered automatically. Open the Runtime Inspector with Shift + D.
      </p>
    </div>
  );
}
