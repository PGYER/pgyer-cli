import { loadConfig, createApiClient } from '../../core';
import { normalizeShortcut } from '../../core/apps';
import { createLogger, reportError } from '../../utils/logger';
import { createSpinner } from '../../utils/spinner';

interface ShortcutApp {
  buildKey: string;
  buildType: number | string;
  buildFileName: string;
  buildFileSize: number | string;
  buildName: string;
  buildVersion: string;
  buildVersionNo: string;
  buildBuildVersion: number | string;
  buildIdentifier: string;
  buildCreated: string;
  buildDescription?: string;
  buildUpdateDescription?: string;
  buildShortcutUrl: string;
}

export async function handleAppsResolve(shortcutInput: string): Promise<void> {
  const logger = createLogger();
  const spinner = createSpinner('Resolving app shortcut...');
  try {
    const shortcut = normalizeShortcut(shortcutInput);
    const api = createApiClient(loadConfig());
    spinner.start();
    const data = await api.request<ShortcutApp>({
      method: 'POST',
      path: '/apiv2/app/getByShortcut',
      params: { buildShortcutUrl: shortcut },
    });
    spinner.succeed('App shortcut resolved');

    const output = {
      name: data.buildName,
      bundleId: data.buildIdentifier,
      version: data.buildVersion,
      versionNo: data.buildVersionNo,
      buildVersion: data.buildBuildVersion,
      buildKey: data.buildKey,
      shortcut: data.buildShortcutUrl,
      fileName: data.buildFileName,
      fileSize: data.buildFileSize,
      createdAt: data.buildCreated,
      description: data.buildDescription,
      updateDescription: data.buildUpdateDescription,
    };
    logger.json(output);
  } catch (error) {
    spinner.fail('Failed to resolve app shortcut');
    reportError(error);
    process.exit(1);
  }
}
