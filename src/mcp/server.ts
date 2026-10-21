import * as path from 'path';
import { McpServer, type ServerContext } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod';
import { ApiClient, ApiError, WEB_URL } from '../core/api';
import {
  findAppKeyByShortcut,
  normalizeShortcut,
  platformName,
  updateAppSettings,
  type AppSettingsChange,
} from '../core/apps';
import { loadConfig, type Config } from '../core/config';
import {
  DEFAULT_PROCESSING_TIMEOUT_SECONDS,
  FastUploader,
  ProcessingTimeoutError,
  type UploadBuildInfo,
  type UploadProgress,
} from '../core/upload';
import { CLI_VERSION, MCP_USER_AGENT } from '../core/version';

export interface PgyerMcpServerOptions {
  /** Reads the configuration for each tool call; defaults to PGYER_API_KEY, then the saved login. */
  loadConfig?: () => Config;
  /** User-Agent of PGYER requests; defaults to pgyer-mcp-server/<version> pgyer-cli/<version> Node/<version> */
  userAgent?: string;
  /** API servers to try in order; defaults to the configured or PGYER ones */
  servers?: string[];
  /** Interval between build status checks (tests use a short one) */
  pollIntervalMs?: number;
  /** How many pages of the app list to search when resolving a shortcut */
  shortcutSearchPages?: number;
}

const INSTRUCTIONS = `PGYER (pgyer.com) distributes Android, iOS and HarmonyOS test builds to testers.
- upload_app publishes a local .apk, .ipa or .hap file and returns its download page URL and QR code URL; share those with testers.
- An appKey identifies an app and a buildKey identifies one uploaded version. Get them from list_apps, get_app or list_versions.
- A shortcut is the last part of a download page URL: https://www.pgyer.com/<shortcut>.
- Settings you leave out keep their current values.`;

const AUTH_HELP =
  'No PGYER API key is configured. Set PGYER_API_KEY in this MCP server\'s environment, ' +
  'or run "pgyer auth login" on this machine. Find the key at https://www.pgyer.com/account/api';

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the YYYY-MM-DD format');
const INSTALL_TYPE = z.enum(['public', 'password', 'invite']);

const ANNOTATIONS = {
  read: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  upload: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  overwrite: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
} as const;

const buildOutput = z.object({
  status: z.enum(['published', 'processing'])
    .describe('published: ready to install. processing: PGYER is still processing; call get_upload_status later.'),
  buildKey: z.string().describe('Key of this build (version)'),
  appName: z.string().optional(),
  platform: z.string().optional(),
  version: z.string().optional().describe('Version name from the package, e.g. 1.2.0'),
  versionCode: z.string().optional().describe('Version code / build number from the package'),
  buildNumber: z.string().optional().describe('PGYER build number of this upload'),
  identifier: z.string().optional().describe('Package name or bundle ID'),
  shortcut: z.string().optional(),
  downloadPageUrl: z.string().optional().describe('Download page to share with testers'),
  qrCodeUrl: z.string().optional().describe('QR code image of the download page'),
  fileName: z.string().optional(),
  fileSize: z.number().optional().describe('Bytes'),
  createdAt: z.string().optional(),
  updateDescription: z.string().optional(),
});
type BuildOutput = z.infer<typeof buildOutput>;

const appOutput = z.object({
  appKey: z.string().optional().describe('Missing when the app could not be found in this account\'s app list'),
  buildKey: z.string(),
  name: z.string().optional(),
  platform: z.string().optional(),
  version: z.string().optional(),
  versionCode: z.string().optional(),
  buildNumber: z.string().optional(),
  identifier: z.string().optional(),
  shortcut: z.string().optional(),
  downloadPageUrl: z.string().optional(),
  qrCodeUrl: z.string().optional(),
  iconUrl: z.string().optional(),
  fileName: z.string().optional(),
  fileSize: z.number().optional(),
  isLatest: z.boolean().optional().describe('Whether this build is the one the download page serves'),
  description: z.string().optional(),
  updateDescription: z.string().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
  installType: INSTALL_TYPE.optional(),
  installPeriod: z.object({ start: z.string(), end: z.string() }).nullable().optional()
    .describe('Dates between which the build can be installed; null means no limit'),
  language: z.enum(['zh', 'en', 'auto']).optional().describe('Download page language'),
  versionSource: z.enum(['pgyer', 'app']).optional()
    .describe('Whether the download page shows PGYER build numbers or the package version code'),
  autoSync: z.boolean().optional(),
  showPgyerCopyright: z.boolean().optional(),
});
type AppOutput = z.infer<typeof appOutput>;

type ToolResult = {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

class ToolInputError extends Error {}

function text(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const result = String(value).trim();
  return result ? result : undefined;
}

function count(value: unknown): number | undefined {
  const result = Number(value);
  return value === undefined || value === null || value === '' || !Number.isFinite(result)
    ? undefined
    : result;
}

/** Drops undefined fields so structured output stays compact. */
function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}

function pageUrl(shortcut: unknown, buildKey: unknown): string | undefined {
  const key = text(shortcut) ?? text(buildKey);
  return key ? `${WEB_URL}/${key}` : undefined;
}

function humanSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    let message = `PGYER API error ${error.code}: ${error.message}`;
    if (error.hint) message += `\n${error.hint}`;
    return message;
  }
  return error instanceof Error ? error.message : String(error);
}

function success(summary: string, structured: Record<string, unknown>): ToolResult {
  return {
    content: [
      { type: 'text', text: summary },
      { type: 'text', text: JSON.stringify(structured, null, 2) },
    ],
    structuredContent: structured,
  };
}

function failure(error: unknown): ToolResult {
  return { content: [{ type: 'text', text: describeError(error) }], isError: true };
}

function buildFromInfo(status: BuildOutput['status'], buildKey: string, info?: UploadBuildInfo): BuildOutput {
  if (!info) return { status, buildKey };
  return compact({
    status,
    buildKey: text(info.buildKey) ?? buildKey,
    appName: text(info.buildName),
    platform: info.buildType !== undefined ? platformName(info.buildType) : undefined,
    version: text(info.buildVersion),
    versionCode: text(info.buildVersionNo),
    buildNumber: text(info.buildBuildVersion),
    identifier: text(info.buildIdentifier),
    shortcut: text(info.buildShortcutUrl),
    downloadPageUrl: pageUrl(info.buildShortcutUrl, info.buildKey ?? buildKey),
    qrCodeUrl: text(info.buildQRCodeURL),
    fileName: text(info.buildFileName),
    fileSize: count(info.buildFileSize),
    createdAt: text(info.buildCreated),
    updateDescription: text(info.buildUpdateDescription),
  });
}

function buildSummary(build: BuildOutput, timeoutSeconds?: number): string {
  if (build.status === 'processing') {
    const waited = timeoutSeconds ? ` after ${timeoutSeconds} seconds` : '';
    return `The file is uploaded, but PGYER is still processing the build${waited}. ` +
      `Call get_upload_status with buildKey ${build.buildKey} later to get the download page.`;
  }
  const name = [build.appName, build.version].filter(Boolean).join(' ') || 'The build';
  const number = build.buildNumber ? ` (PGYER build ${build.buildNumber})` : '';
  const lines = [`${name}${number} is published on PGYER.`];
  if (build.downloadPageUrl) lines.push(`Download page: ${build.downloadPageUrl}`);
  if (build.qrCodeUrl) lines.push(`QR code: ${build.qrCodeUrl}`);
  return lines.join('\n');
}

const INSTALL_TYPE_NAMES: Record<string, AppOutput['installType']> = { 1: 'public', 2: 'password', 3: 'invite' };
const LANGUAGE_NAMES: Record<string, AppOutput['language']> = { 1: 'zh', 2: 'en', 3: 'auto' };
const VERSION_SOURCE_NAMES: Record<string, AppOutput['versionSource']> = { 1: 'pgyer', 2: 'app' };

function flag(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  return String(value) === '1';
}

function appFromDetail(detail: Record<string, unknown>, appKey?: string): AppOutput {
  const hasSettings = detail.appIsInstallDate !== undefined;
  return compact({
    appKey: text(detail.appKey) ?? appKey,
    buildKey: text(detail.buildKey) ?? '',
    name: text(detail.buildName),
    platform: detail.buildType !== undefined ? platformName(detail.buildType) : undefined,
    version: text(detail.buildVersion),
    versionCode: text(detail.buildVersionNo),
    buildNumber: text(detail.buildBuildVersion),
    identifier: text(detail.buildIdentifier),
    shortcut: text(detail.buildShortcutUrl),
    downloadPageUrl: pageUrl(detail.buildShortcutUrl, detail.buildKey),
    qrCodeUrl: text(detail.buildQRCodeURL),
    iconUrl: text(detail.iconUrl),
    fileName: text(detail.buildFileName),
    fileSize: count(detail.buildFileSize),
    isLatest: flag(detail.buildIsLastest),
    description: text(detail.buildDescription),
    updateDescription: text(detail.buildUpdateDescription),
    createdAt: text(detail.buildCreated),
    updatedAt: text(detail.buildUpdated),
    installType: INSTALL_TYPE_NAMES[String(detail.buildInstallType)],
    installPeriod: hasSettings
      ? (String(detail.appIsInstallDate) === '1'
        ? { start: text(detail.appInstallStartDate) ?? '', end: text(detail.appInstallEndDate) ?? '' }
        : null)
      : undefined,
    language: LANGUAGE_NAMES[String(detail.appLang)],
    versionSource: VERSION_SOURCE_NAMES[String(detail.buildVersionType)],
    autoSync: flag(detail.appAutoSync),
    showPgyerCopyright: flag(detail.appShowPgyerCopyright),
  });
}

function checkPeriod(start: string | undefined, end: string | undefined): void {
  if (Boolean(start) !== Boolean(end)) {
    throw new ToolInputError('Set both installStartDate and installEndDate, or neither.');
  }
  if (start && end && end <= start) {
    throw new ToolInputError('installEndDate must be later than installStartDate.');
  }
}

/** Sends MCP progress notifications when the client asked for them. */
function uploadProgress(ctx: ServerContext, fileName: string): (progress: UploadProgress) => void {
  const token = ctx.mcpReq._meta?.progressToken;
  if (token === undefined) return () => undefined;
  let last = -1;
  let fileStep = -1;
  const send = (progress: number, message: string): void => {
    if (progress <= last) return;
    last = progress;
    ctx.mcpReq
      .notify({ method: 'notifications/progress', params: { progressToken: token, progress, total: 100, message } })
      .catch(() => undefined);
  };
  return (event) => {
    switch (event.stage) {
      case 'token':
        send(1, 'Requesting upload credentials');
        break;
      case 'upload': {
        const ratio = event.totalBytes ? Math.min(1, event.sentBytes / event.totalBytes) : 1;
        const step = Math.floor(ratio * 20);
        if (step <= fileStep) break;
        fileStep = step;
        send(
          Math.round((1 + 88 * (step / 20)) * 10) / 10,
          `Uploading ${fileName}: ${step * 5}% (${humanSize(event.sentBytes)} of ${humanSize(event.totalBytes)})`
        );
        break;
      }
      case 'processing': {
        const ratio = event.timeoutMs ? Math.min(1, event.elapsedMs / event.timeoutMs) : 0;
        send(
          Math.round((90 + 9 * ratio) * 100) / 100,
          `Waiting for PGYER to process the build (${Math.round(event.elapsedMs / 1000)} s)`
        );
        break;
      }
      case 'published':
        send(100, 'Published');
        break;
    }
  };
}

/** Creates the PGYER MCP server with all tools registered. */
export function createPgyerMcpServer(options: PgyerMcpServerOptions = {}): McpServer {
  const server = new McpServer(
    { name: 'pgyer', title: 'PGYER', version: CLI_VERSION, websiteUrl: 'https://www.pgyer.com' },
    { instructions: INSTRUCTIONS }
  );
  const userAgent = options.userAgent ?? MCP_USER_AGENT;
  const shortcutPages = options.shortcutSearchPages ?? 50;

  const currentConfig = (): Config => {
    const config = (options.loadConfig ?? loadConfig)();
    if (!config.apiKey) throw new ToolInputError(AUTH_HELP);
    return config;
  };
  const apiClient = (): ApiClient => new ApiClient(currentConfig(), { userAgent, servers: options.servers });
  const uploader = (): FastUploader => new FastUploader(currentConfig(), { userAgent, servers: options.servers });

  const resolveAppKey = async (
    api: ApiClient,
    input: { appKey?: string; shortcut?: string },
    signal: AbortSignal
  ): Promise<{ appKey: string; shortcutApp?: Record<string, unknown> }> => {
    if (input.appKey && input.shortcut) throw new ToolInputError('Pass either appKey or shortcut, not both.');
    if (input.appKey) return { appKey: input.appKey };
    if (!input.shortcut) throw new ToolInputError('Pass appKey or shortcut.');
    const shortcut = normalizeShortcut(input.shortcut);
    const shortcutApp = await api.request<Record<string, unknown>>({
      path: '/apiv2/app/getByShortcut',
      params: { buildShortcutUrl: shortcut },
      signal,
    });
    const appKey = await findAppKeyByShortcut(
      api,
      shortcut,
      { identifier: text(shortcutApp?.buildIdentifier), buildType: text(shortcutApp?.buildType) },
      shortcutPages,
      signal
    );
    if (!appKey) {
      return { appKey: '', shortcutApp };
    }
    return { appKey, shortcutApp };
  };

  server.registerTool(
    'upload_app',
    {
      title: 'Upload app to PGYER',
      description:
        'Upload an Android (.apk), iOS (.ipa) or HarmonyOS (.hap) package from this machine to PGYER and wait until PGYER has processed it. ' +
        'Returns the published build with its download page URL (share it with testers) and QR code image URL. ' +
        'PGYER matches the package to an existing app by its package identifier, or creates the app on the first upload. ' +
        'Only the settings you pass are changed; the app keeps its current values for the rest. ' +
        'Large files can take several minutes. If PGYER is still processing when processingTimeoutSeconds ends, the result has status "processing" and a buildKey: call get_upload_status with it later instead of uploading again.',
      inputSchema: z.object({
        filePath: z.string().min(1).describe('Absolute path of the .apk, .ipa or .hap file on this machine'),
        updateDescription: z.string().optional().describe('Release notes for this build, shown on the download page'),
        description: z.string().optional().describe('App description shown on the download page'),
        installType: INSTALL_TYPE.optional().describe(
          'Who can install: public (anyone with the link), password (needs the install password) or invite (only invited testers). Setting only password implies password.'
        ),
        password: z.string().optional().describe('Install password for installType "password"'),
        installStartDate: DATE.optional().describe('First day the build can be installed (YYYY-MM-DD); set together with installEndDate'),
        installEndDate: DATE.optional().describe('Last day the build can be installed (YYYY-MM-DD); set together with installStartDate'),
        channelShortcut: z.string().optional().describe('Shortcut of a PGYER channel download link to publish this build to'),
        oversea: z.boolean().optional().describe(
          'true: upload through the overseas network; false: upload within mainland China. Leave out to let PGYER choose by IP address.'
        ),
        processingTimeoutSeconds: z.number().int().min(1).max(3600).optional().describe(
          `Seconds to wait for PGYER to process the build after the file is uploaded (default ${DEFAULT_PROCESSING_TIMEOUT_SECONDS})`
        ),
      }),
      outputSchema: buildOutput,
      annotations: ANNOTATIONS.upload,
    },
    async (input, ctx) => {
      try {
        checkPeriod(input.installStartDate, input.installEndDate);
        if (input.password && input.installType && input.installType !== 'password') {
          throw new ToolInputError('password can only be used with installType "password".');
        }
        const filePath = path.resolve(input.filePath);
        const timeoutSeconds = input.processingTimeoutSeconds ?? DEFAULT_PROCESSING_TIMEOUT_SECONDS;
        const installTypes = { public: 1, password: 2, invite: 3 } as const;
        try {
          const result = await uploader().upload({
            filePath,
            buildDescription: input.description,
            buildUpdateDescription: input.updateDescription,
            buildInstallType: input.installType ? installTypes[input.installType] : undefined,
            buildPassword: input.password,
            buildInstallStartDate: input.installStartDate,
            buildInstallEndDate: input.installEndDate,
            buildChannelShortcut: input.channelShortcut,
            oversea: input.oversea === undefined ? undefined : (input.oversea ? 1 : 2),
            timeoutMs: timeoutSeconds * 1000,
            pollIntervalMs: options.pollIntervalMs,
            wait: true,
            onProgress: uploadProgress(ctx, path.basename(filePath)),
            signal: ctx.mcpReq.signal,
          });
          const build = buildFromInfo('published', result.uploadKey, result.data);
          return success(buildSummary(build), build);
        } catch (error) {
          if (error instanceof ProcessingTimeoutError) {
            const build: BuildOutput = { status: 'processing', buildKey: error.buildKey };
            return success(buildSummary(build, error.timeoutSeconds), build);
          }
          throw error;
        }
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'get_upload_status',
    {
      title: 'Get upload status',
      description:
        'Check whether PGYER has finished processing an upload, by the buildKey that upload_app returned with status "processing". ' +
        'Returns the published build with its download page URL once it is ready. Set waitSeconds to keep checking for up to that long.',
      inputSchema: z.object({
        buildKey: z.string().min(1).describe('buildKey returned by upload_app'),
        waitSeconds: z.number().int().min(0).max(600).optional()
          .describe('Keep checking every few seconds for up to this many seconds (default 0: check once)'),
      }),
      outputSchema: buildOutput,
      annotations: ANNOTATIONS.read,
    },
    async (input, ctx) => {
      try {
        const client = uploader();
        if (input.waitSeconds) {
          try {
            const result = await client.waitForBuild(input.buildKey, {
              timeoutMs: input.waitSeconds * 1000,
              pollIntervalMs: options.pollIntervalMs,
              signal: ctx.mcpReq.signal,
            });
            const build = buildFromInfo('published', input.buildKey, result.data);
            return success(buildSummary(build), build);
          } catch (error) {
            if (!(error instanceof ProcessingTimeoutError)) throw error;
            const build: BuildOutput = { status: 'processing', buildKey: input.buildKey };
            return success(buildSummary(build, error.timeoutSeconds), build);
          }
        }
        const result = await client.getStatus(input.buildKey, ctx.mcpReq.signal);
        const build = result.status === 'published'
          ? buildFromInfo('published', input.buildKey, result.data)
          : { status: 'processing' as const, buildKey: input.buildKey };
        return success(buildSummary(build), build);
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'list_apps',
    {
      title: 'List apps',
      description:
        'List the apps in the PGYER account, 20 per page, with each app\'s latest version and download page. ' +
        'Use page to see more; pageCount tells how many pages there are.',
      inputSchema: z.object({
        page: z.number().int().min(1).optional().describe('Page number, starting at 1 (default 1)'),
      }),
      outputSchema: z.object({
        page: z.number(),
        pageCount: z.number().optional(),
        totalApps: z.number().optional(),
        apps: z.array(z.object({
          appKey: z.string(),
          name: z.string().optional(),
          platform: z.string().optional(),
          version: z.string().optional(),
          buildNumber: z.string().optional(),
          identifier: z.string().optional(),
          shortcut: z.string().optional(),
          downloadPageUrl: z.string().optional(),
          latestBuildKey: z.string().optional(),
          lastUploadAt: z.string().optional(),
        })),
      }),
      annotations: ANNOTATIONS.read,
    },
    async (input, ctx) => {
      try {
        const page = input.page ?? 1;
        const data = await apiClient().request<Record<string, unknown> | Record<string, unknown>[]>({
          path: '/apiv2/app/listMy',
          params: { page },
          signal: ctx.mcpReq.signal,
        });
        const list = (Array.isArray(data) ? data : ((data?.list as Record<string, unknown>[]) ?? []));
        const apps = list.map((app) => compact({
          appKey: text(app.appKey) ?? '',
          name: text(app.buildName),
          platform: platformName(app.buildType),
          version: text(app.buildVersion),
          buildNumber: text(app.buildBuildVersion),
          identifier: text(app.buildIdentifier),
          shortcut: text(app.buildShortcutUrl),
          downloadPageUrl: pageUrl(app.buildShortcutUrl, app.buildKey),
          latestBuildKey: text(app.buildKey),
          lastUploadAt: text(app.buildCreated),
        }));
        const meta = Array.isArray(data) ? {} : data;
        const output = compact({
          page,
          pageCount: count(meta.pageCount),
          totalApps: count(meta.count),
          apps,
        });
        const pages = output.pageCount ? ` of ${output.pageCount}` : '';
        return success(`Page ${page}${pages}: ${apps.length} apps.`, output);
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'get_app',
    {
      title: 'Get app details',
      description:
        'Get an app\'s details by appKey or by shortcut (or a full https://www.pgyer.com/<shortcut> URL): latest version, download page, QR code, install type, install period and download page settings. ' +
        'Pass buildKey together with appKey to get one specific historical build. The install password is never returned.',
      inputSchema: z.object({
        appKey: z.string().min(1).optional().describe('App key'),
        shortcut: z.string().min(1).optional().describe('Download page shortcut or URL, e.g. "abcd" or "https://www.pgyer.com/abcd"'),
        buildKey: z.string().min(1).optional().describe('A specific build of the app (only with appKey)'),
      }),
      outputSchema: appOutput,
      annotations: ANNOTATIONS.read,
    },
    async (input, ctx) => {
      try {
        if (input.buildKey && !input.appKey) {
          throw new ToolInputError('buildKey can only be used together with appKey.');
        }
        const api = apiClient();
        const signal = ctx.mcpReq.signal;
        const { appKey, shortcutApp } = await resolveAppKey(api, input, signal);
        let app: AppOutput;
        if (appKey) {
          const detail = await api.request<Record<string, unknown>>({
            path: '/apiv2/app/view',
            params: { appKey, buildKey: input.buildKey ?? text(shortcutApp?.buildKey) },
            signal,
          });
          app = appFromDetail({ ...(shortcutApp ?? {}), ...detail }, appKey);
        } else {
          app = appFromDetail(shortcutApp ?? {});
        }
        const name = [app.name, app.version].filter(Boolean).join(' ') || app.buildKey;
        const summary = [`${name} (${app.platform ?? 'Unknown'})`];
        if (app.downloadPageUrl) summary.push(`Download page: ${app.downloadPageUrl}`);
        if (!app.appKey) {
          summary.push('The appKey was not found in this account\'s app list, so only the shortcut details are shown.');
        }
        return success(summary.join('\n'), app);
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'list_versions',
    {
      title: 'List app versions',
      description:
        'List the uploaded versions (builds) of an app, newest first, by appKey or shortcut. ' +
        'isLatest marks the build the download page serves. Use page to see older builds.',
      inputSchema: z.object({
        appKey: z.string().min(1).optional().describe('App key'),
        shortcut: z.string().min(1).optional().describe('Download page shortcut or URL'),
        page: z.number().int().min(1).optional().describe('Page number, starting at 1 (default 1)'),
      }),
      outputSchema: z.object({
        appKey: z.string(),
        page: z.number(),
        pageCount: z.number().optional(),
        versions: z.array(z.object({
          buildKey: z.string(),
          version: z.string().optional(),
          versionCode: z.string().optional(),
          buildNumber: z.string().optional(),
          isLatest: z.boolean().optional(),
          createdAt: z.string().optional(),
          updateDescription: z.string().optional(),
          fileName: z.string().optional(),
          fileSize: z.number().optional(),
        })),
      }),
      annotations: ANNOTATIONS.read,
    },
    async (input, ctx) => {
      try {
        const api = apiClient();
        const signal = ctx.mcpReq.signal;
        const { appKey } = await resolveAppKey(api, input, signal);
        if (!appKey) {
          throw new ToolInputError('That shortcut does not belong to an app in this account\'s app list. Pass the appKey instead.');
        }
        const page = input.page ?? 1;
        const data = await api.request<{ list?: Record<string, unknown>[]; pageCount?: unknown }>({
          path: '/apiv2/app/builds',
          params: { appKey, page },
          signal,
        });
        const versions = (data?.list ?? []).map((item) => compact({
          buildKey: text(item.buildKey) ?? '',
          version: text(item.buildVersion),
          versionCode: text(item.buildVersionNo),
          buildNumber: text(item.buildBuildVersion),
          isLatest: flag(item.buildIsLastest),
          createdAt: text(item.buildCreated),
          updateDescription: text(item.buildUpdateDescription),
          fileName: text(item.buildFileName),
          fileSize: count(item.buildFileSize),
        }));
        const output = compact({ appKey, page, pageCount: count(data?.pageCount), versions });
        const pages = output.pageCount ? ` of ${output.pageCount}` : '';
        return success(`Page ${page}${pages}: ${versions.length} versions.`, output);
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'set_latest_version',
    {
      title: 'Set latest version',
      description:
        'Make a build the latest version of its app, which is the one the app\'s download page serves to testers (latest: true, the default). ' +
        'With latest: false, remove the latest mark from that build instead. Get build keys from list_versions.',
      inputSchema: z.object({
        buildKey: z.string().min(1).describe('Build to change'),
        latest: z.boolean().optional().describe('true (default): set as latest. false: remove the latest mark.'),
      }),
      outputSchema: z.object({ buildKey: z.string(), latest: z.boolean() }),
      annotations: ANNOTATIONS.overwrite,
    },
    async (input, ctx) => {
      try {
        const latest = input.latest ?? true;
        await apiClient().request({
          path: latest ? '/apiv2/app/setNewestVersion' : '/apiv2/app/cancelNewestVersion',
          params: { buildKey: input.buildKey },
          signal: ctx.mcpReq.signal,
        });
        const summary = latest
          ? `Build ${input.buildKey} is now the latest version.`
          : `Removed the latest mark from build ${input.buildKey}.`;
        return success(summary, { buildKey: input.buildKey, latest });
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'update_app_settings',
    {
      title: 'Update app settings',
      description:
        'Change an app\'s download page and installation settings. Only the settings you pass change; the rest keep their current values. ' +
        'Use dryRun to see which settings would change without saving.',
      inputSchema: z.object({
        appKey: z.string().min(1).describe('App key'),
        shortcut: z.string().min(1).optional().describe('New download page shortcut (https://www.pgyer.com/<shortcut>)'),
        installType: INSTALL_TYPE.optional().describe('public, password or invite'),
        password: z.string().min(1).optional().describe('Install password; implies installType "password"'),
        installStartDate: DATE.optional().describe('First day the app can be installed (YYYY-MM-DD); set together with installEndDate'),
        installEndDate: DATE.optional().describe('Last day the app can be installed (YYYY-MM-DD); set together with installStartDate'),
        removeInstallPeriod: z.boolean().optional().describe('true: remove the install period limit'),
        language: z.enum(['zh', 'en', 'auto']).optional().describe('Download page language'),
        versionSource: z.enum(['pgyer', 'app']).optional()
          .describe('Show PGYER build numbers (pgyer) or the package version code (app) on the download page'),
        autoSync: z.boolean().optional().describe('Sync app information automatically'),
        showPgyerCopyright: z.boolean().optional().describe('Show the PGYER copyright on the download page'),
        dryRun: z.boolean().optional().describe('true: only report what would change'),
      }),
      outputSchema: z.object({ appKey: z.string(), updated: z.array(z.string()), dryRun: z.boolean() }),
      annotations: ANNOTATIONS.overwrite,
    },
    async (input, ctx) => {
      try {
        checkPeriod(input.installStartDate, input.installEndDate);
        if (input.removeInstallPeriod && input.installStartDate) {
          throw new ToolInputError('removeInstallPeriod cannot be combined with install dates.');
        }
        const change: AppSettingsChange = {
          shortcut: input.shortcut,
          installType: input.installType,
          password: input.password,
          validFrom: input.installStartDate,
          validUntil: input.installEndDate,
          noExpiry: input.removeInstallPeriod === true,
          language: input.language,
          versionSource: input.versionSource,
          autoSync: input.autoSync,
          showCopyright: input.showPgyerCopyright,
        };
        const hasChange = Object.entries(change).some(([key, value]) =>
          key === 'noExpiry' ? value === true : value !== undefined
        );
        if (!hasChange) throw new ToolInputError('Pass at least one setting to change.');
        const result = await updateAppSettings(apiClient(), input.appKey, change, {
          dryRun: input.dryRun,
          signal: ctx.mcpReq.signal,
        });
        const changed = result.updated.join(', ');
        const summary = result.dryRun
          ? `Dry run: would update ${changed} of app ${input.appKey}.`
          : `Updated ${changed} of app ${input.appKey}.`;
        return success(summary, { appKey: input.appKey, updated: result.updated, dryRun: result.dryRun });
      } catch (error) {
        return failure(error);
      }
    }
  );

  return server;
}

/**
 * Serves the PGYER tools over stdio until the client closes stdin. Only MCP
 * messages are written to stdout.
 */
export async function runStdioServer(options: PgyerMcpServerOptions = {}): Promise<void> {
  // Anything printed by accident would corrupt the protocol stream.
  console.log = console.error.bind(console);
  console.info = console.error.bind(console);
  console.debug = console.error.bind(console);
  console.warn = console.error.bind(console);

  const handle = serveStdio(() => createPgyerMcpServer(options), {
    onerror: (error) => console.error(`[pgyer mcp] ${error.message}`),
  });
  const shutdown = (): void => {
    void handle.close().finally(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
