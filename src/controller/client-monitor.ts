import { ProcessUtils } from '../shared/process-utils.js';
import { LeagueUtils } from '../shared/league-utils.js';
import { Logger } from '../shared/logger.js';

export class ClientMonitor {
  private logger: Logger;
  private monitorInterval: number;
  private isMonitoring: boolean = false;
  private monitorTimer?: NodeJS.Timeout;
  private onImmediateStart?: () => void;
  private onClientStarted?: () => void;
  private lastProcessCount: number = 0;
  private immediateStartTriggered: boolean = false;
  private lastRestartTime: number = 0;
  private lastLogTime: number = 0;
  private readonly restartCooldown: number = 30000; // 30 seconds cooldown

  constructor(monitorInterval: number = 5000) {
    this.logger = new Logger('ClientMonitor');
    this.monitorInterval = monitorInterval;
  }

  /**
   * Set callback for when immediate start is needed (8+ processes detected)
   */
  setImmediateStartCallback(callback: () => void): void {
    this.onImmediateStart = callback;
  }

  /**
   * Set callback for when client is started
   */
  setClientStartedCallback(callback: () => void): void {
    this.onClientStarted = callback;
  }

  /**
   * Start monitoring League Client
   */
  async start(): Promise<void> {
    if (this.isMonitoring) {
      this.logger.warn('Monitor already running');
      return;
    }

    this.isMonitoring = true;
    this.logger.info('Starting League Client monitor...');

    // Initial check and launch if needed
    await this.checkAndRestartClient();

    // Set up periodic monitoring
    this.monitorTimer = setInterval(async () => {
      await this.checkAndRestartClient();
      await this.checkAndKillGame();
      await this.checkLeagueProcessCount();
    }, this.monitorInterval);

    this.logger.success('Monitor started successfully');
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = undefined;
    }
    this.isMonitoring = false;
    this.logger.info('Monitor stopped');
  }

  /**
   * Check if client is running, restart if not
   */
  private async checkAndRestartClient(): Promise<void> {
    const processName = LeagueUtils.getLeagueClientProcessName();
    
    // Check process count first - if already 1 or more, don't start new one
    const processPids = await ProcessUtils.getProcessPids(processName);
    const processCount = processPids.length;
    
    if (processCount >= 1) {
      // Already have LeagueClient running, don't start another one
      this.logger.info(`LeagueClient already running (${processCount} process(es) detected). Skipping restart.`);
      return;
    }

    // No LeagueClient running, check if we should restart
    const isRunning = await ProcessUtils.isProcessRunning(processName);
    
    if (!isRunning) {
      // Check cooldown - don't restart if we just restarted recently
      const timeSinceLastRestart = Date.now() - this.lastRestartTime;
      if (timeSinceLastRestart < this.restartCooldown) {
        const remainingSeconds = Math.ceil((this.restartCooldown - timeSinceLastRestart) / 1000);
        this.logger.info(`LeagueClient not running, but in cooldown period (${remainingSeconds}s remaining). Skipping restart.`);
        return;
      }

      this.logger.warn('LeagueClient is not running, restarting...');
      
      const success = await LeagueUtils.launchLeagueClient();
      
      if (success) {
        this.lastRestartTime = Date.now();
        this.logger.success('LeagueClient restarted successfully');
        
        // Wait for process to actually appear (up to 15 seconds)
        this.logger.info('Waiting for LeagueClient process to appear...');
        const processAppeared = await ProcessUtils.waitForProcess(processName, 15000);
        
        if (processAppeared) {
          this.logger.success('LeagueClient process detected');
          // Notify that client was started
          if (this.onClientStarted) {
            this.onClientStarted();
          }
        } else {
          this.logger.warn('LeagueClient process not detected after 15 seconds, but launch was successful');
          // Still notify even if process not detected (launch was successful)
          if (this.onClientStarted) {
            this.onClientStarted();
          }
        }
      } else {
        this.logger.error('Failed to restart LeagueClient');
      }
    }
  }

  /**
   * Check if game process is running, kill it immediately
   */
  private async checkAndKillGame(): Promise<void> {
    const gameProcessName = LeagueUtils.getLeagueGameProcessName();
    const isRunning = await ProcessUtils.isProcessRunning(gameProcessName);

    if (isRunning) {
      this.logger.warn('League of Legends game detected, killing immediately...');
      
      const killedCount = await ProcessUtils.killProcessByName(gameProcessName);
      
      if (killedCount > 0) {
        this.logger.success(`Killed ${killedCount} game process(es)`);
      } else {
        this.logger.error('Failed to kill game process');
      }
    }
  }

  /**
   * Check League of Legends process count by description
   * If 8 or more processes found, trigger immediate start callback
   * This runs every monitorInterval (default 5 seconds)
   */
  private async checkLeagueProcessCount(): Promise<void> {
    // Only check on Windows
    if (process.platform !== 'win32') {
      return;
    }

    try {
      const processCount = await ProcessUtils.getProcessCountByDescription('League of Legends');
      
      // Log if count changed or if it's 8+
      if (processCount !== this.lastProcessCount) {
        this.logger.info(`League of Legends process count: ${processCount}`);
        this.lastProcessCount = processCount;
      } else if (processCount >= 8) {
        // Log periodically even if count hasn't changed (every 30 seconds)
        const now = Date.now();
        if (!this.lastLogTime || now - this.lastLogTime > 30000) {
          this.logger.info(`League of Legends process count: ${processCount} (>=8, monitoring...)`);
          this.lastLogTime = now;
        }
      }

      // If exactly 8 or more processes and not already triggered, trigger immediate start
      if (processCount >= 8 && !this.immediateStartTriggered && this.onImmediateStart) {
        this.logger.success(`${processCount} League of Legends processes detected (>=8)! Sending immediate start command to followers...`);
        this.onImmediateStart();
        this.immediateStartTriggered = true;
      }

      // Reset flag if process count drops below 8
      if (processCount < 8 && this.immediateStartTriggered) {
        this.logger.info('League of Legends process count dropped below 8, resetting immediate start flag');
        this.immediateStartTriggered = false;
      }
    } catch (error) {
      // Log error for debugging
      this.logger.error('Failed to check League of Legends process count', error as Error);
    }
  }

  /**
   * Get monitoring status
   */
  isActive(): boolean {
    return this.isMonitoring;
  }
}
