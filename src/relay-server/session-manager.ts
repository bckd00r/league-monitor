import { Logger } from '../shared/logger.js';
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
  private sessions: Map<string, Session> = new Map();
  private clientToSession: Map<string, string> = new Map();

  constructor() {
    this.logger = new Logger('SessionManager');
    
    // Clean up old sessions every 5 minutes
    setInterval(() => this.cleanupOldSessions(), 5 * 60 * 1000);
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
    } else {
      session.followers.set(clientId, connection);
      this.logger.info(`Follower ${clientId} joined session: ${token}`);
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
    } else {
      session.followers.delete(clientId);
      this.logger.info(`Follower ${clientId} disconnected from session: ${token}`);
    }

    this.clientToSession.delete(clientId);

    // Remove session if no clients
    if (!session.controller && session.followers.size === 0) {
      this.sessions.delete(token);
      this.logger.info(`Session ${token} removed (no clients)`);
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
    } else {
      const follower = session.followers.get(clientId);
      if (follower) {
        follower.lastHeartbeat = Date.now();
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
    return sentCount;
  }

  /**
   * Broadcast status from controller to all followers
   */
  broadcastStatus(controllerClientId: string, status: { clientRunning: boolean }): number {
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
      return true;
    } catch (error) {
      this.logger.error('Failed to send status request', error as Error);
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
}
