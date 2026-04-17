import { type CAC } from 'cac';
import { handleAppsList } from './list';
import { handleAppsInfo } from './info';
import { handleAppsDelete } from './delete';

const APPS_ACTIONS = ['list', 'info', 'delete'] as const;

/**
 * Register all apps commands
 */
export function registerAppsCommands(cli: CAC): void {
  cli
    .command('apps <action> [appKey]', 'App management commands')
    .example('pgyer apps list              # List all apps')
    .example('pgyer apps info <appKey>     # Show app details')
    .example('pgyer apps delete <appKey>   # Delete an app')
    .option('-f, --force', 'Skip confirmation (for delete)')
    .action(async (action: string, appKey?: string, options?: { force?: boolean }) => {
      switch (action) {
        case 'list':
          await handleAppsList();
          break;
        case 'info':
          if (!appKey) {
            console.error('Error: appKey is required for info command');
            process.exit(1);
          }
          await handleAppsInfo(appKey);
          break;
        case 'delete':
          if (!appKey) {
            console.error('Error: appKey is required for delete command');
            process.exit(1);
          }
          await handleAppsDelete(appKey, options?.force ?? false);
          break;
        default:
          console.error(`Unknown apps action: ${action}`);
          console.error(`Available actions: ${APPS_ACTIONS.join(', ')}`);
          process.exit(1);
      }
    });
}
