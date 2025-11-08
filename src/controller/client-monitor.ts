import { ProcessUtils } from '../shared/process-utils.js';
import { LeagueUtils } from '../shared/league-utils.js';
import { Logger } from '../shared/logger.js';

export class ClientMonitor {
  private logger: Logger;
  private monitorInterval: number;
  private isMonitoring: boolean = false;
  private monitorTimer?: NodeJS.Timeout;
  private onClientRestarted?: () => void;

  constructor(monitorInterval: number = 5000) {
    this.logger = new Logger('ClientMonitor');
    this.monitorInterval = monitorInterval;
  }

  /**
   * Set callback for when client is restarted
   */
  setRestartCallback(callback: () => void): void {
    this.onClientRestarted = callback;
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
    const isRunning = await ProcessUtils.isProcessRunning(processName);

    if (!isRunning) {
      this.logger.warn('LeagueClient is not running, restarting...');
      
      const success = await LeagueUtils.launchLeagueClient();
      
      if (success) {
        this.logger.success('LeagueClient restarted successfully');
        
        // Wait a bit to ensure process started
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Notify that client was restarted
        if (this.onClientRestarted) {
          this.onClientRestarted();
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
   * Get monitoring status
   */
  isActive(): boolean {
    return this.isMonitoring;
  }
}
