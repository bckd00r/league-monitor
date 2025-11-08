import { WebSocketServer, WebSocket } from 'ws';
import { Message, MessageType } from '../shared/types.js';
import { Logger } from '../shared/logger.js';

export class NetworkServer {
  private wss: WebSocketServer;
  private logger: Logger;
  private clients: Set<WebSocket> = new Set();

  constructor(port: number) {
    this.logger = new Logger('NetworkServer');
    this.wss = new WebSocketServer({ 
      port,
      host: '0.0.0.0' // Listen on all network interfaces
    });
    this.setupServer();
  }

  private setupServer(): void {
    this.wss.on('listening', () => {
      const address = this.wss.address();
      this.logger.success(`WebSocket server listening on ${JSON.stringify(address)}`);
      this.logger.info('Server is accessible from all network interfaces (0.0.0.0)');
      this.logger.info(`Clients should connect to: ws://<your-mac-ip>:${this.wss.options.port}`);
    });

    this.wss.on('connection', (ws: WebSocket, req) => {
      const clientIp = req.socket.remoteAddress;
      this.logger.info(`New client connected from ${clientIp}`);
      
      this.clients.add(ws);

      ws.on('message', (data: Buffer) => {
        try {
          const message: Message = JSON.parse(data.toString());
          this.handleMessage(ws, message);
        } catch (error) {
          this.logger.error('Failed to parse message', error as Error);
        }
      });

      ws.on('close', () => {
        this.logger.info(`Client disconnected: ${clientIp}`);
        this.clients.delete(ws);
      });

      ws.on('error', (error) => {
        this.logger.error('WebSocket error', error);
        this.clients.delete(ws);
      });

      // Send welcome message
      this.sendMessage(ws, {
        type: MessageType.ACK,
        timestamp: Date.now(),
        data: { message: 'Connected to controller' }
      });
    });

    this.wss.on('error', (error) => {
      this.logger.error('Server error', error);
    });
  }

  private handleMessage(ws: WebSocket, message: Message): void {
    this.logger.info(`Received message: ${message.type}`);

    switch (message.type) {
      case MessageType.HEARTBEAT:
        this.sendMessage(ws, {
          type: MessageType.ACK,
          timestamp: Date.now()
        });
        break;
      
      default:
        this.logger.warn(`Unknown message type: ${message.type}`);
    }
  }

  private sendMessage(ws: WebSocket, message: Message): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Broadcast client restart notification to all connected clients
   */
  broadcastClientRestart(): void {
    const message: Message = {
      type: MessageType.CLIENT_RESTARTED,
      timestamp: Date.now()
    };

    this.logger.info('Broadcasting client restart notification...');

    let sentCount = 0;
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(message));
        sentCount++;
      }
    });

    this.logger.success(`Notification sent to ${sentCount} client(s)`);
  }

  /**
   * Get number of connected clients
   */
  getClientCount(): number {
    return Array.from(this.clients).filter(
      client => client.readyState === WebSocket.OPEN
    ).length;
  }

  /**
   * Close the server
   */
  close(): void {
    this.logger.info('Closing server...');
    this.wss.close();
  }
}
