import { loadConfig, createApiClient } from '../../core';
import { createLogger, isHuman, reportError } from '../../utils/logger';
import { createSpinner } from '../../utils/spinner';

interface AppDetail {
  buildKey: string;
  buildType: string; // "1": iOS, "2": Android, "3": HarmonyOS
  buildName: string;
  buildVersion: string;
  buildVersionNo: string;
  buildBuildVersion: string;
  buildIdentifier: string;
  buildIcon: string;
  buildFileSize: string;
  buildCreated: string;
  buildUpdated: string;
  buildShortcutUrl: string;
  buildInstallType: string;
  buildPassword?: string;
  buildDescription?: string;
  buildUpdateDescription?: string;
  appKey: string;
  iconUrl: string;
  buildQRCodeURL: string;
  appExpiredDate: string;
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
 * Get install type description
 */
function getInstallType(type: string): string {
  switch (type) {
    case '1':
      return 'Public';
    case '2':
      return 'Password';
    case '3':
      return 'Invite';
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
 * Handle apps info command
 */
export async function handleAppsInfo(appKey: string, buildKey?: string): Promise<void> {
  const logger = createLogger();
  const spinner = createSpinner('Fetching app info...');

  try {
    const config = loadConfig();
    const api = createApiClient(config);

    spinner.start();
    const data = await api.request<AppDetail>({
      method: 'POST',
      path: '/apiv2/app/view',
      params: { appKey, buildKey },
    });
    spinner.succeed('App info retrieved');

    const info = {
      name: data.buildName,
      bundleId: data.buildIdentifier,
      appKey: data.appKey,
      version: data.buildVersion,
      buildVersion: data.buildBuildVersion,
      type: getPlatformName(data.buildType),
      size: formatFileSize(parseInt(data.buildFileSize, 10)),
      shortcut: data.buildShortcutUrl,
      installType: getInstallType(data.buildInstallType),
      createdAt: data.buildCreated,
      updatedAt: data.buildUpdated,
      expiredAt: data.appExpiredDate,
    };

    if (isHuman()) {
      console.log(
        `App: ${data.buildName} (${data.buildIdentifier})\n` +
          `  App Key:     ${data.appKey}\n` +
          `  Version:     ${data.buildVersion} (Build ${data.buildBuildVersion})\n` +
          `  Platform:    ${getPlatformName(data.buildType)}\n` +
          `  Size:        ${formatFileSize(parseInt(data.buildFileSize, 10))}\n` +
          `  Shortcut:    ${data.buildShortcutUrl}\n` +
          `  Install:     ${getInstallType(data.buildInstallType)}\n` +
          `  Created:     ${data.buildCreated}\n` +
          `  Updated:     ${data.buildUpdated}\n` +
          `  Expires:     ${data.appExpiredDate}`
      );
    } else {
      logger.json(info);
    }
  } catch (error) {
    spinner.fail('Failed to fetch app info');
    reportError(error);
    process.exit(1);
  }
}
