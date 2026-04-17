import { loadConfig, createApiClient, ApiError } from '../../core';
import { createLogger } from '../../utils/logger';
import { createSpinner } from '../../utils/spinner';

interface AppDetail {
  buildKey: string;
  buildName: string;
  buildBundleId: string;
  buildVersion: string;
  buildBuildVersion: string;
  appKey: string;
  buildCount?: number;
}

/**
 * Handle apps info command
 */
export async function handleAppsInfo(appKey: string): Promise<void> {
  const logger = createLogger();
  const spinner = createSpinner('Fetching app info...');

  try {
    const config = loadConfig();
    const api = createApiClient(config);

    spinner.start();
    const data = await api.request<AppDetail>({
      method: 'GET',
      path: '/apiv2/app/view',
      params: { appKey },
    });
    spinner.succeed('App info retrieved');

    logger.json({
      name: data.buildName,
      bundleId: data.buildBundleId,
      appKey: data.appKey,
      version: data.buildVersion,
      buildVersion: data.buildBuildVersion,
      buildCount: data.buildCount,
    });

    if (process.stdout.isTTY) {
      console.log(
        `App: ${data.buildName} (${data.buildBundleId})\n` +
          `  App Key:   ${data.appKey}\n` +
          `  Version:   ${data.buildVersion} (Build ${data.buildBuildVersion})\n` +
          `  Builds:    ${data.buildCount ?? 'N/A'}`
      );
    }
  } catch (error) {
    spinner.fail('Failed to fetch app info');
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
