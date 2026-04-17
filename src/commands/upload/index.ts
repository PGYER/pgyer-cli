import { type CAC } from 'cac';
import * as fs from 'fs';
import * as path from 'path';
import { loadConfig, createApiClient, ApiError } from '../../core';
import { createLogger } from '../../utils/logger';
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
    .command('upload <file>', 'Upload an app package (IPA/APK)')
    .option('--app-key <key>', 'Target app key (optional)')
    .option('--build-update-description <desc>', 'Update description')
    .option('--build-install-type <type>', 'Install type: 1=public, 2=password, 3=invite', {
      default: 1,
    })
    .option('--build-password <password>', 'Install password (required when type=2)')
    .action(
      async (
        file: string,
        options: {
          appKey?: string;
          buildUpdateDescription?: string;
          buildInstallType?: number;
          buildPassword?: string;
        }
      ) => {
        const logger = createLogger();
        const spinner = createSpinner('Uploading...');

        try {
          // Validate file exists
          const filePath = path.resolve(file);
          if (!fs.existsSync(filePath)) {
            logger.error(`File not found: ${filePath}`);
            process.exit(1);
          }

          const config = loadConfig();
          const api = createApiClient(config);

          // Build form data
          const formData = new FormData();
          const fileContent = fs.readFileSync(filePath);
          const fileName = path.basename(filePath);

          // Create blob from file content
          const blob = new Blob([fileContent]);
          formData.append('file', blob, fileName);

          if (options.appKey) {
            formData.append('appKey', options.appKey);
          }
          if (options.buildUpdateDescription) {
            formData.append('buildUpdateDescription', options.buildUpdateDescription);
          }
          if (options.buildInstallType) {
            formData.append('buildInstallType', String(options.buildInstallType));
          }
          if (options.buildPassword) {
            formData.append('buildPassword', options.buildPassword);
          }

          spinner.start();
          const data = await api.request<UploadResponse>({
            method: 'POST',
            path: '/apiv2/app/upload',
            body: formData,
          });
          spinner.succeed('Upload successful');

          logger.json({
            success: true,
            buildKey: data.buildKey,
            buildVersion: data.buildVersion,
            buildBuildVersion: data.buildBuildVersion,
          });

          if (process.stdout.isTTY) {
            console.log(
              `Version: ${data.buildVersion} (Build ${data.buildBuildVersion})\n` +
                `URL: https://www.pgyer.com/${data.buildKey}`
            );
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
