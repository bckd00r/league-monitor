export interface ClientConfig {
  serverHost: string;
  serverPort: number;
  restartDelay: number; // milliseconds
}

export interface ControllerConfig {
  port: number;
  monitorInterval: number; // milliseconds
}

export enum MessageType {
  CLIENT_RESTARTED = 'CLIENT_RESTARTED',
  HEARTBEAT = 'HEARTBEAT',
  ACK = 'ACK'
}

export interface Message {
  type: MessageType;
  timestamp: number;
  data?: any;
}

export interface ProcessInfo {
  pid: number;
  name: string;
}

export interface LeagueInstallation {
  clientPath: string;
  gamePath: string;
  installPath: string;
}
