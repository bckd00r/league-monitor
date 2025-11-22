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

  // Set callback to broadcast immediate start when 8+ processes detected
  monitor.setImmediateStartCallback(() => {
    logger.info('8+ League of Legends processes detected, sending immediate start command...');
    sessionClient.broadcastImmediateStart();
  });

  // Set callback to broadcast restart when VGC exit code 185 detected
  monitor.setRestartCallback(async () => {
    logger.info('VGC exit code 185 detected. Waiting for process count to reach 8 before notifying followers...');
    
    // Wait for process count to reach 8 before notifying followers (Windows only)
    if (process.platform === 'win32') {
      const { ProcessUtils } = await import('../shared/process-utils.js');
      
      const maxWaitTime = 120000; // 2 minutes max wait
      const checkInterval = 5000; // Check every 5 seconds
      const startTime = Date.now();
      let processCount = 0;
      
      while (Date.now() - startTime < maxWaitTime) {
        try {
          processCount = await ProcessUtils.getProcessCountByDescription('League of Legends');
          logger.info(`VGC restart: Current process count: ${processCount} (waiting for >= 8)`);
          
          if (processCount >= 8) {
            logger.success(`VGC restart: Process count reached ${processCount} (>=8)! Notifying followers...`);
            sessionClient.broadcastRestart();
            return;
          }
        } catch (error) {
          logger.warn(`VGC restart: Failed to check process count: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
        
        // Wait before next check
        await new Promise(resolve => setTimeout(resolve, checkInterval));
      }
      
      // Timeout reached, notify anyway
      logger.warn(`VGC restart: Process count did not reach 8 within ${maxWaitTime / 1000} seconds. Current count: ${processCount}. Notifying followers anyway...`);
      sessionClient.broadcastRestart();
    } else {
      // Non-Windows: notify immediately (can't check process count)
      logger.info('VGC exit code 185 detected, sending restart command to followers...');
      sessionClient.broadcastRestart();
    }
  });

  // Set callback for game running restart request from follower
  sessionClient.setGameRunningRestartRequestCallback(async () => {
    logger.info('Game running restart request received from follower! Restarting League Client...');
    
    const { ProcessUtils } = await import('../shared/process-utils.js');
    const { LeagueUtils } = await import('../shared/league-utils.js');
    
    // First, kill VGC process before killing League Client
    logger.info('Terminating VGC process before restarting League Client...');
    await ProcessUtils.killVgcProcess();
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Kill existing League Client if running
    const processName = LeagueUtils.getLeagueClientProcessName();
    const isRunning = await ProcessUtils.isProcessRunning(processName);
    
    if (isRunning) {
      logger.info('Killing existing League Client due to game running restart request...');
      await ProcessUtils.killProcessByName(processName);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    // Restart League Client
    const success = await LeagueUtils.launchLeagueClient();
    if (success) {
      logger.success('League Client restarted successfully due to game running restart request');
      
      // Wait for process to appear
      const processAppeared = await ProcessUtils.waitForProcess(processName, 15000);
      if (processAppeared) {
        logger.success('League Client process detected');
      }
      
      // Wait for process count to reach 8 before notifying followers (Windows only)
      if (process.platform === 'win32') {
        logger.info('Waiting for process count to reach 8 before notifying followers...');
        
        const maxWaitTime = 120000; // 2 minutes max wait
        const checkInterval = 5000; // Check every 5 seconds
        const startTime = Date.now();
        let processCount = 0;
        
        while (Date.now() - startTime < maxWaitTime) {
          try {
            processCount = await ProcessUtils.getProcessCountByDescription('League of Legends');
            logger.info(`Current process count: ${processCount} (waiting for >= 8)`);
            
            if (processCount >= 8) {
              logger.success(`Process count reached ${processCount} (>=8)! Notifying followers...`);
              sessionClient.broadcastRestart();
              return;
            }
          } catch (error) {
            logger.warn(`Failed to check process count: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
          
          // Wait before next check
          await new Promise(resolve => setTimeout(resolve, checkInterval));
        }
        
        // Timeout reached, notify anyway
        logger.warn(`Process count did not reach 8 within ${maxWaitTime / 1000} seconds. Current count: ${processCount}. Notifying followers anyway...`);
        sessionClient.broadcastRestart();
      } else {
        // Non-Windows: notify immediately (can't check process count)
        logger.info('Non-Windows platform, notifying followers immediately...');
        sessionClient.broadcastRestart();
      }
    } else {
      logger.error('Failed to restart League Client due to game running restart request');
    }
  });

  // Note: No onClientStarted callback - we only send commands when 8+ processes are detected, VGC exit code 185, or game running restart request

  // Set callback for status requests
  sessionClient.setStatusRequestCallback(async () => {
    const { ProcessUtils } = await import('../shared/process-utils.js');
    const { LeagueUtils } = await import('../shared/league-utils.js');
    const processName = LeagueUtils.getLeagueClientProcessName();
    const isRunning = await ProcessUtils.isProcessRunning(processName);
    
    // Get League of Legends process count (Windows only)
    let processCount = 0;
    if (process.platform === 'win32') {
      try {
        processCount = await ProcessUtils.getProcessCountByDescription('League of Legends');
      } catch (error) {
        // Silently fail
      }
    }
    
    logger.info(`Status check: LeagueClient is ${isRunning ? 'RUNNING' : 'NOT RUNNING'}, Process count: ${processCount}`);
    return { clientRunning: isRunning, processCount };
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
