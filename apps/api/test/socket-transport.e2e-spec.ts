import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import type { Namespace } from 'socket.io';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { PrismaModule } from '../src/modules/prisma/prisma.module';
import { FeaturesModule } from '../src/modules/features/features.module';
import { KdsGateway } from '../src/modules/kitchen/kds.gateway';
import { WsAuthGuard } from '../src/modules/kitchen/ws-auth.guard';
import { WsJwtAdapter } from '../src/modules/kitchen/ws-jwt.adapter';

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl || !new URL(databaseUrl).pathname.includes('test')) throw new Error('Dedicated TEST_DATABASE_URL required');
process.env.DATABASE_URL = databaseUrl;
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const run = randomUUID();
const tenantId = randomUUID();
const foreignTenantId = randomUUID();
const branchId = randomUUID();
const unassignedBranchId = randomUUID();
const foreignBranchId = randomUUID();
const kitchenId = randomUUID();
const stationId = randomUUID();
const ownerId = randomUUID();
const waiterId = randomUUID();
const cashierId = randomUUID();
const ownerMembership = randomUUID();
const waiterMembership = randomUUID();
const cashierMembership = randomUUID();
const secret = `socket-test-${run}`;
const previousAccessSecret = process.env.JWT_ACCESS_SECRET;
const previousCorsOrigin = process.env.API_CORS_ORIGIN;
// ConfigService prioritizes process environment over its internal fixture map.
// Pin this isolated test process to the same key used by the real signer.
process.env.JWT_ACCESS_SECRET = secret;
process.env.API_CORS_ORIGIN = 'http://localhost:3000';
const sockets = new Set<Socket>();
let app: INestApplication;
let endpoint: string;
let jwt: JwtService;
let gateway: KdsGateway;

function nextEvent<T>(socket: Socket, event: string, timeoutMs = 10_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const handler = (data: T) => { clearTimeout(timer); resolve(data); };
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Socket event timeout: ${event}`));
    }, timeoutMs);
    socket.once(event, handler);
  });
}

async function token(userId: string, expiresIn = 60) {
  return jwt.signAsync({ sub: userId, email: `transport-${userId}@test.invalid`, platformRole: 'USER' }, { expiresIn });
}

function client(accessToken?: string, requestedTenant = tenantId, origin?: string) {
  const socket = io(`${endpoint}/kds`, {
    autoConnect: false, reconnection: false, forceNew: true,
    transports: ['websocket'], timeout: 10_000,
    auth: { token: accessToken, tenantId: requestedTenant },
    extraHeaders: origin ? { Origin: origin } : undefined,
  });
  sockets.add(socket);
  return socket;
}

async function connected(userId: string, expiresIn = 60) {
  const socket = client(await token(userId, expiresIn));
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Socket connection timeout')), 10_000);
    socket.once('connect', () => { clearTimeout(timer); resolve(); });
    socket.once('connect_error', (error: Error) => { clearTimeout(timer); reject(error); });
  });
  socket.connect();
  await ready;
  return socket;
}

async function join(socket: Socket, event: string, data: Record<string, unknown>) {
  const joined = nextEvent<{ room: string }>(socket, 'joined');
  socket.emit(event, data);
  return joined;
}

async function denied(socket: Socket, event: string, data: Record<string, unknown>) {
  const rejection = nextEvent<{ message: string }>(socket, 'exception');
  socket.emit(event, data);
  expect((await rejection).message).toBe('Forbidden resource');
}

describe('KDS actual signed-token Socket.IO transport', () => {
  beforeAll(async () => {
    await prisma.tenant.createMany({ data: [
      { id: tenantId, name: 'Transport owned', slug: `transport-${run}`, status: 'ACTIVE' },
      { id: foreignTenantId, name: 'Transport foreign', slug: `transport-foreign-${run}`, status: 'ACTIVE' },
    ] });
    await prisma.branch.createMany({ data: [
      { id: branchId, tenantId, name: 'Owned', slug: 'owned', isActive: true },
      { id: unassignedBranchId, tenantId, name: 'Unassigned', slug: 'unassigned', isActive: true },
      { id: foreignBranchId, tenantId: foreignTenantId, name: 'Foreign', slug: 'foreign', isActive: true },
    ] });
    await prisma.user.createMany({ data: [ownerId, waiterId, cashierId].map((id) => ({
      id, email: `transport-${id}@test.invalid`, displayName: 'Transport fixture',
      passwordHash: 'unused-signed-token-fixture', status: 'ACTIVE',
    })) });
    await prisma.tenantMembership.createMany({ data: [
      { id: ownerMembership, tenantId, userId: ownerId, role: 'OWNER', status: 'ACTIVE' },
      { id: waiterMembership, tenantId, userId: waiterId, role: 'WAITER', status: 'ACTIVE' },
      { id: cashierMembership, tenantId, userId: cashierId, role: 'CASHIER', status: 'ACTIVE' },
    ] });
    await prisma.branchAssignment.createMany({ data: [waiterMembership, cashierMembership].map((membershipId) => ({
      tenantId, branchId, membershipId,
    })) });
    await prisma.tenantEntitlement.create({ data: { tenantId, featureKey: 'KDS', status: 'ENABLED' } });
    await prisma.kitchen.create({ data: { id: kitchenId, tenantId, branchId, name: 'Transport Kitchen', isActive: true } });
    await prisma.kitchenStation.create({ data: { id: stationId, tenantId, branchId, kitchenId, name: 'Transport Station', isActive: true } });

    const module = await Test.createTestingModule({
      imports: [PrismaModule, FeaturesModule, JwtModule.register({ secret })],
      providers: [KdsGateway, WsAuthGuard, {
        provide: ConfigService, useValue: new ConfigService({ JWT_ACCESS_SECRET: secret, API_CORS_ORIGIN: 'http://localhost:3000' }),
      }],
    }).compile();
    app = module.createNestApplication();
    app.useLogger(['error', 'warn']);
    app.useWebSocketAdapter(new WsJwtAdapter(app));
    await app.listen(0, '127.0.0.1');
    endpoint = await app.getUrl();
    jwt = app.get(JwtService);
    gateway = app.get(KdsGateway);
  }, 120_000);

  afterAll(async () => {
    try {
      for (const socket of sockets) socket.disconnect();
      if (app) await app.close();
      await prisma.$transaction(async (tx) => {
        await tx.kitchenStation.deleteMany({ where: { id: stationId, tenantId } });
        await tx.kitchen.deleteMany({ where: { id: kitchenId, tenantId } });
        await tx.featureSetting.deleteMany({ where: { tenantId } });
        await tx.tenantEntitlement.deleteMany({ where: { tenantId } });
        await tx.branchAssignment.deleteMany({ where: { tenantId } });
        await tx.tenantMembership.deleteMany({ where: { id: { in: [ownerMembership, waiterMembership, cashierMembership] } } });
        await tx.branch.deleteMany({ where: { id: { in: [branchId, unassignedBranchId, foreignBranchId] } } });
        await tx.tenant.deleteMany({ where: { id: { in: [tenantId, foreignTenantId] } } });
        await tx.user.deleteMany({ where: { id: { in: [ownerId, waiterId, cashierId] } } });
      }, { timeout: 30_000 });
    } finally {
      await prisma.$disconnect();
      if (previousAccessSecret === undefined) delete process.env.JWT_ACCESS_SECRET;
      else process.env.JWT_ACCESS_SECRET = previousAccessSecret;
      if (previousCorsOrigin === undefined) delete process.env.API_CORS_ORIGIN;
      else process.env.API_CORS_ORIGIN = previousCorsOrigin;
    }
  }, 120_000);

  it('rejects missing, incorrectly signed, expired tokens and foreign memberships at handshake', async () => {
    const wrongSignature = await jwt.signAsync({ sub: ownerId, email: 'wrong-signature@test.invalid' }, {
      secret: 'wrong-socket-test-signing-key', expiresIn: 60,
    });
    for (const socket of [client(), client('invalid-token'), client(wrongSignature), client(await token(ownerId, -1)), client(await token(ownerId), foreignTenantId)]) {
      const rejected = nextEvent<Error>(socket, 'connect_error');
      socket.connect();
      expect((await rejected).message).toMatch(/authentication|token|member/i);
      expect(socket.connected).toBe(false);
      socket.disconnect();
    }
  });

  it('enforces exact configured Origin on actual WebSocket upgrades', async () => {
    for (const origin of ['http://localhost:3001', 'https://localhost:3000', 'http://preview.localhost:3000']) {
      const socket = client(await token(ownerId), tenantId, origin);
      const rejected = nextEvent<Error>(socket, 'connect_error');
      socket.connect();
      expect((await rejected).message).toBe('websocket error');
      expect(socket.connected).toBe(false);
      socket.disconnect();
    }
    const socket = client(await token(ownerId), tenantId, 'http://localhost:3000');
    const ready = nextEvent(socket, 'connect');
    socket.connect();
    await ready;
    expect(socket.connected).toBe(true);
    socket.disconnect();
  });

  it('joins authorized rooms and delivers one invalidation to an overlapping branch/station subscriber', async () => {
    const socket = await connected(ownerId);
    expect((await join(socket, 'join:branch', { branchId })).room).toBe(`branch:${branchId}`);
    expect((await join(socket, 'join:station', { branchId, stationId })).room).toBe(`station:${branchId}:${stationId}`);
    const data = { eventId: randomUUID(), ticketId: randomUUID(), version: 3 };
    let deliveries = 0;
    socket.on('ticket:invalidated', () => deliveries++);
    const received = nextEvent(socket, 'ticket:invalidated');
    gateway.broadcastTicketInvalidated(branchId, stationId, data);
    expect(await received).toEqual(data);
    // Ordered marker bounds delivery without an arbitrary sleep.
    const marker = nextEvent(socket, 'fulfillment:changed');
    gateway.broadcastFulfillmentChanged(branchId, { marker: true });
    await marker;
    expect(deliveries).toBe(1);
    socket.disconnect();
  });

  it('denies foreign tenant branches, unassigned branches, preparation/Expo roles and another waiter room', async () => {
    const owner = await connected(ownerId);
    await denied(owner, 'join:branch', { branchId: foreignBranchId });
    owner.disconnect();
    const waiter = await connected(waiterId);
    await denied(waiter, 'join:branch', { branchId: unassignedBranchId });
    await denied(waiter, 'join:station', { branchId, stationId });
    await denied(waiter, 'join:expo', { branchId });
    const rejection = nextEvent<{ message: string }>(waiter, 'error');
    waiter.emit('join:waiter', { branchId, userId: ownerId });
    expect((await rejection).message).toMatch(/another user/);
    expect((await join(waiter, 'join:waiter', { branchId, userId: waiterId })).room).toBe(`waiter:${branchId}:${waiterId}`);
    waiter.disconnect();
    const cashier = await connected(cashierId);
    await denied(cashier, 'join:station', { branchId, stationId });
    await denied(cashier, 'join:expo', { branchId });
    cashier.disconnect();
  });

  it('rejects newly disabled features and suspended membership on the existing connection', async () => {
    const socket = await connected(ownerId);
    const setting = await prisma.featureSetting.create({ data: {
      tenantId, branchId, featureKey: 'KDS', enabled: false, updatedByUserId: ownerId,
    } });
    await denied(socket, 'join:branch', { branchId });
    await prisma.featureSetting.delete({ where: { id: setting.id } });
    await join(socket, 'join:branch', { branchId });
    await prisma.tenantMembership.update({ where: { id: ownerMembership }, data: { status: 'SUSPENDED' } });
    try { await denied(socket, 'join:expo', { branchId }); }
    finally { await prisma.tenantMembership.update({ where: { id: ownerMembership }, data: { status: 'ACTIVE' } }); }
    socket.disconnect();
  });

  it('disconnects a signed access token connection at its expiration', async () => {
    const socket = await connected(ownerId, 5);
    expect(await nextEvent<string>(socket, 'disconnect', 8_000)).toBe('io server disconnect');
    expect(socket.connected).toBe(false);
  });

  it('disconnects an already joined connection when its membership is suspended', async () => {
    const socket = await connected(ownerId);
    await join(socket, 'join:branch', { branchId });
    const disconnected = nextEvent<string>(socket, 'disconnect', 15_000);
    await prisma.tenantMembership.update({ where: { id: ownerMembership }, data: { status: 'SUSPENDED' } });
    try {
      expect(await disconnected).toBe('io server disconnect');
      expect(socket.connected).toBe(false);
    } finally {
      await prisma.tenantMembership.update({ where: { id: ownerMembership }, data: { status: 'ACTIVE' } });
      socket.disconnect();
    }
  });

  it('removes already joined branch and personal rooms after branch unassignment', async () => {
    const socket = await connected(waiterId);
    await join(socket, 'join:branch', { branchId });
    await join(socket, 'join:waiter', { branchId, userId: waiterId });
    const changed = nextEvent<{ message: string }>(socket, 'exception', 15_000);
    expect((await prisma.branchAssignment.deleteMany({ where: {
      tenantId, branchId, membershipId: waiterMembership,
    } })).count).toBe(1);
    try {
      expect((await changed).message).toMatch(/Live access changed/);
      // Gateway is a namespace at runtime; inspect actual server-side rooms,
      // not a mocked join callback or an absence inferred from a short sleep.
      const serverSocket = (gateway.server as unknown as Namespace).sockets.get(socket.id!);
      expect(serverSocket).toBeDefined();
      expect(serverSocket!.rooms.has(`branch:${branchId}`)).toBe(false);
      expect(serverSocket!.rooms.has(`waiter:${branchId}:${waiterId}`)).toBe(false);
      await denied(socket, 'join:branch', { branchId });
    } finally {
      await prisma.branchAssignment.create({ data: { tenantId, branchId, membershipId: waiterMembership } });
      socket.disconnect();
    }
  });

  it('removes already joined branch and station rooms when KDS is disabled', async () => {
    const socket = await connected(ownerId);
    await join(socket, 'join:branch', { branchId });
    await join(socket, 'join:station', { branchId, stationId });
    const changed = nextEvent<{ message: string }>(socket, 'exception', 15_000);
    const setting = await prisma.featureSetting.create({ data: {
      tenantId, branchId, featureKey: 'KDS', enabled: false, updatedByUserId: ownerId,
    } });
    try {
      expect((await changed).message).toMatch(/Live access changed/);
      const serverSocket = (gateway.server as unknown as Namespace).sockets.get(socket.id!);
      expect(serverSocket).toBeDefined();
      expect(serverSocket!.rooms.has(`branch:${branchId}`)).toBe(false);
      expect(serverSocket!.rooms.has(`station:${branchId}:${stationId}`)).toBe(false);
      await denied(socket, 'join:branch', { branchId });
    } finally {
      await prisma.featureSetting.delete({ where: { id: setting.id } });
      socket.disconnect();
    }
  });
});
