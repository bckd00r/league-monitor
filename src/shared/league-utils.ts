import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import YAML from 'yaml';
import { LeagueInstallation } from './types.js';
import { Logger } from './logger.js';

const logger = new Logger('LeagueUtils');

export class LeagueUtils {
  /**
   * Get League of Legends installation path
   */
  static async getInstallPath(): Promise<string | null> {
    const platform = process.platform;

    try {
      if (platform === 'darwin') {
        // macOS: Try YAML file first
        const yamlPath = '/Users/Shared/Riot Games/Metadata/league_of_legends.live/league_of_legends.live.product_settings.yaml';
        
        if (existsSync(yamlPath)) {
          const content = await readFile(yamlPath, 'utf-8');
          const data = YAML.parse(content);
          const installPath = data.product_install_full_path;
          
          if (installPath) {
            const fullPath = join(installPath, 'Contents', 'LoL');
            logger.info(`Found League installation via YAML: ${fullPath}`);
            return fullPath;
          }
        }

        // Fallback to default macOS path
        const defaultPath = '/Applications/League of Legends.app/Contents/LoL';
        if (existsSync(defaultPath)) {
          logger.info(`Using default macOS path: ${defaultPath}`);
          return defaultPath;
        }
      } else if (platform === 'win32') {
        // Windows: Try YAML file first
        const appData = process.env.PROGRAMDATA || 'C:\\ProgramData';
        const yamlPath = join(appData, 'Riot Games', 'Metadata', 'league_of_legends.live', 'league_of_legends.live.product_settings.yaml');

        if (existsSync(yamlPath)) {
          const content = await readFile(yamlPath, 'utf-8');
          const data = YAML.parse(content);
          const installPath = data.product_install_full_path;
          
          if (installPath) {
            logger.info(`Found League installation via YAML: ${installPath}`);
            return installPath;
          }
        }

        // Fallback to default Windows path
        const defaultPath = 'C:\\Riot Games\\League of Legends';
        if (existsSync(defaultPath)) {
          logger.info(`Using default Windows path: ${defaultPath}`);
          return defaultPath;
        }
      }

      logger.error('Could not find League of Legends installation');
      return null;
    } catch (error) {
      logger.error('Failed to get install path', error as Error);
      return null;
    }
  }

  /**
   * Get Riot Client executable path
   */
  static async getRiotClientPath(): Promise<string | null> {
    const platform = process.platform;

    try {
      if (platform === 'darwin') {
        // macOS: RiotClientServices is inside the app bundle
        const appPath = '/Applications/Riot Client.app';
        if (existsSync(appPath)) {
          return appPath;
        }
      } else if (platform === 'win32') {
        // Windows: Check RiotClientInstalls.json
        const appData = process.env.PROGRAMDATA || 'C:\\ProgramData';
        const installsPath = join(appData, 'Riot Games', 'RiotClientInstalls.json');

        if (existsSync(installsPath)) {
          try {
            const content = await readFile(installsPath, 'utf-8');
            // Clean content: remove BOM, trim whitespace, and handle trailing commas
            const cleanedContent = content.trim().replace(/^\uFEFF/, '').replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
            
            // Try to find valid JSON (in case there are comments or extra content)
            const jsonMatch = cleanedContent.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
              throw new Error('No valid JSON found in file');
            }
            
            const data = JSON.parse(jsonMatch[0]);
            
            // Try different paths
            const paths = [
              data.rc_default,
              data.rc_live,
              data.rc_beta
            ];

            for (const path of paths) {
              if (path && existsSync(path)) {
                logger.info(`Found Riot Client: ${path}`);
                return path;
              }
            }
          } catch (parseError) {
            logger.warn(`Failed to parse RiotClientInstalls.json: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`);
            // Continue to fallback path
          }
        }

        // Fallback
        const defaultPath = 'C:\\Riot Games\\Riot Client\\RiotClientServices.exe';
        if (existsSync(defaultPath)) {
          return defaultPath;
        }
      }

      logger.error('Could not find Riot Client');
      return null;
    } catch (error) {
      logger.error('Failed to get Riot Client path', error as Error);
      return null;
    }
  }

  /**
   * Get League Client process name based on platform
   */
  static getLeagueClientProcessName(): string {
    return process.platform === 'darwin' ? 'LeagueClient' : 'LeagueClient';
  }

  /**
   * Get League Game process name based on platform
   */
  static getLeagueGameProcessName(): string {
    return process.platform === 'darwin' ? 'League Of Legends' : 'League Of Legends';
  }

  /**
   * Launch League Client with arguments
   */
  static async launchLeagueClient(args: string[] = []): Promise<boolean> {
    const clientPath = await this.getRiotClientPath();
    
    if (!clientPath) {
      logger.error('Cannot launch client: path not found');
      return false;
    }

    // Default args for launching League
    const defaultArgs = [
      '--launch-product=league_of_legends',
      '--launch-patchline=live',
      '--allow-multiple-clients'
    ];

    const allArgs = [...defaultArgs, ...args];

    const { ProcessUtils } = await import('./process-utils.js');
    return ProcessUtils.launchApp(clientPath, allArgs);
  }
}
