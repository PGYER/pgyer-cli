import * as readline from 'readline';
import { loadConfig, createApiClient, ApiError } from '../../core';
import { createLogger } from '../../utils/logger';
import { createSpinner } from '../../utils/spinner';

/**
 * Prompt for confirmation
 */
function confirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stderr,
    });

    rl.question(`${message} (y/N): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

/**
 * Handle apps delete command
 */
export async function handleAppsDelete(appKey: string, force: boolean): Promise<void> {
  const logger = createLogger();
  const spinner = createSpinner('Deleting app...');

  try {
    // Confirm deletion unless --force
    if (!force && process.stdin.isTTY) {
      const confirmed = await confirm(
        `Are you sure you want to delete app "${appKey}"?`
      );
      if (!confirmed) {
        logger.error('Cancelled');
        process.exit(1);
      }
    }

    const config = loadConfig();
    const api = createApiClient(config);

    spinner.start();
    await api.request({
      method: 'POST',
      path: '/apiv2/app/delete',
      params: { appKey },
    });
    spinner.succeed('App deleted');

    logger.json({ success: true });
  } catch (error) {
    spinner.fail('Failed to delete app');
    if (error instanceof ApiError) {
      logger.error(`[${error.code}] ${error.message}`);
    } else {
      const message =
        error instanceof Error ? error.message : 'Unknown error';
      logger.error(message);
    }
    process.exit(1);
  }
}
