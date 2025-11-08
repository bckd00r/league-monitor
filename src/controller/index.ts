import { ClientMonitor } from './client-monitor.js';
import { SessionClient } from './session-client.js';
import { Logger } from '../shared/logger.js';
import { getControllerConfig } from '../shared/config.js';

const logger = new Logger('Controller');

// Load configuration from config.json
const config = getControllerConfig();

async function main() {
  logger.info('Starting League Client Controller (Mac) with Session Token...');
  logger.info(`Platform: ${process.platform}`);

  if (process.platform !== 'darwin') {
    logger.warn('This controller is designed for macOS. Functionality may be limited.');
  }

  // Initialize session client (creates new session)
  const sessionClient = new SessionClient(
    config.relayServerHost,
    config.relayServerPort,
    'controller'
  );
  
  // Initialize client monitor
  const monitor = new ClientMonitor(config.monitorInterval);

  // Set callback to broadcast when client restarts
  monitor.setRestartCallback(() => {
    logger.info('Client was restarted, broadcasting to followers...');
    sessionClient.broadcastRestart();
  });

  // Set callback for status requests
  sessionClient.setStatusRequestCallback(async () => {
    const { ProcessUtils } = await import('../shared/process-utils.js');
    const { LeagueUtils } = await import('../shared/league-utils.js');
    const processName = LeagueUtils.getLeagueClientProcessName();
    const isRunning = await ProcessUtils.isProcessRunning(processName);
    logger.info(`Status check: LeagueClient is ${isRunning ? 'RUNNING' : 'NOT RUNNING'}`);
    return isRunning;
  });

  // Connect to relay server
  await sessionClient.connect();

  // Wait for session creation
  await new Promise(resolve => setTimeout(resolve, 2000));

  const token = sessionClient.getSessionToken();
  if (token) {
    logger.success('='.repeat(60));
    logger.success(`SESSION TOKEN: ${token}`);
    logger.success('Share this token with follower clients to connect');
    logger.success('='.repeat(60));
  }

  // Start monitoring
  await monitor.start();

  // Send heartbeat every 30 seconds
  setInterval(() => {
    if (sessionClient.connected()) {
      sessionClient.sendHeartbeat();
    }
  }, 30000);

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    logger.info('Received SIGINT, shutting down...');
    monitor.stop();
    sessionClient.disconnect();
    process.exit(0);
  });

  logger.success('Controller is running!');
  logger.info('Press Ctrl+C to stop');
}

main().catch((error) => {
  logger.error('Fatal error', error);
  process.exit(1);
});
