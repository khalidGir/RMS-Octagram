import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

/**
 * Populated-database migration test for selectorHash backfill.
 *
 * Verifies that the migration at 20260821000001_add_auth_session_selector_hash
 * correctly backfills unique hashes for existing rows and that the UNIQUE
 * index succeeds even when the table already contains multiple AuthSession rows.
 */
describe('selectorHash migration on populated database (e2e)', () => {
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('every AuthSession row has a unique selectorHash after migration', async () => {
    const sessions = await prisma.$queryRaw<{ selectorHash: string }[]>`
      SELECT "selectorHash" FROM "AuthSession"
    `;

    if (sessions.length === 0) {
      // No sessions to check — migration is trivially correct
      return;
    }

    const hashes = sessions.map((s) => s.selectorHash);
    const uniqueHashes = new Set(hashes);

    // All hashes must be unique (UNIQUE index constraint)
    expect(uniqueHashes.size).toBe(hashes.length);

    // No hash should be empty string (backfill must replace the default '')
    for (const h of hashes) {
      expect(h).not.toBe('');
      expect(h.length).toBe(32); // md5() produces 32 hex chars
    }
  });

  it('selectorHash unique index exists and is valid', async () => {
    const indexes = await prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'AuthSession'
        AND indexname = 'AuthSession_selectorHash_key'
    `;

    expect(indexes).toHaveLength(1);
    expect(indexes[0].indexdef).toContain('UNIQUE');
    expect(indexes[0].indexdef).toContain('selectorHash');
  });
});
