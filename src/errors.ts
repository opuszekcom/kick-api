/** Error response from the Kick API, with the HTTP status and response body. */
export class KickApiError extends Error {
  readonly status: number;
  readonly method: string;
  readonly path: string;
  readonly body: unknown;

  constructor({ status, method, path, body }: { status: number; method: string; path: string; body: unknown }) {
    super(`Kick API ${method} ${path} failed with ${status}: ${describe(body)}`);
    this.name = 'KickApiError';
    this.status = status;
    this.method = method;
    this.path = path;
    this.body = body;
  }
}

/** Error response from the Kick OAuth server. */
export class KickAuthError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(`Kick OAuth request failed with ${status}: ${describe(body)}`);
    this.name = 'KickAuthError';
    this.status = status;
    this.body = body;
  }
}

function describe(body: unknown): string {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    for (const key of ['message', 'error_description', 'error']) {
      if (typeof record[key] === 'string') return record[key] as string;
    }
  }
  return typeof body === 'string' && body ? body.slice(0, 300) : 'no details';
}
