import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { SessionManager } from './session-manager.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { Logger } from '../shared/logger.js';
import { getRelayConfig } from '../shared/config.js';
import crypto from 'crypto';

const logger = new Logger('RelayServer');

interface ClientMessage {
  type: 'JOIN' | 'HEARTBEAT' | 'RESTART' | 'CREATE_SESSION' | 'STATUS_UPDATE' | 'STATUS_REQUEST' | 'IMMEDIATE_START' | 'GAME_STATUS' | 'ADMIN_SUBSCRIBE' | 'ADMIN_UNSUBSCRIBE';
  sessionToken?: string;
  role?: 'controller' | 'follower';
  status?: { clientRunning: boolean; processCount?: number };
  gameRunning?: boolean;
}

class RelayServer {
  private sessionManager: SessionManager;
  private wss: WebSocketServer;
  private httpServer;
  private clientIds: Map<WebSocket, string> = new Map();
  private clientIps: Map<WebSocket, string> = new Map(); // Store IP for each WebSocket
  private adminClients: Set<WebSocket> = new Set();

  constructor(private port: number) {
    this.sessionManager = new SessionManager();
    
    // Create HTTP server for health check and session creation
    this.httpServer = createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', 'application/json');

      // Serve dashboard static files if built
      if (req.url && req.url.startsWith('/dashboard')) {
        // Try .output/public (Nuxt build) then fallback to dashboard/dist
        const publicRoot = join(process.cwd(), 'dashboard', '.output', 'public');
        const distRoot = join(process.cwd(), 'dashboard', 'dist');

        const relPath = req.url === '/dashboard' || req.url === '/dashboard/' ? '/index.html' : req.url.replace('/dashboard', '');

        let filePath = join(publicRoot, relPath);
        if (!existsSync(filePath)) {
          filePath = join(distRoot, relPath);
        }

        if (existsSync(filePath)) {
          try {
            const contents = readFileSync(filePath);
            // crude content-type detection
            const ct = filePath.endsWith('.html') ? 'text/html' : filePath.endsWith('.js') ? 'application/javascript' : filePath.endsWith('.css') ? 'text/css' : 'application/octet-stream';
            res.setHeader('Content-Type', ct);
            res.writeHead(200);
            res.end(contents);
            return;
          } catch (err) {
            logger.warn(`Failed serving dashboard file ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        // If not found, continue to API routing
      }

      if (req.url === '/health') {
        res.writeHead(200);
        res.end(JSON.stringify({ status: 'ok', timestamp: Date.now() }));
      } else if (req.url === '/create-session' && req.method === 'POST') {
        const token = this.sessionManager.generateToken();
        res.writeHead(200);
        res.end(JSON.stringify({ token, message: 'Session created' }));
      } else if (req.url === '/sessions' && req.method === 'GET') {
        const sessions = this.sessionManager.getAllSessions();
        res.writeHead(200);
        res.end(JSON.stringify({ sessions }));
      } else if (req.url && req.url.startsWith('/sessions/') && req.method === 'GET') {
        // GET /sessions/:token -> session details
        const token = req.url.split('/')[2];
        if (!token) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Missing token' }));
          return;
        }

        const info = this.sessionManager.getSessionInfo(token);
        if (!info) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'Session not found' }));
          return;
        }

        res.writeHead(200);
        res.end(JSON.stringify({ session: info }));
      } else if (req.url && req.url.startsWith('/sessions/') && req.method === 'POST') {
        // POST /sessions/:token/restart or /sessions/:token/immediate
        const parts = req.url.split('/');
        const token = parts[2];
        const action = parts[3];

        if (!token || !action) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Missing token or action' }));
          return;
        }

        if (!this.sessionManager.sessionExists(token)) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'Session not found' }));
          return;
        }

        if (action === 'restart') {
          const count = this.sessionManager.broadcastRestartByToken(token);
          res.writeHead(200);
          res.end(JSON.stringify({ result: 'broadcasted', sentTo: count }));
          return;
        }

        if (action === 'immediate') {
          const count = this.sessionManager.broadcastImmediateStartByToken(token);
          res.writeHead(200);
          res.end(JSON.stringify({ result: 'broadcasted', sentTo: count }));
          return;
        }

        res.writeHead(400);
        res.end(JSON.stringify({ error: 'Unknown action' }));
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    });

    this.wss = new WebSocketServer({ server: this.httpServer });
    // Subscribe to session manager events and forward to admin clients
    this.sessionManager.on('session_created', (payload: any) => this.broadcastToAdmins({ type: 'SESSIONS_UPDATE', timestamp: Date.now(), payload: { sessions: this.sessionManager.getAllSessions(), event: 'session_created', data: payload } }));
    this.sessionManager.on('session_updated', (payload: any) => this.broadcastToAdmins({ type: 'SESSIONS_UPDATE', timestamp: Date.now(), payload: { sessions: this.sessionManager.getAllSessions(), event: 'session_updated', data: payload } }));
    this.sessionManager.on('session_removed', (payload: any) => this.broadcastToAdmins({ type: 'SESSIONS_UPDATE', timestamp: Date.now(), payload: { sessions: this.sessionManager.getAllSessions(), event: 'session_removed', data: payload } }));
    this.sessionManager.on('activity', (payload: any) => this.broadcastToAdmins({ type: 'ACTIVITY', timestamp: Date.now(), payload }));
    this.setupWebSocket();
  }

  private setupWebSocket(): void {
    this.wss.on('connection', (ws: WebSocket, req) => {
      const clientId = crypto.randomBytes(8).toString('hex');
      this.clientIds.set(ws, clientId);

      // Get and normalize IP address
      const clientIp = req.socket.remoteAddress || 'unknown';
      const normalizedIp = clientIp.replace(/^::ffff:/, '');
      this.clientIps.set(ws, normalizedIp);
      
      logger.info(`Client connected: ${clientId} from ${normalizedIp}`);

      ws.on('message', (data: Buffer) => {
        try {
          const message: ClientMessage = JSON.parse(data.toString());
          this.handleMessage(ws, clientId, message);
        } catch (error) {
          logger.error('Failed to parse message', error as Error);
        }
      });

      ws.on('close', () => {
        logger.info(`Client disconnected: ${clientId}`);
        this.sessionManager.removeClient(clientId);
        this.clientIds.delete(ws);
        this.clientIps.delete(ws);
        // remove from admin clients if present
        if (this.adminClients.has(ws)) this.adminClients.delete(ws);
      });

      ws.on('error', (error) => {
        logger.error(`WebSocket error for ${clientId}`, error);
      });

      // If admin connects via WS and sends ADMIN_SUBSCRIBE, they will be added in handleMessage

      // Send welcome
      this.send(ws, {
        type: 'CONNECTED',
        clientId,
        message: 'Connected to relay server'
      });
    });
  }

  private handleMessage(ws: WebSocket, clientId: string, message: ClientMessage): void {
    logger.info(`Message from ${clientId}: ${message.type}`);

    switch (message.type) {
      case 'ADMIN_SUBSCRIBE':
        this.adminClients.add(ws);
        logger.info(`Admin subscribed: ${clientId}`);
        // Send initial sessions list
        this.send(ws, { type: 'SESSIONS_UPDATE', timestamp: Date.now(), payload: { sessions: this.sessionManager.getAllSessions() } });
        return;

      case 'ADMIN_UNSUBSCRIBE':
        this.adminClients.delete(ws);
        logger.info(`Admin unsubscribed: ${clientId}`);
        return;
      case 'CREATE_SESSION':
        const createSessionIp = this.clientIps.get(ws) || 'unknown';
        const { token, isNew } = this.sessionManager.findOrCreateSessionByIp(
          createSessionIp,
          ws,
          clientId,
          'controller'
        );
        
        this.send(ws, {
          type: 'SESSION_CREATED',
          token,
          message: isNew 
            ? 'New session created (same IP clients will auto-connect)' 
            : 'Joined existing session for your IP'
        });
        
        // Auto-join the session
        const sessionInfo = this.sessionManager.getSessionInfo(token);
        this.send(ws, {
          type: 'JOINED',
          role: 'controller',
          sessionToken: token,
          sessionInfo
        });
        break;

      case 'JOIN':
        const clientIp = this.clientIps.get(ws) || 'unknown';
        
        // If no token provided, try to auto-join by IP
        if (!message.sessionToken) {
          logger.info(`No token provided, attempting auto-join by IP: ${clientIp}`);
          const role = message.role || 'follower';
          const { token: autoToken, isNew } = this.sessionManager.findOrCreateSessionByIp(
            clientIp,
            ws,
            clientId,
            role
          );
          
          if (!isNew) {
            // Found existing session, auto-joined
            const sessionInfo = this.sessionManager.getSessionInfo(autoToken);
            this.send(ws, {
              type: 'JOINED',
              role: role,
              sessionToken: autoToken,
              sessionInfo,
              autoJoined: true
            });
            break;
          } else {
            // New session created (for controller) or no existing session (for follower)
            if (role === 'controller') {
              // Controller created new session via auto-join
              const sessionInfo = this.sessionManager.getSessionInfo(autoToken);
              this.send(ws, {
                type: 'JOINED',
                role: 'controller',
                sessionToken: autoToken,
                sessionInfo,
                autoJoined: true
              });
              break;
            } else {
              // Follower: No existing session found, need token
              this.send(ws, { 
                type: 'ERROR', 
                message: 'No session found for your IP. Please provide a session token or start controller first.' 
              });
              return;
            }
          }
        }

        // Token provided, use normal join flow
        if (!message.role) {
          this.send(ws, { type: 'ERROR', message: 'Missing role' });
          return;
        }

        if (!this.sessionManager.sessionExists(message.sessionToken)) {
          this.send(ws, { type: 'ERROR', message: 'Session not found' });
          return;
        }

        const joined = this.sessionManager.joinSession(
          message.sessionToken,
          ws,
          clientId,
          message.role
        );

        if (joined) {
          const sessionInfo = this.sessionManager.getSessionInfo(message.sessionToken);
          this.send(ws, {
            type: 'JOINED',
            role: message.role,
            sessionToken: message.sessionToken,
            sessionInfo
          });
        } else {
          this.send(ws, { type: 'ERROR', message: 'Failed to join session' });
        }
        break;

      case 'HEARTBEAT':
        this.sessionManager.updateHeartbeat(clientId);
        this.send(ws, { type: 'HEARTBEAT_ACK' });
        break;

      case 'RESTART':
        const sentCount = this.sessionManager.broadcastRestart(clientId);
        this.send(ws, {
          type: 'RESTART_BROADCASTED',
          sentTo: sentCount
        });
        break;

      case 'STATUS_UPDATE':
        if (!message.status) {
          this.send(ws, { type: 'ERROR', message: 'Missing status' });
          return;
        }
        // Ensure processCount is included (default to 0 if not provided)
        const statusWithCount = {
          clientRunning: message.status.clientRunning || false,
          processCount: message.status.processCount || 0
        };
        const statusSent = this.sessionManager.broadcastStatus(clientId, statusWithCount);
        this.send(ws, {
          type: 'STATUS_BROADCASTED',
          sentTo: statusSent
        });
        break;

      case 'STATUS_REQUEST':
        const statusRequested = this.sessionManager.requestStatus(clientId);
        if (!statusRequested) {
          this.send(ws, { type: 'ERROR', message: 'Failed to request status' });
        }
        break;

      case 'IMMEDIATE_START':
        const sentImmediate = this.sessionManager.broadcastImmediateStart(clientId);
        this.send(ws, {
          type: 'IMMEDIATE_START_BROADCASTED',
          sentTo: sentImmediate
        });
        break;

      case 'GAME_STATUS':
        // Follower sends game status to controller
        const gameStatusSent = this.sessionManager.forwardGameStatus(clientId, message.gameRunning ?? false);
        if (gameStatusSent) {
          this.send(ws, {
            type: 'GAME_STATUS_RECEIVED',
            message: 'Game status forwarded to controller'
          });
        } else {
          this.send(ws, {
            type: 'ERROR',
            message: 'Failed to forward game status to controller'
          });
        }
        break;

        // other non-handled messages fall through to default below

      default:
        logger.warn(`Unknown message type: ${message.type}`);
    }
  }

  private send(ws: WebSocket, data: any): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  private broadcastToAdmins(data: any): void {
    this.adminClients.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify(data));
        } catch (err) {
          logger.warn(`Failed to send to admin: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    });
  }

  start(): void {
    this.httpServer.listen(this.port, '0.0.0.0', () => {
      logger.success(`Relay server started on port ${this.port}`);
      logger.info('Endpoints:');
      logger.info(`  HTTP: http://0.0.0.0:${this.port}/health`);
      logger.info(`  HTTP: http://0.0.0.0:${this.port}/create-session (POST)`);
      logger.info(`  WS:   ws://0.0.0.0:${this.port}`);
    });
  }
}

// Start server
const config = getRelayConfig();
const PORT = parseInt(process.env.PORT || config.port.toString());
const server = new RelayServer(PORT);
server.start();

process.on('SIGINT', () => {
  logger.info('Shutting down...');
  process.exit(0);
});
