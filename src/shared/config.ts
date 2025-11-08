import { readFileSync } from 'fs';
import { join } from 'path';

interface RelayConfig {
  port: number;
  host: string;
}

interface ControllerConfig {
  relayServerHost: string;
  relayServerPort: number;
  monitorInterval: number;
  killGameProcess: boolean;
}

interface FollowerConfig {
  relayServerHost: string;
  relayServerPort: number;
  restartDelay: number;
}

interface Config {
  relay: RelayConfig;
  controller: ControllerConfig;
  follower: FollowerConfig;
}

let config: Config | null = null;

export function loadConfig(): Config {
  if (config) return config;

  try {
    const configPath = join(process.cwd(), 'config.json');
    const configData = readFileSync(configPath, 'utf-8');
    config = JSON.parse(configData);
    return config as Config;
  } catch (error) {
    console.error('Failed to load config.json, using defaults');
    console.error('Copy config.example.json to config.json and customize it');
    
    // Return defaults
    config = {
      relay: {
        port: 8080,
        host: '0.0.0.0'
      },
      controller: {
        relayServerHost: 'localhost',
        relayServerPort: 8080,
        monitorInterval: 5000,
        killGameProcess: true
      },
      follower: {
        relayServerHost: 'localhost',
        relayServerPort: 8080,
        restartDelay: 30000
      }
    };
    
    return config;
  }
}

export function getRelayConfig(): RelayConfig {
  return loadConfig().relay;
}

export function getControllerConfig(): ControllerConfig {
  return loadConfig().controller;
}

export function getFollowerConfig(): FollowerConfig {
  return loadConfig().follower;
}
