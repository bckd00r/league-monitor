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
    const { LeagueUtils } = await import('../shared/league-utils.js');
    const clientProcessName = LeagueUtils.getLeagueClientProcessName();
    const gameProcessNames = LeagueUtils.getLeagueGameProcessNames();
    
    logger.info('CLIENT_RESTARTED command received from controller (VGC exit code 185)!');
    
    // Check if game is running - if yes, skip launch (30-second check will handle it when game closes)
    const isGameRunning = await ProcessUtils.isAnyProcessRunning(gameProcessNames);
    if (isGameRunning) {
      logger.info('League of Legends game is running, skipping LeagueClient launch (will be handled by 30-second game check when game closes)');
      return;
    }
    
    const isClientRunning = await ProcessUtils.isProcessRunning(clientProcessName);
    
    if (isClientRunning) {
      // Client already running - kill and restart
      logger.info('LeagueClient is already running, killing and restarting...');
      
      const killedCount = await ProcessUtils.killProcessByName(clientProcessName);
      if (killedCount > 0) {
        logger.success('Killed existing LeagueClient');
        // Also kill RiotClientServices
        const riotClientServicesName = LeagueUtils.getRiotClientServicesProcessName();
        const riotClientServicesRunning = await ProcessUtils.isProcessRunning(riotClientServicesName);
        if (riotClientServicesRunning) {
          logger.info('Killing RiotClientServices...');
          await ProcessUtils.killProcessByName(riotClientServicesName);
        }
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
    const { LeagueUtils } = await import('../shared/league-utils.js');
    const clientProcessName = LeagueUtils.getLeagueClientProcessName();
    const gameProcessNames = LeagueUtils.getLeagueGameProcessNames();
    
    logger.info('IMMEDIATE START command received from controller!');
    
    // Check if game is running - if yes, skip launch (30-second check will handle it when game closes)
    const isGameRunning = await ProcessUtils.isAnyProcessRunning(gameProcessNames);
    if (isGameRunning) {
      logger.info('League of Legends game is running, skipping LeagueClient launch (will be handled by 30-second game check when game closes)');
      return;
    }
    
    const isClientRunning = await ProcessUtils.isProcessRunning(clientProcessName);
    
    if (isClientRunning) {
      // Client already running - kill and restart immediately
      logger.info('LeagueClient is already running, killing and restarting immediately...');
      
      const killedCount = await ProcessUtils.killProcessByName(clientProcessName);
      if (killedCount > 0) {
        logger.success('Killed existing LeagueClient');
        // Also kill RiotClientServices
        const riotClientServicesName = LeagueUtils.getRiotClientServicesProcessName();
        const riotClientServicesRunning = await ProcessUtils.isProcessRunning(riotClientServicesName);
        if (riotClientServicesRunning) {
          logger.info('Killing RiotClientServices...');
          await ProcessUtils.killProcessByName(riotClientServicesName);
        }
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

  // Track game process status for comparison (30 second check)
  let lastGameStatus: boolean | null = null; // null = not checked yet
  
  // Track last restart request time for cooldown
  let lastRestartRequestTime: number = 0;
  const restartRequestCooldown: number = 60 * 1000; // 1 minute cooldown between restart requests when game closes

  // Also track for 4-minute check when game is running
  let lastGameRunningCheckTime: number = 0;
  const gameRunningRestartCooldown: number = 10 * 60 * 1000; // 5 minutes cooldown between restart requests when game is running

  // Check game process every 5 seconds
  // If game was running 5 seconds ago but is now closed, restart both clients
  const gameCheckInterval = 5 * 1000; // 5 seconds in milliseconds
  
  // Every 5 seconds: Check if game process status changed (running -> closed)
  // Also check if game is running and LeagueClient should be closed
  setInterval(async () => {
    if (!sessionClient.connected() || !sessionClient.getSessionToken()) {
      return; // Not connected yet, skip check
    }

    try {
      const { ProcessUtils } = await import('../shared/process-utils.js');
      const { LeagueUtils } = await import('../shared/league-utils.js');
      const gameProcessNames = LeagueUtils.getLeagueGameProcessNames();
      const clientProcessName = LeagueUtils.getLeagueClientProcessName();
      const isGameRunning = await ProcessUtils.isAnyProcessRunning(gameProcessNames);
      const isClientRunning = await ProcessUtils.isProcessRunning(clientProcessName);

      // If game is running and LeagueClient is also running, close LeagueClient
      if (isGameRunning && isClientRunning) {
        logger.warn('League of Legends game is running and LeagueClient is also running! Closing LeagueClient until game closes...');
        const killedCount = await ProcessUtils.killProcessByName(clientProcessName);
        if (killedCount > 0) {
          logger.success('Closed LeagueClient because game is running');
          // Also kill RiotClientServices
          const riotClientServicesName = LeagueUtils.getRiotClientServicesProcessName();
          const riotClientServicesRunning = await ProcessUtils.isProcessRunning(riotClientServicesName);
          if (riotClientServicesRunning) {
            logger.info('Killing RiotClientServices...');
            await ProcessUtils.killProcessByName(riotClientServicesName);
          }
        }
        lastGameStatus = isGameRunning;
        return;
      }
      
      // // Check if game was running before but is now closed
      // if (lastGameStatus === true && !isGameRunning) {
      //   // Game was running but is now closed - restart both clients
      //   const timeSinceLastRequest = now - lastRestartRequestTime;
        
      //   if (timeSinceLastRequest >= restartRequestCooldown) {
      //     logger.warn('League of Legends game was running but is now closed! Requesting restart...');
      //     sessionClient.requestRestartFromController();
      //     lastRestartRequestTime = now;
      //     lastGameStatus = isGameRunning;
      //   } else {
      //     const remainingSeconds = Math.ceil((restartRequestCooldown - timeSinceLastRequest) / 1000);
      //     logger.info(`Game closed, but restart request is in cooldown (${remainingSeconds}s remaining)`);
      //     lastGameStatus = isGameRunning;
      //   }
      // } else {
      //   // Update status
      //   lastGameStatus = isGameRunning;
        
      //   // Log occasionally when game status doesn't change
      //   if (isGameRunning) {
      //     logger.info('League of Legends game is running');
      //   } else {
      //     // Log less frequently when game is not running
      //     if (!lastGameRunningCheckTime || now - lastGameRunningCheckTime > 300000) { // Log every 5 minutes
      //       logger.info('League of Legends game is not running');
      //       lastGameRunningCheckTime = now;
      //     }
      //   }
      // }
    } catch (error) {
      logger.error('Failed to check game process status', error as Error);
    }
  }, gameCheckInterval);

  // Also check game process every 2 minutes for restart request when game is running
  const gameRunningCheckInterval = 2 * 60 * 1000; // 2 minutes in milliseconds

  // Every 2 minutes: Check if game is running and request restart (if game keeps running)
  setInterval(async () => {
    if (!sessionClient.connected() || !sessionClient.getSessionToken()) {
      return; // Not connected yet, skip check
    }

    try {
      const { ProcessUtils } = await import('../shared/process-utils.js');
      const { LeagueUtils } = await import('../shared/league-utils.js');
      const gameProcessNames = LeagueUtils.getLeagueGameProcessNames();
      const isGameRunning = await ProcessUtils.isAnyProcessRunning(gameProcessNames);

      const now = Date.now();
      
      if (isGameRunning) {
        // Game is running, check if we should request restart
        const timeSinceLastRequest = now - lastGameRunningCheckTime;
        
        if (timeSinceLastRequest >= gameRunningRestartCooldown) {
          logger.info('League of Legends game is running (2 minute check), requesting restart from controller...');
          sessionClient.requestRestartFromController();
          lastGameRunningCheckTime = now;
        } else {
          const remainingMinutes = Math.ceil((gameRunningRestartCooldown - timeSinceLastRequest) / 60000);
          logger.info(`Game is running, but restart request is in cooldown (${remainingMinutes} minutes remaining)`);
        }
      }
    } catch (error) {
      logger.error('Failed to check game process for restart request', error as Error);
    }
  }, gameRunningCheckInterval);

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
  logger.info('Game process check: Every 30 seconds (if game closes, will request restart)');
  logger.info('Game process check: Every 2 minutes (if game is running, will request restart)');
  logger.info('Press Ctrl+C to stop');
}

main().catch((error) => {
  logger.error('Fatal error', error);
  process.exit(1);
});
