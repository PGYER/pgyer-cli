import { loadConfig, createApiClient, ApiError } from '../../core';
import { createLogger } from '../../utils/logger';
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

function normalizeShortcut(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) throw new Error('Shortcut cannot be empty');
  if (/^https?:\/\//i.test(trimmed)) {
    const url = new URL(trimmed);
    const shortcut = url.pathname.split('/').filter(Boolean).pop();
    if (!shortcut) throw new Error('The URL does not contain an app shortcut');
    return shortcut;
  }
  return trimmed.split('/').filter(Boolean).pop() ?? trimmed;
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
    if (error instanceof ApiError) logger.error(`[${error.code}] ${error.message}`);
    else logger.error(error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}
