import { type CAC } from 'cac';
import { loadConfig, createApiClient, ApiError } from '../../core';
import { createLogger, isHuman } from '../../utils/logger';
import { createSpinner } from '../../utils/spinner';
import { confirmDestructiveAction } from '../../utils/confirm';

interface VersionItem {
  buildKey: string;
  buildType: number | string;
  buildFileSize: number | string;
  buildName: string;
  buildVersion: string;
  buildVersionNo: string;
  buildBuildVersion: number | string;
  buildIdentifier: string;
  buildCreated: string;
}

interface VersionPage {
  pageCount: number | string;
  currentPage: number | string;
  list: VersionItem[];
}

interface VersionOptions {
  page?: string;
  all?: boolean;
  force?: boolean;
  currentVersion?: string;
  buildVersion?: string;
  channel?: string;
  dryRun?: boolean;
}

function parsePage(value: string | undefined): number {
  if (value === undefined) return 1;
  const page = Number(value);
  if (!Number.isInteger(page) || page < 1) {
    throw new Error('--page must be a positive integer');
  }
  return page;
}

function formatFileSize(value: number | string): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return String(value);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function listVersions(appKey: string, options: VersionOptions): Promise<void> {
  if (options.all && options.page !== undefined) {
    throw new Error('--all and --page cannot be used together');
  }
  const api = createApiClient(loadConfig());
  const firstPage = parsePage(options.page);
  const pages: VersionPage[] = [];
  let page = firstPage;

  do {
    const data = await api.request<VersionPage>({
      method: 'POST',
      path: '/apiv2/app/builds',
      params: { appKey, page },
    });
    pages.push(data);
    const pageCount = Number(data.pageCount) || page;
    if (!options.all || page >= pageCount) break;
    page += 1;
  } while (true);

  const versions = pages.flatMap((item) => item.list ?? []).map((item) => ({
    name: item.buildName,
    version: item.buildVersion,
    versionNo: item.buildVersionNo,
    buildVersion: item.buildBuildVersion,
    buildKey: item.buildKey,
    bundleId: item.buildIdentifier,
    size: formatFileSize(item.buildFileSize),
    createdAt: item.buildCreated,
  }));
  const logger = createLogger();
  if (isHuman()) logger.table(versions);
  else logger.json({ versions, page: firstPage, pagesFetched: pages.length });
}

async function mutateLatest(
  buildKey: string,
  setLatest: boolean,
  dryRun: boolean = false
): Promise<void> {
  const logger = createLogger();
  if (dryRun) {
    logger.json({
      dryRun: true,
      action: setLatest ? 'setLatest' : 'unsetLatest',
      buildKey,
    });
    return;
  }
  const api = createApiClient(loadConfig());
  await api.request({
    method: 'POST',
    path: setLatest ? '/apiv2/app/setNewestVersion' : '/apiv2/app/cancelNewestVersion',
    params: { buildKey },
  });
  const action = setLatest ? 'set as latest' : 'removed from latest';
  if (isHuman()) logger.success(`Version ${buildKey} ${action}`);
  else logger.json({ success: true, buildKey, latest: setLatest });
}

async function checkVersion(appKey: string, options: VersionOptions): Promise<void> {
  const buildBuildVersion = options.buildVersion === undefined
    ? undefined
    : Number(options.buildVersion);
  if (buildBuildVersion !== undefined && (!Number.isInteger(buildBuildVersion) || buildBuildVersion < 0)) {
    throw new Error('--build-version must be a non-negative integer');
  }
  const api = createApiClient(loadConfig());
  const data = await api.request<Record<string, unknown>>({
    method: 'POST',
    path: '/apiv2/app/check',
    params: {
      appKey,
      buildVersion: options.currentVersion,
      buildBuildVersion,
      channelKey: options.channel,
    },
  });
  const { downloadURL: _downloadURL, ...safeData } = data;
  createLogger().json(safeData);
}

async function deleteVersion(
  buildKey: string,
  force: boolean,
  dryRun: boolean = false
): Promise<void> {
  if (dryRun) {
    createLogger().json({ dryRun: true, action: 'deleteVersion', buildKey });
    return;
  }
  await confirmDestructiveAction(
    `Permanently delete version "${buildKey}"?`,
    force
  );
  const api = createApiClient(loadConfig());
  await api.request({
    method: 'POST',
    path: '/apiv2/app/buildDelete',
    params: { buildKey },
  });
  const logger = createLogger();
  if (isHuman()) logger.success('Version deleted successfully');
  else logger.json({ success: true, buildKey });
}

export function registerVersionCommands(cli: CAC): void {
  cli
    .command('versions:list <appKey>', 'List historical app versions')
    .usage('versions list <appKey> [options]')
    .option('--page <number>', 'Page number')
    .option('--all', 'Fetch all pages')
    .action(async (appKey: string, options: VersionOptions) => {
      try {
        await listVersions(appKey, options);
      } catch (error) {
        handleVersionError(error);
      }
    });

  cli
    .command('versions:set-latest <buildKey>', 'Set a build as the latest version')
    .usage('versions set-latest <buildKey> [options]')
    .option('--dry-run', 'Show the change without modifying the app')
    .action(async (buildKey: string, options: VersionOptions) => {
      try {
        await mutateLatest(buildKey, true, options.dryRun);
      } catch (error) {
        handleVersionError(error);
      }
    });

  cli
    .command('versions:unset-latest <buildKey>', 'Remove the latest-version flag from a build')
    .usage('versions unset-latest <buildKey> [options]')
    .option('--dry-run', 'Show the change without modifying the app')
    .action(async (buildKey: string, options: VersionOptions) => {
      try {
        await mutateLatest(buildKey, false, options.dryRun);
      } catch (error) {
        handleVersionError(error);
      }
    });

  cli
    .command('versions:check <appKey>', 'Check whether an app has a newer version')
    .usage('versions check <appKey>')
    .option('--current-version <version>', 'Current app version for update checks')
    .option('--build-version <number>', 'Current PGYER build version for update checks')
    .option('--channel <key>', 'Channel key for update checks')
    .action(async (appKey: string, options: VersionOptions) => {
      try {
        await checkVersion(appKey, options);
      } catch (error) {
        handleVersionError(error);
      }
    });

  cli
    .command('versions:delete <buildKey>', 'Permanently delete an app version')
    .usage('versions delete <buildKey> [options]')
    .option('-f, --force', 'Skip destructive action confirmation')
    .option('--dry-run', 'Show the deletion plan without deleting the version')
    .action(async (buildKey: string, options: VersionOptions) => {
      try {
        await deleteVersion(
          buildKey,
          options.force ?? false,
          options.dryRun ?? false
        );
      } catch (error) {
        handleVersionError(error);
      }
    });
}

function handleVersionError(error: unknown): never {
  const spinner = createSpinner('Version command failed');
  spinner.fail('Version command failed');
  const logger = createLogger();
  if (error instanceof ApiError) logger.error(`[${error.code}] ${error.message}`);
  else logger.error(error instanceof Error ? error.message : 'Unknown error');
  process.exit(1);
}
