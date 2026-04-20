import { type CAC } from 'cac';
import * as fs from 'fs';
import * as path from 'path';
import { loadConfig, createApiClient, ApiError } from '../../core';
import { createLogger, isHuman } from '../../utils/logger';
import { createSpinner } from '../../utils/spinner';

interface UploadResponse {
  buildKey: string;
  buildVersion: string;
  buildBuildVersion: string;
  buildName?: string;
}

/**
 * Register upload command
 */
export function registerUploadCommand(cli: CAC): void {
  cli
    .command('upload <file>', 'Upload an app package (IPA/APK/HAP)')
    .option('--app-key <key>', 'Target app key (optional)')
    .option('--build-update-description <desc>', 'Version update description')
    .option('--password <pwd>', 'Install password (sets install type to password)')
    .option('--invite-install', 'Set install type to invite (cannot be used with --password)')
    .option('--pubstart <date>', 'Install validity start date (format: YYYY-MM-DD)')
    .option('--pubend <date>', 'Install validity end date (format: YYYY-MM-DD)')
    .option('--short <shortcut>', 'Channel shortcut')
    .action(
      async (
        file: string,
        options: {
          appKey?: string;
          buildUpdateDescription?: string;
          password?: string;
          inviteInstall?: boolean;
          pubstart?: string;
          pubend?: string;
          short?: string;
        }
      ) => {
        const logger = createLogger();
        const spinner = createSpinner('Uploading...');

        try {
          // Validate --invite-install and --password are mutually exclusive
          if (options.inviteInstall && options.password) {
            logger.error('--invite-install and --password cannot be used together');
            process.exit(1);
          }

          // Validate pubstart/pubend
          if ((options.pubstart && !options.pubend) || (!options.pubstart && options.pubend)) {
            logger.error('--pubstart and --pubend must be used together');
            process.exit(1);
          }

          if (options.pubstart && options.pubend) {
            const startDate = new Date(options.pubstart);
            const endDate = new Date(options.pubend);

            if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
              logger.error('Invalid date format. Use YYYY-MM-DD format');
              process.exit(1);
            }

            if (endDate <= startDate) {
              logger.error('--pubend must be greater than --pubstart');
              process.exit(1);
            }
          }

          // Validate file exists
          const filePath = path.resolve(file);
          if (!fs.existsSync(filePath)) {
            logger.error(`File not found: ${filePath}`);
            process.exit(1);
          }

          const config = loadConfig();
          const api = createApiClient(config);

          // Determine install type
          let buildInstallType = 1; // Default: public
          if (options.inviteInstall) {
            buildInstallType = 3; // Invite
          } else if (options.password) {
            buildInstallType = 2; // Password
          }

          // Build form data
          const formData = new FormData();
          const fileContent = fs.readFileSync(filePath);
          const fileName = path.basename(filePath);

          const blob = new Blob([fileContent]);
          formData.append('file', blob, fileName);

          if (options.appKey) {
            formData.append('appKey', options.appKey);
          }
          if (options.buildUpdateDescription) {
            formData.append('buildUpdateDescription', options.buildUpdateDescription);
          }

          formData.append('buildInstallType', String(buildInstallType));

          if (options.password) {
            formData.append('buildPassword', options.password);
          }

          if (options.pubstart && options.pubend) {
            formData.append('buildInstallDate', '1');
            formData.append('buildInstallStartDate', options.pubstart);
            formData.append('buildInstallEndDate', options.pubend);
          }

          if (options.short) {
            formData.append('buildChannelShortcut', options.short);
          }

          spinner.start();
          const data = await api.request<UploadResponse>({
            method: 'POST',
            path: '/apiv2/app/upload',
            body: formData,
          });
          spinner.succeed('Upload successful');

          if (isHuman()) {
            console.log(
              `Version: ${data.buildVersion} (Build ${data.buildBuildVersion})\n` +
              `URL: https://www.pgyer.com/${data.buildKey}`
            );
          } else {
            logger.json({
              success: true,
              buildKey: data.buildKey,
              buildVersion: data.buildVersion,
              buildBuildVersion: data.buildBuildVersion,
            });
          }
        } catch (error) {
          spinner.fail('Upload failed');
          if (error instanceof ApiError) {
            logger.error(`[${error.code}] ${error.message}`);
          } else {
            const message =
              error instanceof Error ? error.message : 'Unknown error';
            logger.error(message);
          }
          process.exit(1);
        }
      }
    );
}
