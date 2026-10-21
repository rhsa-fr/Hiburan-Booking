/**
 * Transport-level error. The status code travels with the message so screens
 * can distinguish "not found" (render an empty state) from "server error"
 * (offer a retry) without parsing copy.
 */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}
