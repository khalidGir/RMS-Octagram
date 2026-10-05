import { z } from 'zod';

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
  S3_ENDPOINT: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  // Menu item media: dedicated bucket + CDN base are optional for backwards
  // compatibility; production/staging deployments must set both.
  S3_MEDIA_BUCKET: z.string().min(1).optional(),
  MEDIA_CDN_URL: z.string().url().optional(),
  // SQS job queue for the worker (outbox → SQS → worker). Optional in dev;
  // when unset the outbox handler fails visibly instead of dropping jobs.
  SQS_QUEUE_URL: z.string().url().optional(),
  SQS_ENDPOINT: z.string().optional(),
  SQS_REGION: z.string().default('us-east-1'),
  // Redis configuration for rate limiting and distributed state
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  // Trust proxy hops (1 for ALB, 0 for direct)
  TRUST_PROXY: z.coerce.number().default(1),
  // Cookie SameSite policy: 'lax' | 'strict' | 'none'
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  // Cookie domain (optional, defaults to request domain)
  COOKIE_DOMAIN: z.string().optional(),
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
  S3_PROOF_BUCKET: z.string().min(1).optional(),
  S3_MEDIA_BUCKET: z.string().min(1).optional(),
  S3_ENDPOINT: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  MEDIA_CDN_URL: z.string().url().optional(),
  SQS_QUEUE_URL: z.string().url().optional(),
  SQS_ENDPOINT: z.string().optional(),
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

export { envSchema };
