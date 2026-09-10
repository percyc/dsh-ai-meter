import type { ErrorCode } from './types.js';
export class MeterError extends Error {
  constructor(readonly code: ErrorCode) { super(code); }
}
export function errorCode(error: unknown): ErrorCode {
  // Do not expose exceptions, response bodies, URLs, CLI stderr, or credentials.
  return error instanceof MeterError ? error.code : 'upstream';
}
