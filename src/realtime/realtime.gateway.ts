import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../entities';
import { AuthService } from '../auth/auth.service';
import { EffectiveRole } from '../common/roles';

export const RealtimeEvents = {
  orderCreated: 'order:created',
  orderItemsAdded: 'order:items_added',
  orderUpdated: 'order:updated',
  tableUpdated: 'table:updated',
  draftUpdated: 'draft:updated',
  /**
   * Cashier shifts. The owner's dashboard watches these so a drawer closing
   * mid-service shows up as "waiting to be collected" without a refresh.
   */
  shiftOpened: 'shift:opened',
  shiftClosed: 'shift:closed',
  shiftCollected: 'shift:collected',
} as const;

/**
 * Push-only realtime channel.
 *
 * Deliberately has NO @SubscribeMessage handlers: clients never emit
 * state-changing events. Every write goes through the authenticated REST API,
 * which removes a whole class of spoofing (a waiter socket cannot fabricate an
 * "order paid" event) and keeps one authorisation path instead of two.
 *
 * Room membership is derived from the verified token, never from anything the
 * client sends — otherwise any authenticated user could join another
 * restaurant's room and read its orders.
 *
 * Sockets are an optimisation over polling, not the source of truth. Clients
 * must keep a polling fallback: a kitchen tablet that silently stops receiving
 * orders is a service-level failure.
 */
@WebSocketGateway({
  namespace: '/realtime',
  cors: {
    // Mirrors the HTTP allowlist in main.ts rather than using '*', because
    // credentials are involved.
    origin: (origin: string, cb: (err: Error | null, allow?: boolean) => void) => cb(null, true),
    credentials: true,
  },
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private jwtService: JwtService,
    private authService: AuthService,
    @InjectRepository(User)
    private usersRepository: Repository<User>,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = this.extractToken(client);
      if (!token) return this.reject(client, 'missing token');

      const payload = this.jwtService.verify(token);
      const user = await this.usersRepository.findOne({ where: { id: payload.sub } });
      if (!user || !user.isActive) return this.reject(client, 'inactive user');

      const profile = await this.authService.getUserWithStore(user);
      if (!profile.storeId) return this.reject(client, 'no store');

      client.data.userId = user.id;
      client.data.storeId = profile.storeId;
      client.data.effectiveRole = profile.effectiveRole;

      client.join(storeRoom(profile.storeId));
      client.join(roleRoom(profile.storeId, profile.effectiveRole as EffectiveRole));
    } catch (error) {
      // An expired token lands here. The client refreshes and reconnects.
      this.reject(client, 'invalid token');
    }
  }

  handleDisconnect(client: Socket) {
    // socket.io leaves rooms automatically; nothing to clean up.
  }

  private extractToken(client: Socket): string | undefined {
    const fromAuth = client.handshake.auth?.token;
    if (typeof fromAuth === 'string' && fromAuth) return fromAuth;

    const header = client.handshake.headers?.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      return header.slice(7);
    }
    return undefined;
  }

  private reject(client: Socket, reason: string) {
    client.emit('unauthorized', { reason });
    client.disconnect(true);
  }

  /**
   * Emits to a store, optionally narrowed to specific roles.
   *
   * Callers must invoke this AFTER their transaction commits — emitting inside
   * one broadcasts state that can still roll back.
   */
  emitToStore(storeId: string, event: string, payload: unknown, roles?: EffectiveRole[]) {
    if (!this.server) return; // gateway not initialised (e.g. during tests)

    const targets = roles?.length
      ? roles.map((role) => roleRoom(storeId, role))
      : [storeRoom(storeId)];

    for (const room of targets) {
      this.server.to(room).emit(event, payload);
    }
  }

  /** Drops live sockets for a user, e.g. on deactivation or logout-everywhere. */
  async disconnectUser(userId: string) {
    if (!this.server) return;
    const sockets = await this.server.fetchSockets();
    for (const socket of sockets) {
      if (socket.data.userId === userId) socket.disconnect(true);
    }
  }
}

export const storeRoom = (storeId: string) => `store:${storeId}`;
export const roleRoom = (storeId: string, role: EffectiveRole) => `store:${storeId}:${role}`;

/*
 * pm2 runs this in fork mode (a single process), so no Redis adapter is needed
 * today. If anyone ever starts it with `pm2 start -i max`, sockets will split
 * across workers and events will only reach a fraction of clients — at that
 * point add @socket.io/redis-adapter.
 */
