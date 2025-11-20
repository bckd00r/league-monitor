import { SessionClient } from '../controller/session-client.js';
import { LeagueUtils } from '../shared/league-utils.js';
import { Logger } from '../shared/logger.js';
import { getFollowerConfig } from '../shared/config.js';

const logger = new Logger('Follower');

// Load configuration from config.json
const config = getFollowerConfig();

async function main() {
  // Get token from command line argument
  const sessionToken = process.argv[2];

  if (!sessionToken) {
    console.log('\n='.repeat(60));
    console.log('League Client Follower');
    console.log('='.repeat(60));
    console.log('\nUsage:');
    console.log('  npm run follower <session-token>');
    console.log('\nExample:');
    console.log('  npm run follower abc123def456\n');
    console.log('Get the session token from the controller output.\n');
    process.exit(1);
  }

  logger.info('Starting League Client Follower with Session Token...');
  logger.info(`Platform: ${process.platform}`);
  logger.info(`Restart delay: ${config.restartDelay}ms`);
  logger.info(`Session token: ${sessionToken}`);

  // Initialize session client
  const sessionClient = new SessionClient(
    config.relayServerHost,
    config.relayServerPort,
    'follower'
  );

  sessionClient.setRestartCallback(async () => {
    const { ProcessUtils } = await import('../shared/process-utils.js');
    const clientProcessName = LeagueUtils.getLeagueClientProcessName();
    const isClientRunning = await ProcessUtils.isProcessRunning(clientProcessName);
    
    if (isClientRunning) {
      // Client already running - kill and restart immediately
      logger.info('LeagueClient is already running, restarting immediately...');
      
      const killedCount = await ProcessUtils.killProcessByName(clientProcessName);
      if (killedCount > 0) {
        logger.success('Killed existing LeagueClient');
        // Wait a moment for process to fully terminate
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
      logger.info('Launching LeagueClient immediately...');
      const success = await LeagueUtils.launchLeagueClient();
      
      if (success) {
        logger.success('Client launched successfully (immediate restart)');
      } else {
        logger.error('Failed to launch client');
      }
    } else {
      // Client not running - wait delay then start
      logger.info(`LeagueClient not running, waiting ${config.restartDelay}ms before starting...`);
      
      await new Promise(resolve => setTimeout(resolve, config.restartDelay));
      
      logger.info('Starting League Client...');
      const success = await LeagueUtils.launchLeagueClient();
      
      if (success) {
        logger.success('Client launched successfully (delayed start)');
      } else {
        logger.error('Failed to launch client');
      }
    }
  });

  // Immediate start callback - no delay, start immediately
  sessionClient.setImmediateStartCallback(async () => {
    const { ProcessUtils } = await import('../shared/process-utils.js');
    const clientProcessName = LeagueUtils.getLeagueClientProcessName();
    const isClientRunning = await ProcessUtils.isProcessRunning(clientProcessName);
    
    logger.info('IMMEDIATE START command received from controller!');
    
    if (isClientRunning) {
      // Client already running - kill and restart immediately
      logger.info('LeagueClient is already running, killing and restarting immediately...');
      
      const killedCount = await ProcessUtils.killProcessByName(clientProcessName);
      if (killedCount > 0) {
        logger.success('Killed existing LeagueClient');
        // Wait a moment for process to fully terminate
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    logger.info('Launching LeagueClient immediately (no delay)...');
    const success = await LeagueUtils.launchLeagueClient();
    
    if (success) {
      logger.success('Client launched successfully (immediate start - no delay)');
    } else {
      logger.error('Failed to launch client');
    }
  });

  // Connect with token
  await sessionClient.connect(sessionToken);

  // Wait for connection
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Request initial status from controller
  if (sessionClient.connected()) {
    logger.info('Requesting initial status from controller...');
    sessionClient.requestStatus();
  }

  // Send heartbeat every 30 seconds
  setInterval(() => {
    if (sessionClient.connected()) {
      sessionClient.sendHeartbeat();
    }
  }, 30000);

  process.on('SIGINT', () => {
    logger.info('Shutting down...');
    sessionClient.disconnect();
    process.exit(0);
  });

  logger.success('Follower is running!');
  logger.info('Waiting for controller restart events...');
  logger.info('Press Ctrl+C to stop');
}

main().catch((error) => {
  logger.error('Fatal error', error);
  process.exit(1);
});
