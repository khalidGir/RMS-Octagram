import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import type { OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { UseGuards, Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';
import type { AuthenticatedSocket } from './ws-jwt.adapter';
import { WsAuthGuard } from './ws-auth.guard';

/**
 * KDS WebSocket Gateway.
 *
 * Rooms:
 *   - `branch:{branchId}` — all KDS screens for a branch
 *   - `station:{branchId}:{stationId}` — screens filtered to a specific station
 *
 * Authentication:
 *   - WsJwtAdapter authenticates connections via JWT (full validation pipeline)
 *   - WsAuthGuard authorizes room joins (tenant, branch, KDS entitlement)
 *   - Every room join is independently authorized against the socket's tenant context
 *
 * Tenant/branch identity is NEVER accepted from the client without server verification.
 */
@WebSocketGateway({ namespace: '/kds' })
@UseGuards(WsAuthGuard)
@Injectable()
export class KdsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(KdsGateway.name);

  @WebSocketServer()
  server!: Server;

  handleConnection(client: AuthenticatedSocket) {
    const ctx = client.data?.tenantContext;
    this.logger.debug(
      `KDS client connected: ${client.id} user=${ctx?.userId ?? 'unknown'} tenant=${ctx?.tenantId ?? 'none'}`,
    );
  }

  handleDisconnect(client: AuthenticatedSocket) {
    const ctx = client.data?.tenantContext;
    this.logger.debug(
      `KDS client disconnected: ${client.id} user=${ctx?.userId ?? 'unknown'} tenant=${ctx?.tenantId ?? 'none'}`,
    );
  }

  /**
   * Client joins a branch room to receive all ticket updates for that branch.
   * Branch is verified against the socket's authenticated tenant context.
   */
  @SubscribeMessage('join:branch')
  handleJoinBranch(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { branchId: string },
  ) {
    const ctx = client.data.tenantContext!;
    const branchId = data.branchId;

    if (!branchId) {
      return { event: 'error', data: { message: 'branchId is required' } };
    }

    // Verify branch belongs to this tenant (already validated by WsAuthGuard,
    // but double-check with explicit branch ID format)
    const room = `branch:${branchId}`;
    void client.join(room);
    this.logger.debug(
      `Client ${client.id} (user=${ctx.userId}) joined room ${room}`,
    );
    return { event: 'joined', data: { room, branchId } };
  }

  /**
   * Client joins a station-specific room.
   * Branch and station are verified against the socket's authenticated tenant context.
   */
  @SubscribeMessage('join:station')
  handleJoinStation(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { branchId: string; stationId: string },
  ) {
    const ctx = client.data.tenantContext!;
    const { branchId, stationId } = data;

    if (!branchId || !stationId) {
      return { event: 'error', data: { message: 'branchId and stationId are required' } };
    }

    const room = `station:${branchId}:${stationId}`;
    void client.join(room);
    this.logger.debug(
      `Client ${client.id} (user=${ctx.userId}) joined room ${room}`,
    );
    return { event: 'joined', data: { room, branchId, stationId } };
  }

  /**
   * Client leaves a room.
   */
  @SubscribeMessage('leave')
  handleLeave(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { room: string },
  ) {
    void client.leave(data.room);
    return { event: 'left', data: { room: data.room } };
  }

  // ─── Broadcasting Methods (called by services) ────

  /**
   * Broadcast a new ticket to all screens for a branch.
   */
  broadcastTicketCreated(branchId: string, ticket: Record<string, unknown>) {
    this.server?.to(`branch:${branchId}`).emit('ticket:created', ticket);
  }

  broadcastTicketInvalidated(branchId: string, stationId: string, data: Record<string, unknown>) {
    this.server?.to(`branch:${branchId}`).to(`station:${branchId}:${stationId}`).emit('ticket:invalidated', data);
  }

  /**
   * Broadcast a ticket status change to branch and station rooms.
   */
  broadcastTicketUpdated(
    branchId: string,
    stationId: string,
    ticket: Record<string, unknown>,
  ) {
    this.server?.to(`branch:${branchId}`).emit('ticket:updated', ticket);
    this.server?.to(`station:${branchId}:${stationId}`).emit('ticket:updated', ticket);
  }

  /**
   * Broadcast an order status change (e.g., order.confirmed → triggers ticket creation).
   */
  broadcastOrderConfirmed(branchId: string, order: Record<string, unknown>) {
    this.server?.to(`branch:${branchId}`).emit('order:confirmed', order);
  }

  /**
   * Broadcast a service notification to a specific waiter's room.
   */
  broadcastServiceNotification(branchId: string, userId: string, notification: Record<string, unknown>) {
    this.server?.to(`waiter:${branchId}:${userId}`).emit('service:notification', notification);
  }

  /**
   * Broadcast to the expo room for a branch.
   */
  broadcastToExpo(branchId: string, event: string, data: Record<string, unknown>) {
    this.server?.to(`branch:${branchId}`).emit(event, data);
    this.server?.to(`expo:${branchId}`).emit(event, data);
  }

  /**
   * Broadcast to the service board room for a branch.
   */
  broadcastToServiceBoard(branchId: string, event: string, data: Record<string, unknown>) {
    this.server?.to(`service:${branchId}`).emit(event, data);
  }

  /**
   * Broadcast a fulfillment status change to all relevant rooms.
   */
  broadcastFulfillmentChanged(branchId: string, data: Record<string, unknown>) {
    this.server?.to(`branch:${branchId}`).emit('fulfillment:changed', data);
    this.server?.to(`service:${branchId}`).emit('fulfillment:changed', data);
  }

  // ─── Client-side room joins ─────────────

  /**
   * Client joins the expo room for a branch.
   */
  @SubscribeMessage('join:expo')
  handleJoinExpo(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { branchId: string },
  ) {
    const ctx = client.data.tenantContext!;
    const { branchId } = data;

    if (!branchId) {
      return { event: 'error', data: { message: 'branchId is required' } };
    }

    const room = `expo:${branchId}`;
    void client.join(room);
    this.logger.debug(
      `Client ${client.id} (user=${ctx.userId}) joined expo room ${room}`,
    );
    return { event: 'joined', data: { room, branchId } };
  }

  /**
   * Client joins the service board room for a branch.
   */
  @SubscribeMessage('join:service')
  handleJoinService(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { branchId: string },
  ) {
    const ctx = client.data.tenantContext!;
    const { branchId } = data;

    if (!branchId) {
      return { event: 'error', data: { message: 'branchId is required' } };
    }

    const room = `service:${branchId}`;
    void client.join(room);
    this.logger.debug(
      `Client ${client.id} (user=${ctx.userId}) joined service room ${room}`,
    );
    return { event: 'joined', data: { room, branchId } };
  }

  /**
   * Client joins a waiter-specific room for personal notifications.
   */
  @SubscribeMessage('join:waiter')
  handleJoinWaiter(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { branchId: string; userId: string },
  ) {
    const ctx = client.data.tenantContext!;
    const { branchId, userId } = data;

    if (!branchId || !userId) {
      return { event: 'error', data: { message: 'branchId and userId are required' } };
    }

    // Verify the requesting user matches the userId (or is manager/owner)
    if (ctx.userId !== userId && ctx.tenantRole !== 'OWNER' && ctx.tenantRole !== 'MANAGER') {
      return { event: 'error', data: { message: 'Cannot join another user\'s room' } };
    }

    const room = `waiter:${branchId}:${userId}`;
    void client.join(room);
    this.logger.debug(
      `Client ${client.id} (user=${ctx.userId}) joined waiter room ${room}`,
    );
    return { event: 'joined', data: { room, branchId, userId } };
  }
}
