import WebSocket from 'ws';
import { Logger } from '../shared/logger.js';

export class SessionClient {
  private ws?: WebSocket;
  private logger: Logger;
  private serverUrl: string;
  private sessionToken?: string;
  private role: 'controller' | 'follower';
  private reconnectInterval: number = 5000;
  private reconnectTimer?: NodeJS.Timeout;
  private onRestartEvent?: () => void;
  private onStatusRequest?: () => Promise<boolean>;
  private isConnected: boolean = false;

  constructor(serverHost: string, serverPort: number, role: 'controller' | 'follower') {
    this.logger = new Logger(`SessionClient-${role}`);
    this.serverUrl = `ws://${serverHost}:${serverPort}`;
    this.role = role;
  }

  setRestartCallback(callback: () => void): void {
    this.onRestartEvent = callback;
  }

  setStatusRequestCallback(callback: () => Promise<boolean>): void {
    this.onStatusRequest = callback;
  }

  async connect(sessionToken?: string): Promise<void> {
    this.logger.info(`Connecting to relay server at ${this.serverUrl}...`);

    this.ws = new WebSocket(this.serverUrl);

    this.ws.on('open', () => {
      this.logger.success('Connected to relay server');
      this.isConnected = true;

      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
      }

      // If token provided, join session
      if (sessionToken) {
        this.joinSession(sessionToken);
      } else if (this.role === 'controller') {
        // Controller creates new session
        this.createSession();
      }
    });

    this.ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleMessage(message);
      } catch (error) {
        this.logger.error('Failed to parse message', error as Error);
      }
    });

    this.ws.on('close', () => {
      this.logger.warn('Disconnected from relay server');
      this.isConnected = false;
      this.scheduleReconnect();
    });

    this.ws.on('error', (error) => {
      this.logger.error('WebSocket error', error);
    });
  }

  private createSession(): void {
    this.send({
      type: 'CREATE_SESSION'
    });
  }

  private joinSession(token: string): void {
    this.sessionToken = token;
    this.send({
      type: 'JOIN',
      sessionToken: token,
      role: this.role
    });
  }

  private handleMessage(message: any): void {
    switch (message.type) {
      case 'CONNECTED':
        this.logger.info(`Client ID: ${message.clientId}`);
        break;

      case 'SESSION_CREATED':
        this.sessionToken = message.token;
        this.logger.success(`Session created: ${message.token}`);
        this.logger.info('Share this token with other clients to connect them');
        
        // Auto-join own session
        this.joinSession(message.token);
        break;

      case 'JOINED':
        this.logger.success(`Joined session as ${message.role}`);
        this.logger.info(`Session: ${message.sessionToken}`);
        if (message.sessionInfo) {
          this.logger.info(`Controller: ${message.sessionInfo.hasController ? 'Yes' : 'No'}`);
          this.logger.info(`Followers: ${message.sessionInfo.followerCount}`);
        }
        break;

      case 'CLIENT_RESTARTED':
        this.logger.info('Controller restarted its client!');
        if (this.onRestartEvent) {
          this.onRestartEvent();
        }
        break;

      case 'RESTART_BROADCASTED':
        this.logger.success(`Restart event sent to ${message.sentTo} follower(s)`);
        break;

      case 'STATUS_UPDATE':
        this.logger.info('Received status update from controller');
        if (message.status?.clientRunning) {
          this.logger.info('Controller client is RUNNING, syncing...');
          if (this.onRestartEvent) {
            this.onRestartEvent();
          }
        } else {
          this.logger.info('Controller client is NOT running');
        }
        break;

      case 'STATUS_REQUEST':
        this.logger.info('Controller status requested');
        if (this.onStatusRequest) {
          this.onStatusRequest().then(isRunning => {
            this.sendStatus(isRunning);
          });
        }
        break;

      case 'HEARTBEAT_ACK':
        // Silent
        break;

      case 'ERROR':
        this.logger.error(`Server error: ${message.message}`);
        break;

      default:
        this.logger.info(`Received: ${message.type}`);
    }
  }

  broadcastRestart(): void {
    if (!this.isConnected) {
      this.logger.warn('Not connected, cannot broadcast restart');
      return;
    }

    this.send({
      type: 'RESTART'
    });
  }

  sendStatus(clientRunning: boolean): void {
    if (!this.isConnected) {
      this.logger.warn('Not connected, cannot send status');
      return;
    }

    this.send({
      type: 'STATUS_UPDATE',
      status: { clientRunning }
    });
  }

  requestStatus(): void {
    if (!this.isConnected) {
      this.logger.warn('Not connected, cannot request status');
      return;
    }

    this.send({
      type: 'STATUS_REQUEST'
    });
  }

  private send(data: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  sendHeartbeat(): void {
    this.send({ type: 'HEARTBEAT' });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectTimer = setTimeout(() => {
      this.logger.info('Attempting to reconnect...');
      this.connect(this.sessionToken);
    }, this.reconnectInterval);
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

  getSessionToken(): string | undefined {
    return this.sessionToken;
  }
}
