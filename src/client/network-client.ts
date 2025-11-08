import WebSocket from 'ws';
import { Message, MessageType } from '../shared/types.js';
import { Logger } from '../shared/logger.js';

export class NetworkClient {
  private ws?: WebSocket;
  private logger: Logger;
  private serverUrl: string;
  private reconnectInterval: number = 5000;
  private reconnectTimer?: NodeJS.Timeout;
  private onClientRestart?: () => void;
  private isConnected: boolean = false;

  constructor(serverHost: string, serverPort: number) {
    this.logger = new Logger('NetworkClient');
    this.serverUrl = `ws://${serverHost}:${serverPort}`;
  }

  setRestartCallback(callback: () => void): void {
    this.onClientRestart = callback;
  }

  async connect(): Promise<void> {
    this.logger.info(`Connecting to controller at ${this.serverUrl}...`);

    this.ws = new WebSocket(this.serverUrl);

    this.ws.on('open', () => {
      this.logger.success('Connected to controller');
      this.isConnected = true;
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
      }
    });

    this.ws.on('message', (data: Buffer) => {
      try {
        const message: Message = JSON.parse(data.toString());
        this.handleMessage(message);
      } catch (error) {
        this.logger.error('Failed to parse message', error as Error);
      }
    });

    this.ws.on('close', () => {
      this.logger.warn('Disconnected from controller');
      this.isConnected = false;
      this.scheduleReconnect();
    });

    this.ws.on('error', (error) => {
      this.logger.error('WebSocket error', error);
    });
  }

  private handleMessage(message: Message): void {
    this.logger.info(`Received: ${message.type}`);

    switch (message.type) {
      case MessageType.CLIENT_RESTARTED:
        this.logger.info('Controller restarted its client, triggering restart...');
        if (this.onClientRestart) {
          this.onClientRestart();
        }
        break;

      case MessageType.ACK:
        this.logger.info('Received ACK from controller');
        break;

      default:
        this.logger.warn(`Unknown message type: ${message.type}`);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectTimer = setTimeout(() => {
      this.logger.info('Attempting to reconnect...');
      this.connect();
    }, this.reconnectInterval);
  }

  sendHeartbeat(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const message: Message = {
        type: MessageType.HEARTBEAT,
        timestamp: Date.now()
      };
      this.ws.send(JSON.stringify(message));
    }
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    if (this.ws) {
      this.ws.close();
    }
  }

  connected(): boolean {
    return this.isConnected;
  }
}
