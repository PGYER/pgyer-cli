import { type CAC } from 'cac';
import { handleAuthLogin } from './login';
import { handleAuthLogout } from './logout';
import { handleAuthStatus } from './status';
import { handleAuthToken } from './token';

const AUTH_ACTIONS = ['login', 'logout', 'status', 'token'] as const;

/**
 * Register all auth commands
 */
export function registerAuthCommands(cli: CAC): void {
  cli
    .command('auth <action>', 'Authentication commands')
    .example('pgyer auth login    # Login via browser')
    .example('pgyer auth logout   # Clear saved credentials')
    .example('pgyer auth status   # Show login status')
    .example('pgyer auth token    # Display API token')
    .action(async (action: string) => {
      switch (action) {
        case 'login':
          await handleAuthLogin();
          break;
        case 'logout':
          handleAuthLogout();
          break;
        case 'status':
          handleAuthStatus();
          break;
        case 'token':
          handleAuthToken();
          break;
        default:
          console.error(`Unknown auth action: ${action}`);
          console.error(`Available actions: ${AUTH_ACTIONS.join(', ')}`);
          process.exit(1);
      }
    });
}
