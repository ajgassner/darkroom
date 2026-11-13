// Machine-readable codes for messages we generate, so the UI can translate them.
import type { MessageParams, Notice } from './contract.ts';

export type { MessageParams, Notice };
// The English text stays alongside (CLI, debug log, fallback for unknown codes).

/** Error with a code for the UI. Upstream API errors use a plain Error (or an AppError without code). */
export class AppError extends Error {
  code?: string;
  params?: MessageParams;
  constructor(code: string | undefined, message: string, params?: MessageParams) {
    super(message);
    this.code = code;
    this.params = params;
  }
}

/** Warnings as English text plus the same warnings as codes. */
export interface WarningList {
  warnings: string[];
  notices: Notice[];
}

export function addWarning(w: WarningList, code: string, message: string, params?: MessageParams): void {
  w.warnings.push(message);
  w.notices.push(params ? { code, params } : { code });
}

export const TIMEOUT_MESSAGE = 'Timed out (increase REQUEST_TIMEOUT_MS)';

/** Error fields for a manifest entry: English text, plus code/params for errors we generate. */
export function errorFields(
  err: unknown,
  abort?: AbortSignal,
): { error: string; errorCode?: string; errorParams?: MessageParams } {
  if (abort?.aborted) return { error: 'Aborted', errorCode: 'aborted' };
  if (err instanceof Error && err.name === 'TimeoutError') return { error: TIMEOUT_MESSAGE, errorCode: 'timeout' };
  if (err instanceof AppError && err.code) {
    return { error: err.message, errorCode: err.code, ...(err.params ? { errorParams: err.params } : {}) };
  }
  return { error: err instanceof Error ? err.message : String(err) };
}
