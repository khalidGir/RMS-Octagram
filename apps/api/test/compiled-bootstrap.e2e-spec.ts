import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type AddressInfo } from 'node:net';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { seedEntitlements, cleanupEntitlements } from './entitlements-test-utils';

/**
 * Boots the real compiled API (dist/main.js) and exercises the logo endpoints
 * through its actual bootstrap: ValidationPipe with enableImplicitConversion,
 * whitelist + forbidNonWhitelisted, global throttler guard, and the runtime
 * DTO metadata (design:paramtypes) that tsc emits. The in-process vitest suite
 * cannot cover this: esbuild strips decorator metadata, so pipes there never
 * see the DTO classes — exactly the class of bug a review once found.
 */

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
if (!TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is required.');
if (!TEST_DATABASE_URL.includes('test'))
  throw new Error(`TEST_DATABASE_URL must contain "test". Got: ${TEST_DATABASE_URL}`);

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';

const prisma = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

const ts = Date.now();
const ownerEmail = `compiled-${ts}@test.com`;
const validSha = 'a'.repeat(64);

const distEntry = path.resolve(__dirname, '../dist/main.js');

let child: ChildProcess | null = null;
let baseUrl = '';
let childOutput = '';
let ownerToken = '';
let tenantId = '';
let tenantVersion = 1;

const spawnLogs = (chunk: Buffer | string) => {
  childOutput = `${childOutput}${chunk.toString()}`;
  if (childOutput.length > 40_000) childOutput = childOutput.slice(-40_000);
};

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

async function waitForReady(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) {
      throw new Error(
        `Compiled API exited with code ${child.exitCode} before becoming ready.\n${childOutput}`,
      );
    }
    try {
      const res = await fetch(`${url}/api/v1/health/ready`);
      if (res.ok) return;
      lastError = `health/ready -> ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Compiled API not ready in ${timeoutMs}ms (${lastError}).\n${childOutput}`);
}

async function http(
  method: string,
  pathname: string,
  body?: unknown,
  token?: string,
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(token ? { 'x-tenant-id': tenantId } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let parsed: any = null;
  try {
    parsed = await res.json();
  } catch {
    /* empty body */
  }
  return { status: res.status, body: parsed };
}

const intentBody = (overrides: Record<string, unknown> = {}) => ({
  contentType: 'image/png',
  sizeBytes: 256,
  sha256: validSha,
  crop: { x: 0, y: 0, width: 1, height: 1 },
  expectedVersion: tenantVersion,
  ...overrides,
});

describe('Compiled API bootstrap (dist/main.js)', () => {
  beforeAll(async () => {
    if (!fs.existsSync(distEntry)) {
      throw new Error(
        `${distEntry} is missing. Run \`pnpm build\` before the API e2e suite (CI does this automatically).`,
      );
    }

    const port = await freePort();
    baseUrl = `http://127.0.0.1:${port}`;

    child = spawn(process.execPath, [distEntry], {
      cwd: path.resolve(__dirname, '..'),
      env: {
        ...process.env,
        NODE_ENV: 'test',
        API_PORT: String(port),
        API_HOST: '127.0.0.1',
        API_CORS_ORIGIN: 'http://localhost:3000',
        TRUST_PROXY: '0',
        DATABASE_URL: TEST_DATABASE_URL,
        JWT_ACCESS_SECRET: 'compiled-e2e-access-secret',
        JWT_REFRESH_SECRET: 'compiled-e2e-refresh-secret',
        S3_PROOF_BUCKET: 'rms-proof-test',
        S3_MEDIA_BUCKET: 'rms-media-test',
        MEDIA_CDN_URL: process.env.MEDIA_CDN_URL || 'https://media.example.test',
        AWS_ACCESS_KEY_ID: 'test-key',
        AWS_SECRET_ACCESS_KEY: 'test-secret',
        REDIS_HOST: '127.0.0.1',
        SQS_QUEUE_URL: '',
        SQS_ENDPOINT: '',
        LOG_LEVEL: 'error',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', spawnLogs);
    child.stderr?.on('data', spawnLogs);

    await waitForReady(baseUrl, 25_000);

    const passwordHash = await argon2.hash('Test1234!', { type: argon2.argon2id });
    const tenant = await prisma.tenant.create({
      data: { name: 'CompiledBootstrap', slug: `compiled-${ts}`, status: 'ACTIVE' },
    });
    tenantId = tenant.id;
    tenantVersion = tenant.version;
    await seedEntitlements(prisma, tenantId);

    const branch = await prisma.branch.create({
      data: { tenantId, name: 'CompiledB', slug: `compiled-b-${ts}`, isActive: true },
    });
    const owner = await prisma.user.create({
      data: { email: ownerEmail, passwordHash, displayName: 'Owner', status: 'ACTIVE' },
    });
    const membership = await prisma.tenantMembership.create({
      data: { tenantId, userId: owner.id, role: 'OWNER', status: 'ACTIVE' },
    });
    await prisma.branchAssignment.create({
      data: { tenantId, branchId: branch.id, membershipId: membership.id },
    });

    const login = await http('POST', '/api/v1/auth/login', {
      email: ownerEmail,
      password: 'Test1234!',
    });
    if (login.status !== 201 && login.status !== 200) {
      throw new Error(
        `Login failed against compiled API: ${login.status} ${JSON.stringify(login.body)}`,
      );
    }
    ownerToken = login.body.data.accessToken;
  }, 40_000);

  afterAll(async () => {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        const force = setTimeout(() => {
          child?.kill('SIGKILL');
          resolve();
        }, 5_000);
        child?.once('exit', () => {
          clearTimeout(force);
          resolve();
        });
      });
    }
    child = null;
    await prisma.auditLog.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.mediaObject.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.featureSetting.deleteMany({ where: { tenantId } }).catch(() => {});
    await cleanupEntitlements(prisma, tenantId).catch(() => {});
    await prisma.branchAssignment.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.tenantMembership.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { email: ownerEmail } }).catch(() => {});
    await prisma.branch.deleteMany({ where: { tenantId } }).catch(() => {});
    await prisma.tenant.deleteMany({ where: { id: tenantId } }).catch(() => {});
    await prisma.$disconnect();
  }, 30_000);

  it('accepts a valid upload intent with the full response contract', async () => {
    const res = await http(
      'POST',
      '/api/v1/tenants/current/logo/upload-intent',
      intentBody(),
      ownerToken,
    );
    expect(res.status).toBe(201);
    expect(res.body.data.mediaObjectId).toBeTruthy();
    expect(res.body.data.uploadUrl).toBeTruthy();
    expect(typeof res.body.data.fields).toBe('object');
    expect(res.body.data.expiresAt).toBeTruthy();
    expect(res.body.data.tenantVersion).toBe(tenantVersion);
  });

  it('reports status for the pending upload with uploadExpiresAt', async () => {
    const intent = await http(
      'POST',
      '/api/v1/tenants/current/logo/upload-intent',
      intentBody(),
      ownerToken,
    );
    expect(intent.status).toBe(201);
    const res = await http(
      'GET',
      `/api/v1/tenants/current/logo/status?mediaObjectId=${intent.body.data.mediaObjectId}`,
      undefined,
      ownerToken,
    );
    expect(res.status).toBe(200);
    expect(res.body.data.processingStatus).toBe('PENDING_UPLOAD');
    expect(res.body.data.uploadExpiresAt).toBeTruthy();
  });

  it('rejects a non-whitelisted content type with the pipe message', async () => {
    const res = await http(
      'POST',
      '/api/v1/tenants/current/logo/upload-intent',
      intentBody({ contentType: 'image/gif' }),
      ownerToken,
    );
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('contentType');
  });

  it('rejects a missing crop object', async () => {
    const body = intentBody();
    delete (body as Record<string, unknown>).crop;
    const res = await http('POST', '/api/v1/tenants/current/logo/upload-intent', body, ownerToken);
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('crop');
  });

  it('rejects a malformed sha256 digest', async () => {
    const res = await http(
      'POST',
      '/api/v1/tenants/current/logo/upload-intent',
      intentBody({ sha256: 'NOT-A-DIGEST' }),
      ownerToken,
    );
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('sha256');
  });

  it('rejects expectedVersion below 1', async () => {
    const res = await http(
      'POST',
      '/api/v1/tenants/current/logo/upload-intent',
      intentBody({ expectedVersion: 0 }),
      ownerToken,
    );
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('expectedVersion');
  });

  it('rejects unknown properties (whitelist + forbidNonWhitelisted from main.ts)', async () => {
    const res = await http(
      'POST',
      '/api/v1/tenants/current/logo/upload-intent',
      intentBody({ surprise: 'field' }),
      ownerToken,
    );
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('surprise');
  });

  it('rejects finalize with a null mediaObjectId', async () => {
    const res = await http(
      'POST',
      '/api/v1/tenants/current/logo/finalize',
      { mediaObjectId: null, expectedVersion: tenantVersion },
      ownerToken,
    );
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('mediaObjectId');
  });

  it('answers 404 for a well-formed unknown finalize target', async () => {
    const res = await http(
      'POST',
      '/api/v1/tenants/current/logo/finalize',
      { mediaObjectId: '11111111-2222-4333-8444-555555555555', expectedVersion: tenantVersion },
      ownerToken,
    );
    expect(res.status).toBe(404);
  });

  it('rejects remove with a non-integer expectedVersion', async () => {
    const res = await http(
      'DELETE',
      '/api/v1/tenants/current/logo',
      { expectedVersion: 'one' },
      ownerToken,
    );
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('expectedVersion');
  });

  it('accepts a valid remove', async () => {
    const res = await http(
      'DELETE',
      '/api/v1/tenants/current/logo',
      { expectedVersion: tenantVersion },
      ownerToken,
    );
    expect(res.status).toBe(200);
    expect(res.body.data.tenantVersion).toBe(tenantVersion + 1);
  });
});
