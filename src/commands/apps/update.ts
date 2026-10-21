import { loadConfig, createApiClient } from '../../core';
import { AppSettingsError, updateAppSettings, type AppSettingsChange } from '../../core/apps';
import { createLogger, isHuman, reportError } from '../../utils/logger';
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

function parseEnum<T extends string>(
  value: string | undefined,
  values: Record<string, T>,
  name: string
): T | undefined {
  if (value === undefined) return undefined;
  const result = values[value];
  if (result === undefined) {
    throw new Error(`${name} must be one of: ${Object.keys(values).join(', ')}`);
  }
  return result;
}

function parseToggle(value: string | undefined, name: string): boolean | undefined {
  const result = parseEnum(value, { on: 'on', off: 'off' } as const, name);
  return result === undefined ? undefined : result === 'on';
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
    const installType = parseEnum(
      options.install,
      { public: 'public', password: 'password', invite: 'invite' } as const,
      '--install'
    );
    const change: AppSettingsChange = {
      shortcut: options.shortcut,
      installType,
      password: requestedPassword,
      validFrom: options.validFrom,
      validUntil: options.validUntil,
      noExpiry: options.expiry === false,
      language: parseEnum(options.language, { zh: 'zh', en: 'en', auto: 'auto' } as const, '--language'),
      versionSource: parseEnum(
        options.versionSource,
        { pgyer: 'pgyer', app: 'app' } as const,
        '--version-source'
      ),
      autoSync: parseToggle(options.autoSync, '--auto-sync'),
      showCopyright: parseToggle(options.copyright, '--copyright'),
    };
    const api = createApiClient(loadConfig());
    spinner.start('Fetching current app settings...');
    let result: { updated: string[]; dryRun: boolean };
    try {
      result = await updateAppSettings(api, appKey, change, {
        dryRun: options.dryRun,
        onStatus: (status) => spinner.text(status),
      });
    } catch (error) {
      if (error instanceof AppSettingsError) {
        throw new Error(error.code === 'PASSWORD_REQUIRED'
          ? 'Password installation requires --password or an existing password'
          : '--password can only be used with --install password');
      }
      throw error;
    }

    if (result.dryRun) {
      spinner.stop();
      logger.json({ dryRun: true, action: 'updateApp', appKey, updated: result.updated });
      return;
    }

    spinner.succeed('App settings updated');
    if (isHuman()) logger.success(`App ${appKey} updated successfully`);
    else {
      logger.json({ success: true, appKey, updated: result.updated });
    }
  } catch (error) {
    spinner.fail('Failed to update app settings');
    reportError(error);
    process.exit(1);
  }
}
