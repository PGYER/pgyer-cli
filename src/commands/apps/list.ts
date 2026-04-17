import { loadConfig, createApiClient, ApiError } from '../../core';
import { createLogger } from '../../utils/logger';
import { createSpinner } from '../../utils/spinner';

interface AppItem {
  buildKey: string;
  buildName: string;
  buildBundleId: string;
  appKey: string;
}

interface AppListResponse {
  list: AppItem[];
}

/**
 * Handle apps list command
 */
export async function handleAppsList(): Promise<void> {
  const logger = createLogger();
  const spinner = createSpinner('Fetching apps...');

  try {
    const config = loadConfig();
    const api = createApiClient(config);

    spinner.start();
    const data = await api.request<AppListResponse>({
      method: 'GET',
      path: '/apiv2/app/list',
    });
    spinner.succeed(`Found ${data.list.length} apps`);

    const apps = data.list.map((app: AppItem) => ({
      name: app.buildName,
      bundleId: app.buildBundleId,
      appKey: app.appKey,
    }));

    logger.json({ apps });

    if (process.stdout.isTTY) {
      logger.table(apps);
    }
  } catch (error) {
    spinner.fail('Failed to fetch apps');
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
