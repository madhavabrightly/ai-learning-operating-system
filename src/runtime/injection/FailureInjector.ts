import { AppError } from '@/errors/AppError';

export type FailureTarget = 'parse' | 'concepts' | 'research' | 'ai';

export interface FailureInjection {
  enabled: boolean;
  target: FailureTarget | null;
  /** Times to fail before passing (0 = always fail). */
  times: number;
  message: string;
  code: string;
}

const DEFAULT: FailureInjection = { enabled: false, target: null, times: 1, message: 'Injected failure', code: 'INJECTED_FAILURE' };

/**
 * Developer-only failure injection. When enabled, the targeted real component
 * fails for `times` attempts with a transient error so the orchestrator's
 * retry/fallback path executes against REAL code — the failure actually
 * occurs in the selected component.
 */
export class FailureInjector {
  private state: FailureInjection = { ...DEFAULT };

  isEnabled(target: FailureTarget): boolean {
    return this.state.enabled && this.state.target === target;
  }

  configure(injection: Partial<FailureInjection>): FailureInjection {
    this.state = { ...DEFAULT, ...injection };
    return { ...this.state };
  }

  disable(): void {
    this.state = { ...DEFAULT };
  }

  snapshot(): FailureInjection {
    return { ...this.state };
  }

  /** Returns an injected error if the target should fail right now. */
  maybeFail(target: FailureTarget): AppError | null {
    if (!this.isEnabled(target)) return null;
    if (this.state.times <= 0) {
      // Always fail.
      return new AppError({ message: this.state.message, code: this.state.code, retryable: true, fallbackAvailable: true });
    }
    if (this.state.times > 0) {
      this.state.times -= 1;
      if (this.state.times === 0) this.state.enabled = false;
      return new AppError({ message: this.state.message, code: this.state.code, retryable: true, fallbackAvailable: true });
    }
    return null;
  }
}
