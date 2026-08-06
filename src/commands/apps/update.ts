import { loadConfig, createApiClient, ApiError } from '../../core';
import { createLogger, isHuman } from '../../utils/logger';
import { createSpinner } from '../../utils/spinner';

export interface AppsUpdateOptions {
  shortcut?: string;
  install?: string;
  password?: string;
  validFrom?: string;
  validUntil?: string;
  expiry?: boolean;
  language?: string;
  versionSource?: string;
  autoSync?: string;
  copyright?: string;
  passwordEnv?: string;
  dryRun?: boolean;
}

interface CurrentAppSettings {
  buildInstallType?: number | string;
  buildPassword?: string;
  buildShortcutUrl?: string;
  appIsInstallDate?: number | string;
  appInstallStartDate?: string;
  appInstallEndDate?: string;
  appLang?: number | string;
  buildVersionType?: number | string;
  appAutoSync?: number | string;
  appShowPgyerCopyright?: number | string;
}

function parseEnum(value: string | undefined, values: Record<string, number>, name: string): number | undefined {
  if (value === undefined) return undefined;
  const result = values[value];
  if (result === undefined) {
    throw new Error(`${name} must be one of: ${Object.keys(values).join(', ')}`);
  }
  return result;
}

function parseToggle(value: string | undefined, name: string): number | undefined {
  return parseEnum(value, { on: 1, off: 2 }, name);
}

function validateDate(value: string, name: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`${name} must use YYYY-MM-DD format`);
  }
}

export async function handleAppsUpdate(appKey: string, options: AppsUpdateOptions): Promise<void> {
  const logger = createLogger();
  const spinner = createSpinner('Updating app settings...');
  try {
    const hasChange = [
      options.shortcut,
      options.install,
      options.password,
      options.validFrom,
      options.validUntil,
      options.language,
      options.versionSource,
      options.autoSync,
      options.copyright,
      options.passwordEnv,
    ].some((value) => value !== undefined) || options.expiry === false;
    if (!hasChange) throw new Error('At least one app setting option is required');
    if ((options.validFrom && !options.validUntil) || (!options.validFrom && options.validUntil)) {
      throw new Error('--valid-from and --valid-until must be used together');
    }
    if (options.validFrom && options.validUntil) {
      validateDate(options.validFrom, '--valid-from');
      validateDate(options.validUntil, '--valid-until');
      if (options.validUntil <= options.validFrom) {
        throw new Error('--valid-until must be greater than --valid-from');
      }
    }
    if (options.expiry === false && options.validFrom) {
      throw new Error('--no-expiry cannot be combined with validity dates');
    }
    if (options.password !== undefined && options.passwordEnv !== undefined) {
      throw new Error('--password and --password-env cannot be used together');
    }

    const passwordEnvName = options.passwordEnv || 'PGYER_INSTALL_PASSWORD';
    const envPassword = options.passwordEnv !== undefined
      ? process.env[passwordEnvName]
      : undefined;
    if (options.passwordEnv !== undefined && !envPassword) {
      throw new Error(`Environment variable ${passwordEnvName} is empty or not set`);
    }
    const requestedPassword = options.password ?? envPassword;
    const api = createApiClient(loadConfig());
    spinner.start('Fetching current app settings...');
    const current = await api.request<CurrentAppSettings>({
      method: 'POST',
      path: '/apiv2/app/view',
      params: { appKey },
    });

    const requestedInstallType = parseEnum(
      options.install,
      { public: 1, password: 2, invite: 3 },
      '--install'
    );
    const buildInstallType = requestedInstallType
      ?? (requestedPassword !== undefined ? 2 : Number(current.buildInstallType ?? 1));
    const buildPassword = requestedPassword !== undefined
      ? requestedPassword
      : (buildInstallType === 2 ? current.buildPassword : '');
    if (buildInstallType === 2 && !buildPassword) {
      throw new Error('Password installation requires --password or an existing password');
    }
    if (requestedPassword !== undefined && buildInstallType !== 2) {
      throw new Error('--password can only be used with --install password');
    }

    const appIsInstallDate = options.expiry === false
      ? 2
      : (options.validFrom ? 1 : Number(current.appIsInstallDate ?? 2));

    const updateParams = {
        appKey,
        buildShortcutUrl: options.shortcut ?? current.buildShortcutUrl,
        buildInstallType,
        buildPassword,
        appIsInstallDate,
        appInstallStartDate: options.validFrom ?? current.appInstallStartDate,
        appInstallEndDate: options.validUntil ?? current.appInstallEndDate,
        appLang: parseEnum(options.language, { zh: 1, en: 2, auto: 3 }, '--language')
          ?? current.appLang,
        buildVersionType: parseEnum(
          options.versionSource,
          { pgyer: 1, app: 2 },
          '--version-source'
        ) ?? current.buildVersionType,
        appAutoSync: parseToggle(options.autoSync, '--auto-sync') ?? current.appAutoSync,
        appShowPgyerCopyright: parseToggle(options.copyright, '--copyright')
          ?? current.appShowPgyerCopyright,
    };

    const updated = [
      options.shortcut !== undefined ? 'shortcut' : undefined,
      options.install !== undefined || requestedPassword !== undefined ? 'installation' : undefined,
      options.validFrom !== undefined || options.expiry === false ? 'validity' : undefined,
      options.language !== undefined ? 'language' : undefined,
      options.versionSource !== undefined ? 'versionSource' : undefined,
      options.autoSync !== undefined ? 'autoSync' : undefined,
      options.copyright !== undefined ? 'copyright' : undefined,
    ].filter((value): value is string => value !== undefined);

    if (options.dryRun) {
      spinner.stop();
      logger.json({ dryRun: true, action: 'updateApp', appKey, updated });
      return;
    }

    spinner.text('Updating app settings...');
    await api.request<Record<string, unknown>>({
      method: 'POST',
      path: '/apiv2/app/update',
      params: updateParams,
    });
    spinner.succeed('App settings updated');
    if (isHuman()) logger.success(`App ${appKey} updated successfully`);
    else {
      logger.json({ success: true, appKey, updated });
    }
  } catch (error) {
    spinner.fail('Failed to update app settings');
    if (error instanceof ApiError) logger.error(`[${error.code}] ${error.message}`);
    else logger.error(error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}
