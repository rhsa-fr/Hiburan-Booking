/**
 * One-line structured logs: `job=auto_complete processed=3 skipped=1`.
 * No secrets, no PII (no phone numbers, names, addresses or payloads).
 */
export function logLine(fields: string): void {
  console.log(`ts=${new Date().toISOString()} ${fields}`);
}

/** Single-line, length-capped error text for logs. */
export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, ' ').slice(0, 200);
}
