import { SessionClient } from '../controller/session-client.js';
import { LeagueUtils } from '../shared/league-utils.js';
import { Logger } from '../shared/logger.js';

const logger = new Logger('Follower');

// Configuration - change this to your relay server
const RELAY_SERVER_HOST = '37.59.96.187'; // or remote server IP
const RELAY_SERVER_PORT = 8080;
const RESTART_DELAY = 30000; // 30 seconds

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
  logger.info(`Restart delay: ${RESTART_DELAY}ms`);
  logger.info(`Session token: ${sessionToken}`);

  // Initialize session client
  const sessionClient = new SessionClient(RELAY_SERVER_HOST, RELAY_SERVER_PORT, 'follower');

  sessionClient.setRestartCallback(async () => {
    logger.info(`Waiting ${RESTART_DELAY}ms before restarting client...`);
    
    await new Promise(resolve => setTimeout(resolve, RESTART_DELAY));
    
    logger.info('Starting League Client...');
    const success = await LeagueUtils.launchLeagueClient();
    
    if (success) {
      logger.success('Client launched successfully');
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
