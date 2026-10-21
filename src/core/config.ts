import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parseEnvConfig } from './env';

/**
 * Configuration interface
 */
export interface Config {
  /** API key for authentication (user's API key) */
  apiKey?: string;
  /** API base URL */
  apiUrl?: string;
  /** Output format preference */
  outputFormat?: 'json' | 'text';
  /** User key (from auth) */
  ukey?: string;
  /** User name (from auth) */
  name?: string;
}

/**
 * Get the config file path
 */
export function getConfigPath(): string {
  const configDir = path.join(os.homedir(), '.config', 'pgyer');
  return path.join(configDir, 'config.json');
}

/**
 * Ensure config directory exists
 */
function ensureConfigDir(): void {
  const configPath = getConfigPath();
  const configDir = path.dirname(configPath);

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
}

/**
 * Load config from file
 */
export function loadFileConfig(): Config {
  const configPath = getConfigPath();

  if (!fs.existsSync(configPath)) {
    return {};
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(content) as Config;
  } catch {
    return {};
  }
}

/**
 * Save config to file
 */
export function saveConfig(config: Config): void {
  ensureConfigDir();
  const configPath = getConfigPath();

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');

  // Set file permissions to 600 for security (owner read/write only)
  try {
    fs.chmodSync(configPath, 0o600);
  } catch {
    // Ignore permission errors on some systems
  }
}

/**
 * Load merged config with priority: CLI > env > file
 */
export function loadConfig(cliConfig: Config = {}): Config {
  const fileConfig = loadFileConfig();
  const envConfig = parseEnvConfig();

  return {
    ...fileConfig,
    ...envConfig,
    ...cliConfig,
  };
}

/**
 * Clear saved config
 */
export function clearConfig(): void {
  const configPath = getConfigPath();

  if (fs.existsSync(configPath)) {
    fs.unlinkSync(configPath);
  }
}

/**
 * Get the API key from config
 */
export function getApiKey(config: Config): string | undefined {
  return config.apiKey;
}

/**
 * PGYER API servers, tried in order. The later ones help when DNS for the main
 * domain is blocked or hijacked.
 */
export const DEFAULT_API_SERVERS: readonly string[] = [
  'https://www.pgyer.com',
  'https://www.xcxwo.com',
  'https://www.pgyerapp.com',
];

/**
 * Get the API servers to try: only the configured apiUrl when the user set
 * one, otherwise the default PGYER domains.
 */
export function getApiServers(config: Config): string[] {
  const custom = config.apiUrl?.trim().replace(/\/+$/, '');
  return custom ? [custom] : [...DEFAULT_API_SERVERS];
}

/**
 * Get the primary API URL
 */
export function getApiUrl(config: Config): string {
  return getApiServers(config)[0];
}
