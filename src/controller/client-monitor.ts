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
  private onRestart?: () => void; // Callback for VGC exit code 185 restart
  private lastProcessCount: number = 0;
  private immediateStartTriggered: boolean = false;
  private lastRestartTime: number = 0;
  private lastLogTime: number = 0;
  private lastVgcCheckTime: number = 0;
  private vgcRestartTriggered: boolean = false;
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
   * Set callback for when restart is needed (VGC exit code 185)
   */
  setRestartCallback(callback: () => void): void {
    this.onRestart = callback;
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
      await this.checkVgcService(); // Check VGC service exit code
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
      return;
    }

    // No LeagueClient running, check if we should restart
    const isRunning = await ProcessUtils.isProcessRunning(processName);
    
    if (!isRunning) {
      // Check cooldown - don't restart if we just restarted recently
      const timeSinceLastRestart = Date.now() - this.lastRestartTime;
      if (timeSinceLastRestart < this.restartCooldown) {
        //const remainingSeconds = Math.ceil((this.restartCooldown - timeSinceLastRestart) / 1000);
        //this.logger.info(`LeagueClient not running, but in cooldown period (${remainingSeconds}s remaining). Skipping restart.`);
        return;
      }

      this.logger.warn('LeagueClient is not running, restarting...');
      
      // Kill VGC process before restarting League Client (Windows only)
      if (process.platform === 'win32') {
        this.logger.info('Terminating VGC process before restarting League Client...');
        await ProcessUtils.killVgcProcess();
      }
      
      const success = await LeagueUtils.launchLeagueClient();
      
      if (success) {
        this.lastRestartTime = Date.now();
        this.logger.success('LeagueClient restarted successfully');
        
        // Wait for process to actually appear (up to 15 seconds)
        this.logger.info('Waiting for LeagueClient process to appear...');
        await ProcessUtils.waitForProcess(processName, 15000);
        
        // if (processAppeared) {
        //   this.logger.success('LeagueClient process detected');
        //   // No callback - we only notify followers when 8+ processes are detected
        // } else {
        //   this.logger.warn('LeagueClient process not detected after 15 seconds, but launch was successful');
        //   // No callback - we only notify followers when 8+ processes are detected
        // }
      } else {
        this.logger.error('Failed to restart LeagueClient');
      }
    }
  }

  /**
   * Check if game process is running, kill it immediately
   * Checks all possible process name variations
   */
  private async checkAndKillGame(): Promise<void> {
    const gameProcessNames = LeagueUtils.getLeagueGameProcessNames();
    const isRunning = await ProcessUtils.isAnyProcessRunning(gameProcessNames);

    if (isRunning) {
      this.logger.warn('League of Legends game detected, killing immediately...');
      
      const killedCount = await ProcessUtils.killProcessByMultipleNames(gameProcessNames);
      
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
      
      // Always log process count for debugging (especially when >= 8)
      if (processCount !== this.lastProcessCount) {
        this.lastProcessCount = processCount;
      } else {
        // Log occasionally for lower counts
        const now = Date.now();
        if (!this.lastLogTime || now - this.lastLogTime > 30000) {
          this.lastLogTime = now;
        }
      }

      // If exactly 8 or more processes and not already triggered, trigger immediate start
      if (processCount >= 8) {
        if (!this.immediateStartTriggered) {
          this.logger.success(`${processCount} League of Legends processes detected (>=8)! Sending immediate start command to followers...`);
          if (this.onImmediateStart) {
            this.onImmediateStart();
            this.immediateStartTriggered = true;
          }
        }
      }

      // Reset flag if process count drops below 8
      if (processCount < 8 && this.immediateStartTriggered) {
        this.immediateStartTriggered = false;
      }
    } catch (error) {
      // Log error for debugging
      this.logger.error('Failed to check League of Legends process count', error as Error);
    }
  }

  /**
   * Check VGC service exit code
   * If exit code is 185, wait for VGC process to close, then restart League Client and notify followers
   * This runs every monitorInterval (default 5 seconds)
   */
  private async checkVgcService(): Promise<void> {
    // Only check on Windows
    if (process.platform !== 'win32') {
      return;
    }

    try {
      const exitCode185 = await ProcessUtils.checkVgcServiceExitCode185();

      if (exitCode185) {
        // Exit code 185 detected
        if (!this.vgcRestartTriggered) {
          this.logger.warn('VGC service exit code 185 detected! Waiting for VGC process to close...');
          this.vgcRestartTriggered = true;
          
          // Wait for VGC process to fully close (up to 2 minutes)
          this.logger.info('Waiting for VGC.exe to terminate...');
          const vgcClosed = await ProcessUtils.waitForVgcProcessToClose(120000); // 2 minutes timeout
          
          if (vgcClosed) {
            this.logger.success('VGC process closed. Now restarting League Client...');
          } else {
            this.logger.warn('VGC process did not close within timeout. Proceeding with restart anyway...');
          }
          
          // Kill existing League Client if running
          const processName = LeagueUtils.getLeagueClientProcessName();
          const isRunning = await ProcessUtils.isProcessRunning(processName);
          
          if (isRunning) {
            this.logger.info('Killing existing League Client due to VGC exit code 185...');
            await ProcessUtils.killProcessByName(processName);
            // Also kill RiotClientServices
            const riotClientServicesName = LeagueUtils.getRiotClientServicesProcessName();
            const riotClientServicesRunning = await ProcessUtils.isProcessRunning(riotClientServicesName);
            if (riotClientServicesRunning) {
              this.logger.info('Killing RiotClientServices...');
              await ProcessUtils.killProcessByName(riotClientServicesName);
            }
          }

          // Check cooldown - don't restart if we just restarted recently
          // const timeSinceLastRestart = Date.now() - this.lastRestartTime;
          // if (timeSinceLastRestart < this.restartCooldown) {
          //   const remainingSeconds = Math.ceil((this.restartCooldown - timeSinceLastRestart) / 1000);
          //   this.logger.info(`VGC exit code 185 detected, but in cooldown period (${remainingSeconds}s remaining). Skipping restart.`);
          //   return;
          // }

          // Restart League Client
          this.logger.info('Restarting League Client due to VGC exit code 185...');
          const success = await LeagueUtils.launchLeagueClient();

          if (success) {
            this.lastRestartTime = Date.now();
            this.logger.success('League Client restarted successfully due to VGC exit code 185');

            // Wait for process to appear
            this.logger.info('Waiting for League Client process to appear...');
            const processAppeared = await ProcessUtils.waitForProcess(processName, 15000);

            if (processAppeared) {
              this.logger.success('League Client process detected');
            } else {
              this.logger.warn('League Client process not detected after 15 seconds, but launch was successful');
            }

            // Notify followers about restart
            if (this.onRestart) {
              this.logger.info('Notifying followers about restart due to VGC exit code 185...');
              this.onRestart();
            }
          } else {
            this.logger.error('Failed to restart League Client due to VGC exit code 185');
          }
        } else {
          // Already triggered, just log occasionally
          const now = Date.now();
          if (!this.lastVgcCheckTime || now - this.lastVgcCheckTime > 30000) {
            this.logger.info('VGC service exit code 185 still detected (already triggered restart)');
            this.lastVgcCheckTime = now;
          }
        }
      } else {
        // Exit code is not 185, reset trigger flag
        if (this.vgcRestartTriggered) {
          this.vgcRestartTriggered = false;
        }
      }
    } catch (error) {
      // Log error for debugging
      this.logger.error('Failed to check VGC service', error as Error);
    }
  }

  /**
   * Get monitoring status
   */
  isActive(): boolean {
    return this.isMonitoring;
  }
}
