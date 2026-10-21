import { loadConfig, createApiClient } from '../../core';
import { createLogger, isHuman, reportError } from '../../utils/logger';
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

export interface AppsListOptions {
  page?: string;
  all?: boolean;
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
function parsePage(value: string | undefined): number {
  if (value === undefined) return 1;
  const page = Number(value);
  if (!Number.isInteger(page) || page < 1) {
    throw new Error('--page must be a positive integer');
  }
  return page;
}

function normalizeApps(data: AppListResponse | AppItem[]): AppItem[] {
  return Array.isArray(data) ? data : (data.list ?? []);
}

export async function handleAppsList(options: AppsListOptions = {}): Promise<void> {
  const logger = createLogger();
  const spinner = createSpinner('Fetching apps...');

  try {
    const config = loadConfig();
    const api = createApiClient(config);

    if (options.all && options.page !== undefined) {
      throw new Error('--all and --page cannot be used together');
    }

    spinner.start();
    const firstPage = parsePage(options.page);
    let page = firstPage;
    let pagesFetched = 0;
    const rawApps: AppItem[] = [];
    const seen = new Set<string>();

    do {
      const data = await api.request<AppListResponse | AppItem[]>({
        method: 'POST',
        path: '/apiv2/app/listMy',
        params: { page },
      });
      pagesFetched += 1;
      const pageApps = normalizeApps(data);
      const newApps = pageApps.filter((app) => {
        const identity = app.appKey || app.buildKey;
        if (seen.has(identity)) return false;
        seen.add(identity);
        return true;
      });
      rawApps.push(...newApps);

      if (!options.all || pageApps.length === 0 || newApps.length === 0) break;
      page += 1;
      if (pagesFetched >= 100) {
        throw new Error('Stopped after 100 pages; use --page to continue explicitly');
      }
    } while (true);

    spinner.succeed(`Found ${rawApps.length} apps`);

    const apps = rawApps.map((app) => ({
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
      logger.json({ apps, page: firstPage, pagesFetched });
    }
  } catch (error) {
    spinner.fail('Failed to fetch apps');
    reportError(error);
    process.exit(1);
  }
}
