import { z } from 'zod';

// Docker Compose renders unset variables as empty strings instead of omitting
// them, and zod's `.optional()` only accepts `undefined`. Optional fields are
// therefore trimmed, and blank (or whitespace-only) values mean "not
// configured"; every non-blank value must still satisfy its original schema
// (typos and malformed URLs fail).
const blankToUndefined = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};
const optional = <T extends z.ZodTypeAny>(schema: T) => z.preprocess(blankToUndefined, schema.optional());

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  API_PORT: z.coerce.number().default(3001),
  API_HOST: z.string().default('0.0.0.0'),
  API_CORS_ORIGIN: z.string().default('http://localhost:3000'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  DEFAULT_TIMEZONE: z.string().default('Africa/Addis_Ababa'),
  DEFAULT_CURRENCY: z.string().default('ETB'),
  // S3 configuration for payment proof uploads
  S3_REGION: z.string().default('us-east-1'),
  S3_PROOF_BUCKET: z.string().min(1),
  S3_ENDPOINT: optional(z.string()),
  AWS_ACCESS_KEY_ID: optional(z.string()),
  AWS_SECRET_ACCESS_KEY: optional(z.string()),
  // Menu item media: dedicated bucket + CDN base are optional for backwards
  // compatibility; production/staging deployments must set both (blank counts
  // as unset — see blankToUndefined above).
  S3_MEDIA_BUCKET: optional(z.string().min(1)),
  MEDIA_CDN_URL: optional(z.string().url()),
  // SQS job queue for the worker (outbox → SQS → worker). Optional in dev;
  // when unset the outbox handler fails visibly instead of dropping jobs.
  SQS_QUEUE_URL: optional(z.string().url()),
  SQS_ENDPOINT: optional(z.string()),
  SQS_REGION: z.string().default('us-east-1'),
  // Redis configuration for rate limiting and distributed state
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: optional(z.string()),
  // Trust proxy hops (1 for ALB, 0 for direct)
  TRUST_PROXY: z.coerce.number().default(1),
  // Cookie SameSite policy: 'lax' | 'strict' | 'none'
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  // Cookie domain (optional, defaults to request domain)
  COOKIE_DOMAIN: optional(z.string()),
  // Log level
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

// The worker only needs storage/queue/database settings; JWT and HTTP settings
// belong to the API process. Validated at worker startup (AGENTS: validate
// environment variables at process startup).
const workerEnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  S3_REGION: z.string().default('us-east-1'),
  S3_PROOF_BUCKET: optional(z.string().min(1)),
  S3_MEDIA_BUCKET: optional(z.string().min(1)),
  S3_ENDPOINT: optional(z.string()),
  AWS_ACCESS_KEY_ID: optional(z.string()),
  AWS_SECRET_ACCESS_KEY: optional(z.string()),
  MEDIA_CDN_URL: optional(z.string().url()),
  SQS_QUEUE_URL: optional(z.string().url()),
  SQS_ENDPOINT: optional(z.string()),
  SQS_REGION: z.string().default('us-east-1'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function validateWorkerEnv(raw: Record<string, unknown>): WorkerEnv {
  const result = workerEnvSchema.safeParse(raw);
  if (!result.success) {
    console.error('Invalid worker environment variables:', result.error.flatten().fieldErrors);
    process.exit(1);
  }
  return result.data;
}

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    console.error('Invalid environment variables:', result.error.flatten().fieldErrors);
    process.exit(1);
  }
  return result.data;
}

export { envSchema, workerEnvSchema };
