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
  private onStatusRequest?: () => Promise<{ clientRunning: boolean; processCount: number }>;
  private onImmediateStart?: () => void;
  private isConnected: boolean = false;

  constructor(serverHost: string, serverPort: number, role: 'controller' | 'follower') {
    this.logger = new Logger(`SessionClient-${role}`);
    this.serverUrl = `ws://${serverHost}:${serverPort}`;
    this.role = role;
  }

  setStatusRequestCallback(callback: () => Promise<{ clientRunning: boolean; processCount: number }>): void {
    this.onStatusRequest = callback;
  }

  setImmediateStartCallback(callback: () => void): void {
    this.onImmediateStart = callback;
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
      } else if (this.role === 'follower') {
        // Follower without token - try auto-join by IP
        this.logger.info('No token provided, attempting auto-join by IP...');
        this.joinSession(); // No token, server will auto-match by IP
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

  private joinSession(token?: string): void {
    if (token) {
      this.sessionToken = token;
    }
    this.send({
      type: 'JOIN',
      sessionToken: token, // Can be undefined for auto-join by IP
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
        this.sessionToken = message.sessionToken;
        this.logger.success(`Joined session as ${message.role}`);
        if (message.autoJoined) {
          this.logger.success('Auto-joined session by IP address (same IP as controller)');
        }
        this.logger.info(`Session: ${message.sessionToken}`);
        if (message.sessionInfo) {
          this.logger.info(`Controller: ${message.sessionInfo.hasController ? 'Yes' : 'No'}`);
          this.logger.info(`Followers: ${message.sessionInfo.followerCount}`);
        }
        break;

      case 'IMMEDIATE_START':
        this.logger.info('Received immediate start command from controller!');
        if (this.onImmediateStart) {
          this.onImmediateStart();
        }
        break;

      case 'IMMEDIATE_START_BROADCASTED':
        this.logger.success(`Immediate start command sent to ${message.sentTo} follower(s)`);
        break;

      case 'STATUS_UPDATE':
        this.logger.info('Received status update from controller');
        if (message.status?.clientRunning) {
          this.logger.info('Controller client is RUNNING');
        } else {
          this.logger.info('Controller client is NOT running');
        }
        const processCount = message.status?.processCount || 0;
        if (processCount > 0) {
          this.logger.info(`Controller process count: ${processCount}`);
        }
        // Status update sadece bilgi amaçlı, başlatma yapılmıyor
        break;

      case 'STATUS_REQUEST':
        this.logger.info('Controller status requested');
        if (this.onStatusRequest) {
          this.onStatusRequest().then(status => {
            this.sendStatus(status.clientRunning, status.processCount);
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

  broadcastImmediateStart(): void {
    if (!this.isConnected) {
      this.logger.warn('Not connected, cannot broadcast immediate start');
      return;
    }

    this.send({
      type: 'IMMEDIATE_START'
    });
  }

  sendStatus(clientRunning: boolean, processCount: number = 0): void {
    if (!this.isConnected) {
      this.logger.warn('Not connected, cannot send status');
      return;
    }

    this.send({
      type: 'STATUS_UPDATE',
      status: { clientRunning, processCount }
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
