import { type CAC } from 'cac';
import { handleAuthLogin } from './login';
import { handleAuthLogout } from './logout';
import { handleAuthStatus } from './status';
import { handleAuthToken } from './token';

export function registerAuthCommands(cli: CAC): void {
  cli
    .command('auth:login', 'Log in through the PGYER website')
    .usage('auth login')
    .action(async () => {
      await handleAuthLogin();
    });

  cli
    .command('auth:logout', 'Clear locally saved credentials')
    .usage('auth logout')
    .action(() => {
      handleAuthLogout();
    });

  cli
    .command('auth:status', 'Show authentication status')
    .usage('auth status')
    .action(() => {
      handleAuthStatus();
    });

  cli
    .command('auth:token', 'Show the current API token in redacted form')
    .usage('auth token [options]')
    .option('--reveal', 'Reveal the complete API token')
    .action((options: { reveal?: boolean }) => {
      handleAuthToken(options.reveal ?? false);
    });
}
