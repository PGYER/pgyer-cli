import { type CAC } from 'cac';
import { ApiError, FastUploader, loadConfig, type UploadStatusResult } from '../../core';
import { createLogger, isHuman } from '../../utils/logger';
import { createSpinner } from '../../utils/spinner';

interface WaitOptions {
  timeout?: string | number;
  pollInterval?: string | number;
}

function parseSeconds(value: string | number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback * 1000;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`${name} must be a positive number of seconds`);
  }
  return seconds * 1000;
}

function outputStatus(result: UploadStatusResult): void {
  const logger = createLogger();
  if (result.status === 'pending' || !result.data) {
    const output = { status: 'pending', pending: true, uploadKey: result.uploadKey };
    if (isHuman()) logger.json(output);
    else logger.json(output);
    return;
  }

  const data = result.data;
  const output = {
    status: 'published',
    pending: false,
    uploadKey: result.uploadKey,
    appKey: data.appKey,
    buildKey: data.buildKey,
    buildName: data.buildName,
    buildVersion: data.buildVersion,
    buildVersionNo: data.buildVersionNo,
    buildBuildVersion: data.buildBuildVersion,
    buildIdentifier: data.buildIdentifier,
    shortcut: data.buildShortcutUrl,
    url: data.buildShortcutUrl ? `https://www.pgyer.com/${data.buildShortcutUrl}` : undefined,
  };
  if (isHuman()) logger.json(output);
  else logger.json(output);
}

function handleError(error: unknown): never {
  const logger = createLogger();
  if (error instanceof ApiError) logger.error(`[${error.code}] ${error.message}`);
  else logger.error(error instanceof Error ? error.message : 'Unknown error');
  process.exit(1);
}

export function registerUploadStatusCommands(cli: CAC): void {
  cli
    .command('uploads:status <uploadKey>', 'Query an asynchronous upload once')
    .usage('uploads status <uploadKey>')
    .action(async (uploadKey: string) => {
      try {
        const uploader = new FastUploader(loadConfig());
        outputStatus(await uploader.getStatus(uploadKey));
      } catch (error) {
        handleError(error);
      }
    });

  cli
    .command('uploads:wait <uploadKey>', 'Wait for an asynchronous upload to finish')
    .usage('uploads wait <uploadKey> [options]')
    .option('--timeout <seconds>', 'Maximum wait time in seconds', { default: 300 })
    .option('--poll-interval <seconds>', 'Polling interval in seconds', { default: 4 })
    .action(async (uploadKey: string, options: WaitOptions) => {
      const spinner = createSpinner('Waiting for app processing...');
      try {
        spinner.start();
        const uploader = new FastUploader(loadConfig());
        const result = await uploader.waitForBuild(uploadKey, {
          timeoutMs: parseSeconds(options.timeout, 300, '--timeout'),
          pollIntervalMs: parseSeconds(options.pollInterval, 4, '--poll-interval'),
          onStatus: (status) => spinner.text(status),
        });
        spinner.succeed('App processing completed');
        outputStatus(result);
      } catch (error) {
        spinner.fail('Upload wait failed');
        handleError(error);
      }
    });
}
