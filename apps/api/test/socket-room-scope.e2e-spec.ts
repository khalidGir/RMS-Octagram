import { randomUUID } from 'node:crypto';
import type { ExecutionContext } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WsAuthGuard } from '../src/modules/kitchen/ws-auth.guard';
import { FeatureResolver } from '../src/modules/features/feature-resolver.service';

const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.includes('test')) throw new Error('Dedicated TEST_DATABASE_URL required');
const prisma = new PrismaClient({ datasources: { db: { url } } });
const id = randomUUID();
const tenantId = randomUUID();
const foreignTenantId = randomUUID();
const branchId = randomUUID();
const foreignBranchId = randomUUID();
const userId = randomUUID();
const membershipId = randomUUID();
const db = prisma as unknown as ConstructorParameters<typeof WsAuthGuard>[0];
const guard = new WsAuthGuard(db, new FeatureResolver(db));
const client = { data: { tenantContext: { tenantId, userId, tenantRole: 'OWNER', branchIds: [branchId] }, kdsEffective: true } };
const context = (requestedBranch: string) => ({
  switchToWs: () => ({ getClient: () => client, getData: () => ({ branchId: requestedBranch }) }),
  getHandler: () => ({ name: 'handleJoinBranch' }),
}) as unknown as ExecutionContext;

// These tests exercise the actual guard against live DB state, not a running
// Socket.IO transport. Handshake/namespace/broadcast tests remain separate gates.
describe('Socket room scope — real membership and entitlement records', () => {
  beforeAll(async () => {
    await prisma.tenant.createMany({ data: [
      { id: tenantId, name: 'Socket owned', slug: `socket-owned-${id}`, status: 'ACTIVE' },
      { id: foreignTenantId, name: 'Socket foreign', slug: `socket-foreign-${id}`, status: 'ACTIVE' },
    ] });
    await prisma.branch.createMany({ data: [
      { id: branchId, tenantId, name: 'Owned', slug: 'owned', isActive: true },
      { id: foreignBranchId, tenantId: foreignTenantId, name: 'Foreign', slug: 'foreign', isActive: true },
    ] });
    await prisma.user.create({ data: { id: userId, email: `socket-${id}@test.invalid`, displayName: 'Socket test', passwordHash: 'unused-test-guard-fixture', status: 'ACTIVE' } });
    await prisma.tenantMembership.create({ data: { id: membershipId, tenantId, userId, role: 'OWNER', status: 'ACTIVE' } });
    await prisma.tenantEntitlement.create({ data: { tenantId, featureKey: 'KDS', status: 'ENABLED' } });
  });
  afterAll(async () => {
    await prisma.branchAssignment.deleteMany({ where: { membershipId } });
    await prisma.featureSetting.deleteMany({ where: { tenantId } });
    await prisma.tenantEntitlement.deleteMany({ where: { tenantId } });
    await prisma.tenantMembership.deleteMany({ where: { id: membershipId } });
    await prisma.branch.deleteMany({ where: { id: { in: [branchId, foreignBranchId] } } });
    await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, foreignTenantId] } } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('Owner without assignments can join their branch, never another tenant', async () => {
    expect(await guard.canActivate(context(branchId))).toBe(true);
    expect(await guard.canActivate(context(foreignBranchId))).toBe(false);
  });
  it('applies real branch-level feature disable and re-enable', async () => {
    const setting = await prisma.featureSetting.create({ data: { tenantId, branchId, featureKey: 'KDS', enabled: false, updatedByUserId: userId } });
    expect(await guard.canActivate(context(branchId))).toBe(false);
    await prisma.featureSetting.update({ where: { id: setting.id }, data: { enabled: true } });
    expect(await guard.canActivate(context(branchId))).toBe(true);
  });
  it('rejects demotion/unassignment and accepts a newly assigned branch without reconnecting', async () => {
    await prisma.tenantMembership.update({ where: { id: membershipId }, data: { role: 'KITCHEN_STAFF' } });
    expect(await guard.canActivate(context(branchId))).toBe(false);
    await prisma.branchAssignment.create({ data: { tenantId, branchId, membershipId } });
    expect(await guard.canActivate(context(branchId))).toBe(true);
    await prisma.branchAssignment.deleteMany({ where: { membershipId } });
    expect(await guard.canActivate(context(branchId))).toBe(false);
  });
  it('rejects suspended membership despite cached Owner claims', async () => {
    await prisma.tenantMembership.update({ where: { id: membershipId }, data: { role: 'OWNER', status: 'SUSPENDED' } });
    client.data.tenantContext.tenantRole = 'OWNER';
    expect(await guard.canActivate(context(branchId))).toBe(false);
  });
});
