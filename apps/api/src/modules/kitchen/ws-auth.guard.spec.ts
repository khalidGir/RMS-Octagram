import type { ExecutionContext } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WsAuthGuard } from './ws-auth.guard';

function setup() {
  const prisma = {
    tenantMembership: { findFirst: vi.fn().mockResolvedValue({ role: 'OWNER', branchAssignments: [] }) },
    branch: { findFirst: vi.fn().mockResolvedValue({ id: 'branch-1' }) },
    kitchenStation: { findFirst: vi.fn().mockResolvedValue({ id: 'station-1' }) },
  };
  const features = { resolve: vi.fn().mockResolvedValue({ effective: true }) };
  const client = { id: 'socket-1', data: { tenantContext: {
    tenantId: 'tenant-1', userId: 'user-1', tenantRole: 'OWNER', branchIds: ['branch-1'],
  }, kdsEffective: true } };
  const guard = new WsAuthGuard(
    prisma as unknown as ConstructorParameters<typeof WsAuthGuard>[0],
    features as unknown as ConstructorParameters<typeof WsAuthGuard>[1],
  );
  const context = (data: unknown = { branchId: 'branch-1' }, handler = 'handleJoinBranch') => ({
    switchToWs: () => ({ getClient: () => client, getData: () => data }),
    getHandler: () => ({ name: handler }),
  }) as unknown as ExecutionContext;
  return { prisma, features, client, guard, context };
}

describe('socket room scope revalidation', () => {
  beforeEach(() => vi.clearAllMocks());
  it('allows Owners only after proving active branch ownership', async () => {
    const { guard, context, prisma, features } = setup();
    expect(await guard.canActivate(context())).toBe(true);
    expect(prisma.branch.findFirst).toHaveBeenCalledWith({
      where: { id: 'branch-1', tenantId: 'tenant-1', isActive: true }, select: { id: true },
    });
    expect(features.resolve).toHaveBeenCalledWith('tenant-1', 'KDS', 'branch-1');
  });
  it('rejects a foreign or inactive branch even for an Owner', async () => {
    const { guard, context, prisma, features } = setup();
    prisma.branch.findFirst.mockResolvedValue(null);
    expect(await guard.canActivate(context({ branchId: 'foreign-branch' }))).toBe(false);
    expect(features.resolve).not.toHaveBeenCalled();
  });
  it.each([undefined, {}, { branchId: '' }, { branchId: 12 }])('fails closed for malformed joins %j', async (data) => {
    const { guard, context, prisma } = setup();
    const invalid = data === undefined ? null : data;
    expect(await guard.canActivate(context(invalid))).toBe(false);
    expect(prisma.tenantMembership.findFirst).not.toHaveBeenCalled();
  });
  it('rejects removed membership or inactive user/tenant rather than trusting handshake state', async () => {
    const { guard, context, prisma } = setup();
    prisma.tenantMembership.findFirst.mockResolvedValue(null);
    expect(await guard.canActivate(context())).toBe(false);
    expect(prisma.tenantMembership.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: {
      tenantId: 'tenant-1', userId: 'user-1', status: 'ACTIVE', tenant: { status: 'ACTIVE' }, user: { status: 'ACTIVE' },
    } }));
  });
  it('denies a demoted Owner with no current branch assignment', async () => {
    const { guard, context, prisma } = setup();
    prisma.tenantMembership.findFirst.mockResolvedValue({ role: 'MANAGER', branchAssignments: [] });
    expect(await guard.canActivate(context())).toBe(false);
  });
  it('allows current assigned staff and refreshes their stale role', async () => {
    const { guard, context, prisma, client } = setup();
    prisma.tenantMembership.findFirst.mockResolvedValue({ role: 'KITCHEN_STAFF', branchAssignments: [{ branchId: 'branch-1' }] });
    expect(await guard.canActivate(context())).toBe(true);
    expect(client.data.tenantContext.tenantRole).toBe('KITCHEN_STAFF');
  });
  it('rejects a newly disabled branch entitlement despite cached enabled state', async () => {
    const { guard, context, features } = setup();
    features.resolve.mockResolvedValue({ effective: false });
    expect(await guard.canActivate(context())).toBe(false);
  });
  it('denies an assigned Cashier access to Expo or preparation station rooms', async () => {
    const { guard, context, prisma } = setup();
    prisma.tenantMembership.findFirst.mockResolvedValue({ role: 'CASHIER', branchAssignments: [{ branchId: 'branch-1' }] });
    expect(await guard.canActivate(context({ branchId: 'branch-1' }, 'handleJoinExpo'))).toBe(false);
    expect(await guard.canActivate(context({ branchId: 'branch-1', stationId: 'station-1' }, 'handleJoinStation'))).toBe(false);
  });
  it('verifies requested station and its active kitchen within the tenant/branch', async () => {
    const { guard, context, prisma } = setup();
    prisma.kitchenStation.findFirst.mockResolvedValue(null);
    expect(await guard.canActivate(context({ branchId: 'branch-1', stationId: 'foreign-station' }, 'handleJoinStation'))).toBe(false);
    expect(prisma.kitchenStation.findFirst).toHaveBeenCalledWith({ where: {
      id: 'foreign-station', tenantId: 'tenant-1', branchId: 'branch-1', isActive: true,
      kitchen: { tenantId: 'tenant-1', branchId: 'branch-1', isActive: true },
    }, select: { id: true } });
  });
});
