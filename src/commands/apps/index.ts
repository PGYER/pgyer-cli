import { type CAC } from 'cac';
import { handleAppsList } from './list';
import { handleAppsInfo } from './info';
import { handleAppsDelete } from './delete';
import { handleAppsResolve } from './resolve';
import { handleAppsUpdate } from './update';

export function registerAppsCommands(cli: CAC): void {
  cli
    .command('apps:list', 'List apps in the current account')
    .usage('apps list [options]')
    .option('--page <number>', 'Page number')
    .option('--all', 'Fetch all app pages')
    .action(async (options: { page?: string; all?: boolean }) => {
      await handleAppsList(options);
    });

  cli
    .command('apps:info <appKey>', 'Show app details')
    .usage('apps info <appKey> [options]')
    .option('--build <buildKey>', 'Show a specific historical build')
    .action(async (appKey: string, options: { build?: string }) => {
      await handleAppsInfo(appKey, options.build);
    });

  cli
    .command('apps:resolve <shortcut>', 'Resolve an app shortcut or PGYER URL')
    .usage('apps resolve <shortcut>')
    .action(async (shortcut: string) => {
      await handleAppsResolve(shortcut);
    });

  cli
    .command('apps:update <appKey>', 'Update app installation and page settings')
    .usage('apps update <appKey> [options]')
    .option('--shortcut <shortcut>', 'Set the app shortcut')
    .option('--install <type>', 'Install type: public, password, or invite')
    .option('--password <password>', 'Installation password (prefer --password-env)')
    .option('--password-env <name>', 'Read installation password from an environment variable')
    .option('--valid-from <date>', 'Install validity start date (YYYY-MM-DD)')
    .option('--valid-until <date>', 'Install validity end date (YYYY-MM-DD)')
    .option('--no-expiry', 'Disable installation expiry')
    .option('--language <language>', 'Page language: zh, en, or auto')
    .option('--version-source <source>', 'Version source: pgyer or app')
    .option('--auto-sync <on|off>', 'Enable or disable app information sync')
    .option('--copyright <on|off>', 'Show or hide PGYER copyright')
    .option('--dry-run', 'Show the proposed changes without modifying the app')
    .action(async (appKey: string, options) => {
      await handleAppsUpdate(appKey, options);
    });

  cli
    .command('apps:delete <appKey>', 'Permanently delete an app and all versions')
    .usage('apps delete <appKey> [options]')
    .option('-f, --force', 'Skip interactive confirmation')
    .option('--dry-run', 'Show the deletion plan without deleting the app')
    .action(async (appKey: string, options: { force?: boolean; dryRun?: boolean }) => {
      await handleAppsDelete(appKey, options.force ?? false, options.dryRun ?? false);
    });
}
