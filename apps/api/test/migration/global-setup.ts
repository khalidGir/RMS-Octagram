import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

/**
 * Migration replay harness for 20260912000000_multi_kitchen_fulfillment.
 *
 * Recreates a dedicated database, applies migrations 1..23, inserts the
 * pre-multi-kitchen fixture, then applies the target migration so its
 * backfills run against realistic historical data. The migration spec then
 * verifies the backfill results with full-table scans on a database this
 * suite alone owns (no cross-suite pollution).
 */

const TARGET_MIGRATION = '20260912000000_multi_kitchen_fulfillment';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');
const prismaDir = path.join(repoRoot, 'packages', 'database', 'prisma');
const migrationsDir = path.join(prismaDir, 'migrations');

const migrationDbUrl =
  process.env.MIGRATION_TEST_DATABASE_URL ??
  'postgresql://rms:rms_dev@localhost:5432/rms_test_migration';

function databaseNameOf(url: string): string {
  const name = url.split('/').pop()?.split('?')[0] ?? '';
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Cannot derive a safe database name from URL (got "${name}").`);
  }
  return name;
}

function adminUrlFor(url: string): string {
  return `${url.slice(0, url.lastIndexOf('/') + 1)}postgres`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function connectOrFail(url: string): Promise<PrismaClient> {
  const client = new PrismaClient({ datasources: { db: { url } } });
  await client.$connect();
  return client;
}

async function ensureDatabaseExists(dbName: string): Promise<void> {
  try {
    const probe = await connectOrFail(migrationDbUrl);
    await probe.$disconnect();
    return;
  } catch (error) {
    const message = errorMessage(error);
    const missing =
      message.includes("Can't reach database server") ||
      message.includes('does not exist') ||
      message.includes('P1001') ||
      message.includes('P1003');
    if (!missing) throw error;
  }

  const admin = await connectOrFail(adminUrlFor(migrationDbUrl));
  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  } catch (error) {
    throw new Error(
      `Migration replay database "${dbName}" is missing and automatic creation failed ` +
        `(${errorMessage(error)}). Create it once manually, e.g. ` +
        `CREATE DATABASE "${dbName}"; then re-run.`,
      { cause: error },
    );
  } finally {
    await admin.$disconnect();
  }
}

async function resetSchema(): Promise<void> {
  const client = await connectOrFail(migrationDbUrl);
  try {
    // Schema-level reset keeps CREATE/DROP DATABASE (which PostgreSQL forbids
    // inside transactions) out of the picture entirely. Dropping `public`
    // also removes the `_prisma_migrations` bookkeeping table, so the replay
    // starts from a truly blank schema.
    await client.$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE');
    await client.$executeRawUnsafe('CREATE SCHEMA public');
  } finally {
    await client.$disconnect();
  }
}

async function replayMigrations(): Promise<void> {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rms-migration-replay-'));
  try {
    const tmpPrisma = path.join(tmpRoot, 'prisma');
    fs.mkdirSync(path.join(tmpPrisma, 'migrations'), { recursive: true });
    fs.copyFileSync(path.join(prismaDir, 'schema.prisma'), path.join(tmpPrisma, 'schema.prisma'));

    const entries = fs.readdirSync(migrationsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === TARGET_MIGRATION) continue;
      fs.cpSync(
        path.join(migrationsDir, entry.name),
        path.join(tmpPrisma, 'migrations', entry.name),
        { recursive: true },
      );
    }

    const run = (args: string): void => {
      execSync(`npx prisma ${args}`, {
        cwd: prismaDir,
        env: { ...process.env, DATABASE_URL: migrationDbUrl },
        stdio: 'pipe',
      });
    };

    const schemaArg = `--schema="${path.join(tmpPrisma, 'schema.prisma')}"`;

    // 1. Historical state: everything before the multi-kitchen migration.
    run(`migrate deploy ${schemaArg}`);

    // 2. Realistic pre-multi-kitchen data.
    run(`db execute --file="${path.join(here, 'fixture.sql')}" --url="${migrationDbUrl}"`);

    // 3. The migration under test: backfills run against the fixture.
    fs.cpSync(
      path.join(migrationsDir, TARGET_MIGRATION),
      path.join(tmpPrisma, 'migrations', TARGET_MIGRATION),
      { recursive: true },
    );
    run(`migrate deploy ${schemaArg}`);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

export default async function globalSetup(): Promise<void> {
  const dbName = databaseNameOf(migrationDbUrl);
  if (!/migration/i.test(dbName)) {
    throw new Error(
      `Refusing to reset "${dbName}": MIGRATION_TEST_DATABASE_URL must point at a ` +
        `dedicated *migration* database (default rms_test_migration).`,
    );
  }

  process.env.TEST_DATABASE_URL = migrationDbUrl;
  process.env.DATABASE_URL = migrationDbUrl;

  await ensureDatabaseExists(dbName);
  await resetSchema();
  await replayMigrations();
}
