import type { ILogger, LogContext, LogLevel } from './ILogger';

const COLORS: Record<LogLevel, string> = {
  debug: 'color:#8b9bb4',
  info: 'color:#4aa8ff',
  warn: 'color:#ffb347',
  error: 'color:#ff6b6b',
};

export class ConsoleLogger implements ILogger {
  constructor(private scope = 'app') {}

  debug(message: string, context?: LogContext): void {
    this.write('debug', message, context);
  }

  info(message: string, context?: LogContext): void {
    this.write('info', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.write('warn', message, context);
  }

  error(message: string, context?: LogContext): void {
    this.write('error', message, context);
  }

  child(scope: string): ILogger {
    return new ConsoleLogger(this.scope ? `${this.scope}:${scope}` : scope);
  }

  async time<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      const result = await fn();
      this.info(`${label} completed`, { durationMs: Math.round(performance.now() - start) });
      return result;
    } catch (error) {
      this.error(`${label} failed`, { durationMs: Math.round(performance.now() - start), error });
      throw error;
    }
  }

  private write(level: LogLevel, message: string, context?: LogContext): void {
    const prefix = `[${new Date().toISOString()}] ${level.toUpperCase()} [${this.scope}]`;
    if (typeof window !== 'undefined' && import.meta.env?.DEV) {
      console.log(`%c${prefix}`, COLORS[level], message, context ?? '');
    } else {
      console.log(prefix, message, context ?? '');
    }
  }
}
