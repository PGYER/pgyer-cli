import * as fs from 'fs';
import * as http from 'http';
import * as https from 'https';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { ApiClient, ApiError, NetworkError, describeFailure, type ApiClientOptions } from './api';
import { getApiKey, type Config } from './config';

export type UploadBuildType = 'ios' | 'android' | 'harmony';

/** Seconds to wait for PGYER to process a build after the file is uploaded. */
export const DEFAULT_PROCESSING_TIMEOUT_SECONDS = 600;
export const DEFAULT_POLL_INTERVAL_MS = 3_000;
/** Abort a storage upload when no data moves for this long. */
const STORAGE_IDLE_TIMEOUT_MS = 5 * 60_000;

const CODE_SYNCING = 1246;
const CODE_PROCESSING = 1247;

const BUILD_TYPES: Record<string, UploadBuildType> = {
  '.ipa': 'ios',
  '.apk': 'android',
  '.hap': 'harmony',
};

/** Optional publish settings sent with /apiv2/app/getCOSToken. */
export interface UploadSettings {
  buildDescription?: string;
  buildUpdateDescription?: string;
  /** 1 public, 2 password, 3 invitation only; left out to keep the app's setting */
  buildInstallType?: number;
  buildPassword?: string;
  /** Kept for compatibility; 1 is sent whenever both dates are set */
  buildInstallDate?: number;
  buildInstallStartDate?: string;
  buildInstallEndDate?: string;
  buildChannelShortcut?: string;
  /** 1 overseas, 2 mainland China; left out to let PGYER choose by IP address */
  oversea?: 1 | 2;
}

export type UploadProgress =
  | { stage: 'token' }
  | { stage: 'upload'; sentBytes: number; totalBytes: number }
  | { stage: 'processing'; elapsedMs: number; timeoutMs: number }
  | { stage: 'published' };

export interface FastUploadOptions extends UploadSettings {
  filePath: string;
  /** Overrides the type detected from the file extension */
  buildType?: UploadBuildType;
  /** Processing deadline after the file is uploaded; default 600 seconds */
  timeoutMs?: number;
  /** Interval between build status checks; default 3 seconds */
  pollIntervalMs?: number;
  /** Wait for PGYER to publish the build (default) or return after the file upload */
  wait?: boolean;
  onStatus?: (status: string) => void;
  onProgress?: (progress: UploadProgress) => void;
  signal?: AbortSignal;
}

export interface UploadBuildInfo {
  appKey?: string;
  buildKey: string;
  buildType: number | string;
  buildName: string;
  buildVersion: string;
  buildVersionNo: string;
  buildBuildVersion: number | string;
  buildIdentifier: string;
  buildShortcutUrl: string;
  buildQRCodeURL?: string;
  buildFileName?: string;
  buildFileSize?: number | string;
  buildUpdateDescription?: string;
  buildCreated?: string;
  buildUpdated?: string;
  [key: string]: unknown;
}

export interface FastUploadResult {
  status: 'uploaded' | 'published';
  uploadKey: string;
  data?: UploadBuildInfo;
}

export interface UploadStatusResult {
  status: 'pending' | 'published';
  uploadKey: string;
  data?: UploadBuildInfo;
}

export interface WaitForUploadOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  onStatus?: (status: string) => void;
  onProgress?: (progress: UploadProgress) => void;
  signal?: AbortSignal;
}

interface UploadToken {
  key: string;
  endpoint: string;
  params: Record<string, unknown>;
}

/** PGYER is still processing the build when the wait ends. The upload itself succeeded. */
export class ProcessingTimeoutError extends Error {
  constructor(
    public readonly buildKey: string,
    public readonly timeoutSeconds: number
  ) {
    super(
      `PGYER is still processing the build after ${timeoutSeconds} seconds. ` +
        `It may still be published; check your PGYER app list. Build key: ${buildKey}`
    );
    this.name = 'ProcessingTimeoutError';
  }
}

export function getBuildType(filePath: string): UploadBuildType {
  const type = BUILD_TYPES[path.extname(filePath).toLowerCase()];
  if (!type) {
    throw new Error('Unsupported file type. Expected an IPA, APK, or HAP file');
  }
  return type;
}

/** COS stores x-cos-meta-* fields as HTTP headers, so only printable ASCII is safe to send. */
export function isPlainAscii(text: string): boolean {
  return /^[\x20-\x7e]+$/.test(text);
}

function isSet(value: unknown): boolean {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

/**
 * The form for /apiv2/app/getCOSToken. Only settings the user gave are sent,
 * so PGYER keeps the app's current values for everything else.
 */
export function buildTokenForm(
  buildType: UploadBuildType,
  settings: UploadSettings
): Record<string, string> {
  const form: Record<string, string> = { buildType };
  const put = (name: string, value: unknown): void => {
    if (isSet(value)) form[name] = String(value);
  };
  // A password on its own means password installation.
  const installType = isSet(settings.buildInstallType)
    ? settings.buildInstallType
    : (isSet(settings.buildPassword) ? 2 : undefined);
  put('buildInstallType', installType);
  put('buildPassword', settings.buildPassword);
  put('buildDescription', settings.buildDescription);
  put('buildUpdateDescription', settings.buildUpdateDescription);
  if (isSet(settings.buildInstallStartDate) && isSet(settings.buildInstallEndDate)) {
    form.buildInstallDate = '1';
    form.buildInstallStartDate = String(settings.buildInstallStartDate);
    form.buildInstallEndDate = String(settings.buildInstallEndDate);
  }
  put('buildChannelShortcut', settings.buildChannelShortcut);
  if (settings.oversea === 1 || settings.oversea === 2) {
    // 1 = overseas, 2 = mainland China; the server ignores any other value.
    form.oversea = String(settings.oversea);
  }
  return form;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function multipartFileName(name: string): string {
  if (isPlainAscii(name) && !name.includes('"')) return name;
  return `upload${path.extname(name)}`;
}

/** Picks the error code and message out of a COS XML error, without echoing anything else. */
function storageError(text: string): string {
  const tag = (name: string): string | undefined =>
    text.match(new RegExp(`<${name}>([^<]{0,200})</${name}>`))?.[1];
  const parts = [tag('Code'), tag('Message')].filter(Boolean);
  const requestId = tag('RequestId');
  let result = parts.length ? `: ${parts.join(': ')}` : '';
  if (requestId) result += ` (request ID ${requestId})`;
  return result;
}

interface StorageUploadOptions {
  userAgent: string;
  onProgress?: (progress: UploadProgress) => void;
  signal?: AbortSignal;
  idleTimeoutMs?: number;
}

/** Streams the file to COS as multipart/form-data. Any 2xx answer is success. */
async function sendToStorage(
  token: UploadToken,
  filePath: string,
  size: number,
  options: StorageUploadOptions
): Promise<void> {
  const url = new URL(token.endpoint);
  const boundary = `----PgyerCli${randomUUID().replace(/-/g, '')}`;
  const fields = new Map<string, string>();
  for (const [name, value] of Object.entries(token.params)) {
    fields.set(name, value === undefined || value === null ? '' : String(value));
  }
  const fileName = path.basename(filePath);
  if (isPlainAscii(fileName)) {
    fields.set('x-cos-meta-file-name', fileName);
  }

  let head = '';
  for (const [name, value] of fields) {
    head += `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
  }
  head +=
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${multipartFileName(fileName)}"\r\n` +
    'Content-Type: application/octet-stream\r\n\r\n';
  const headBytes = Buffer.from(head, 'utf8');
  const tailBytes = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
  const transport = url.protocol === 'http:' ? http : https;
  const idleTimeoutMs = options.idleTimeoutMs ?? STORAGE_IDLE_TIMEOUT_MS;

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let file: fs.ReadStream | undefined;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      file?.destroy();
      if (error) reject(error);
      else resolve();
    };

    const request = transport.request(url, {
      method: 'POST',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'content-length': String(headBytes.length + size + tailBytes.length),
        'user-agent': options.userAgent,
      },
      signal: options.signal,
    });

    request.setTimeout(idleTimeoutMs, () => {
      request.destroy(new Error(
        `Uploading the file to storage stalled: nothing was sent or received for ${Math.round(idleTimeoutMs / 1000)} seconds`
      ));
    });
    request.on('error', (error) => {
      if (options.signal?.aborted) {
        finish(options.signal.reason as Error);
        return;
      }
      finish(error.message.startsWith('Uploading the file')
        ? error
        : new Error(`Uploading the file to storage failed: ${describeFailure(error)}`));
    });
    request.on('response', (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => {
        if (body.length < 65_536) body += chunk;
      });
      response.on('error', (error) => finish(error));
      response.on('end', () => {
        const status = response.statusCode ?? 0;
        if (status >= 200 && status <= 299) {
          finish();
        } else {
          finish(new Error(`Uploading the file to storage failed with HTTP ${status}${storageError(body)}`));
        }
      });
    });

    request.write(headBytes);
    let sent = 0;
    file = fs.createReadStream(filePath, { highWaterMark: 256 * 1024 });
    file.on('data', (chunk: string | Buffer) => {
      sent += chunk.length;
      options.onProgress?.({ stage: 'upload', sentBytes: sent, totalBytes: size });
      if (!request.write(chunk)) {
        file?.pause();
        request.once('drain', () => file?.resume());
      }
    });
    file.on('end', () => request.end(tailBytes));
    file.on('error', (error) => {
      request.destroy();
      finish(new Error(`Reading ${fileName} failed: ${error.message}`));
    });
  });
}

export class FastUploader {
  private readonly api: ApiClient;

  constructor(config: Config, options: ApiClientOptions = {}) {
    if (!getApiKey(config)) {
      throw new Error('Not authenticated. Run "pgyer auth login" or set PGYER_API_KEY');
    }
    this.api = new ApiClient(config, options);
  }

  async upload(options: FastUploadOptions): Promise<FastUploadResult> {
    const buildType = options.buildType ?? getBuildType(options.filePath);
    const stat = await fs.promises.stat(options.filePath).catch((error: NodeJS.ErrnoException) => {
      throw error.code === 'ENOENT' ? new Error(`File not found: ${options.filePath}`) : error;
    });
    if (!stat.isFile()) {
      throw new Error(`Path is not a file: ${options.filePath}`);
    }

    options.onStatus?.('Requesting upload credentials...');
    options.onProgress?.({ stage: 'token' });
    const { server, data } = await this.api.requestWithServer<UploadToken>({
      path: '/apiv2/app/getCOSToken',
      params: buildTokenForm(buildType, options),
      signal: options.signal,
    });
    const token = data ?? ({} as UploadToken);
    if (
      !token.params || typeof token.params !== 'object' ||
      typeof token.endpoint !== 'string' || !token.endpoint || !token.key
    ) {
      throw new Error('PGYER returned an incomplete upload token. Please try again later.');
    }
    const uploadKey = String(token.key);

    options.onStatus?.('Uploading app package...');
    await sendToStorage(token, options.filePath, stat.size, {
      userAgent: this.api.userAgent,
      onProgress: options.onProgress,
      signal: options.signal,
    });

    if (options.wait === false) {
      return { status: 'uploaded', uploadKey };
    }

    options.onStatus?.('Processing app package...');
    const result = await this.waitUntilPublished(uploadKey, server, options);
    return { status: 'published', uploadKey, data: result.data };
  }

  /** Check an upload once. */
  async getStatus(uploadKey: string, signal?: AbortSignal): Promise<UploadStatusResult> {
    return this.checkStatus(uploadKey, undefined, signal);
  }

  /** Poll an upload until PGYER publishes it or the timeout ends. */
  async waitForBuild(
    uploadKey: string,
    options: WaitForUploadOptions = {}
  ): Promise<UploadStatusResult> {
    return this.waitUntilPublished(uploadKey, undefined, options);
  }

  private async checkStatus(
    uploadKey: string,
    server: string | undefined,
    signal?: AbortSignal
  ): Promise<UploadStatusResult> {
    const request = { path: '/apiv2/app/buildInfo', params: { buildKey: uploadKey }, signal };
    try {
      const data = server
        ? await this.api.requestAt<UploadBuildInfo>(server, request)
        : await this.api.request<UploadBuildInfo>(request);
      if (!data || typeof data !== 'object') {
        throw new Error(`PGYER published the build but returned no build information. Build key: ${uploadKey}`);
      }
      // The API can briefly return code=0 with buildBuildVersion=0 before
      // the published build receives its final PGYER build number.
      if (Number(data.buildBuildVersion) === 0) {
        return { status: 'pending', uploadKey, data };
      }
      return { status: 'published', uploadKey, data };
    } catch (error) {
      if (error instanceof ApiError && (error.code === CODE_SYNCING || error.code === CODE_PROCESSING)) {
        return { status: 'pending', uploadKey };
      }
      throw error;
    }
  }

  /**
   * Polls buildInfo until the build is published. Network errors are retried
   * until the deadline, because the file is already uploaded.
   */
  private async waitUntilPublished(
    uploadKey: string,
    server: string | undefined,
    options: WaitForUploadOptions
  ): Promise<UploadStatusResult> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_PROCESSING_TIMEOUT_SECONDS * 1000;
    const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const started = Date.now();
    const deadline = started + timeoutMs;
    let reportedNetworkError = false;
    let lastData: UploadBuildInfo | undefined;

    while (true) {
      let result: UploadStatusResult | undefined;
      try {
        result = await this.checkStatus(uploadKey, server, options.signal);
      } catch (error) {
        if (!(error instanceof NetworkError)) throw error;
        if (!reportedNetworkError) {
          options.onStatus?.(`Checking the build status failed (${error.message}), retrying...`);
          reportedNetworkError = true;
        }
      }
      if (result?.status === 'published') {
        options.onProgress?.({ stage: 'published' });
        return result;
      }
      if (result?.data) lastData = result.data;
      if (Date.now() >= deadline) {
        if (lastData) {
          // PGYER answered code=0 but never filled in the build number.
          options.onProgress?.({ stage: 'published' });
          return { status: 'published', uploadKey, data: lastData };
        }
        throw new ProcessingTimeoutError(uploadKey, Math.round(timeoutMs / 1000));
      }
      options.onStatus?.('Processing app package...');
      options.onProgress?.({ stage: 'processing', elapsedMs: Date.now() - started, timeoutMs });
      await sleep(pollIntervalMs, options.signal);
    }
  }
}
