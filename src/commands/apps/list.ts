import { loadConfig, createApiClient, ApiError } from '../../core';
import { createLogger, isHuman } from '../../utils/logger';
import { createSpinner } from '../../utils/spinner';

interface AppItem {
  buildKey: string;
  buildType: string; // "1": iOS, "2": Android, "3": HarmonyOS
  buildFileSize: string;
  buildName: string;
  buildVersion: string;
  buildVersionNo: string;
  buildBuildVersion: string;
  buildIdentifier: string;
  buildIcon: string;
  buildCreated: string;
  appKey: string;
}

interface AppListResponse {
  list: AppItem[];
}

/**
 * Get platform name from buildType
 */
function getPlatformName(buildType: string): string {
  switch (buildType) {
    case '1':
      return 'iOS';
    case '2':
      return 'Android';
    case '3':
      return 'HarmonyOS';
    default:
      return 'Unknown';
  }
}

/**
 * Format file size to human readable
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
      method: 'POST',
      path: '/apiv2/app/listMy',
    });
    spinner.succeed(`Found ${data.list.length} apps`);

    const apps = data.list.map((app) => ({
      name: app.buildName,
      bundleId: app.buildIdentifier,
      version: app.buildVersion,
      appKey: app.appKey,
      type: getPlatformName(app.buildType),
      size: formatFileSize(parseInt(app.buildFileSize, 10)),
      createdAt: app.buildCreated,
    }));

    if (isHuman()) {
      logger.table(apps);
    } else {
      logger.json({ apps });
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
