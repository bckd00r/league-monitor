import { SessionClient } from '../controller/session-client.js';
import { LeagueUtils } from '../shared/league-utils.js';
import { Logger } from '../shared/logger.js';
import { getFollowerConfig } from '../shared/config.js';

const logger = new Logger('Follower');

// Load configuration from config.json
const config = getFollowerConfig();

async function main() {
  // Get token from command line argument (optional - will auto-join by IP if not provided)
  const sessionToken = process.argv[2];

  logger.info('Starting League Client Follower...');
  logger.info(`Platform: ${process.platform}`);
  
  if (sessionToken) {
    logger.info(`Session token: ${sessionToken}`);
  } else {
    logger.info('No token provided - will attempt auto-join by IP address');
    logger.info('(Make sure controller is running on the same machine/IP)');
  }

  // Initialize session client
  const sessionClient = new SessionClient(
    config.relayServerHost,
    config.relayServerPort,
    'follower'
  );

  // Spam protection: track last start time
  let lastStartTime: number = 0;
  const startCooldown: number = 30000; // 30 seconds cooldown

  // Client restart callback - triggered when controller restarts due to VGC exit code 185
  sessionClient.setClientRestartedCallback(async () => {
    // Check cooldown - don't start if we just started recently
    const timeSinceLastStart = Date.now() - lastStartTime;
    if (timeSinceLastStart < startCooldown) {
      const remainingSeconds = Math.ceil((startCooldown - timeSinceLastStart) / 1000);
      logger.info(`CLIENT_RESTARTED command received, but in cooldown period (${remainingSeconds}s remaining). Skipping.`);
      return;
    }

    const { ProcessUtils } = await import('../shared/process-utils.js');
    const clientProcessName = LeagueUtils.getLeagueClientProcessName();
    const isClientRunning = await ProcessUtils.isProcessRunning(clientProcessName);
    
    logger.info('CLIENT_RESTARTED command received from controller (VGC exit code 185)!');
    
    if (isClientRunning) {
      // Client already running - kill and restart
      logger.info('LeagueClient is already running, killing and restarting...');
      
      const killedCount = await ProcessUtils.killProcessByName(clientProcessName);
      if (killedCount > 0) {
        logger.success('Killed existing LeagueClient');
        // Wait a moment for process to fully terminate
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    logger.info('Launching LeagueClient due to controller restart...');
    const success = await LeagueUtils.launchLeagueClient();
    
    if (success) {
      lastStartTime = Date.now(); // Record start time
      logger.success('Client launched successfully (restart due to VGC exit code 185)');
      
      // Wait for process to appear
      logger.info('Waiting for LeagueClient process to appear...');
      const processAppeared = await ProcessUtils.waitForProcess(clientProcessName, 15000);
      if (processAppeared) {
        logger.success('LeagueClient process detected');
      } else {
        logger.warn('LeagueClient process not detected after 15 seconds, but launch was successful');
      }
    } else {
      logger.error('Failed to launch client');
    }
  });

  // Immediate start callback - triggered when controller detects 8+ processes
  sessionClient.setImmediateStartCallback(async () => {
    // Check cooldown - don't start if we just started recently
    const timeSinceLastStart = Date.now() - lastStartTime;
    if (timeSinceLastStart < startCooldown) {
      const remainingSeconds = Math.ceil((startCooldown - timeSinceLastStart) / 1000);
      logger.info(`IMMEDIATE START command received, but in cooldown period (${remainingSeconds}s remaining). Skipping.`);
      return;
    }

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
      lastStartTime = Date.now(); // Record start time
      logger.success('Client launched successfully (immediate start - no delay)');
      
      // Wait for process to appear
      logger.info('Waiting for LeagueClient process to appear...');
      const processAppeared = await ProcessUtils.waitForProcess(clientProcessName, 15000);
      if (processAppeared) {
        logger.success('LeagueClient process detected');
      } else {
        logger.warn('LeagueClient process not detected after 15 seconds, but launch was successful');
      }
    } else {
      logger.error('Failed to launch client');
    }
  });

  // Connect with token (or auto-join by IP)
  await sessionClient.connect(sessionToken);

  // Wait for connection
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Request initial status from controller (only if we have a session token)
  // If auto-joining, wait for successful join first
  const checkAndRequestStatus = () => {
    if (sessionClient.connected() && sessionClient.getSessionToken()) {
      logger.info('Requesting initial status from controller...');
      sessionClient.requestStatus();
    } else if (!sessionToken) {
      // If no token and no session yet, wait a bit more and retry
      setTimeout(checkAndRequestStatus, 3000);
    }
  };
  
  checkAndRequestStatus();

  // Check game process every 8 minutes (480 seconds)
  // If "League of Legends.exe" is running, request restart from controller
  const gameCheckInterval = 8 * 60 * 1000; // 8 minutes in milliseconds
  let lastGameCheckTime: number = 0;
  let lastRestartRequestTime: number = 0;
  const restartRequestCooldown: number = 5 * 60 * 1000; // 5 minutes cooldown between restart requests

  setInterval(async () => {
    if (!sessionClient.connected() || !sessionClient.getSessionToken()) {
      return; // Not connected yet, skip check
    }

    try {
      const { ProcessUtils } = await import('../shared/process-utils.js');
      const { LeagueUtils } = await import('../shared/league-utils.js');
      const gameProcessName = LeagueUtils.getLeagueGameProcessName();
      const isGameRunning = await ProcessUtils.isProcessRunning(gameProcessName);

      const now = Date.now();
      
      if (isGameRunning) {
        // Game is running, check if we should request restart
        const timeSinceLastRequest = now - lastRestartRequestTime;
        
        if (timeSinceLastRequest >= restartRequestCooldown) {
          logger.info('League of Legends game is running, requesting restart from controller...');
          sessionClient.requestRestartFromController();
          lastRestartRequestTime = now;
        } else {
          const remainingMinutes = Math.ceil((restartRequestCooldown - timeSinceLastRequest) / 60000);
          logger.info(`Game is running, but restart request is in cooldown (${remainingMinutes} minutes remaining)`);
        }
      } else {
        // Game is not running, just log occasionally
        if (!lastGameCheckTime || now - lastGameCheckTime > 300000) { // Log every 5 minutes when not running
          logger.info('League of Legends game is not running');
          lastGameCheckTime = now;
        }
      }
    } catch (error) {
      logger.error('Failed to check game process', error as Error);
    }
  }, gameCheckInterval);

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
  logger.info('Waiting for 8+ process detection from controller...');
  logger.info('Game process check: Every 8 minutes (if game is running, will request restart)');
  logger.info('Press Ctrl+C to stop');
}

main().catch((error) => {
  logger.error('Fatal error', error);
  process.exit(1);
});
