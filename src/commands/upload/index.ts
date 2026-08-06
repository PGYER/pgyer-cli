import { type CAC } from 'cac';
import * as fs from 'fs';
import * as path from 'path';
import { loadConfig, FastUploader, ApiError } from '../../core';
import { createLogger, isHuman } from '../../utils/logger';
import { createSpinner } from '../../utils/spinner';

interface UploadCliOptions {
  appKey?: string;
  description?: string;
  buildUpdateDescription?: string;
  password?: string;
  passwordEnv?: string | boolean;
  inviteInstall?: boolean;
  pubstart?: string;
  pubend?: string;
  short?: string;
  uploadRegion?: string;
  timeout?: string;
  pollInterval?: string;
  wait?: boolean;
}

function parsePositiveSeconds(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`${name} must be a positive number of seconds`);
  }
  return seconds * 1000;
}

function parseUploadRegion(value: string | undefined): 1 | 2 | undefined {
  switch (value ?? 'auto') {
    case 'auto':
      return undefined;
    case 'overseas':
      return 1;
    case 'domestic':
      return 2;
    default:
      throw new Error('--upload-region must be auto, overseas, or domestic');
  }
}

function validateDate(value: string, name: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`${name} must use YYYY-MM-DD format`);
  }
}

/** Register the API 2.0 fast-upload command. */
export function registerUploadCommand(cli: CAC): void {
  cli
    .command('upload <file>', 'Upload an app package (IPA/APK/HAP)')
    .option('--app-key <key>', 'Deprecated: not supported by the fast upload API')
    .option('--description <text>', 'App description')
    .option('--build-update-description <desc>', 'Version update description')
    .option('--password <pwd>', 'Install password (sets install type to password)')
    .option('--password-env [name]', 'Read install password from an environment variable')
    .option('--invite-install', 'Set install type to invite (cannot be used with --password)')
    .option('--pubstart <date>', 'Install validity start date (YYYY-MM-DD)')
    .option('--pubend <date>', 'Install validity end date (YYYY-MM-DD)')
    .option('--short <shortcut>', 'Channel shortcut')
    .option('--upload-region <region>', 'Upload region: auto, overseas, or domestic')
    .option('--timeout <seconds>', 'Upload and processing timeout in seconds', { default: 300 })
    .option('--poll-interval <seconds>', 'Build processing poll interval in seconds', { default: 4 })
    .option('--no-wait', 'Return after file upload without waiting for processing')
    .action(async (file: string, options: UploadCliOptions) => {
      const logger = createLogger();
      const spinner = createSpinner('Preparing upload...');

      try {
        if (options.appKey) {
          throw new Error(
            '--app-key is not supported by the fast upload API; the app is matched by its package identifier'
          );
        }
        if (options.password !== undefined && options.passwordEnv !== undefined) {
          throw new Error('--password and --password-env cannot be used together');
        }
        const passwordEnvName = options.passwordEnv === true
          ? 'PGYER_INSTALL_PASSWORD'
          : options.passwordEnv;
        const envPassword = passwordEnvName ? process.env[passwordEnvName] : undefined;
        if (passwordEnvName && !envPassword) {
          throw new Error(`Environment variable ${passwordEnvName} is empty or not set`);
        }
        const installPassword = options.password ?? envPassword;

        if (options.inviteInstall && installPassword) {
          throw new Error('--invite-install and --password cannot be used together');
        }
        if ((options.pubstart && !options.pubend) || (!options.pubstart && options.pubend)) {
          throw new Error('--pubstart and --pubend must be used together');
        }
        if (options.pubstart && options.pubend) {
          validateDate(options.pubstart, '--pubstart');
          validateDate(options.pubend, '--pubend');
          if (options.pubend <= options.pubstart) {
            throw new Error('--pubend must be greater than --pubstart');
          }
        }

        const filePath = path.resolve(file);
        if (!fs.existsSync(filePath)) {
          throw new Error(`File not found: ${filePath}`);
        }
        if (!fs.statSync(filePath).isFile()) {
          throw new Error(`Path is not a file: ${filePath}`);
        }

        let buildInstallType = 1;
        if (options.inviteInstall) buildInstallType = 3;
        else if (installPassword) buildInstallType = 2;

        const uploader = new FastUploader(loadConfig());
        spinner.start();
        const result = await uploader.upload({
          filePath,
          buildDescription: options.description,
          buildUpdateDescription: options.buildUpdateDescription,
          buildInstallType,
          buildPassword: installPassword,
          buildInstallDate: options.pubstart ? 1 : undefined,
          buildInstallStartDate: options.pubstart,
          buildInstallEndDate: options.pubend,
          buildChannelShortcut: options.short,
          oversea: parseUploadRegion(options.uploadRegion),
          timeoutMs: parsePositiveSeconds(options.timeout, 300, '--timeout'),
          pollIntervalMs: parsePositiveSeconds(options.pollInterval, 4, '--poll-interval'),
          wait: options.wait !== false,
          onStatus: (status) => spinner.text(status),
        });

        if (result.status === 'uploaded' || !result.data) {
          spinner.succeed('Package uploaded; processing continues on PGYER');
          if (isHuman()) {
            logger.text(`Upload key: ${result.uploadKey}`);
          } else {
            logger.json({
              success: true,
              status: result.status,
              pending: true,
              uploadKey: result.uploadKey,
            });
          }
          return;
        }

        const data = result.data;
        spinner.succeed('Upload and processing completed');
        const url = data.buildShortcutUrl
          ? `https://www.pgyer.com/${data.buildShortcutUrl}`
          : undefined;
        if (isHuman()) {
          logger.text(
            `App: ${data.buildName}\n` +
              `Version: ${data.buildVersion} (Build ${data.buildBuildVersion})\n` +
              `Build Key: ${data.buildKey}` +
              (url ? `\nURL: ${url}` : '')
          );
        } else {
          logger.json({
            success: true,
            status: result.status,
            appKey: data.appKey,
            buildKey: data.buildKey,
            buildName: data.buildName,
            buildVersion: data.buildVersion,
            buildVersionNo: data.buildVersionNo,
            buildBuildVersion: data.buildBuildVersion,
            buildIdentifier: data.buildIdentifier,
            shortcut: data.buildShortcutUrl,
            url,
          });
        }
      } catch (error) {
        spinner.fail('Upload failed');
        if (error instanceof ApiError) {
          logger.error(`[${error.code}] ${error.message}`);
        } else {
          logger.error(error instanceof Error ? error.message : 'Unknown error');
        }
        process.exit(1);
      }
    });
}
