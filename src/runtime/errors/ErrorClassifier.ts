import { AppError } from '@/errors/AppError';
import type { ErrorCategory, ErrorClassification } from '../types';

const DEFAULT_CLASSIFICATIONS: Record<ErrorCategory, Omit<ErrorClassification, 'category'>> = {
  TRANSIENT: { retry: true, fallback: true, severity: 'medium', notifyUser: false, telemetry: true },
  PERMANENT: { retry: false, fallback: true, severity: 'high', notifyUser: true, telemetry: true },
  NETWORK: { retry: true, fallback: true, severity: 'medium', notifyUser: false, telemetry: true },
  VALIDATION: { retry: false, fallback: false, severity: 'medium', notifyUser: true, telemetry: true },
  AUTH: { retry: false, fallback: false, severity: 'critical', notifyUser: true, telemetry: true },
  PLUGIN: { retry: true, fallback: true, severity: 'high', notifyUser: true, telemetry: true },
  AI_PROVIDER: { retry: true, fallback: true, severity: 'medium', notifyUser: false, telemetry: true },
  OCR: { retry: true, fallback: true, severity: 'medium', notifyUser: false, telemetry: true },
  PARSER: { retry: true, fallback: true, severity: 'medium', notifyUser: false, telemetry: true },
  DATABASE: { retry: true, fallback: true, severity: 'high', notifyUser: false, telemetry: true },
  UNKNOWN: { retry: false, fallback: true, severity: 'medium', notifyUser: false, telemetry: true },
};

const CODE_TO_CATEGORY: Record<string, ErrorCategory> = {
  TIMEOUT: 'TRANSIENT',
  NETWORK_ERROR: 'NETWORK',
  FETCH_FAILED: 'NETWORK',
  WS_ERROR: 'NETWORK',
  DI_MISSING: 'PLUGIN',
  APP_ERROR: 'UNKNOWN',
};

export function classifyError(error: AppError): ErrorClassification {
  const category = CODE_TO_CATEGORY[error.code] ?? inferCategoryFromMessage(error.message);
  return { category, ...DEFAULT_CLASSIFICATIONS[category] };
}

function inferCategoryFromMessage(message: string): ErrorCategory {
  const m = message.toLowerCase();
  if (m.includes('timeout')) return 'TRANSIENT';
  if (m.includes('network') || m.includes('fetch') || m.includes('websocket')) return 'NETWORK';
  if (m.includes('validation') || m.includes('invalid')) return 'VALIDATION';
  if (m.includes('auth') || m.includes('unauthorized') || m.includes('forbidden')) return 'AUTH';
  if (m.includes('plugin')) return 'PLUGIN';
  if (m.includes('ocr')) return 'OCR';
  if (m.includes('parser') || m.includes('parse')) return 'PARSER';
  if (m.includes('database') || m.includes('db')) return 'DATABASE';
  if (m.includes('ai') || m.includes('model') || m.includes('llm')) return 'AI_PROVIDER';
  return 'UNKNOWN';
}
