import { type ApiClient } from './api';

/** Platform name for PGYER's buildType ("1" iOS, "2" Android, "3" HarmonyOS). */
export function platformName(buildType: unknown): 'iOS' | 'Android' | 'HarmonyOS' | 'Unknown' {
  switch (String(buildType)) {
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

/** Accepts a shortcut, a path or a full PGYER URL and returns the shortcut. */
export function normalizeShortcut(value: string): string {
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

interface AppListItem {
  appKey?: string;
  buildType?: number | string;
  buildIdentifier?: string;
  buildShortcutUrl?: string;
}

/**
 * Finds the appKey of an app by its download shortcut. The shortcut API does
 * not return the appKey, so this walks the app list (newest first) and
 * matches the shortcut, or else the package identifier and platform.
 */
export async function findAppKeyByShortcut(
  api: ApiClient,
  shortcut: string,
  match: { identifier?: string; buildType?: number | string } = {},
  maxPages = 50,
  signal?: AbortSignal
): Promise<string | undefined> {
  const wanted = shortcut.toLowerCase();
  let fallback: string | undefined;
  for (let page = 1; page <= maxPages; page += 1) {
    const data = await api.request<{ list?: AppListItem[]; pageCount?: number | string } | AppListItem[]>({
      path: '/apiv2/app/listMy',
      params: { page },
      signal,
    });
    const list = Array.isArray(data) ? data : (data?.list ?? []);
    for (const app of list) {
      if (!app.appKey) continue;
      if (app.buildShortcutUrl && app.buildShortcutUrl.toLowerCase() === wanted) {
        return app.appKey;
      }
      if (
        !fallback && match.identifier && app.buildIdentifier === match.identifier &&
        String(app.buildType) === String(match.buildType)
      ) {
        fallback = app.appKey;
      }
    }
    const pageCount = Array.isArray(data) ? undefined : Number(data?.pageCount);
    if (list.length === 0 || (pageCount !== undefined && Number.isFinite(pageCount) && page >= pageCount)) {
      break;
    }
  }
  return fallback;
}

/** Current settings as returned by /apiv2/app/view. */
export interface CurrentAppSettings {
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

/** Settings to change; anything left undefined keeps its current value. */
export interface AppSettingsChange {
  shortcut?: string;
  installType?: 'public' | 'password' | 'invite';
  password?: string;
  validFrom?: string;
  validUntil?: string;
  /** Remove the installation validity period */
  noExpiry?: boolean;
  language?: 'zh' | 'en' | 'auto';
  versionSource?: 'pgyer' | 'app';
  autoSync?: boolean;
  showCopyright?: boolean;
}

export type AppSettingsErrorCode = 'PASSWORD_REQUIRED' | 'PASSWORD_NOT_ALLOWED';

/** A requested change that does not fit the app's settings. */
export class AppSettingsError extends Error {
  constructor(public readonly code: AppSettingsErrorCode, message: string) {
    super(message);
    this.name = 'AppSettingsError';
  }
}

const INSTALL_TYPES = { public: 1, password: 2, invite: 3 } as const;
const LANGUAGES = { zh: 1, en: 2, auto: 3 } as const;
const VERSION_SOURCES = { pgyer: 1, app: 2 } as const;

/**
 * Builds the full /apiv2/app/update form from the current settings and the
 * requested changes. The API replaces every setting, so unchanged values are
 * filled in from the current ones.
 */
export function mergeAppSettings(
  appKey: string,
  current: CurrentAppSettings,
  change: AppSettingsChange
): { params: Record<string, unknown>; updated: string[] } {
  const requestedInstallType = change.installType ? INSTALL_TYPES[change.installType] : undefined;
  const buildInstallType = requestedInstallType
    ?? (change.password !== undefined ? 2 : Number(current.buildInstallType ?? 1));
  const buildPassword = change.password !== undefined
    ? change.password
    : (buildInstallType === 2 ? current.buildPassword : '');
  if (buildInstallType === 2 && !buildPassword) {
    throw new AppSettingsError(
      'PASSWORD_REQUIRED',
      'Password installation needs a password, and the app does not have one yet'
    );
  }
  if (change.password !== undefined && buildInstallType !== 2) {
    throw new AppSettingsError(
      'PASSWORD_NOT_ALLOWED',
      'A password can only be set together with password installation'
    );
  }

  const appIsInstallDate = change.noExpiry
    ? 2
    : (change.validFrom ? 1 : Number(current.appIsInstallDate ?? 2));
  const toggle = (value: boolean | undefined, currentValue: unknown): unknown =>
    value === undefined ? currentValue : (value ? 1 : 2);

  const params = {
    appKey,
    buildShortcutUrl: change.shortcut ?? current.buildShortcutUrl,
    buildInstallType,
    buildPassword,
    appIsInstallDate,
    appInstallStartDate: change.validFrom ?? current.appInstallStartDate,
    appInstallEndDate: change.validUntil ?? current.appInstallEndDate,
    appLang: change.language ? LANGUAGES[change.language] : current.appLang,
    buildVersionType: change.versionSource
      ? VERSION_SOURCES[change.versionSource]
      : current.buildVersionType,
    appAutoSync: toggle(change.autoSync, current.appAutoSync),
    appShowPgyerCopyright: toggle(change.showCopyright, current.appShowPgyerCopyright),
  };

  const updated = [
    change.shortcut !== undefined ? 'shortcut' : undefined,
    change.installType !== undefined || change.password !== undefined ? 'installation' : undefined,
    change.validFrom !== undefined || change.noExpiry ? 'validity' : undefined,
    change.language !== undefined ? 'language' : undefined,
    change.versionSource !== undefined ? 'versionSource' : undefined,
    change.autoSync !== undefined ? 'autoSync' : undefined,
    change.showCopyright !== undefined ? 'copyright' : undefined,
  ].filter((value): value is string => value !== undefined);

  return { params, updated };
}

/**
 * Reads the app's current settings, merges the change and (unless dryRun)
 * saves the result.
 */
export async function updateAppSettings(
  api: ApiClient,
  appKey: string,
  change: AppSettingsChange,
  options: { dryRun?: boolean; signal?: AbortSignal; onStatus?: (status: string) => void } = {}
): Promise<{ updated: string[]; dryRun: boolean }> {
  options.onStatus?.('Fetching current app settings...');
  const current = await api.request<CurrentAppSettings>({
    path: '/apiv2/app/view',
    params: { appKey },
    signal: options.signal,
  });
  const { params, updated } = mergeAppSettings(appKey, current ?? {}, change);
  if (options.dryRun) {
    return { updated, dryRun: true };
  }
  options.onStatus?.('Updating app settings...');
  await api.request<Record<string, unknown>>({
    path: '/apiv2/app/update',
    params,
    signal: options.signal,
  });
  return { updated, dryRun: false };
}
