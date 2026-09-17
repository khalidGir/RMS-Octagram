import { afterEach, describe, expect, it, vi } from 'vitest';
import { WsJwtAdapter } from './ws-jwt.adapter';

function setup(exp: number | undefined = Math.floor(Date.now() / 1000) + 60) {
  const jwt = { verifyAsync: vi.fn().mockResolvedValue({ sub: 'user-1', email: null, platformRole: null, exp }) };
  const prisma = {
    user: { findUnique: vi.fn().mockResolvedValue({ id: 'user-1', status: 'ACTIVE', platformRole: null }) },
    tenant: { findUnique: vi.fn().mockResolvedValue({ id: 'tenant-1', status: 'ACTIVE' }) },
    tenantMembership: {
      findUnique: vi.fn().mockResolvedValue({ role: 'OWNER', status: 'ACTIVE', branchAssignments: [] }),
      findFirst: vi.fn().mockResolvedValue({ role: 'OWNER', branchAssignments: [] }),
    },
  };
  const services: Record<string, unknown> = {
    JwtService: jwt, PrismaService: prisma, FeatureResolver: { resolve: vi.fn().mockResolvedValue({ effective: true }) },
    ConfigService: { get: vi.fn().mockReturnValue('unit-test-access-secret') },
  };
  const app = { get: (token: { name: string }) => services[token.name] };
  const adapter = new WsJwtAdapter(app as unknown as ConstructorParameters<typeof WsJwtAdapter>[0]);
  Reflect.get(adapter, 'initServices').call(adapter);
  const listeners: Record<string, () => void> = {};
  const socket = { id: 'socket-1', handshake: { auth: { token: 'verified-in-test', tenantId: 'tenant-1' }, query: {}, headers: {} },
    rooms: new Set(['socket-1']),
    data: {} as Record<string, unknown>, disconnect: vi.fn(),
    once: vi.fn((event: string, callback: () => void) => { listeners[event] = callback; }),
  };
  const authenticate = () => Reflect.get(adapter, 'authenticateSocket').call(adapter, socket) as Promise<void>;
  return { socket, authenticate, listeners, jwt, prisma };
}

afterEach(() => vi.useRealTimers());
describe('connected socket token lifetime', () => {
  it('disconnects when current authorization queries exceed their deadline', async () => {
    vi.useFakeTimers();
    const { socket, authenticate, listeners, prisma } = setup();
    await authenticate();
    prisma.user.findUnique.mockImplementation(() => new Promise(() => {}));
    await vi.advanceTimersByTimeAsync(13_000);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
    listeners.disconnect();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('disconnects an authenticated connection at access-token expiry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-17T12:00:00Z'));
    const { socket, authenticate } = setup();
    await authenticate();
    expect(socket.data.tokenExpiresAt).toEqual(new Date('2026-09-17T12:01:00Z'));
    await vi.advanceTimersByTimeAsync(59_999);
    expect(socket.disconnect).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });
  it('clears expiry timers when the socket disconnects early', async () => {
    vi.useFakeTimers();
    const { socket, authenticate, listeners } = setup();
    await authenticate();
    listeners.disconnect();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(socket.disconnect).not.toHaveBeenCalled();
  });
  it('rejects verified payloads without a finite expiration', async () => {
    const { authenticate, jwt, socket } = setup();
    jwt.verifyAsync.mockResolvedValue({ sub: 'user-1', email: null, platformRole: null, exp: undefined });
    await expect(authenticate()).rejects.toThrow('Invalid or expired token');
    expect(socket.once).not.toHaveBeenCalled();
  });
});
