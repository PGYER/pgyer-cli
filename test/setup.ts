import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Get config file path
 */
export function getConfigPath(): string {
  return path.join(os.homedir(), '.config', 'pgyer', 'config.json');
}

/**
 * Backup existing config and return backup content (or null if no config)
 */
export function backupConfig(): string | null {
  const configPath = getConfigPath();
  if (fs.existsSync(configPath)) {
    return fs.readFileSync(configPath, 'utf-8');
  }
  return null;
}

/**
 * Restore config from backup
 */
export function restoreConfig(backup: string | null): void {
  const configPath = getConfigPath();
  const configDir = path.dirname(configPath);

  if (fs.existsSync(configPath)) {
    fs.unlinkSync(configPath);
  }

  if (backup !== null) {
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    fs.writeFileSync(configPath, backup, 'utf-8');
  }
}

/**
 * Clear config file
 */
export function clearTestConfig(): void {
  const configPath = getConfigPath();
  if (fs.existsSync(configPath)) {
    fs.unlinkSync(configPath);
  }
}

/**
 * Save test config
 */
export function saveTestConfig(config: Record<string, unknown>): void {
  const configPath = getConfigPath();
  const configDir = path.dirname(configPath);

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}

/**
 * Check if API key is available in environment
 */
export function hasApiKey(): boolean {
  return !!process.env.PGYER_API_KEY;
}

/**
 * Get API key from environment
 */
export function getApiKey(): string | undefined {
  return process.env.PGYER_API_KEY;
}

/**
 * Run CLI command and capture output
 */
export interface CliResult {
  stdout: string;
  stderr: string;
  code: number;
}

export function runCli(args: string[], envOverrides?: Record<string, string>): Promise<CliResult> {
  const { spawn } = require('child_process');
  const cliPath = path.resolve(__dirname, '../src/index.ts');

  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', cliPath, ...args], {
      env: { ...process.env, ...envOverrides },
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('close', (code: number | null) => {
      resolve({ stdout, stderr, code: code ?? 0 });
    });
  });
}
