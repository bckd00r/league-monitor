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
   * If processName already includes .exe, it won't be added again
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
        // If processName already has .exe, use it as is; otherwise add .exe
        const processNameExe = processName.toLowerCase().endsWith('.exe') 
          ? processName 
          : `${processName}.exe`;
        const { stdout } = await execAsync(`tasklist /FI "IMAGENAME eq ${processNameExe}" /NH`);
        return stdout.toLowerCase().includes(processNameExe.toLowerCase());
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
        // If processName already has .exe, use it as is; otherwise add .exe
        const processNameExe = processName.toLowerCase().endsWith('.exe') 
          ? processName 
          : `${processName}.exe`;
        const result = await execAsync(
          `wmic process where "name='${processNameExe}'" get ProcessId /value`
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
   * Kill all processes by multiple possible names (tries all until one works)
   * Useful for processes with varying capitalizations or extensions
   */
  static async killProcessByMultipleNames(processNames: string[]): Promise<number> {
    let totalKilled = 0;

    for (const processName of processNames) {
      const killed = await this.killProcessByName(processName);
      totalKilled += killed;
    }

    return totalKilled;
  }

  /**
   * Check if any of the given process names is running
   * Returns true if at least one process name is found running
   */
  static async isAnyProcessRunning(processNames: string[]): Promise<boolean> {
    for (const processName of processNames) {
      const isRunning = await this.isProcessRunning(processName);
      if (isRunning) {
        return true;
      }
    }
    return false;
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
        // For "League of Legends", use process name patterns (most reliable method)
        if (description === 'League of Legends' || description.toLowerCase().includes('league')) {
          // Method A: Use getProcessPids (most reliable)
          try {
            const leagueProcessNames = ['LeagueClient', 'LeagueClientUx', 'LeagueClientUxRender'];
            let totalCount = 0;
            
            for (const procName of leagueProcessNames) {
              const pids = await this.getProcessPids(procName);
              totalCount += pids.length;
              if (pids.length > 0) {
                logger.info(`Found ${pids.length} ${procName} process(es)`);
              }
            }
            
            if (totalCount > 0) {
              logger.info(`Total League process count: ${totalCount} (by process name patterns)`);
              return totalCount;
            }
          } catch (error) {
            logger.warn(`Process name pattern method failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }

          // Method B: Use tasklist for each process separately (most reliable, works on all Windows)
          try {
            const leagueProcessNames = ['LeagueClient.exe', 'LeagueClientUx.exe', 'LeagueClientUxRender.exe'];
            let totalCount = 0;
            
            for (const procName of leagueProcessNames) {
              try {
                const { stdout } = await execAsync(`tasklist /FI "IMAGENAME eq ${procName}" /FO CSV /NH`);
                
                // Parse CSV output - count non-empty lines (excluding header)
                const lines = stdout.trim().split('\n').filter(line => {
                  const trimmed = line.trim();
                  // CSV format: "ProcessName","PID","SessionName","Session#","MemUsage"
                  // Check if line contains the process name and has content
                  return trimmed.length > 0 && 
                         trimmed.includes(`"${procName.replace('.exe', '')}"`) &&
                         trimmed.includes('"');
                });
                
                totalCount += lines.length;
                if (lines.length > 0) {
                  logger.info(`Found ${lines.length} ${procName} process(es) via tasklist`);
                }
              } catch (error) {
                // Try alternative tasklist format if CSV fails
                try {
                  const { stdout } = await execAsync(`tasklist /FI "IMAGENAME eq ${procName}" /NH`);
                  const lines = stdout.split('\n').filter(line => {
                    const upperLine = line.toUpperCase().trim();
                    // Check if line contains process name (case-insensitive)
                    return upperLine.length > 0 && 
                           upperLine.includes(procName.toUpperCase().replace('.EXE', ''));
                  });
                  totalCount += lines.length;
                  if (lines.length > 0) {
                    logger.info(`Found ${lines.length} ${procName} process(es) via tasklist (format 2)`);
                  }
                } catch (error2) {
                  // Skip this process if both formats fail
                  logger.warn(`Failed to count ${procName}: ${error2 instanceof Error ? error2.message : 'Unknown'}`);
                }
              }
            }
            
            if (totalCount > 0) {
              logger.info(`Total League process count: ${totalCount} (by tasklist)`);
              return totalCount;
            }
          } catch (error) {
            logger.warn(`Tasklist method failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }

          // Method C: Try PowerShell Get-Process (Windows 10+, alternative)
          try {
            const { stdout } = await execAsync(
              `powershell -Command "Get-Process | Where-Object {$_.ProcessName -like 'LeagueClient*'} | Measure-Object | Select-Object -ExpandProperty Count"`
            );
            const count = parseInt(stdout.trim());
            if (!isNaN(count) && count > 0) {
              logger.info(`Total League process count: ${count} (by PowerShell Get-Process)`);
              return count;
            }
          } catch (error) {
            // PowerShell might not be available on older Windows
          }

          // Method D: Simple tasklist all processes and filter (most compatible)
          try {
            const { stdout } = await execAsync('tasklist /FO LIST');
            
            // Count processes that match League process names
            const lines = stdout.split('\n');
            let count = 0;
            let currentProcess = '';
            
            for (const line of lines) {
              if (line.includes('Image Name:')) {
                const match = line.match(/Image Name:\s*(.+)/i);
                if (match) {
                  currentProcess = match[1].trim().toLowerCase();
                }
              } else if (line.includes('PID:')) {
                // If we're tracking a League process, count it
                if (currentProcess === 'leagueclient.exe' || 
                    currentProcess === 'leagueclientux.exe' || 
                    currentProcess === 'leagueclientuxrender.exe') {
                  count++;
                  currentProcess = ''; // Reset to avoid double counting
                }
              }
            }
            
            if (count > 0) {
              logger.info(`Total League process count: ${count} (by tasklist /FO LIST)`);
              return count;
            }
          } catch (error) {
            logger.warn(`Tasklist LIST method failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
        }

        // Try other methods for other descriptions
        // Method 1: Try by Description
        try {
          const { stdout: descStdout } = await execAsync(
            `wmic process where "Description='${description}'" get ProcessId /value`
          );
          const descLines = descStdout.trim().split('\n').filter(line => line.includes('ProcessId='));
          if (descLines.length > 0) {
            logger.info(`Found ${descLines.length} process(es) with Description="${description}"`);
            return descLines.length;
          }
        } catch (error) {
          // Description method failed, try next
        }

        // Method 2: Try by ProductName
        try {
          const { stdout: productStdout } = await execAsync(
            `wmic process where "ProductName='${description}'" get ProcessId /value`
          );
          const productLines = productStdout.trim().split('\n').filter(line => line.includes('ProcessId='));
          if (productLines.length > 0) {
            logger.info(`Found ${productLines.length} process(es) with ProductName="${description}"`);
            return productLines.length;
          }
        } catch (error) {
          // ProductName method failed
        }

        logger.warn(`No processes found with description/product "${description}"`);
        return 0;
      } else if (platform === 'darwin') {
        // macOS: Not easily supported, return 0
        logger.warn('getProcessCountByDescription is not supported on macOS');
        return 0;
      } else {
        logger.warn(`Unsupported platform: ${platform}`);
        return 0;
      }
    } catch (error) {
      // If all methods fail, log it for debugging
      logger.warn(`Failed to get process count for "${description}": ${error instanceof Error ? error.message : 'Unknown error'}`);
      return 0;
    }
  }

  /**
   * Check VGC service exit code
   * Returns true if SERVICE_EXIT_CODE is 185 (0xb9)
   * Windows only
   */
  static async checkVgcServiceExitCode185(): Promise<boolean> {
    try {
      const platform = process.platform;

      if (platform !== 'win32') {
        // Only supported on Windows
        return false;
      }

      // Query VGC service status using sc queryex
      const { stdout } = await execAsync('sc queryex vgc');
      
      // Parse SERVICE_EXIT_CODE from output
      // Format: SERVICE_EXIT_CODE  : 185  (0xb9)
      const exitCodeMatch = stdout.match(/SERVICE_EXIT_CODE\s*:\s*(\d+)/i);
      
      if (exitCodeMatch) {
        const exitCode = parseInt(exitCodeMatch[1]);
        const isExitCode185 = exitCode === 185;
        
        if (isExitCode185) {
          logger.warn(`VGC service exit code is 185 (0xb9) - service error detected`);
        }
        
        return isExitCode185;
      }

      // If exit code not found in output, return false
      return false;
    } catch (error) {
      // Service query failed or service not found
      logger.warn(`Failed to query VGC service: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return false;
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
