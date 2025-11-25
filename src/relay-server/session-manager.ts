import { Logger } from '../shared/logger.js';
import EventEmitter from 'events';
import crypto from 'crypto';

interface ClientConnection {
  ws: any;
  clientId: string;
  role: 'controller' | 'follower';
  connectedAt: number;
  lastHeartbeat: number;
}

interface Session {
  token: string;
  createdAt: number;
  controller?: ClientConnection;
  followers: Map<string, ClientConnection>;
}

export class SessionManager {
  private logger: Logger;
  private emitter: EventEmitter;
  private sessions: Map<string, Session> = new Map();
  private clientToSession: Map<string, string> = new Map();
  private ipToSession: Map<string, string> = new Map(); // IP -> Session Token
  private clientToIp: Map<string, string> = new Map(); // ClientId -> IP

  constructor() {
    this.logger = new Logger('SessionManager');
    this.emitter = new EventEmitter();
    
    // Clean up old sessions every 5 minutes
    setInterval(() => this.cleanupOldSessions(), 5 * 60 * 1000);
  }

  /**
   * Broadcast restart event to followers using a session token (admin/UI action)
   */
  broadcastRestartByToken(token: string): number {
    const session = this.sessions.get(token);
    if (!session) return 0;

    this.logger.info(`Admin broadcast: Restart event for session: ${token}`);

    let sentCount = 0;
    session.followers.forEach((follower) => {
      try {
        follower.ws.send(JSON.stringify({
          type: 'CLIENT_RESTARTED',
          timestamp: Date.now(),
          sessionToken: token
        }));
        sentCount++;
      } catch (error) {
        this.logger.error(`Failed to send to follower ${follower.clientId}`, error as Error);
      }
    });

    this.logger.success(`Admin restart broadcast sent to ${sentCount} follower(s)`);
    return sentCount;
  }

  /**
   * Broadcast immediate start command to followers using a session token (admin/UI action)
   */
  broadcastImmediateStartByToken(token: string): number {
    const session = this.sessions.get(token);
    if (!session) return 0;

    this.logger.info(`Admin broadcast: Immediate start for session: ${token}`);

    let sentCount = 0;
    session.followers.forEach((follower) => {
      try {
        follower.ws.send(JSON.stringify({
          type: 'IMMEDIATE_START',
          timestamp: Date.now(),
          sessionToken: token
        }));
        sentCount++;
      } catch (error) {
        this.logger.error(`Failed to send immediate start to follower ${follower.clientId}`, error as Error);
      }
    });

    this.logger.success(`Admin immediate start sent to ${sentCount} follower(s)`);
    return sentCount;
  }

  /**
   * Generate a new session token
   */
  generateToken(): string {
    const token = crypto.randomBytes(16).toString('hex');
    
    const session: Session = {
      token,
      createdAt: Date.now(),
      followers: new Map()
    };

    this.sessions.set(token, session);
    this.logger.success(`New session created: ${token}`);
    this.emitter.emit('session_created', this.getSessionInfo(token));
    this.emitter.emit('activity', { level: 'info', message: `New session created: ${token}`, timestamp: Date.now() });
    
    return token;
  }

  /**
   * Join a session with token
   */
  joinSession(
    token: string, 
    ws: any, 
    clientId: string, 
    role: 'controller' | 'follower'
  ): boolean {
    const session = this.sessions.get(token);
    
    if (!session) {
      this.logger.error(`Session not found: ${token}`);
      return false;
    }

    const connection: ClientConnection = {
      ws,
      clientId,
      role,
      connectedAt: Date.now(),
      lastHeartbeat: Date.now()
    };

    if (role === 'controller') {
      if (session.controller) {
        this.logger.warn(`Controller already exists for session ${token}, replacing...`);
        session.controller.ws.close();
      }
      session.controller = connection;
      this.logger.info(`Controller joined session: ${token}`);
      this.emitter.emit('session_updated', this.getSessionInfo(token));
      this.emitter.emit('activity', { level: 'info', message: `Controller joined session: ${token}`, timestamp: Date.now() });
    } else {
      session.followers.set(clientId, connection);
      this.logger.info(`Follower ${clientId} joined session: ${token}`);
      this.emitter.emit('session_updated', this.getSessionInfo(token));
      this.emitter.emit('activity', { level: 'info', message: `Follower ${clientId} joined session: ${token}`, timestamp: Date.now() });
    }

    this.clientToSession.set(clientId, token);
    return true;
  }

  /**
   * Remove client from session
   */
  removeClient(clientId: string): void {
    const token = this.clientToSession.get(clientId);
    if (!token) return;

    const session = this.sessions.get(token);
    if (!session) return;

    if (session.controller?.clientId === clientId) {
      this.logger.info(`Controller disconnected from session: ${token}`);
      session.controller = undefined;
      this.emitter.emit('session_updated', this.getSessionInfo(token));
      this.emitter.emit('activity', { level: 'info', message: `Controller disconnected: ${clientId} (session ${token})`, timestamp: Date.now() });
    } else {
      session.followers.delete(clientId);
      this.logger.info(`Follower ${clientId} disconnected from session: ${token}`);
      this.emitter.emit('session_updated', this.getSessionInfo(token));
      this.emitter.emit('activity', { level: 'info', message: `Follower disconnected: ${clientId} (session ${token})`, timestamp: Date.now() });
    }

    this.clientToSession.delete(clientId);
    this.removeIpMapping(clientId);

    // Remove session if no clients
    if (!session.controller && session.followers.size === 0) {
      this.sessions.delete(token);
      this.logger.info(`Session ${token} removed (no clients)`);
      this.emitter.emit('session_removed', token);
      this.emitter.emit('activity', { level: 'info', message: `Session ${token} removed (no clients)`, timestamp: Date.now() });
    }
  }

  /**
   * Update heartbeat for client
   */
  updateHeartbeat(clientId: string): void {
    const token = this.clientToSession.get(clientId);
    if (!token) return;

    const session = this.sessions.get(token);
    if (!session) return;

    if (session.controller?.clientId === clientId) {
      session.controller.lastHeartbeat = Date.now();
      this.emitter.emit('session_updated', this.getSessionInfo(token));
      this.emitter.emit('activity', { level: 'debug', message: `Heartbeat updated for controller ${clientId} in session ${token}`, timestamp: Date.now() });
    } else {
      const follower = session.followers.get(clientId);
      if (follower) {
        follower.lastHeartbeat = Date.now();
        this.emitter.emit('session_updated', this.getSessionInfo(token));
        this.emitter.emit('activity', { level: 'debug', message: `Heartbeat updated for follower ${clientId} in session ${token}`, timestamp: Date.now() });
      }
    }
  }

  /**
   * Broadcast restart event from controller to all followers
   */
  broadcastRestart(controllerClientId: string): number {
    const token = this.clientToSession.get(controllerClientId);
    if (!token) return 0;

    const session = this.sessions.get(token);
    if (!session) return 0;

    this.logger.info(`Broadcasting restart event for session: ${token}`);

    let sentCount = 0;
    session.followers.forEach((follower) => {
      try {
        follower.ws.send(JSON.stringify({
          type: 'CLIENT_RESTARTED',
          timestamp: Date.now(),
          sessionToken: token
        }));
        sentCount++;
      } catch (error) {
        this.logger.error(`Failed to send to follower ${follower.clientId}`, error as Error);
      }
    });

    this.logger.success(`Restart broadcast sent to ${sentCount} follower(s)`);
    this.emitter.emit('activity', { level: 'info', message: `Restart broadcast from controller ${controllerClientId} for session ${token}`, timestamp: Date.now() });
    return sentCount;
  }

  /**
   * Broadcast status from controller to all followers
   */
  broadcastStatus(controllerClientId: string, status: { clientRunning: boolean; processCount: number }): number {
    const token = this.clientToSession.get(controllerClientId);
    if (!token) return 0;

    const session = this.sessions.get(token);
    if (!session) return 0;

    this.logger.info(`Broadcasting status for session: ${token}`);

    let sentCount = 0;
    session.followers.forEach((follower) => {
      try {
        follower.ws.send(JSON.stringify({
          type: 'STATUS_UPDATE',
          timestamp: Date.now(),
          status
        }));
        sentCount++;
      } catch (error) {
        this.logger.error(`Failed to send status to follower ${follower.clientId}`, error as Error);
      }
    });

    this.logger.success(`Status sent to ${sentCount} follower(s)`);
    this.emitter.emit('activity', { level: 'info', message: `Status update from controller ${controllerClientId} for session ${token}`, timestamp: Date.now(), status });
    return sentCount;
  }

  /**
   * Request status from controller
   */
  requestStatus(followerClientId: string): boolean {
    const token = this.clientToSession.get(followerClientId);
    if (!token) return false;

    const session = this.sessions.get(token);
    if (!session || !session.controller) return false;

    try {
      session.controller.ws.send(JSON.stringify({
        type: 'STATUS_REQUEST',
        timestamp: Date.now(),
        fromClient: followerClientId
      }));
      this.logger.info(`Status request sent to controller for session: ${token}`);
        this.emitter.emit('activity', { level: 'info', message: `Status request from follower ${followerClientId} forwarded to controller for session ${token}`, timestamp: Date.now() });
      return true;
    } catch (error) {
      this.logger.error('Failed to send status request', error as Error);
      return false;
    }
  }

  /**
   * Forward game status from follower to controller
   */
  forwardGameStatus(followerClientId: string, gameRunning: boolean): boolean {
    const token = this.clientToSession.get(followerClientId);
    if (!token) return false;

    const session = this.sessions.get(token);
    if (!session || !session.controller) return false;

    try {
      session.controller.ws.send(JSON.stringify({
        type: 'GAME_STATUS',
        timestamp: Date.now(),
        fromFollower: followerClientId,
        gameRunning
      }));
      this.logger.info(`Game status (${gameRunning ? 'RUNNING' : 'STOPPED'}) forwarded from follower ${followerClientId} to controller for session: ${token}`);
      this.emitter.emit('activity', { level: 'info', message: `Game status forwarded from follower ${followerClientId} to controller for session ${token}`, timestamp: Date.now() });
      return true;
    } catch (error) {
      this.logger.error('Failed to forward game status', error as Error);
      return false;
    }
  }

  /**
   * Broadcast immediate start command from controller to all followers
   */
  broadcastImmediateStart(controllerClientId: string): number {
    const token = this.clientToSession.get(controllerClientId);
    if (!token) return 0;

    const session = this.sessions.get(token);
    if (!session) return 0;

    this.logger.info(`Broadcasting immediate start command for session: ${token}`);

    let sentCount = 0;
    session.followers.forEach((follower) => {
      try {
        follower.ws.send(JSON.stringify({
          type: 'IMMEDIATE_START',
          timestamp: Date.now(),
          sessionToken: token
        }));
        sentCount++;
      } catch (error) {
        this.logger.error(`Failed to send immediate start to follower ${follower.clientId}`, error as Error);
      }
    });

    this.logger.success(`Immediate start command sent to ${sentCount} follower(s)`);
    this.emitter.emit('activity', { level: 'info', message: `Immediate start broadcast from controller ${controllerClientId} for session ${token}`, timestamp: Date.now() });
    return sentCount;
  }

  /**
   * Get session info
   */
  getSessionInfo(token: string) {
    const session = this.sessions.get(token);
    if (!session) return null;

    return {
      token: session.token,
      createdAt: session.createdAt,
      hasController: !!session.controller,
      followerCount: session.followers.size,
      followers: Array.from(session.followers.values()).map(f => ({
        clientId: f.clientId,
        connectedAt: f.connectedAt
      }))
    };
  }

  /**
   * Get all sessions
   */
  getAllSessions() {
    return Array.from(this.sessions.values()).map(session => ({
      token: session.token,
      createdAt: session.createdAt,
      hasController: !!session.controller,
      followerCount: session.followers.size
    }));
  }

  // Admin subscriptions
  on(event: 'session_created' | 'session_updated' | 'session_removed' | 'activity', fn: (payload: any) => void) {
    this.emitter.on(event, fn);
  }

  /**
   * Cleanup old sessions (24 hours)
   */
  private cleanupOldSessions(): void {
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    this.sessions.forEach((session, token) => {
      if (now - session.createdAt > maxAge) {
        // Close all connections
        session.controller?.ws.close();
        session.followers.forEach(f => f.ws.close());
        
        this.sessions.delete(token);
        this.logger.info(`Cleaned up old session: ${token}`);
      }
    });
  }

  /**
   * Check if session exists
   */
  sessionExists(token: string): boolean {
    return this.sessions.has(token);
  }

  /**
   * Find or create session by IP address
   * If same IP has a controller session, automatically join it
   */
  findOrCreateSessionByIp(
    ip: string,
    ws: any,
    clientId: string,
    role: 'controller' | 'follower'
  ): { token: string; isNew: boolean } {
    // Normalize IP (handle IPv6 mapped IPv4)
    const normalizedIp = ip?.replace(/^::ffff:/, '') || 'unknown';

    // Check if there's an existing session for this IP
    const existingToken = this.ipToSession.get(normalizedIp);
    
    if (existingToken && this.sessions.has(existingToken)) {
      // Existing session found, join it
      this.logger.info(`Found existing session for IP ${normalizedIp}: ${existingToken}`);
      const joined = this.joinSession(existingToken, ws, clientId, role);
      if (joined) {
        this.clientToIp.set(clientId, normalizedIp);
        return { token: existingToken, isNew: false };
      }
    }

    // No existing session or join failed, create new one
    const token = this.generateToken();
    this.ipToSession.set(normalizedIp, token);
    this.clientToIp.set(clientId, normalizedIp);
    
    const joined = this.joinSession(token, ws, clientId, role);
    if (joined) {
      this.logger.success(`Created new session for IP ${normalizedIp}: ${token}`);
      return { token, isNew: true };
    }

    return { token, isNew: true };
  }

  /**
   * Remove IP mapping when client disconnects
   * Keep IP mapping if session still exists (for reconnect)
   */
  removeIpMapping(clientId: string): void {
    const ip = this.clientToIp.get(clientId);
    if (ip) {
      const token = this.ipToSession.get(ip);
      const session = token ? this.sessions.get(token) : null;
      
      // Only remove IP mapping if session is completely empty
      if (session && !session.controller && session.followers.size === 0) {
        this.ipToSession.delete(ip);
        this.logger.info(`Removed IP mapping for ${ip} (session empty)`);
      } else if (session) {
        // Session still has clients, keep IP mapping for reconnect
        this.logger.info(`Keeping IP mapping for ${ip} (session has other clients or will be reused)`);
      }
      
      this.clientToIp.delete(clientId);
    }
  }
}
