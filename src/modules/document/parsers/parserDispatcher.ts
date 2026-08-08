import { AppError } from '@/errors/AppError';
import type { ParserOutput } from '../model/normalizer';
import { parsePdfFile } from './pdfParser';
import { parseDocxFile } from './docxParser';
import { parseText } from './textParser';

export interface ParseOptions {
  onProgress?: (fraction: number, message?: string) => void;
  /** Per-page progress for PDF. */
  onPageProgress?: (page: number, total: number, message?: string) => void;
  extractFigures?: boolean;
  maxFigureSize?: number;
}

export interface ParseRequest {
  file: File;
  options?: ParseOptions;
}

export function isSupportedFile(file: File): boolean {
  return detectFormat(file) !== 'unsupported';
}

export function detectFormat(file: File): ParserOutput['format'] {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();

  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (
    type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    name.endsWith('.docx')
  ) {
    return 'docx';
  }
  if (name.endsWith('.md') || name.endsWith('.markdown')) return 'markdown';
  if (type.startsWith('text/') || name.endsWith('.txt')) return 'txt';

  return 'unsupported';
}

export function detectRequiresOcr(file: File): boolean {
  const name = file.name.toLowerCase();
  // Scanned PDFs are typically image-only; we cannot know without parsing.
  // The parse stage sets needsOcr per page when a page has no extractable text.
  return name.endsWith('.pdf');
}

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

export function validateUpload(file: File): { ok: true } | { ok: false; reason: string } {
  if (file.size <= 0) return { ok: false, reason: 'File is empty' };
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { ok: false, reason: 'File exceeds the 50 MB limit' };
  }
  if (detectFormat(file) === 'unsupported') {
    return { ok: false, reason: 'Unsupported file type. Supported: PDF, DOCX, TXT, Markdown.' };
  }
  return { ok: true };
}

/** Parse any supported file into raw parser output. */
export async function parseFile(request: ParseRequest): Promise<ParserOutput> {
  const { file, options } = request;
  const format = detectFormat(file);

  switch (format) {
    case 'pdf':
      return parsePdfFile(file, {
        onProgress: options?.onProgress ? (p, t, m) => options.onProgress?.(p / t, m) : undefined,
        onPageProgress: options?.onPageProgress,
        extractFigures: options?.extractFigures,
        maxFigureSize: options?.maxFigureSize,
      });
    case 'docx':
      return parseDocxFile(file, { onProgress: options?.onProgress });
    case 'markdown':
    case 'txt':
      return parseText(await file.text(), { format, title: file.name.replace(/\.[^.]+$/, '') });
    default:
      throw new AppError({
        message: `Unsupported file type: ${file.name}`,
        code: 'UNSUPPORTED_FORMAT',
        retryable: false,
        fallbackAvailable: false,
      });
  }
}

/** Ensure a real File object (not a mocked/empty one) parses. */
export async function parseFileSafe(file: File, options?: ParseOptions): Promise<ParserOutput> {
  if (typeof Blob !== 'undefined' && !(file instanceof Blob)) {
    throw new AppError({ message: 'Invalid file object', code: 'INVALID_FILE', retryable: false });
  }
  const validation = validateUpload(file);
  if (!validation.ok) {
    throw new AppError({ message: validation.reason, code: 'VALIDATION_ERROR', retryable: false });
  }
  return parseFile({ file, options });
}
