// @ts-check
/** Stable engine failures; the CLI owns presentation and confirmation. */
export class InstallerError extends Error {
  /** @param {string} code @param {string} message @param {Record<string, unknown>} [details] @param {number} [exitCode] */
  constructor(code, message, details = {}, exitCode = 2) {
    super(message); this.name = 'InstallerError'; this.code = code; this.exitCode = exitCode; this.details = details;
  }
  toJSON() { return { ok: false, code: this.code, message: this.message, exitCode: this.exitCode, details: this.details }; }
}
/** @param {unknown} error @param {string} code */
export function isFsError(error, code) { return error instanceof Error && 'code' in error && error.code === code; }
/** @param {unknown} error */
export function asInstallerError(error) {
  return error instanceof InstallerError ? error : new InstallerError('IO_ERROR', error instanceof Error ? error.message : 'Filesystem operation failed', error instanceof Error && 'code' in error ? {fsCode:error.code} : {}, 5);
}
