import { loadConfig, createApiClient } from '../../core';
import { createLogger, isHuman, reportError } from '../../utils/logger';
import { createSpinner } from '../../utils/spinner';
import { confirmDestructiveAction } from '../../utils/confirm';

/**
 * Handle apps delete command
 */
export async function handleAppsDelete(
  appKey: string,
  force: boolean,
  dryRun: boolean = false
): Promise<void> {
  const logger = createLogger();
  const spinner = createSpinner('Deleting app...');

  try {
    if (dryRun) {
      const plan = { dryRun: true, action: 'deleteApp', appKey, deletesAllVersions: true };
      if (isHuman()) logger.json(plan);
      else logger.json(plan);
      return;
    }
    await confirmDestructiveAction(
      `Permanently delete app "${appKey}" and all of its versions?`,
      force
    );

    const config = loadConfig();
    const api = createApiClient(config);

    spinner.start();
    await api.request({
      method: 'POST',
      path: '/apiv2/app/deleteApp',
      params: { appKey },
    });
    spinner.succeed('App deleted');

    if (isHuman()) {
      logger.success('App deleted successfully');
    } else {
      logger.json({ success: true });
    }
  } catch (error) {
    spinner.fail('Failed to delete app');
    reportError(error);
    process.exit(1);
  }
}
