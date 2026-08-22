import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Injectable, Logger } from '@nestjs/common';

/**
 * KDS WebSocket Gateway.
 *
 * Rooms:
 *   - `branch:{branchId}` — all KDS screens for a branch
 *   - `station:{branchId}:{stationId}` — screens filtered to a specific station
 *
 * The gateway does NOT authorize connections beyond socket-level auth (JWT).
 * Branch/station filtering is done via room joins.
 */
@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/kds',
})
@Injectable()
export class KdsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(KdsGateway.name);

  @WebSocketServer()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server!: any;

  handleConnection(client: any) {
    this.logger.debug(`KDS client connected: ${client.id}`);
  }

  handleDisconnect(client: any) {
    this.logger.debug(`KDS client disconnected: ${client.id}`);
  }

  /**
   * Client joins a branch room to receive all ticket updates for that branch.
   */
  @SubscribeMessage('join:branch')
  handleJoinBranch(
    @ConnectedSocket() client: any,
    @MessageBody() data: { branchId: string },
  ) {
    const room = `branch:${data.branchId}`;
    void client.join(room);
    this.logger.debug(`Client ${client.id} joined room ${room}`);
    return { event: 'joined', data: { room } };
  }

  /**
   * Client joins a station-specific room.
   */
  @SubscribeMessage('join:station')
  handleJoinStation(
    @ConnectedSocket() client: any,
    @MessageBody() data: { branchId: string; stationId: string },
  ) {
    const room = `station:${data.branchId}:${data.stationId}`;
    void client.join(room);
    this.logger.debug(`Client ${client.id} joined room ${room}`);
    return { event: 'joined', data: { room } };
  }

  /**
   * Client leaves a room.
   */
  @SubscribeMessage('leave')
  handleLeave(
    @ConnectedSocket() client: any,
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
}
