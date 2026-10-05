import { describe, expect, it } from 'vitest';
import { envSchema, workerEnvSchema } from '@rms/config';

function apiEnv(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/rms',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'b'.repeat(32),
    S3_PROOF_BUCKET: 'rms-proof-bucket',
    ...overrides,
  };
}

const BLANK_OPTIONAL_KEYS = [
  'S3_MEDIA_BUCKET',
  'MEDIA_CDN_URL',
  'SQS_QUEUE_URL',
  'S3_ENDPOINT',
  'SQS_ENDPOINT',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'COOKIE_DOMAIN',
  'REDIS_PASSWORD',
] as const;

const BLANK_WORKER_OPTIONAL_KEYS = [
  'S3_PROOF_BUCKET',
  'S3_MEDIA_BUCKET',
  'S3_ENDPOINT',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'MEDIA_CDN_URL',
  'SQS_QUEUE_URL',
  'SQS_ENDPOINT',
] as const;

describe('envSchema blank handling', () => {
  it('treats blank optional values as unset (docker compose renders unset vars as "")', () => {
    const blanks = Object.fromEntries(BLANK_OPTIONAL_KEYS.map((key) => [key, '']));
    const result = envSchema.parse(apiEnv(blanks));
    for (const key of BLANK_OPTIONAL_KEYS) expect(result[key as keyof typeof result]).toBeUndefined();
  });

  it('treats omitted optional values as unset', () => {
    const result = envSchema.parse(apiEnv());
    expect(result.S3_MEDIA_BUCKET).toBeUndefined();
    expect(result.MEDIA_CDN_URL).toBeUndefined();
    expect(result.SQS_QUEUE_URL).toBeUndefined();
  });

  it('keeps valid non-empty optional values', () => {
    const result = envSchema.parse(
      apiEnv({
        S3_MEDIA_BUCKET: 'rms-media',
        MEDIA_CDN_URL: 'https://cdn.example.test',
        SQS_QUEUE_URL: 'https://sqs.us-east-1.amazonaws.com/123456789012/rms-staging',
      }),
    );
    expect(result.S3_MEDIA_BUCKET).toBe('rms-media');
    expect(result.MEDIA_CDN_URL).toBe('https://cdn.example.test');
    expect(result.SQS_QUEUE_URL).toBe('https://sqs.us-east-1.amazonaws.com/123456789012/rms-staging');
  });

  it('still rejects malformed non-empty values', () => {
    const invalidUrl = envSchema.safeParse(apiEnv({ MEDIA_CDN_URL: 'not a url' }));
    expect(invalidUrl.success).toBe(false);
    if (!invalidUrl.success) expect(invalidUrl.error.flatten().fieldErrors.MEDIA_CDN_URL).toBeDefined();

    const invalidQueue = envSchema.safeParse(apiEnv({ SQS_QUEUE_URL: 'rms-staging' }));
    expect(invalidQueue.success).toBe(false);
  });

  it('treats whitespace-only values as unset and trims surrounding whitespace', () => {
    const whitespaceOnly = envSchema.parse(apiEnv({ S3_MEDIA_BUCKET: '   ' }));
    expect(whitespaceOnly.S3_MEDIA_BUCKET).toBeUndefined();

    const padded = envSchema.parse(apiEnv({ S3_MEDIA_BUCKET: ' rms-media ' }));
    expect(padded.S3_MEDIA_BUCKET).toBe('rms-media');
  });

  it('still rejects blank required values', () => {
    expect(envSchema.safeParse(apiEnv({ S3_PROOF_BUCKET: '' })).success).toBe(false);
    expect(envSchema.safeParse(apiEnv({ DATABASE_URL: '' })).success).toBe(false);
    expect(envSchema.safeParse(apiEnv({ DATABASE_URL: undefined })).success).toBe(false);
    expect(envSchema.safeParse(apiEnv({ JWT_ACCESS_SECRET: 'short' })).success).toBe(false);
  });
});

describe('workerEnvSchema blank handling', () => {
  function workerEnv(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { DATABASE_URL: 'postgresql://user:pass@localhost:5432/rms', ...overrides };
  }

  it('treats blank optional values as unset', () => {
    const blanks = Object.fromEntries(BLANK_WORKER_OPTIONAL_KEYS.map((key) => [key, '']));
    const result = workerEnvSchema.parse(workerEnv(blanks));
    for (const key of BLANK_WORKER_OPTIONAL_KEYS) expect(result[key as keyof typeof result]).toBeUndefined();
  });

  it('still rejects malformed non-empty values and blank required values', () => {
    expect(workerEnvSchema.safeParse(workerEnv({ SQS_QUEUE_URL: 'not-a-url' })).success).toBe(false);
    expect(workerEnvSchema.safeParse(workerEnv({ DATABASE_URL: '' })).success).toBe(false);
  });
});
