const API_BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1').replace(/\/$/, '');

export type ApiEnvelope<T> = { data: T };

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly correlationId?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  accessToken?: string | null;
  csrfToken?: string | null;
  tenantId?: string | null;
}

function errorMessage(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return 'The request could not be completed.';
  const value = payload as { message?: string | string[]; error?: string };
  if (Array.isArray(value.message)) return value.message.join(' ');
  return value.message ?? value.error ?? 'The request could not be completed.';
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  if (options.accessToken) headers.set('Authorization', `Bearer ${options.accessToken}`);
  if (options.csrfToken) headers.set('x-csrf-token', options.csrfToken);
  if (options.tenantId) headers.set('x-tenant-id', options.tenantId);

  const response = await fetch(`${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`, {
    ...options,
    headers,
    credentials: 'include',
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const correlationId = response.headers.get('x-correlation-id') ?? undefined;
  const payload: unknown = response.status === 204 ? undefined : await response.json().catch(() => undefined);

  if (!response.ok) throw new ApiError(response.status, errorMessage(payload), correlationId, payload);
  return payload as T;
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export function formatEtbMinor(value: string | number | bigint, locale = 'en-ET'): string {
  const minor = typeof value === 'bigint' ? value : BigInt(value);
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  const whole = absolute / 100n;
  const fraction = absolute % 100n;
  const formattedWhole = new Intl.NumberFormat(locale).format(whole);
  const decimals = fraction === 0n ? '' : `.${fraction.toString().padStart(2, '0')}`;
  return `${negative ? '−' : ''}ETB ${formattedWhole}${decimals}`;
}
