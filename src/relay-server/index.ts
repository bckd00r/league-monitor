import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { SessionManager } from './session-manager.js';
import { Logger } from '../shared/logger.js';
import { getRelayConfig } from '../shared/config.js';
import crypto from 'crypto';

const logger = new Logger('RelayServer');

interface ClientMessage {
  type: 'JOIN' | 'HEARTBEAT' | 'RESTART' | 'CREATE_SESSION' | 'STATUS_UPDATE' | 'STATUS_REQUEST';
  sessionToken?: string;
  role?: 'controller' | 'follower';
  status?: { clientRunning: boolean };
}

class RelayServer {
  private sessionManager: SessionManager;
  private wss: WebSocketServer;
  private httpServer;
  private clientIds: Map<WebSocket, string> = new Map();

  constructor(private port: number) {
    this.sessionManager = new SessionManager();
    
    // Create HTTP server for health check and session creation
    this.httpServer = createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Content-Type', 'application/json');

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
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    });

    this.wss = new WebSocketServer({ server: this.httpServer });
    this.setupWebSocket();
  }

  private setupWebSocket(): void {
    this.wss.on('connection', (ws: WebSocket, req) => {
      const clientId = crypto.randomBytes(8).toString('hex');
      this.clientIds.set(ws, clientId);

      const clientIp = req.socket.remoteAddress;
      logger.info(`Client connected: ${clientId} from ${clientIp}`);

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
      });

      ws.on('error', (error) => {
        logger.error(`WebSocket error for ${clientId}`, error);
      });

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
      case 'CREATE_SESSION':
        const token = this.sessionManager.generateToken();
        this.send(ws, {
          type: 'SESSION_CREATED',
          token,
          message: 'Use this token to connect other clients'
        });
        break;

      case 'JOIN':
        if (!message.sessionToken || !message.role) {
          this.send(ws, { type: 'ERROR', message: 'Missing sessionToken or role' });
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
        const statusSent = this.sessionManager.broadcastStatus(clientId, message.status);
        this.send(ws, {
          type: 'STATUS_BROADCASTED',
          sentTo: statusSent
        });
        break;

      case 'STATUS_REQUEST':
        const requested = this.sessionManager.requestStatus(clientId);
        if (!requested) {
          this.send(ws, { type: 'ERROR', message: 'Failed to request status' });
        }
        break;

      default:
        logger.warn(`Unknown message type: ${message.type}`);
    }
  }

  private send(ws: WebSocket, data: any): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
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
