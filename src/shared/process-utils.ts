import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { ProcessInfo } from './types.js';
import { Logger } from './logger.js';

const execAsync = promisify(exec);
const logger = new Logger('ProcessUtils');

export class ProcessUtils {
  /**
   * Check if a process is running by name
   * Works on both macOS and Windows
   */
  static async isProcessRunning(processName: string): Promise<boolean> {
    try {
      const platform = process.platform;

      if (platform === 'darwin') {
        // macOS: use pgrep
        const { stdout } = await execAsync(`pgrep -x "${processName}"`);
        return stdout.trim().length > 0;
      } else if (platform === 'win32') {
        // Windows: use tasklist
        const { stdout } = await execAsync(`tasklist /FI "IMAGENAME eq ${processName}.exe" /NH`);
        return stdout.toLowerCase().includes(processName.toLowerCase());
      } else {
        logger.warn(`Unsupported platform: ${platform}`);
        return false;
      }
    } catch (error) {
      // pgrep/tasklist returns error if process not found
      return false;
    }
  }

  /**
   * Get all PIDs for a process name
   */
  static async getProcessPids(processName: string): Promise<number[]> {
    try {
      const platform = process.platform;
      let stdout: string;

      if (platform === 'darwin') {
        const result = await execAsync(`pgrep -x "${processName}"`);
        stdout = result.stdout;
      } else if (platform === 'win32') {
        const result = await execAsync(
          `wmic process where "name='${processName}.exe'" get ProcessId /value`
        );
        stdout = result.stdout;
      } else {
        return [];
      }

      const pids: number[] = [];
      const lines = stdout.trim().split('\n');

      for (const line of lines) {
        if (platform === 'win32') {
          const match = line.match(/ProcessId=(\d+)/);
          if (match) {
            pids.push(parseInt(match[1]));
          }
        } else {
          const pid = parseInt(line.trim());
          if (!isNaN(pid)) {
            pids.push(pid);
          }
        }
      }

      return pids;
    } catch (error) {
      return [];
    }
  }

  /**
   * Kill a process by PID
   */
  static async killProcess(pid: number): Promise<boolean> {
    try {
      const platform = process.platform;

      if (platform === 'darwin') {
        await execAsync(`kill -9 ${pid}`);
      } else if (platform === 'win32') {
        await execAsync(`taskkill /F /PID ${pid}`);
      } else {
        return false;
      }

      logger.info(`Killed process with PID: ${pid}`);
      return true;
    } catch (error) {
      logger.error(`Failed to kill process ${pid}`, error as Error);
      return false;
    }
  }

  /**
   * Kill all processes by name
   */
  static async killProcessByName(processName: string): Promise<number> {
    const pids = await this.getProcessPids(processName);
    let killedCount = 0;

    for (const pid of pids) {
      const success = await this.killProcess(pid);
      if (success) killedCount++;
    }

    if (killedCount > 0) {
      logger.info(`Killed ${killedCount} instance(s) of ${processName}`);
    }

    return killedCount;
  }

  /**
   * Wait for a process to appear
   */
  static async waitForProcess(
    processName: string,
    timeout: number = 30000
  ): Promise<boolean> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      if (await this.isProcessRunning(processName)) {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    return false;
  }

  /**
   * Get process count by description/product name (Windows only)
   * Useful for counting processes by their "Description" or "Product Name" field
   */
  static async getProcessCountByDescription(description: string): Promise<number> {
    try {
      const platform = process.platform;

      if (platform === 'win32') {
        // Windows: use wmic to get processes by description
        const { stdout } = await execAsync(
          `wmic process where "Description='${description}'" get ProcessId /value`
        );
        
        const lines = stdout.trim().split('\n').filter(line => line.includes('ProcessId='));
        return lines.length;
      } else if (platform === 'darwin') {
        // macOS: Not easily supported, return 0
        logger.warn('getProcessCountByDescription is not supported on macOS');
        return 0;
      } else {
        logger.warn(`Unsupported platform: ${platform}`);
        return 0;
      }
    } catch (error) {
      // If no processes found, wmic returns error
      return 0;
    }
  }

  /**
   * Launch an application
   */
  static async launchApp(appPath: string, args: string[] = []): Promise<boolean> {
    try {
      const platform = process.platform;

      if (platform === 'darwin') {
        // macOS: use open command
        spawn('open', ['-a', appPath, '--args', ...args], {
          detached: true,
          stdio: 'ignore'
        }).unref();
      } else if (platform === 'win32') {
        // Windows: Spawn directly with CREATE_NO_WINDOW flag
        logger.info(`Launching: ${appPath} ${args.join(' ')}`);
        
        const child = spawn(appPath, args, {
          detached: true,
          stdio: 'ignore',
          windowsVerbatimArguments: false,
          windowsHide: false
        });
            
        child.unref();
      } else {
        logger.error(`Unsupported platform: ${platform}`);
        return false;
      }

      logger.success(`Launched application: ${appPath}`);
      return true;
    } catch (error) {
      logger.error(`Failed to launch ${appPath}`, error as Error);
      return false;
    }
  }
}
