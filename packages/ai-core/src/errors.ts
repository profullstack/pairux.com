/**
 * Thrown when a provider's response cannot be parsed into the required structured
 * shape. Callers catch this to fall back to manual mode (e.g. the clip-review UI
 * lets the host cut clips by hand when selection fails).
 */
export class StructuredOutputError extends Error {
  /** The raw model text that failed to parse, preserved for logging and retry. */
  readonly raw: string;

  constructor(message: string, raw: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'StructuredOutputError';
    this.raw = raw;
  }
}
