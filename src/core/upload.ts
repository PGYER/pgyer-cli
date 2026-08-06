import * as fs from 'fs';
import * as path from 'path';
import FormData from 'form-data';
import { ApiClient, ApiError } from './api';
import { getApiKey, type Config } from './config';

export type UploadBuildType = 'ios' | 'android' | 'harmonyos';

export interface FastUploadOptions {
  filePath: string;
  buildDescription?: string;
  buildUpdateDescription?: string;
  buildInstallType?: number;
  buildPassword?: string;
  buildInstallDate?: number;
  buildInstallStartDate?: string;
  buildInstallEndDate?: string;
  buildChannelShortcut?: string;
  oversea?: 1 | 2;
  timeoutMs: number;
  pollIntervalMs: number;
  wait: boolean;
  onStatus?: (status: string) => void;
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
  timeoutMs: number;
  pollIntervalMs: number;
  onStatus?: (status: string) => void;
}

interface UploadToken {
  key: string;
  endpoint: string;
  params: {
    key: string;
    signature: string;
    'x-cos-security-token': string;
  };
}

export function getBuildType(filePath: string): UploadBuildType {
  switch (path.extname(filePath).toLowerCase()) {
    case '.ipa':
      return 'ios';
    case '.apk':
      return 'android';
    case '.hap':
      return 'harmonyos';
    default:
      throw new Error('Unsupported file type. Expected an IPA, APK, or HAP file');
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRemainingMs(deadline: number): number {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    throw new Error('Upload timed out while waiting for the app to be published');
  }
  return remaining;
}

async function uploadFile(
  token: UploadToken,
  filePath: string,
  timeoutMs: number
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const form = new FormData();
    form.append('signature', token.params.signature);
    form.append('x-cos-security-token', token.params['x-cos-security-token']);
    form.append('key', token.params.key);
    form.append('x-cos-meta-file-name', path.basename(filePath));
    form.append('file', fs.createReadStream(filePath), {
      filename: path.basename(filePath),
      knownLength: fs.statSync(filePath).size,
    });

    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };

    const request = form.submit(token.endpoint, (error, response) => {
      if (error) {
        finish(error);
        return;
      }

      let responseBody = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => {
        if (responseBody.length < 4096) responseBody += chunk;
      });
      response.on('end', () => {
        if (response.statusCode === 204) {
          finish();
          return;
        }
        const detail = responseBody.trim() ? `: ${responseBody.trim()}` : '';
        finish(
          new Error(
            `Storage upload failed with HTTP ${response.statusCode ?? 'unknown'}${detail}`
          )
        );
      });
    });

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error('Storage upload request timed out'));
    });
    request.on('error', (error) => finish(error));
  });
}

export class FastUploader {
  private readonly api: ApiClient;

  constructor(config: Config) {
    if (!getApiKey(config)) {
      throw new Error('Not authenticated. Run "pgyer auth login" or set PGYER_API_KEY');
    }
    this.api = new ApiClient(config);
  }

  async upload(options: FastUploadOptions): Promise<FastUploadResult> {
    const deadline = Date.now() + options.timeoutMs;
    const buildType = getBuildType(options.filePath);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

    try {
      options.onStatus?.('Requesting upload credentials...');
      const token = await this.api.request<UploadToken>({
        method: 'POST',
        path: '/apiv2/app/getCOSToken',
        params: {
          buildType,
          oversea: options.oversea,
          buildDescription: options.buildDescription,
          buildUpdateDescription: options.buildUpdateDescription,
          buildInstallType: options.buildInstallType,
          buildPassword: options.buildPassword,
          buildInstallDate: options.buildInstallDate,
          buildInstallStartDate: options.buildInstallStartDate,
          buildInstallEndDate: options.buildInstallEndDate,
          buildChannelShortcut: options.buildChannelShortcut,
        },
        signal: controller.signal,
      });

      options.onStatus?.('Uploading app package...');
      await uploadFile(token, options.filePath, getRemainingMs(deadline));

      if (!options.wait) {
        return { status: 'uploaded', uploadKey: token.key };
      }

      options.onStatus?.('Processing app package...');
      const result = await this.waitUntilPublished(
        token.key,
        deadline,
        options.pollIntervalMs,
        controller.signal,
        options.onStatus
      );
      return { status: 'published', uploadKey: token.key, data: result.data };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Upload timed out while waiting for the app to be published');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async getStatus(uploadKey: string): Promise<UploadStatusResult> {
    return this.getStatusWithSignal(uploadKey);
  }

  async waitForBuild(
    uploadKey: string,
    options: WaitForUploadOptions
  ): Promise<UploadStatusResult> {
    const deadline = Date.now() + options.timeoutMs;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      return await this.waitUntilPublished(
        uploadKey,
        deadline,
        options.pollIntervalMs,
        controller.signal,
        options.onStatus
      );
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Upload timed out while waiting for the app to be published');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async getStatusWithSignal(
    uploadKey: string,
    signal?: AbortSignal
  ): Promise<UploadStatusResult> {
    try {
      const data = await this.api.request<UploadBuildInfo>({
        method: 'GET',
        path: '/apiv2/app/buildInfo',
        params: { buildKey: uploadKey },
        signal,
      });
      // The API can briefly return code=0 with buildBuildVersion=0 before
      // the published build receives its final PGYER build number.
      if (Number(data.buildBuildVersion) === 0) {
        return { status: 'pending', uploadKey };
      }
      return { status: 'published', uploadKey, data };
    } catch (error) {
      if (error instanceof ApiError && error.code === 1247) {
        return { status: 'pending', uploadKey };
      }
      throw error;
    }
  }

  private async waitUntilPublished(
    uploadKey: string,
    deadline: number,
    pollIntervalMs: number,
    signal?: AbortSignal,
    onStatus?: (status: string) => void
  ): Promise<UploadStatusResult> {
    while (true) {
      getRemainingMs(deadline);
      const result = await this.getStatusWithSignal(uploadKey, signal);
      if (result.status === 'published') return result;
      onStatus?.('Processing app package...');
      await delay(Math.min(pollIntervalMs, getRemainingMs(deadline)));
    }
  }
}
