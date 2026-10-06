/**
 * Server-side API access for Next.js server components and route handlers.
 * The client bundle must never see these URLs beyond NEXT_PUBLIC_API_URL; in
 * deployment `API_INTERNAL_URL` points at the ECS service without passing
 * through the browser.
 */

const API_BASE_URL = (
  process.env.API_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  'http://localhost:3001/api/v1'
)
  .trim()
  .replace(/\/$/, '');

export class ServerApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ServerApiError';
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      cache: 'no-store',
    });
  } catch (error) {
    throw new ServerApiError(
      0,
      `API unreachable for ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok) {
    throw new ServerApiError(response.status, `API ${path} responded ${response.status}`);
  }
  const body = (await response.json()) as { data: T };
  return body.data;
}

export const serverApi = {
  get: <T>(path: string): Promise<T> => request<T>(path),
  post: <T>(path: string, payload: unknown): Promise<T> =>
    request<T>(path, { method: 'POST', body: JSON.stringify(payload) }),
};
